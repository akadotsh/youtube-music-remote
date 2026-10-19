# YouTube Music Remote

An open-source remote for controlling the active media player on a Mac from an Android phone. Audio never leaves the computer.

## Current desktop POC

The Rust controller in [`apps/desktop`](apps/desktop) uses MediaRemote to control Chrome and compatible desktop players without browser automation. It provides a verified CLI and a functional GPUI player.

## What works

- Play, pause, previous, next, and seeking
- Current title, artist, artwork, duration, and playback position
- A native GPUI desktop player with live media updates
- MediaRemote compatibility checks on macOS
- A separately tested Cloudflare relay and installable Android PWA, not yet connected to the Rust desktop app

## Requirements

- Node.js 20 or newer
- pnpm 10
- Rust 1.92 or newer
- CMake and Xcode Command Line Tools (source builds only)
- A free Cloudflare account

## Install and verify

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
cargo test
pnpm desktop:check
```

Create a self-contained, ad-hoc signed macOS application with `pnpm desktop:bundle`. End users of the bundle do not need Homebrew, CMake, Rust, or `media-control`.

## Deploy the relay

Authenticate Wrangler and deploy the Worker and its Durable Objects:

```sh
pnpm --filter @yt-remote/relay exec wrangler login
pnpm --filter @yt-remote/relay deploy
```

Keep the resulting `https://…workers.dev` URL. The default configuration uses only free-tier Cloudflare services.

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
pnpm exec wrangler pages deploy apps/web/dist
```

Open the deployed URL on Android, enter the same relay URL and pairing code, then use the browser's **Add to Home screen** action.

## Architecture

```text
Android PWA ⇄ WSS ⇄ Cloudflare Worker / Durable Object ⇄ WSS ⇄ Rust desktop app ⇄ MediaRemote
```

The shared `@yt-remote/protocol` package validates messages at the relay boundary. A room accepts commands only from the paired remote and state updates only from the desktop app. Pairing attempts are limited to ten per IP address per five minutes. Tokens are stored as SHA-256 hashes in Durable Object storage.

## Workspace

```text
apps/desktop    Rust media controller and future GPUI app
apps/relay      Cloudflare Worker and Durable Objects
apps/web        React, Tailwind CSS, shadcn-style PWA
packages/protocol  Shared messages and validation
```

## License

MIT
