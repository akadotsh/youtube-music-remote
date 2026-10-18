import type { ClientMessage, Command, PlayerState } from "@yt-remote/protocol";

type ExtensionRequest =
  | { type: "LOCAL_COMMAND"; command: Command }
  | { type: "GET_CACHED_STATE" }
  | ClientMessage;

let lastState: PlayerState | undefined;

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, respond) => {
  if (message.type === "STATE") {
    lastState = message.state;
    return;
  }

  if (message.type === "GET_CACHED_STATE") {
    respond(lastState);
    return;
  }

  if (message.type === "LOCAL_COMMAND") {
    void sendToMusicTab(message.command).then(respond);
    return true;
  }
});

async function sendToMusicTab(command: Command): Promise<ClientMessage> {
  const [tab] = await chrome.tabs.query({ url: "https://music.youtube.com/*" });
  if (!tab?.id) return { type: "ERROR", message: "Open YouTube Music in Chrome first" };

  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: "EXECUTE",
      requestId: crypto.randomUUID(),
      command,
    });
  } catch {
    return { type: "ERROR", message: "Reload the YouTube Music tab and try again" };
  }
}
