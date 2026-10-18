// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeCommand, readPlayerState, readSearchResults } from "./player";

describe("YouTube Music player adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <video></video>
      <ytmusic-player-bar>
        <div class="title">Test Song</div>
        <div class="byline">Test Artist</div>
        <div class="image"><img src="https://example.com/art.jpg"></div>
        <button class="next-button"></button>
      </ytmusic-player-bar>`;
  });

  it("reads playback metadata", () => {
    const video = document.querySelector("video")!;
    Object.defineProperties(video, {
      duration: { value: 180 },
      currentTime: { value: 12, writable: true },
      paused: { value: false },
      ended: { value: false },
    });

    expect(readPlayerState(document)).toMatchObject({
      title: "Test Song",
      artist: "Test Artist",
      duration: 180,
      position: 12,
      isPlaying: true,
    });
  });

  it("clicks the next button", async () => {
    const click = vi.spyOn(document.querySelector<HTMLButtonElement>(".next-button")!, "click");
    await executeCommand({ type: "NEXT" }, document);
    expect(click).toHaveBeenCalledOnce();
  });

  it("extracts unique song search results", () => {
    document.body.innerHTML = `
      <ytmusic-shelf-renderer>
        <ytmusic-responsive-list-item-renderer>
          <a href="https://music.youtube.com/watch?v=song-1">First Song</a>
          <div class="secondary-flex-columns"><a>First Artist</a></div>
          <img src="https://example.com/first.jpg">
        </ytmusic-responsive-list-item-renderer>
      </ytmusic-shelf-renderer>`;

    expect(readSearchResults(document)).toEqual([{
      id: "song-1",
      title: "First Song",
      artist: "First Artist",
      thumbnail: "https://example.com/first.jpg",
    }]);
  });
});
