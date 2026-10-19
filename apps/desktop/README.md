# Desktop controller

This Rust controller reads and controls the current macOS Now Playing session. Playback remains in the original application.

It currently invokes [`media-control`](https://github.com/ungive/media-control), the BSD-licensed reference CLI that bundles [`mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter).

## Setup

```sh
brew tap ungive/media-control
brew install media-control
cargo run --bin yt-remote-media -- check
```

## Commands

```sh
cargo run --bin yt-remote-media -- status
cargo run --bin yt-remote-media -- play
cargo run --bin yt-remote-media -- pause
cargo run --bin yt-remote-media -- next
cargo run --bin yt-remote-media -- previous
cargo run --bin yt-remote-media -- seek 60
```

`status` prints the title, artist, album, source application, playback state and progress. When artwork is present, it decodes it into the system temporary directory and prints the resulting path.

## Limitations

- MediaRemote is a private Apple framework. macOS updates can break it without notice; rerun `check` after an OS update.
- Commands target the active Now Playing session. There is no public macOS API for selecting a particular Chrome tab.
- Seek, artwork and metadata availability depend on the player.
- The POC depends on Homebrew's `media-control`. A packaged application should bundle and sign the adapter.
- Search and other YouTube Music-specific features are unavailable through MediaRemote.
