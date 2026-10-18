import type { Command, PairingSession, PlayerState } from "@yt-remote/protocol";

type ExtensionStatus = {
  connected: boolean;
  state?: PlayerState;
  connection?: { relayUrl: string; session: PairingSession };
};

const track = document.querySelector<HTMLDivElement>("#track")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const relay = document.querySelector<HTMLInputElement>("#relay")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;
const code = document.querySelector<HTMLDivElement>("#code")!;

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
  button.addEventListener("click", async () => {
    const command = { type: button.dataset.command } as Command;
    status.textContent = "Sending…";
    const response = await chrome.runtime.sendMessage({ type: "LOCAL_COMMAND", command });
    status.textContent = response?.type === "ERROR" ? response.message : "Done";
    await refresh();
  });
}

pair.addEventListener("click", async () => {
  if (!relay.value) return relay.reportValidity();
  pair.disabled = true;
  status.textContent = "Creating pairing code…";
  const response = (await chrome.runtime.sendMessage({ type: "START_PAIRING", relayUrl: relay.value })) as
    | PairingSession
    | { error: string };
  pair.disabled = false;
  if ("error" in response) return void (status.textContent = response.error);
  code.textContent = response.pairingCode;
  status.textContent = "Enter this code on your phone within five minutes.";
});

async function refresh(): Promise<void> {
  const result = (await chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATUS" })) as ExtensionStatus;
  if (result.connection) {
    relay.value = result.connection.relayUrl;
    if (Date.now() < result.connection.session.expiresAt) code.textContent = result.connection.session.pairingCode;
  }
  status.textContent = result.connected ? "Relay connected" : "Relay disconnected";
  if (!result.state) return;
  track.replaceChildren(strong(result.state.title || "Nothing playing"), span(result.state.artist));
}

function strong(value: string): HTMLElement {
  const element = document.createElement("strong");
  element.textContent = value;
  return element;
}

function span(value: string): HTMLElement {
  const element = document.createElement("span");
  element.textContent = value;
  return element;
}

void refresh();
