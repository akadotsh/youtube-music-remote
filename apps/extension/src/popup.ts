import type { Command, PlayerState } from "@yt-remote/protocol";

const track = document.querySelector<HTMLDivElement>("#track")!;
const status = document.querySelector<HTMLDivElement>("#status")!;

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
  button.addEventListener("click", async () => {
    const command = { type: button.dataset.command } as Command;
    status.textContent = "Sending…";
    const response = await chrome.runtime.sendMessage({ type: "LOCAL_COMMAND", command });
    status.textContent = response?.type === "ERROR" ? response.message : "Done";
    await refresh();
  });
}

async function refresh(): Promise<void> {
  const state = (await chrome.runtime.sendMessage({ type: "GET_CACHED_STATE" })) as PlayerState | undefined;
  if (!state) return;
  track.replaceChildren(strong(state.title || "Nothing playing"), span(state.artist));
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
