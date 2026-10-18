import type { ClientMessage, Command, PairingSession, PlayerState, ServerMessage } from "@yt-remote/protocol";

type ExtensionRequest =
  | { type: "LOCAL_COMMAND"; command: Command }
  | { type: "GET_EXTENSION_STATUS" }
  | { type: "START_PAIRING"; relayUrl: string }
  | ClientMessage;

type StoredConnection = { relayUrl: string; session: PairingSession };

let lastState: PlayerState | undefined;
let socket: WebSocket | undefined;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1_000;

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, respond) => {
  if (message.type === "STATE") {
    lastState = message.state;
    send(message);
    return;
  }

  if (message.type === "GET_EXTENSION_STATUS") {
    void chrome.storage.local.get("connection").then(({ connection }) => {
      respond({ connected, state: lastState, connection });
    });
    return true;
  }

  if (message.type === "LOCAL_COMMAND") {
    void sendToMusicTab(message.command).then(respond);
    return true;
  }

  if (message.type === "START_PAIRING") {
    void startPairing(message.relayUrl).then(respond);
    return true;
  }
});

async function startPairing(relayUrl: string): Promise<PairingSession | { error: string }> {
  try {
    const normalizedUrl = relayUrl.replace(/\/$/, "");
    const response = await fetch(`${normalizedUrl}/pair/start`, { method: "POST" });
    if (!response.ok) throw new Error("Relay rejected the pairing request");
    const session = (await response.json()) as PairingSession;
    await chrome.storage.local.set({ connection: { relayUrl: normalizedUrl, session } satisfies StoredConnection });
    connect({ relayUrl: normalizedUrl, session });
    return session;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start pairing" };
  }
}

async function restoreConnection(): Promise<void> {
  const { connection } = await chrome.storage.local.get("connection");
  if (connection) connect(connection as StoredConnection);
}

function connect(connection: StoredConnection): void {
  clearTimeout(reconnectTimer);
  socket?.close();

  const url = new URL(connection.relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/connect";
  url.search = new URLSearchParams({ room: connection.session.roomId, token: connection.session.token }).toString();
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    connected = true;
    reconnectDelay = 1_000;
    if (lastState) send({ type: "STATE", state: lastState });
  });
  socket.addEventListener("message", (event) => void handleRelayMessage(event.data));
  socket.addEventListener("close", () => scheduleReconnect(connection));
  socket.addEventListener("error", () => socket?.close());
}

function scheduleReconnect(connection: StoredConnection): void {
  connected = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(connection), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
}

async function handleRelayMessage(raw: unknown): Promise<void> {
  if (typeof raw !== "string") return;
  let message: ServerMessage;
  try {
    message = JSON.parse(raw) as ServerMessage;
  } catch {
    return;
  }

  if (message.type === "COMMAND") send(await sendToMusicTab(message.command, message.requestId));
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function sendToMusicTab(command: Command, requestId: string = crypto.randomUUID()): Promise<ClientMessage> {
  const [tab] = await chrome.tabs.query({ url: "https://music.youtube.com/*" });
  if (!tab?.id) return { type: "ERROR", requestId, message: "Open YouTube Music in Chrome first" };

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "EXECUTE", requestId, command });
  } catch {
    return { type: "ERROR", requestId, message: "Reload the YouTube Music tab and try again" };
  }
}

void restoreConnection();
