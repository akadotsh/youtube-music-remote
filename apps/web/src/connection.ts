import type { DeviceCredential } from "@yt-remote/protocol";

export function websocketUrl(relayUrl: string, credential: DeviceCredential): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/connect";
  url.search = new URLSearchParams({ room: credential.roomId, token: credential.token }).toString();
  return url.toString();
}
