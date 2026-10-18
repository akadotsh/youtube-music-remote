import type { Command, PlayerState } from "@yt-remote/protocol";

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
    default:
      throw new Error(`${command.type} is not available in this milestone`);
  }
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
