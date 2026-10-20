use crate::{MediaCommand, MediaController, MediaError, MediaRemoteAdapter, MediaState};
use serde::Deserialize;
use std::process::Command;

pub struct DesktopController {
    system: MediaRemoteAdapter,
}

impl DesktopController {
    pub fn new() -> Result<Self, MediaError> {
        Ok(Self {
            system: MediaRemoteAdapter::new()?,
        })
    }

    fn youtube_music_state(&self) -> Result<Option<MediaState>, MediaError> {
        let Some(raw) = run_in_youtube_music(READ_STATE)? else {
            return Ok(None);
        };
        let state: BrowserState = serde_json::from_str(&raw)?;
        let state = MediaState {
            title: state.title,
            artist: non_empty(state.artist),
            album: None,
            source: "YouTube Music".into(),
            is_playing: state.is_playing,
            duration: valid_time(state.duration),
            position: valid_time(state.position),
            volume: state
                .volume
                .filter(|value| value.is_finite() && (0. ..=1.).contains(value)),
            artwork: None,
            artwork_url: state.artwork.and_then(|value| artwork_url(&value)),
            artwork_mime_type: None,
        };

        Ok(Some(state))
    }
}

impl MediaController for DesktopController {
    fn check_compatibility(&self) -> Result<(), MediaError> {
        self.system.check_compatibility()
    }

    fn current_state(&self) -> Result<Option<MediaState>, MediaError> {
        match self.youtube_music_state().map_err(chrome_setup_error)? {
            Some(state) => Ok(Some(state)),
            None => self.system.current_state(),
        }
    }

    fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        let script = command_script(&command)?;
        match run_in_youtube_music(&script).map_err(chrome_setup_error)? {
            Some(result) if result == "ok" => Ok(()),
            Some(_) => Err(MediaError::CommandFailed(
                "YouTube Music player control is unavailable".into(),
            )),
            None => self.system.send(command),
        }
    }
}

fn run_in_youtube_music(javascript: &str) -> Result<Option<String>, MediaError> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", CHROME_SCRIPT, javascript])
        .output()
        .map_err(MediaError::LaunchFailed)?;
    if !output.status.success() {
        return Err(MediaError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let output = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    Ok((output != NO_TAB).then_some(output))
}

fn command_script(command: &MediaCommand) -> Result<String, MediaError> {
    Ok(match command {
        MediaCommand::Play => PLAYER_COMMAND.replace("COMMAND", "video.play()"),
        MediaCommand::Pause => PLAYER_COMMAND.replace("COMMAND", "video.pause()"),
        MediaCommand::Seek(position) if position.is_finite() && *position >= 0. => PLAYER_COMMAND
            .replace(
                "COMMAND",
                &format!("video.currentTime = Math.min({position}, video.duration || {position})"),
            ),
        MediaCommand::Seek(_) => return Err(MediaError::InvalidSeek),
        MediaCommand::SetVolume(volume) if volume.is_finite() && (0. ..=1.).contains(volume) => {
            PLAYER_COMMAND.replace(
                "COMMAND",
                &format!("video.volume = {volume}; video.muted = false"),
            )
        }
        MediaCommand::SetVolume(_) => {
            return Err(MediaError::CommandFailed(
                "Volume must be between 0 and 1".into(),
            ));
        }
        MediaCommand::Next => BUTTON_COMMAND.replace("SELECTORS", NEXT_SELECTORS),
        MediaCommand::Previous => BUTTON_COMMAND.replace("SELECTORS", PREVIOUS_SELECTORS),
    })
}

fn chrome_setup_error(error: MediaError) -> MediaError {
    let message = error.to_string();
    if message.contains("Apple Events") || message.contains("execute javascript") {
        MediaError::CommandFailed(
            "Enable View > Developer > Allow JavaScript from Apple Events in Chrome".into(),
        )
    } else {
        error
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn artwork_url(value: &str) -> Option<String> {
    let mut url = url::Url::parse(value).ok()?;
    let host = url.host_str()?;
    if url.scheme() != "https" {
        return None;
    }
    if host.ends_with(".googleusercontent.com") || host.ends_with(".ggpht.com") {
        let path = url.path().split('=').next().unwrap_or(url.path());
        url.set_path(&format!("{path}=w1024-h1024-l90-rj"));
    }
    Some(url.into())
}

fn valid_time(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite() && *value >= 0.)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    title: String,
    artist: String,
    #[serde(default)]
    artwork: Option<String>,
    is_playing: bool,
    duration: Option<f64>,
    position: Option<f64>,
    #[serde(default)]
    volume: Option<f64>,
}

const NO_TAB: &str = "__YT_REMOTE_NO_TAB__";
const CHROME_SCRIPT: &str = r#"
on run argv
  if not (application "Google Chrome" is running) then return "__YT_REMOTE_NO_TAB__"
  set pageScript to item 1 of argv
  tell application "Google Chrome"
    repeat with browserWindow in windows
      set tabURLs to URL of tabs of browserWindow
      repeat with tabIndex from 1 to count of tabURLs
        if item tabIndex of tabURLs starts with "https://music.youtube.com/" then
          return execute tab tabIndex of browserWindow javascript pageScript
        end if
      end repeat
    end repeat
  end tell
  return "__YT_REMOTE_NO_TAB__"
end run
"#;

const READ_STATE: &str = r#"(() => {
  const video = document.querySelector('video');
  const text = (selectors) => selectors.map((selector) => document.querySelector(selector)).find(Boolean)?.textContent?.trim() || '';
  const cover = document.querySelector('ytmusic-player-bar img');
  return JSON.stringify({
    title: text(['ytmusic-player-bar .title', '.content-info-wrapper .title']),
    artist: text(['ytmusic-player-bar .byline', '.content-info-wrapper .byline']),
    artwork: cover?.currentSrc || cover?.src || null,
    isPlaying: Boolean(video && !video.paused && !video.ended),
    volume: video ? (video.muted ? 0 : video.volume) : null,
    duration: Number.isFinite(video?.duration) ? video.duration : null,
    position: Number.isFinite(video?.currentTime) ? video.currentTime : null
  });
})()"#;

const PLAYER_COMMAND: &str = r#"(() => {
  const video = document.querySelector('video');
  if (!video) return 'missing';
  COMMAND;
  return 'ok';
})()"#;
const BUTTON_COMMAND: &str = r#"(() => {
  const button = SELECTORS.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!button) return 'missing';
  button.click();
  return 'ok';
})()"#;
const NEXT_SELECTORS: &str = "['ytmusic-player-bar .next-button', 'button[aria-label^=\"Next\"]']";
const PREVIOUS_SELECTORS: &str =
    "['ytmusic-player-bar .previous-button', 'button[aria-label^=\"Previous\"]']";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_large_google_cover_only_for_google_hosts() {
        assert_eq!(
            artwork_url("https://lh3.googleusercontent.com/cover=w60-h60-l90-rj").as_deref(),
            Some("https://lh3.googleusercontent.com/cover=w1024-h1024-l90-rj")
        );
        assert_eq!(
            artwork_url("https://example.com/cover=w60").as_deref(),
            Some("https://example.com/cover=w60")
        );
        assert!(artwork_url("javascript:alert(1)").is_none());
    }

    #[test]
    fn builds_tab_specific_commands() {
        assert!(
            command_script(&MediaCommand::Next)
                .unwrap()
                .contains(".next-button")
        );
        assert!(
            command_script(&MediaCommand::Seek(42.5))
                .unwrap()
                .contains("42.5")
        );
        assert!(command_script(&MediaCommand::Seek(-1.)).is_err());
    }

    #[test]
    fn builds_tab_volume_commands_and_rejects_invalid_levels() {
        for volume in [0., 0.5, 1.] {
            let script = command_script(&MediaCommand::SetVolume(volume)).unwrap();
            assert!(script.contains(&format!("video.volume = {volume}; video.muted = false")));
        }
        for volume in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
            assert!(command_script(&MediaCommand::SetVolume(volume)).is_err());
        }
    }

    #[test]
    fn parses_browser_state() {
        let state: BrowserState = serde_json::from_str(
            r#"{"title":"Song","artist":"Artist","artwork":"https://lh3.googleusercontent.com/cover","isPlaying":true,"duration":120,"position":10,"volume":0.5}"#,
        )
        .unwrap();
        assert_eq!(state.title, "Song");
        assert_eq!(state.position, Some(10.));
        assert_eq!(state.volume, Some(0.5));
        assert_eq!(
            state.artwork.as_deref(),
            Some("https://lh3.googleusercontent.com/cover")
        );
    }
}
