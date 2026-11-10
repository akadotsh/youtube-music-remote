use crate::{MediaCommand, MediaController, MediaError, MediaState, SearchResult};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

pub struct DesktopController;

impl DesktopController {
    pub fn new() -> Result<Self, MediaError> {
        Ok(Self)
    }

    pub fn search(_query: &str) -> Result<Vec<SearchResult>, MediaError> {
        Err(MediaError::CommandFailed(
            "YouTube Music search currently requires Chrome on macOS".into(),
        ))
    }

    fn current_session()
    -> Result<Option<(GlobalSystemMediaTransportControlsSession, WinRtApartment)>, MediaError> {
        // WinRT calls require an initialized apartment on each calling thread.
        let apartment = WinRtApartment::initialize()?;
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(win_error)?
            .join()
            .map_err(win_error)?;
        Ok(manager
            .GetCurrentSession()
            .ok()
            .map(|session| (session, apartment)))
    }
}

struct WinRtApartment;

impl WinRtApartment {
    fn initialize() -> Result<Self, MediaError> {
        use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(win_error)?;
        Ok(Self)
    }
}

impl Drop for WinRtApartment {
    fn drop(&mut self) {
        unsafe { windows::Win32::System::WinRT::RoUninitialize() };
    }
}

impl MediaController for DesktopController {
    fn check_compatibility(&self) -> Result<(), MediaError> {
        Self::current_session().map(drop)
    }

    fn current_state(&self) -> Result<Option<MediaState>, MediaError> {
        let Some((session, _apartment)) = Self::current_session()? else {
            return Ok(None);
        };
        let properties = session
            .TryGetMediaPropertiesAsync()
            .map_err(win_error)?
            .join()
            .map_err(win_error)?;
        let timeline = session.GetTimelineProperties().map_err(win_error)?;
        let playback = session.GetPlaybackInfo().map_err(win_error)?;
        let start = timeline.StartTime().map_or(0, |time| time.Duration);
        let position = timeline
            .Position()
            .ok()
            .map(|time| time.Duration.saturating_sub(start).max(0) as f64 / 10_000_000.);
        let duration = timeline
            .EndTime()
            .ok()
            .map(|end| end.Duration.saturating_sub(start).max(0) as f64 / 10_000_000.);
        let source = session
            .SourceAppUserModelId()
            .map(|value| value.to_string())
            .unwrap_or_else(|_| "Windows media session".into());

        Ok(Some(MediaState {
            title: properties
                .Title()
                .map(|value| value.to_string())
                .unwrap_or_default(),
            artist: non_empty(
                properties
                    .Artist()
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
            ),
            album: non_empty(
                properties
                    .AlbumTitle()
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
            ),
            source,
            is_playing: playback.PlaybackStatus().is_ok_and(|status| {
                status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
            }),
            duration,
            position,
            volume: None,
            artwork: None,
            artwork_url: None,
            artwork_mime_type: None,
        }))
    }

    fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        let Some((session, _apartment)) = Self::current_session()? else {
            return Err(MediaError::CommandFailed(
                "No active Windows media session".into(),
            ));
        };
        let result = match command {
            MediaCommand::Play => session.TryPlayAsync().map(|op| op.join()),
            MediaCommand::Pause => session.TryPauseAsync().map(|op| op.join()),
            MediaCommand::Next => session.TrySkipNextAsync().map(|op| op.join()),
            MediaCommand::Previous => session.TrySkipPreviousAsync().map(|op| op.join()),
            MediaCommand::Seek(seconds)
                if seconds.is_finite()
                    && seconds >= 0.
                    && seconds <= i64::MAX as f64 / 10_000_000. =>
            {
                let start = session
                    .GetTimelineProperties()
                    .map_err(win_error)?
                    .StartTime()
                    .map_or(0, |time| time.Duration);
                let Some(position) = ((seconds * 10_000_000.).round() as i64).checked_add(start)
                else {
                    return Err(MediaError::InvalidSeek);
                };
                session
                    .TryChangePlaybackPositionAsync(position)
                    .map(|op| op.join())
            }
            MediaCommand::Seek(_) => return Err(MediaError::InvalidSeek),
            MediaCommand::SetVolume(_) => {
                return Err(MediaError::CommandFailed(
                    "Volume control requires an open YouTube Music tab".into(),
                ));
            }
            MediaCommand::SetSystemVolume(_) => {
                return Err(MediaError::CommandFailed(
                    "Windows system volume control is unavailable".into(),
                ));
            }
            MediaCommand::PlaySong(_) => {
                return Err(MediaError::CommandFailed(
                    "YouTube Music search currently requires Chrome on macOS".into(),
                ));
            }
        }
        .map_err(win_error)?
        .map_err(win_error)?;
        if result {
            Ok(())
        } else {
            Err(MediaError::CommandFailed(
                "The active Windows media session rejected the command".into(),
            ))
        }
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

fn win_error(error: impl std::fmt::Display) -> MediaError {
    MediaError::CommandFailed(error.to_string())
}
