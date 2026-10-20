import assert from "node:assert/strict";
import { parseClientMessage } from "./src/index.ts";
import { canSend } from "../../apps/relay/src/rules.ts";

const command = (command) => parseClientMessage(JSON.stringify({ type: "COMMAND", requestId: "search-1", command }));
for (const query of ["Song", "Artist \"name\"", "🎵".repeat(100)]) assert.ok(command({ type: "SEARCH", query }));
for (const query of ["", "  ", null, 1, "x".repeat(201), "🎵".repeat(101)]) assert.equal(command({ type: "SEARCH", query }), undefined);
assert.ok(command({ type: "PLAY_SONG", videoId: "aB1_-Cd2Ef3" }));
for (const videoId of ["short", "https://example.com", "a';alert(1)", 1]) assert.equal(command({ type: "PLAY_SONG", videoId }), undefined);

const song = { videoId: "aB1_-Cd2Ef3", title: "Song", artist: "Artist", artwork: "https://example.com/cover" };
const response = (results) => parseClientMessage(JSON.stringify({ type: "SEARCH_RESULTS", requestId: "search-1", results }));
assert.ok(response([]));
assert.ok(response([song]));
assert.equal(response(Array(26).fill(song)), undefined);
for (const invalid of [{ ...song, artwork: "javascript:alert(1)" }, { ...song, title: "" }, { ...song, title: "x".repeat(501) }, { ...song, videoId: "invalid" }, { ...song, artist: null }]) {
  assert.equal(response([invalid]), undefined);
}
assert.equal(canSend("remote", response([song])), false);
assert.equal(canSend("desktop", response([song])), true);
assert.equal(canSend("remote", command({ type: "SEARCH", query: "Song" })), true);
assert.equal(canSend("desktop", command({ type: "SEARCH", query: "Song" })), false);
