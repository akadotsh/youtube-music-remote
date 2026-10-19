import { describe, expect, it } from "vitest";
import { canSend } from "./rules";

describe("relay direction rules", () => {
  it("only accepts commands from the remote", () => {
    expect(canSend("remote", { type: "COMMAND", requestId: "1", command: { type: "PLAY" } })).toBe(true);
    expect(canSend("remote", { type: "STATE", state: emptyState })).toBe(false);
  });

  it("only accepts responses and state from the desktop", () => {
    expect(canSend("desktop", { type: "STATE", state: emptyState })).toBe(true);
    expect(canSend("desktop", { type: "COMMAND", requestId: "1", command: { type: "PLAY" } })).toBe(false);
  });
});

const emptyState = { title: "", artist: "", duration: 0, position: 0, isPlaying: false };
