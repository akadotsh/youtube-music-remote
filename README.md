# YouTube Music Remote

An open-source Android PWA that controls YouTube Music playing in an existing Chrome tab on a Mac. Commands and metadata travel through a Cloudflare Durable Object; audio and Google credentials never leave the Mac.

## Current native POC

The local macOS controller is in [`apps/macos-controller`](apps/macos-controller). It uses MediaRemote to control the active player—including Chrome and compatible desktop players—without the extension or remote infrastructure. See its README for setup, commands, verification steps and private-API limitations.

## What works

- Secure, six-digit device pairing with five-minute expiry and rate limiting
- Revocable 256-bit device credentials
- Play, pause, previous, next, and seeking
- Current title, artist, artwork, duration, and playback position
- YouTube Music webpage search and result playback
- Automatic WebSocket reconnection and peer connection status
- Installable Android PWA with an offline app shell

## Requirements

- Node.js 20 or newer
- pnpm 10
- A free Cloudflare account
- Google Chrome on the Mac

## Install and verify

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

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

## Install the Chrome extension

```sh
pnpm --filter @yt-remote/extension build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`. Open [YouTube Music](https://music.youtube.com), then open the extension popup. Enter the relay URL and create a pairing code.

The extension requests access only to YouTube Music, Cloudflare `workers.dev` relays, local development hosts, tabs, and its own local storage. If you deploy the relay on a custom domain, add that origin to `host_permissions` in `apps/extension/public/manifest.json` before building.

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
Android PWA ⇄ WSS ⇄ Cloudflare Worker / Durable Object ⇄ WSS ⇄ Chrome extension ⇄ YouTube Music DOM
```

The shared `@yt-remote/protocol` package validates messages at the relay boundary. A room accepts commands only from the paired remote and state/results only from the extension. Pairing attempts are limited to ten per IP address per five minutes. Tokens are stored as SHA-256 hashes in Durable Object storage.

YouTube Music has no official API for this browser-control workflow. The extension therefore keeps all change-prone selectors in `apps/extension/src/player.ts`. When YouTube changes its page markup, update that adapter and its DOM tests.

## Workspace

```text
apps/extension  Chrome Manifest V3 extension
apps/relay      Cloudflare Worker and Durable Objects
apps/web        React, Tailwind CSS, shadcn-style PWA
packages/protocol  Shared messages and validation
```

## License

MIT
