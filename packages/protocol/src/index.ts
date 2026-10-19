export type Role = "remote" | "desktop";

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
  | { type: "GET_STATE" };

export type PlayerState = {
  title: string;
  artist: string;
  artwork?: string;
  duration: number;
  position: number;
  isPlaying: boolean;
  source?: string;
  capabilities?: PlayerCapabilities;
};

export type PlayerCapabilities = {
  playPause: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
};

export type ClientMessage =
  | { type: "COMMAND"; requestId: string; command: Command }
  | { type: "STATE"; state: PlayerState }
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
  "GET_STATE",
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "COMMAND":
      return typeof value.requestId === "string" && isCommand(value.command);
    case "STATE":
      return isPlayerState(value.state);
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

export function parseServerMessage(raw: string): ServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      isRecord(value) &&
      value.type === "PEER_STATUS" &&
      typeof value.connected === "boolean"
    ) {
      return value as { type: "PEER_STATUS"; connected: boolean };
    }
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
    typeof value.isPlaying === "boolean" &&
    (value.source === undefined || typeof value.source === "string") &&
    (value.capabilities === undefined || isPlayerCapabilities(value.capabilities))
  );
}

function isPlayerCapabilities(value: unknown): value is PlayerCapabilities {
  return (
    isRecord(value) &&
    typeof value.playPause === "boolean" &&
    typeof value.next === "boolean" &&
    typeof value.previous === "boolean" &&
    typeof value.seek === "boolean"
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
