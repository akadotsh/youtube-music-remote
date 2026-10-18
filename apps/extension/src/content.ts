import type { ClientMessage, Command } from "@yt-remote/protocol";
import { executeCommand, readPlayerState, search } from "./player";

type ContentRequest = { type: "EXECUTE"; requestId: string; command: Command };

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, respond) => {
  if (message.type !== "EXECUTE") return;

  void (message.command.type === "SEARCH"
    ? search(document, message.command.query)
    : executeCommand(message.command, document))
    .then((results) => {
      const response: ClientMessage =
        message.command.type === "SEARCH"
          ? { type: "SEARCH_RESULTS", requestId: message.requestId, results: results ?? [] }
          : message.command.type === "GET_STATE"
          ? { type: "STATE", state: readPlayerState(document) }
          : { type: "ACK", requestId: message.requestId };
      respond(response);
      publishState();
    })
    .catch((error: unknown) => {
      respond({
        type: "ERROR",
        requestId: message.requestId,
        message: error instanceof Error ? error.message : "Command failed",
      } satisfies ClientMessage);
    });

  return true;
});

function publishState(): void {
  void chrome.runtime.sendMessage({ type: "STATE", state: readPlayerState(document) } satisfies ClientMessage);
}

document.addEventListener("yt-navigate-finish", publishState);
setInterval(publishState, 2_000);
publishState();
