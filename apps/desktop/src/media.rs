use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::{env, error::Error, fmt, path::PathBuf, process::Command};

#[derive(Debug, PartialEq)]
pub struct MediaState {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub source: String,
    pub is_playing: bool,
    pub duration: Option<f64>,
    pub position: Option<f64>,
    pub volume: Option<f64>,
    pub artwork: Option<Vec<u8>>,
    pub artwork_url: Option<String>,
    pub artwork_mime_type: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum MediaCommand {
    Play,
    Pause,
    Next,
    Previous,
    Seek(f64),
    SetVolume(f64),
    SetSystemVolume(f64),
}

pub trait MediaController {
    fn check_compatibility(&self) -> Result<(), MediaError>;
    fn current_state(&self) -> Result<Option<MediaState>, MediaError>;
    fn send(&self, command: MediaCommand) -> Result<(), MediaError>;
}

pub struct MediaRemoteAdapter {
    script: PathBuf,
    framework: PathBuf,
    test_client: PathBuf,
}

impl MediaRemoteAdapter {
    pub fn new() -> Result<Self, MediaError> {
        if let Some(directory) = env::var_os("YT_REMOTE_MEDIAREMOTE_ADAPTER_DIR") {
            return Self::from_resource_directory(directory.into());
        }

        let executable = env::current_exe().map_err(MediaError::CurrentExecutable)?;
        let executable_directory = executable
            .parent()
            .ok_or(MediaError::ResourcesUnavailable)?;
        let candidates = [
            executable_directory
                .parent()
                .map(|contents| contents.join("Resources/mediaremote-adapter")),
            executable_directory
                .parent()
                .map(|target| target.join("mediaremote-adapter")),
        ];

        candidates
            .into_iter()
            .flatten()
            .find(|directory| directory.is_dir())
            .ok_or(MediaError::ResourcesUnavailable)
            .and_then(Self::from_resource_directory)
    }

    pub fn from_resource_directory(directory: PathBuf) -> Result<Self, MediaError> {
        let adapter = Self {
            script: directory.join("mediaremote-adapter.pl"),
            framework: directory.join("MediaRemoteAdapter.framework"),
            test_client: directory.join("MediaRemoteAdapterTestClient"),
        };
        for path in [&adapter.script, &adapter.framework, &adapter.test_client] {
            if !path.exists() {
                return Err(MediaError::MissingResource(path.clone()));
            }
        }
        Ok(adapter)
    }

    fn run(&self, arguments: &[String]) -> Result<String, MediaError> {
        let output = Command::new("/usr/bin/perl")
            .arg(&self.script)
            .arg(&self.framework)
            .arg(&self.test_client)
            .args(arguments)
            .output()
            .map_err(MediaError::LaunchFailed)?;

        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(MediaError::CommandFailed(if message.is_empty() {
                format!("mediaremote-adapter exited with {}", output.status)
            } else {
                message
            }));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    fn arguments(command: &MediaCommand) -> Result<Vec<String>, MediaError> {
        match command {
            MediaCommand::Play => Ok(vec!["send".into(), "0".into()]),
            MediaCommand::Pause => Ok(vec!["send".into(), "1".into()]),
            MediaCommand::Next => Ok(vec!["send".into(), "4".into()]),
            MediaCommand::Previous => Ok(vec!["send".into(), "5".into()]),
            MediaCommand::Seek(seconds)
                if seconds.is_finite()
                    && *seconds >= 0.0
                    && *seconds <= u64::MAX as f64 / 1_000_000.0 =>
            {
                Ok(vec![
                    "seek".into(),
                    (seconds * 1_000_000.0).round().to_string(),
                ])
            }
            MediaCommand::Seek(_) => Err(MediaError::InvalidSeek),
            MediaCommand::SetVolume(_) => Err(MediaError::CommandFailed(
                "Volume control requires an open YouTube Music tab".into(),
            )),
            MediaCommand::SetSystemVolume(_) => Err(MediaError::CommandFailed(
                "Mac volume must be controlled through the desktop controller".into(),
            )),
        }
    }
}

impl MediaController for MediaRemoteAdapter {
    fn check_compatibility(&self) -> Result<(), MediaError> {
        self.run(&["test".into()]).map(drop)
    }

    fn current_state(&self) -> Result<Option<MediaState>, MediaError> {
        let output = self.run(&["get".into(), "--now".into()])?;
        if output == "null" {
            return Ok(None);
        }

        let payload: AdapterPayload = serde_json::from_str(&output)?;
        Ok(Some(MediaState {
            title: payload.title,
            artist: payload.artist,
            album: payload.album,
            source: payload
                .parent_application_bundle_identifier
                .unwrap_or(payload.bundle_identifier),
            is_playing: payload.playing,
            duration: payload.duration,
            position: payload.elapsed_time_now.or(payload.elapsed_time),
            volume: None,
            artwork: payload
                .artwork_data
                .and_then(|value| STANDARD.decode(value).ok()),
            artwork_mime_type: payload.artwork_mime_type,
            artwork_url: None,
        }))
    }

    fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        self.run(&Self::arguments(&command)?).map(drop)
    }
}

#[derive(Debug)]
pub enum MediaError {
    ResourcesUnavailable,
    MissingResource(PathBuf),
    CurrentExecutable(std::io::Error),
    LaunchFailed(std::io::Error),
    CommandFailed(String),
    InvalidResponse(serde_json::Error),
    InvalidSeek,
}

impl fmt::Display for MediaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ResourcesUnavailable => write!(
                formatter,
                "bundled media adapter not found; run `pnpm desktop:prepare-adapter` when developing"
            ),
            Self::MissingResource(path) => {
                write!(
                    formatter,
                    "media adapter resource is missing: {}",
                    path.display()
                )
            }
            Self::CurrentExecutable(error) => {
                write!(
                    formatter,
                    "could not locate the current executable: {error}"
                )
            }
            Self::LaunchFailed(error) => {
                write!(formatter, "could not launch media adapter: {error}")
            }
            Self::CommandFailed(message) => formatter.write_str(message),
            Self::InvalidResponse(error) => {
                write!(formatter, "invalid media adapter response: {error}")
            }
            Self::InvalidSeek => {
                formatter.write_str("seek expects a non-negative number of seconds")
            }
        }
    }
}

impl Error for MediaError {}

impl From<serde_json::Error> for MediaError {
    fn from(error: serde_json::Error) -> Self {
        Self::InvalidResponse(error)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdapterPayload {
    bundle_identifier: String,
    parent_application_bundle_identifier: Option<String>,
    playing: bool,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    elapsed_time: Option<f64>,
    elapsed_time_now: Option<f64>,
    artwork_data: Option<String>,
    artwork_mime_type: Option<String>,
}
