mod media;
mod relay;
mod system_volume;
#[cfg(windows)]
mod windows_controller;
#[cfg(not(windows))]
mod youtube_music;

pub use media::{
    MediaCommand, MediaController, MediaError, MediaRemoteAdapter, MediaState, SearchResult,
};
pub use relay::{
    RelayEvent, RelayStatus, SavedConnection, load_connection, pair, run_relay, save_connection,
};
#[cfg(windows)]
pub use windows_controller::DesktopController;
#[cfg(not(windows))]
pub use youtube_music::DesktopController;
