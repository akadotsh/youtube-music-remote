import type { Command, PlayerState, SearchResult } from "@yt-remote/protocol";

const selectors = {
  title: ["ytmusic-player-bar .title", ".content-info-wrapper .title"],
  artist: ["ytmusic-player-bar .byline", ".content-info-wrapper .byline"],
  artwork: ["ytmusic-player-bar .image img", "ytmusic-player-bar img"],
  next: ["ytmusic-player-bar .next-button", 'button[aria-label^="Next"]'],
  previous: ["ytmusic-player-bar .previous-button", 'button[aria-label^="Previous"]'],
};

export async function executeCommand(command: Command, document: Document): Promise<void> {
  const video = document.querySelector<HTMLVideoElement>("video");

  switch (command.type) {
    case "PLAY":
      if (!video) throw new Error("YouTube Music player is unavailable");
      await video.play();
      return;
    case "PAUSE":
      if (!video) throw new Error("YouTube Music player is unavailable");
      video.pause();
      return;
    case "NEXT":
      clickFirst(document, selectors.next, "Next button is unavailable");
      return;
    case "PREVIOUS":
      clickFirst(document, selectors.previous, "Previous button is unavailable");
      return;
    case "SEEK":
      if (!video) throw new Error("YouTube Music player is unavailable");
      video.currentTime = Math.min(command.position, video.duration || command.position);
      return;
    case "GET_STATE":
      return;
    case "PLAY_RESULT": {
      const link = document.querySelector<HTMLAnchorElement>(`a[href*="v=${cssEscape(command.resultId)}"]`);
      if (!link) throw new Error("Search result is no longer available");
      link.click();
      return;
    }
    default:
      throw new Error(`${command.type} is not available in this milestone`);
  }
}

export async function search(document: Document, query: string): Promise<SearchResult[]> {
  const input = document.querySelector<HTMLInputElement>("ytmusic-search-box input#input, input#input.ytmusic-search-box");
  if (!input) throw new Error("YouTube Music search is unavailable");

  setInputValue(input, query);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const results = readSearchResults(document);
    if (results.length > 0) return results;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [];
}

export function readSearchResults(document: Document): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const row of document.querySelectorAll<HTMLElement>("ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer")) {
    const link = row.querySelector<HTMLAnchorElement>('a[href*="watch?v="]');
    if (!link) continue;
    const id = new URL(link.href).searchParams.get("v");
    if (!id || seen.has(id)) continue;

    const title = link.textContent?.trim() || link.getAttribute("title") || "";
    const byline = row.querySelector<HTMLElement>(".secondary-flex-columns, .flex-column-secondary");
    const artist = byline?.querySelector("a")?.textContent?.trim() || byline?.textContent?.trim() || "";
    const thumbnail = row.querySelector<HTMLImageElement>("img")?.src;
    if (!title) continue;

    seen.add(id);
    results.push({ id, title, artist, ...(thumbnail ? { thumbnail } : {}) });
    if (results.length === 20) break;
  }
  return results;
}

export function readPlayerState(document: Document): PlayerState {
  const video = document.querySelector<HTMLVideoElement>("video");
  const artwork = queryFirst<HTMLImageElement>(document, selectors.artwork)?.src;

  return {
    title: textFrom(document, selectors.title),
    artist: textFrom(document, selectors.artist),
    ...(artwork ? { artwork } : {}),
    duration: finiteTime(video?.duration),
    position: finiteTime(video?.currentTime),
    isPlaying: Boolean(video && !video.paused && !video.ended),
  };
}

function clickFirst(document: Document, candidates: string[], error: string): void {
  const button = queryFirst<HTMLElement>(document, candidates);
  if (!button) throw new Error(error);
  button.click();
}

function textFrom(document: Document, candidates: string[]): string {
  return queryFirst<HTMLElement>(document, candidates)?.textContent?.trim() ?? "";
}

function queryFirst<T extends Element>(document: Document, candidates: string[]): T | undefined {
  for (const selector of candidates) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
}

function finiteTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
