# YouTube Music Remote

An open-source remote for controlling the active media player on a Mac from an Android phone. Audio never leaves the computer.

## Current desktop POC

The Rust controller in [`apps/desktop`](apps/desktop) targets an open YouTube Music tab in Chrome, with MediaRemote as a fallback for other players. It provides a verified CLI and a functional GPUI player.

## What works

- Play, pause, previous, next, and seeking
- Phone volume slider for the YouTube Music tab, independent of other Mac audio
- Separate Mac output-volume slider, affecting all system audio
- Search songs from the phone and play a result in the existing YouTube Music tab
- Current title, artist, artwork, duration, and playback position
- YouTube Music stays selected when another Chrome tab starts playing media
- A native GPUI desktop player with live media updates
- MediaRemote compatibility checks on macOS
- A Cloudflare relay and installable Android PWA connected through desktop pairing

## Requirements

- Node.js 20 or newer
- pnpm 10
- Rust 1.92 or newer
- CMake and Xcode Command Line Tools (source builds only)
- A free Cloudflare account

## Install and verify

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm desktop:check
```

Create a self-contained, ad-hoc signed macOS application with `pnpm desktop:bundle`. End users of the bundle do not need Homebrew, CMake, Rust, or `media-control`.

### Keep awake while playing

Enable **Keep awake while playing** in the desktop agent to prevent idle system sleep during playback. The display can still turn off, and the Mac can stay locked. Protection is released when playback pauses or stops, media-state reading fails, the checkbox is cleared, or the agent exits. The checkbox starts unchecked each launch; it does not change macOS power settings permanently.

This does not override **Apple menu → Sleep**, closing the lid, or macOS safety-related sleep. Keeping the Mac awake uses more battery than sleep. Leave the agent running and use **Lock Screen**, rather than Sleep, when controlling music from your phone.

## Deploy the relay

Authenticate Wrangler and deploy the Worker and its Durable Objects:

```sh
pnpm --filter @yt-remote/relay exec wrangler login
pnpm --filter @yt-remote/relay deploy
```

Keep the resulting `https://…workers.dev` URL. The default configuration uses only free-tier Cloudflare services.

Paste that URL into **Phone pairing** in the desktop app and create a six-digit code.

For local relay development:

```sh
pnpm --filter @yt-remote/relay dev
```

## Deploy the PWA

Build the static site:

```sh
pnpm --filter @yt-remote/web build
```

Deploy `apps/web/dist` to Cloudflare Pages or any HTTPS static host. For Cloudflare Pages with Wrangler:

```sh
pnpm --filter @yt-remote/relay exec wrangler pages deploy ../../apps/web/dist
```

Open the deployed URL on Android, enter the relay URL and desktop pairing code, then use the browser's **Add to Home screen** action.

## Architecture

```text
Android PWA ⇄ WSS ⇄ Cloudflare Worker / Durable Object ⇄ WSS ⇄ Rust desktop app ⇄ MediaRemote
```

The shared `@yt-remote/protocol` package validates messages at the relay boundary. A room accepts commands only from the paired remote and state updates only from the desktop app. Pairing attempts are limited to ten per IP address per five minutes. Tokens are stored as SHA-256 hashes in Durable Object storage.

## Workspace

```text
apps/desktop    Rust media controller, GPUI app, and relay client
apps/relay      Cloudflare Worker and Durable Objects
apps/web        React, Tailwind CSS, shadcn-style PWA
packages/protocol  Shared messages and validation
```

## License

MIT
