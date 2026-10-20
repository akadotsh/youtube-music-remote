import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ root: new URL(".", import.meta.url).pathname, server: { middlewareMode: true, ws: false }, appType: "custom" });
try {
  const { Player, MiniPlayer, VolumePopover, SongSearch } = await server.ssrLoadModule("/src/App.tsx");
  const remote = { state: { title: "Song", artist: "Artist", duration: 100, position: 20, isPlaying: true, volume: 0 }, send() {}, setError() {} };
  const render = () => renderToStaticMarkup(createElement(VolumePopover, { remote }));
  assert.doesNotMatch(renderToStaticMarkup(createElement(Player, { remote })), /id="music-volume"|id="mac-volume"/);
  let html = render();
  assert.match(html, /id="music-volume"[^>]*value="0"/);
  assert.doesNotMatch(html, /id="mac-volume"/);
  assert.match(html, /popover="auto"/);
  assert.match(html, /popoverTarget="volume-controls"/i);
  remote.state.systemVolume = 0.4;
  html = render();
  assert.match(html, /id="mac-volume"[^>]*value="40"/);
  delete remote.state.volume;
  assert.doesNotMatch(render(), /id="music-volume"/);
  const mini = () => renderToStaticMarkup(createElement(MiniPlayer, { remote, onOpen() {} }));
  assert.match(mini(), /aria-label="Back to player"/);
  assert.match(mini(), /aria-label="Pause"/);
  remote.state.isPlaying = false;
  assert.match(mini(), /aria-label="Play"/);
  remote.searchResults = [{ videoId: "aB1_-Cd2Ef3", title: "Result", artist: "Artist" }];
  const search = renderToStaticMarkup(createElement(SongSearch, { remote, onPlay() {} }));
  assert.match(search, /class="search-header"/);
  assert.match(search, /<\/form>[\s\S]*<\/div><ul class="search-results/);
} finally {
  await server.close();
}
