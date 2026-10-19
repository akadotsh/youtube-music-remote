use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::{error::Error, fmt, process::Command};

#[derive(Debug, PartialEq)]
pub struct MediaState {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub source: String,
    pub is_playing: bool,
    pub duration: Option<f64>,
    pub position: Option<f64>,
    pub artwork: Option<Vec<u8>>,
    pub artwork_mime_type: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum MediaCommand {
    Play,
    Pause,
    Next,
    Previous,
    Seek(f64),
}

pub trait MediaController {
    fn check_compatibility(&self) -> Result<(), MediaError>;
    fn current_state(&self) -> Result<Option<MediaState>, MediaError>;
    fn send(&self, command: MediaCommand) -> Result<(), MediaError>;
}

pub struct MediaControlAdapter {
    executable: String,
}

impl MediaControlAdapter {
    pub fn new() -> Self {
        Self::with_executable("media-control")
    }

    pub fn with_executable(executable: impl Into<String>) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    fn run(&self, arguments: &[String]) -> Result<String, MediaError> {
        let output = Command::new(&self.executable)
            .args(arguments)
            .output()
            .map_err(|_| MediaError::Unavailable)?;

        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(MediaError::CommandFailed(if message.is_empty() {
                format!("media-control exited with {}", output.status)
            } else {
                message
            }));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    fn arguments(command: &MediaCommand) -> Result<Vec<String>, MediaError> {
        match command {
            MediaCommand::Play => Ok(vec!["play".into()]),
            MediaCommand::Pause => Ok(vec!["pause".into()]),
            MediaCommand::Next => Ok(vec!["next-track".into()]),
            MediaCommand::Previous => Ok(vec!["previous-track".into()]),
            MediaCommand::Seek(seconds) if seconds.is_finite() && *seconds >= 0.0 => {
                Ok(vec!["seek".into(), seconds.to_string()])
            }
            MediaCommand::Seek(_) => Err(MediaError::InvalidSeek),
        }
    }
}

impl Default for MediaControlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaController for MediaControlAdapter {
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
            artwork: payload
                .artwork_data
                .and_then(|value| STANDARD.decode(value).ok()),
            artwork_mime_type: payload.artwork_mime_type,
        }))
    }

    fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        self.run(&Self::arguments(&command)?).map(drop)
    }
}

#[derive(Debug)]
pub enum MediaError {
    Unavailable,
    CommandFailed(String),
    InvalidResponse(serde_json::Error),
    InvalidSeek,
}

impl fmt::Display for MediaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => write!(
                formatter,
                "install media-control with: brew tap ungive/media-control && brew install media-control"
            ),
            Self::CommandFailed(message) => formatter.write_str(message),
            Self::InvalidResponse(error) => {
                write!(formatter, "invalid media-control response: {error}")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_playback_commands() {
        assert_eq!(
            MediaControlAdapter::arguments(&MediaCommand::Play).unwrap(),
            ["play"]
        );
        assert_eq!(
            MediaControlAdapter::arguments(&MediaCommand::Pause).unwrap(),
            ["pause"]
        );
        assert_eq!(
            MediaControlAdapter::arguments(&MediaCommand::Next).unwrap(),
            ["next-track"]
        );
        assert_eq!(
            MediaControlAdapter::arguments(&MediaCommand::Previous).unwrap(),
            ["previous-track"]
        );
        assert_eq!(
            MediaControlAdapter::arguments(&MediaCommand::Seek(42.5)).unwrap(),
            ["seek", "42.5"]
        );
    }

    #[test]
    fn rejects_invalid_seek() {
        assert!(matches!(
            MediaControlAdapter::arguments(&MediaCommand::Seek(-1.0)),
            Err(MediaError::InvalidSeek)
        ));
    }
}
