import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/youtube_music.rs", import.meta.url), "utf8");
const script = source.match(/const PLAY_SONG_COMMAND: &str = r#"([\s\S]*?)"#;/)[1];
const events = [];
const app = { dispatchEvent(event) { events.push(event); } };
const elements = { "ytmusic-app": app, "ytmusic-player-bar": {} };
// No page globals or component methods: mirror Chrome's AppleScript isolated world.
const context = vm.createContext({
  document: { querySelector: (selector) => elements[selector] ?? null },
  CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  window: { location: { assign() { assert.fail("Must not unload the Music tab"); } }, focus() { assert.fail("Must not steal focus"); } },
});
const play = () => vm.runInContext(script.replace("VIDEO_ID", "aB1_-Cd2Ef3"), context);
assert.equal(play(), "ok");
assert.equal(events.length, 1);
assert.equal(events[0].type, "yt-navigate");
assert.equal(events[0].detail.endpoint.watchEndpoint.videoId, "aB1_-Cd2Ef3");
assert.equal(events[0].bubbles, true);
assert.equal(events[0].composed, true);
delete elements["ytmusic-app"];
assert.equal(play(), "missing");
elements["ytmusic-app"] = app;
delete elements["ytmusic-player-bar"];
assert.equal(play(), "missing");
assert.equal(events.length, 1);
