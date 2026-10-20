import assert from "node:assert/strict";
import { parseClientMessage, parseServerMessage } from "./src/index.ts";

for (const volume of [0, 0.5, 1]) {
  assert.ok(parseClientMessage(JSON.stringify({ type: "COMMAND", requestId: "volume", command: { type: "SET_VOLUME", volume } })));
}
for (const volume of [-0.01, 1.01, null, "0.5", undefined]) {
  assert.equal(parseClientMessage(JSON.stringify({ type: "COMMAND", requestId: "volume", command: { type: "SET_VOLUME", volume } })), undefined);
}
const state = { title: "Song", artist: "Artist", duration: 100, position: 0, isPlaying: true };
for (const volume of [undefined, 0, 0.5, 1]) {
  assert.ok(parseServerMessage(JSON.stringify({ type: "STATE", state: { ...state, volume } })));
}
for (const volume of [-1, 2, null, "0.5"]) {
  assert.equal(parseServerMessage(JSON.stringify({ type: "STATE", state: { ...state, volume } })), undefined);
}
