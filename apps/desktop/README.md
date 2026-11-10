# Desktop controller

This Rust controller reads and controls the current macOS or Windows media session while ignoring browser video sessions on macOS. YouTube Music in Chrome on macOS also supports search and tab-specific volume. Playback remains in the original application.

The GPUI desktop app shows the active song, artwork where available, playback progress and media controls. Run it during development with:

```sh
pnpm desktop:run
```

It opens as a normal Dock application and exits when its window is closed. The current interface is a functional baseline that can be restyled once the final design is ready.

After deploying the Cloudflare relay, paste its URL into **Phone pairing** and create a code. The relay connection is saved in the platform's application data directory and restored on the next launch.

The macOS packaged application includes [`mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter). Windows uses the built-in Global System Media Transport Controls API.

## Setup

```sh
brew install cmake
pnpm desktop:prepare-adapter
pnpm desktop:check
```

On Windows, install the Visual Studio C++ build tools and run `pnpm desktop:check`; the MediaRemote adapter setup applies only to macOS.

CMake and Xcode Command Line Tools are macOS build-time dependencies only. Build with `pnpm desktop:bundle`; macOS output is written to `target/bundle/macos/YouTube Music Remote.app`, and Windows output to `target/bundle/windows/YouTube Music Remote.exe`.

On macOS, enable **View > Developer > Allow JavaScript from Apple Events** in Chrome. This lets the desktop app address the YouTube Music tab directly without bringing it to the foreground. Approve the macOS Automation prompt the first time the app connects to Chrome.

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

- macOS MediaRemote is a private Apple framework. macOS updates can break it without notice; rerun `check` after an OS update.
- Windows reads the active player through GSMTC. The Windows API does not provide artwork or system output volume through this interface.
- Windows build output is a standalone `.exe` bundle; run `pnpm desktop:bundle` from Windows with Rust and the Visual Studio C++ build tools installed.
- Direct tab enhancements currently support Google Chrome. Other browsers use the active macOS Now Playing session.
- YouTube Music page markup can change; update the selectors in `youtube_music.rs` if controls stop resolving.
- Seek, artwork and metadata availability depend on the player.
- Local bundles use an ad-hoc signature. Public downloads would require Apple Developer signing and notarization to avoid Gatekeeper warnings.
- Search and tab-specific volume are unavailable through MediaRemote.
