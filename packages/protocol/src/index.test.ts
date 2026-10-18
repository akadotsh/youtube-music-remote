import assert from "node:assert/strict";
import test from "node:test";
import { parseClientMessage } from "./index.js";

test("parses a valid command", () => {
  assert.deepEqual(
    parseClientMessage('{"type":"COMMAND","requestId":"1","command":{"type":"SEEK","position":42}}'),
    { type: "COMMAND", requestId: "1", command: { type: "SEEK", position: 42 } },
  );
});

test("rejects invalid and malformed messages", () => {
  assert.equal(parseClientMessage("{"), undefined);
  assert.equal(
    parseClientMessage('{"type":"COMMAND","requestId":"1","command":{"type":"SEEK","position":-1}}'),
    undefined,
  );
});
