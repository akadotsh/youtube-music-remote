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
const unavailable = vm.createContext({ window: {}, document: { querySelector: () => null } });
assert.equal(vm.runInContext(script.replace("SEARCH_INPUT", '[1,"song"]'), unavailable), "search-unavailable");

// Chrome's Polymer wrapper need not expose the application's network manager.
async function browserSearch(status = 200) {
  let requested = false;
  const client = { clientName: "WEB_REMIX", clientVersion: "current-page-version", visitorData: "visitor" };
  const values = { INNERTUBE_CONTEXT: { client }, INNERTUBE_CONTEXT_CLIENT_NAME: 67, INNERTUBE_API_KEY: "page-key&value" };
  const context = vm.createContext({
    document: { querySelector: () => ({}) },
    window: { ytcfg: { get: (key) => values[key] }, fetch: async (url, options) => {
      requested = true;
      assert.equal(url, "/youtubei/v1/search?prettyPrint=false&key=page-key%26value");
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.headers["X-YouTube-Client-Version"], client.clientVersion);
      assert.equal(options.headers["X-YouTube-Client-Name"], "67");
      const payload = JSON.parse(options.body);
      assert.equal(payload.context.client.clientName, "WEB_REMIX");
      assert.equal(payload.query, query);
      return { ok: status === 200, status, json: async () => ({ contents: [song("aB1_-Cd2Ef3")] }) };
    } },
    setTimeout: () => 1, clearTimeout: () => {},
  });
  assert.equal(vm.runInContext(script.replace("SEARCH_INPUT", JSON.stringify([2, query])), context), "ok");
  await new Promise(setImmediate);
  assert.equal(requested, true);
  return context.window.__ytRemoteSearch;
}
assert.equal((await browserSearch()).results[0].videoId, "aB1_-Cd2Ef3");
assert.match((await browserSearch(403)).message, /HTTP 403/);

const wrapped = vm.createContext({ document: { querySelector: () => ({ inst: { networkManager: {
  fetch: async () => ({ contents: [] }),
} } }) }, window: {}, setTimeout: () => 1, clearTimeout: () => {} });
assert.equal(vm.runInContext(script.replace("SEARCH_INPUT", '[3,"song"]'), wrapped), "ok");
await new Promise(setImmediate);
assert.equal(wrapped.window.__ytRemoteSearch.status, "done");
