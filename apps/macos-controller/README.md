# macOS media controller POC

This local Swift CLI reads and controls the current macOS Now Playing session. It does not use the Chrome extension, browser automation, the relay, or the PWA. Playback remains in the original application.

It invokes [`media-control`](https://github.com/ungive/media-control), the BSD-licensed reference CLI that bundles [`mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter).

## Setup

```sh
brew tap ungive/media-control
brew install media-control
cd apps/macos-controller
swift run yt-remote-macos check
```

The compatibility check must print `MediaRemote is working on this Mac.` before relying on the controller.

## Commands

```sh
swift run yt-remote-macos status
swift run yt-remote-macos play
swift run yt-remote-macos pause
swift run yt-remote-macos next
swift run yt-remote-macos previous
swift run yt-remote-macos seek 60
```

`status` prints the title, artist, album, source application, playback state and progress. When artwork is present, it decodes it into the system temporary directory and prints the resulting path.

## YouTube Music verification

1. Open YouTube Music in Chrome and start a queue with at least two tracks.
2. Run `swift run yt-remote-macos status` and confirm the source is `com.google.Chrome` and the displayed track matches Chrome.
3. Run `next`, then `status`; confirm YouTube Music moved to the next item in its existing queue.
4. Run `previous`, then `status`; confirm the original item returns.
5. Run `pause`, `play`, and `seek 30`, checking the Chrome player after each command.

MediaRemote controls whichever application macOS considers the active Now Playing session. Pause other media applications before this test so commands are not routed to the wrong player.

## Limitations

- MediaRemote is a private Apple framework. macOS updates can break it without notice; rerun `check` after an OS update.
- There is no public macOS API for selecting a particular Chrome tab or media application. Commands target the active Now Playing session.
- Seek, artwork, and metadata availability depend on the player. A missing field is not necessarily an adapter failure.
- This POC depends on Homebrew's `media-control`. A packaged application should bundle and sign the adapter instead.
- Search, queue inspection, likes and other YouTube Music-specific features are unavailable through MediaRemote.
