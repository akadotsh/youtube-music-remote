import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/youtube_music.rs", import.meta.url), "utf8");
function script(name) {
  const match = source.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  assert.ok(match, `Missing ${name} script`);
  return match[1];
}

let savedVolume = 100;
const video = { volume: 1, muted: true, paused: false, ended: false, duration: 100, currentTime: 0 };
const slider = { value: savedVolume };
const bar = {
  updateVolume(volume) {
    savedVolume = volume;
    slider.value = volume;
    // The site's slider and the underlying audio gain need not use the same scale.
    video.volume = (volume / 100) ** 2;
  },
};
const player = { unMute() { video.muted = false; } };
const elements = { video, "ytmusic-player-bar": bar, "#movie_player": player, "ytmusic-player-bar #volume-slider": slider };
const context = vm.createContext({ document: { querySelector: (selector) => elements[selector] ?? null } });
const setVolume = (volume) => vm.runInContext(script("VOLUME_COMMAND").replace("VOLUME", String(volume)), context);
const readState = () => JSON.parse(vm.runInContext(script("READ_STATE"), context));

for (const volume of [35, 0, 100]) {
  assert.equal(setVolume(volume), "ok");
  assert.equal(savedVolume, volume);
  assert.equal(video.muted, false);
  for (let track = 0; track < 3; track++) {
    // Both skipped tracks and autoplay restore the site's saved player setting.
    video.volume = (savedVolume / 100) ** 2;
    assert.equal(readState().volume, volume / 100);
    assert.equal(video.volume, (volume / 100) ** 2);
  }
}
video.muted = true;
assert.equal(readState().volume, 0);
delete elements["ytmusic-player-bar #volume-slider"];
video.muted = false;
video.volume = 0.4;
assert.equal(readState().volume, 0.4);
delete elements["ytmusic-player-bar"];
assert.equal(setVolume(50), "missing");
assert.equal(video.volume, 0.4);
