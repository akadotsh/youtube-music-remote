export type Role = "remote" | "extension";

export type DeviceCredential = {
  roomId: string;
  token: string;
  role: Role;
};

export type PairingSession = DeviceCredential & {
  pairingCode: string;
  expiresAt: number;
};

export type Command =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "NEXT" }
  | { type: "PREVIOUS" }
  | { type: "SEEK"; position: number }
  | { type: "SEARCH"; query: string }
  | { type: "PLAY_RESULT"; resultId: string }
  | { type: "GET_STATE" };

export type PlayerState = {
  title: string;
  artist: string;
  artwork?: string;
  duration: number;
  position: number;
  isPlaying: boolean;
};

export type SearchResult = {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
};

export type ClientMessage =
  | { type: "COMMAND"; requestId: string; command: Command }
  | { type: "STATE"; state: PlayerState }
  | { type: "SEARCH_RESULTS"; requestId: string; results: SearchResult[] }
  | { type: "ACK"; requestId: string }
  | { type: "ERROR"; requestId?: string; message: string };

export type ServerMessage =
  | ClientMessage
  | { type: "PEER_STATUS"; connected: boolean };

const commandTypes = new Set([
  "PLAY",
  "PAUSE",
  "NEXT",
  "PREVIOUS",
  "SEEK",
  "SEARCH",
  "PLAY_RESULT",
  "GET_STATE",
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "COMMAND":
      return typeof value.requestId === "string" && isCommand(value.command);
    case "STATE":
      return isPlayerState(value.state);
    case "SEARCH_RESULTS":
      return (
        typeof value.requestId === "string" &&
        Array.isArray(value.results) &&
        value.results.every(isSearchResult)
      );
    case "ACK":
      return typeof value.requestId === "string";
    case "ERROR":
      return (
        (value.requestId === undefined || typeof value.requestId === "string") &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}

export function parseClientMessage(raw: string): ClientMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isClientMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isCommand(value: unknown): value is Command {
  if (!isRecord(value) || typeof value.type !== "string" || !commandTypes.has(value.type)) {
    return false;
  }

  if (value.type === "SEEK") return isFiniteNonNegative(value.position);
  if (value.type === "SEARCH") return typeof value.query === "string" && value.query.trim().length > 0;
  if (value.type === "PLAY_RESULT") return typeof value.resultId === "string" && value.resultId.length > 0;
  return true;
}

function isPlayerState(value: unknown): value is PlayerState {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.artist === "string" &&
    (value.artwork === undefined || typeof value.artwork === "string") &&
    isFiniteNonNegative(value.duration) &&
    isFiniteNonNegative(value.position) &&
    typeof value.isPlaying === "boolean"
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.artist === "string" &&
    (value.thumbnail === undefined || typeof value.thumbnail === "string")
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
