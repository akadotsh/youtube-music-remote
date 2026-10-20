import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../src/scripts/search.js", import.meta.url), "utf8");
const song = (videoId, title = "Song") => ({ musicResponsiveListItemRenderer: {
  playlistItemData: { videoId },
  flexColumns: [title, "Artist"].map((text) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text }] } } })),
  thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "https://example.com/cover" }] } } },
} });
const query = 'A "song"; window.hacked = true; SEARCH_INPUT';
async function search(fetch) {
  let timeout;
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({ networkManager: { fetch } }) },
    setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout: () => {},
  });
  assert.equal(vm.runInContext(script.replace("SEARCH_INPUT", JSON.stringify([1, query])), context), "ok");
  await new Promise(setImmediate);
  return { context, timeout, job: context.window.__ytRemoteSearch };
}
const response = await search(async (path, input) => {
  assert.equal(path, "/search");
  assert.equal(input.query, query);
  return { contents: { sections: [song("aB1_-Cd2Ef3"), song("aB1_-Cd2Ef3"), song("bad"), { musicResponsiveListItemRenderer: { title: "Playlist" } }] } };
});
assert.equal(response.job.status, "done");
assert.equal(response.job.results.length, 1);
assert.equal(response.job.results[0].title, "Song");
assert.equal(response.job.results[0].artist, "Artist");
assert.equal(response.context.window.hacked, undefined);
const many = await search(async () => ({ contents: Array.from({ length: 40 }, (_, i) => song(String(i).padStart(11, "0"), "🎵".repeat(400))) }));
assert.equal(many.job.results.length, 25);
assert.equal(many.job.results[0].title.length, 500);
assert.equal((await search(async () => ({ contents: [] }))).job.results.length, 0);
assert.equal((await search(async () => { throw new Error("Network unavailable"); })).job.message, "Network unavailable");
assert.equal((await search(async () => ({}))).job.status, "error");
const timedOut = await search(() => new Promise(() => {}));
timedOut.timeout();
await new Promise(setImmediate);
assert.equal(timedOut.job.status, "error");
assert.match(timedOut.job.message, /timed out/);
const unavailable = vm.createContext({ document: { querySelector: () => null } });
assert.equal(vm.runInContext(script.replace("SEARCH_INPUT", '[1,"song"]'), unavailable), "missing");
