import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ root: new URL(".", import.meta.url).pathname, server: { middlewareMode: true, ws: false }, appType: "custom" });
try {
  const { Player } = await server.ssrLoadModule("/src/App.tsx");
  const remote = { state: { title: "Song", artist: "Artist", duration: 100, position: 20, isPlaying: true, volume: 0 }, send() {}, setError() {} };
  const render = () => renderToStaticMarkup(createElement(Player, { remote }));
  let html = render();
  assert.match(html, /id="music-volume"[^>]*value="0"/);
  assert.doesNotMatch(html, /Mac audio|id="mac-volume"/);
  remote.state.systemVolume = 0.4;
  html = render();
  assert.match(html, /<details class="mac-audio"><summary>Mac audio<\/summary>/);
  assert.match(html, /id="mac-volume"[^>]*value="40"/);
  delete remote.state.volume;
  assert.doesNotMatch(render(), /id="music-volume"/);
} finally {
  await server.close();
}
