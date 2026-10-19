import assert from "node:assert/strict";
import test from "node:test";
import { parseClientMessage, parseServerMessage } from "./index.js";

test("parses a valid command", () => {
  assert.deepEqual(
    parseClientMessage('{"type":"COMMAND","requestId":"1","command":{"type":"SEEK","position":42}}'),
    { type: "COMMAND", requestId: "1", command: { type: "SEEK", position: 42 } },
  );
});

test("parses peer connection status", () => {
  assert.deepEqual(parseServerMessage('{"type":"PEER_STATUS","connected":true}'), {
    type: "PEER_STATUS",
    connected: true,
  });
});

test("parses player capabilities", () => {
  const message = {
    type: "STATE",
    state: {
      title: "Song",
      artist: "Artist",
      duration: 120,
      position: 12,
      isPlaying: true,
      source: "YouTube Music",
      capabilities: { playPause: true, next: true, previous: true, seek: true },
    },
  };
  assert.deepEqual(parseClientMessage(JSON.stringify(message)), message);
});

test("rejects invalid and malformed messages", () => {
  assert.equal(parseClientMessage("{"), undefined);
  assert.equal(
    parseClientMessage('{"type":"COMMAND","requestId":"1","command":{"type":"SEEK","position":-1}}'),
    undefined,
  );
});
