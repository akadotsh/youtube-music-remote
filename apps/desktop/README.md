# Desktop controller

This Rust controller reads and controls the current macOS Now Playing session. Playback remains in the original application.

The GPUI desktop app shows the active song, artwork, playback progress and media controls. Run it during development with:

```sh
pnpm desktop:run
```

It opens as a normal Dock application and exits when its window is closed. The current interface is a functional baseline that can be restyled once the final design is ready.

The packaged application includes [`mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter), so users do not need Homebrew or a separate media-control installation.

## Setup

```sh
brew install cmake
pnpm desktop:prepare-adapter
pnpm desktop:check
```

CMake and Xcode Command Line Tools are build-time dependencies only. Build the self-contained application with `pnpm desktop:bundle`; the result is written to `target/bundle/macos/YouTube Music Remote.app`.

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
- Local bundles use an ad-hoc signature. Public downloads would require Apple Developer signing and notarization to avoid Gatekeeper warnings.
- Search and other YouTube Music-specific features are unavailable through MediaRemote.
