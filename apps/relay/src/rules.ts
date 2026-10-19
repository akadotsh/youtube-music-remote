import type { ClientMessage, Role } from "@yt-remote/protocol";

export function canSend(role: Role, message: ClientMessage): boolean {
  if (role === "remote") return message.type === "COMMAND";
  return ["STATE", "ACK", "ERROR"].includes(message.type);
}
