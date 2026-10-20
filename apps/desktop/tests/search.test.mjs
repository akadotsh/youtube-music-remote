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
const config = {
  INNERTUBE_CONTEXT: { client: { clientName: "WEB_REMIX", clientVersion: "page-version", visitorData: "visitor" } },
  INNERTUBE_CONTEXT_CLIENT_NAME: 67,
  INNERTUBE_API_KEY: "page-key&value",
};
const inlineConfig = `ytcfg.set(${JSON.stringify(config)})`;

async function search(api, { scripts = [inlineConfig], homepage = inlineConfig, status = 200 } = {}) {
  let timeout;
  const requests = [];
  // Mirror Chrome's AppleScript isolated world: DOM text is shared, page globals are absent.
  const context = vm.createContext({
    document: { scripts: scripts.map((textContent) => ({ textContent })) },
    window: { fetch: async (path, options) => {
      requests.push(path);
      if (path === "/") return { ok: true, text: async () => homepage };
      assert.equal(path, "/youtubei/v1/search?prettyPrint=false&key=page-key%26value");
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.headers["X-YouTube-Client-Name"], "67");
      assert.equal(options.headers["X-YouTube-Client-Version"], "page-version");
      const body = JSON.parse(options.body);
      assert.equal(body.query, query);
      assert.equal(body.context.client.clientName, "WEB_REMIX");
      return { ok: status === 200, status, json: () => api(body) };
    } },
    setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout: () => {},
  });
  assert.equal(context.window.ytcfg, undefined);
  assert.equal(vm.runInContext(script.replace("SEARCH_INPUT", JSON.stringify([1, query])), context), "ok");
  await new Promise(setImmediate);
  return { context, timeout, job: context.window.__ytRemoteSearch, requests };
}

const response = await search(async () => ({ contents: { sections: [song("aB1_-Cd2Ef3"), song("aB1_-Cd2Ef3"), song("bad"), { musicResponsiveListItemRenderer: { title: "Playlist" } }] } }));
assert.equal(response.job.status, "done");
assert.equal(response.job.results.length, 1);
assert.equal(response.job.results[0].title, "Song");
assert.equal(response.job.results[0].artist, "Artist");
assert.equal(response.context.window.hacked, undefined);
assert.equal(response.requests.length, 1);
const many = await search(async () => ({ contents: Array.from({ length: 40 }, (_, i) => song(String(i).padStart(11, "0"), "🎵".repeat(400))) }));
assert.equal(many.job.results.length, 25);
assert.equal(many.job.results[0].title.length, 500);
assert.equal((await search(async () => ({ contents: [] }))).job.results.length, 0);
assert.equal((await search(async () => { throw new Error("Network unavailable"); })).job.message, "Network unavailable");
assert.equal((await search(async () => ({}))).job.status, "error");
assert.match((await search(async () => ({}), { status: 403 })).job.message, /HTTP 403/);
const timedOut = await search(() => new Promise(() => {}));
timedOut.timeout();
await new Promise(setImmediate);
assert.equal(timedOut.job.status, "error");
assert.match(timedOut.job.message, /timed out/);

const fetchedConfig = await search(async () => ({ contents: [song("aB1_-Cd2Ef3")] }), { scripts: [] });
assert.equal(fetchedConfig.requests[0], "/");
assert.equal(fetchedConfig.job.results.length, 1);
const malformed = await search(async () => ({ contents: [] }), { scripts: ["ytcfg.set({invalid});", inlineConfig] });
assert.equal(malformed.job.status, "done");
const missingConfig = await search(async () => assert.fail("Search cannot run without config"), { scripts: [], homepage: "<html>Consent required</html>" });
assert.equal(missingConfig.job.status, "error");
assert.match(missingConfig.job.message, /configuration/);
