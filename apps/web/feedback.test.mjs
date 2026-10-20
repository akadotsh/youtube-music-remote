import assert from "node:assert/strict";
import { reconcileControls, VolumeQueue } from "./src/feedback.ts";

const state = { title: "Song", artist: "Artist", duration: 100, position: 0, isPlaying: true, volume: 0.5 };
const pending = { isPlaying: { value: false, acknowledged: false, requestId: "pause", expiresAt: 5_000 } };
assert.equal(reconcileControls(state, pending, 1_000).isPlaying, false);
assert.equal(state.isPlaying, true);
assert.equal(reconcileControls({ ...state, isPlaying: false }, pending, 1_000).isPlaying, false);
assert.ok(pending.isPlaying); // A matching old state cannot confirm a command before its ACK.
pending.isPlaying.acknowledged = true;
reconcileControls({ ...state, isPlaying: false }, pending, 1_000);
assert.equal(pending.isPlaying, undefined);

const expired = { volume: { value: 0.8, acknowledged: true, expiresAt: 5_000 } };
assert.equal(reconcileControls(state, expired, 1_000).volume, 0.8);
assert.equal(reconcileControls(state, expired, 5_000).volume, 0.5);
assert.equal(expired.volume, undefined);

const sent = [];
const transmit = (volume) => { sent.push(volume); return `volume-${sent.length}`; };
const queue = new VolumeQueue();
assert.equal(queue.send(0.2, transmit), "volume-1");
for (const volume of [0.3, 0.4, 0.6, 0]) assert.equal(queue.send(volume, transmit), undefined);
assert.deepEqual(sent, [0.2]);
assert.equal(queue.acknowledge("unrelated", transmit), undefined);
assert.equal(queue.acknowledge("volume-1", transmit), "volume-2");
assert.deepEqual(sent, [0.2, 0]);
queue.send(0.9, transmit);
queue.reset();
assert.equal(queue.acknowledge("volume-2", transmit), undefined);
assert.equal(queue.send(0.5, transmit), "volume-3");
assert.deepEqual(sent, [0.2, 0, 0.5]);
