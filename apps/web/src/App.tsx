import type { DeviceCredential, PlayerState } from "@yt-remote/protocol";
import { Pause, Play, RotateCcw, Search, SkipBack, SkipForward, Unplug, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { type SavedConnection, useRemote } from "./useRemote";

const storageKey = "yt-remote-connection";

export default function App() {
  const [connection, setConnection] = useState<SavedConnection | undefined>(() => loadConnection());
  if (!connection) return <Pairing onPaired={setConnection} />;
  return <Remote connection={connection} onForget={() => void forget(connection, setConnection)} />;
}

function Pairing({ onPaired }: { onPaired: (connection: SavedConnection) => void }) {
  const [relayUrl, setRelayUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function pair() {
    setLoading(true);
    setError("");
    try {
      const normalizedUrl = relayUrl.replace(/\/$/, "");
      const response = await fetch(`${normalizedUrl}/pair/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as DeviceCredential | { error: string };
      if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "Pairing failed");
      const next = { relayUrl: normalizedUrl, credential: body };
      localStorage.setItem(storageKey, JSON.stringify(next));
      onPaired(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pairing failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell glass-surface pairing-shell">
      <div className="brand-mark"><Play className="size-6 fill-current" aria-hidden="true" /></div>
      <p className="eyebrow mt-6">Music Remote</p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight">Connect to your Mac</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Create a code in the desktop app, then enter it below. Your music stays on your Mac.</p>
      <label className="mt-8 text-sm font-medium" htmlFor="relay">Relay URL</label>
      <input id="relay" type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} placeholder="https://your-worker.workers.dev" className="glass-field mt-2 w-full" />
      <label className="mt-4 text-sm font-medium" htmlFor="code">Pairing code</label>
      <input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" className="glass-field time-label mt-2 w-full text-center text-2xl tracking-[0.35em]" />
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <Button className="mt-8 w-full" disabled={loading || code.length !== 6 || !relayUrl} onClick={pair}>{loading ? "Connecting…" : "Connect to Mac"}</Button>
    </main>
  );
}

function Remote({ connection, onForget }: { connection: SavedConnection; onForget: () => void }) {
  const remote = useRemote(connection);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <main className="app-shell glass-surface">
      <header className="app-header">
        <div className="min-w-0"><h1 className="font-semibold">Music Remote</h1><p className="connection-status" role="status"><span aria-hidden="true" className={`status-dot ${remote.status === "connected" && remote.peerConnected ? "is-connected" : ""}`} />{remote.status === "connected" ? (remote.peerConnected ? "Mac connected" : "Waiting for Mac") : "Reconnecting…"}</p></div>
        <div className="flex">
          <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" aria-label={searchOpen ? "Back to player" : "Search songs"} aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>{searchOpen ? <X className="size-5" /> : <Search className="size-5" />}</Button>
          <Button variant="ghost" size="icon" aria-label="Forget device" title="Forget paired Mac" onClick={onForget}><Unplug className="size-5" /></Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{searchOpen ? <SongSearch remote={remote} onPlay={() => setSearchOpen(false)} /> : <Player remote={remote} />}</div>
    </main>
  );
}

function SongSearch({ remote, onPlay }: { remote: ReturnType<typeof useRemote>; onPlay: () => void }) {
  const [query, setQuery] = useState("");
  const connected = remote.status === "connected" && remote.peerConnected;
  return (
    <section className="py-6">
      <h2 className="text-xl font-semibold">Search songs</h2>
      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); remote.search(query); }}>
        <label className="sr-only" htmlFor="song-search">Song or artist</label>
        <input id="song-search" type="search" enterKeyHint="search" maxLength={200} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Song or artist" className="glass-field min-w-0 flex-1" />
        <Button type="submit" disabled={!connected || remote.searching || !query.trim()}>Search</Button>
      </form>
      <p className="mt-3 text-sm text-muted-foreground">Plays in YouTube Music on your Mac.</p>
      {!connected && <p role="status" className="mt-3 text-sm text-muted-foreground">Connect your Mac to search and play.</p>}
      {remote.searchError && <p role="alert" className="mt-4 text-sm text-danger">{remote.searchError}</p>}
      {remote.error && !remote.searchError && <p role="alert" className="mt-4 text-sm text-danger">{remote.error}</p>}
      <div role="status" aria-live="polite" className="mt-4 text-sm text-muted-foreground">
        {remote.searching ? "Searching…" : remote.searchResults ? `${remote.searchResults.length} songs found` : ""}
      </div>
      <ul className="search-results mt-3">
        {remote.searchResults?.map((song) => (
          <li key={song.videoId} className="flex items-center gap-3 py-3">
            {song.artwork && <img src={song.artwork} alt="" className="size-12 flex-none rounded-lg object-cover" />}
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{song.title}</p><p className="truncate text-xs text-muted-foreground">{song.artist}</p></div>
            <Button variant="ghost" size="icon" aria-label={`Play ${song.title}`} disabled={!connected} onClick={() => { remote.send({ type: "PLAY_SONG", videoId: song.videoId }); onPlay(); }}><Play className="size-5 fill-current" /></Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Player({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const state = remote.state ?? emptyState;
  const [seek, setSeek] = useState<number>();
  const shownPosition = seek ?? state.position;

  return (
    <div className="player flex flex-1 flex-col py-6">
      <p className="eyebrow mb-5">Now playing{state.source ? ` · ${state.source}` : ""}</p>
      <div className="player-artwork aspect-square overflow-hidden rounded-2xl bg-muted">
        {state.artwork ? <img src={state.artwork} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Play className="size-20" /></div>}
      </div>
      <h2 className="mt-6 truncate text-2xl font-semibold">{state.title || "Nothing playing"}</h2>
      <p className="mt-1 truncate text-muted-foreground">{state.artist || "Start music on your Mac"}</p>
      <input aria-label="Playback position" type="range" min="0" max={Math.max(state.duration, 1)} value={shownPosition} onChange={(event) => setSeek(Number(event.target.value))} onPointerUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} onKeyUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} className="mt-4 w-full" />
      <div className="time-label flex justify-between text-xs text-muted-foreground"><span>{time(shownPosition)}</span><span>{time(state.duration)}</span></div>
      <div className="my-5 flex items-center justify-center gap-5">
        <Button variant="ghost" size="icon" aria-label="Previous track" onClick={() => remote.send({ type: "PREVIOUS" })}><SkipBack className="size-7 fill-current" /></Button>
        <Button size="largeIcon" aria-label={state.isPlaying ? "Pause" : "Play"} onClick={() => remote.send({ type: state.isPlaying ? "PAUSE" : "PLAY" })}>{state.isPlaying ? <Pause className="size-8 fill-current" /> : <Play className="ml-1 size-8 fill-current" />}</Button>
        <Button variant="ghost" size="icon" aria-label="Next track" onClick={() => remote.send({ type: "NEXT" })}><SkipForward className="size-7 fill-current" /></Button>
      </div>
      {[
        { id: "music-volume", label: "Music volume", value: state.volume, type: "SET_VOLUME" as const },
        { id: "mac-volume", label: "Mac volume", value: state.systemVolume, type: "SET_SYSTEM_VOLUME" as const },
      ].map((control) => control.value !== undefined && (
        <div key={control.id} className="volume-control mt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <label htmlFor={control.id}>{control.label}</label>
            <span className="time-label">{Math.round(control.value * 100)}%</span>
          </div>
          <input id={control.id} type="range" min="0" max="100" step="1"
            value={Math.round(control.value * 100)}
            onChange={(event) => remote.send({ type: control.type, volume: Number(event.currentTarget.value) / 100 })}
            className="w-full" />
          {control.type === "SET_SYSTEM_VOLUME" && <p className="mt-1 text-xs text-muted-foreground">Changes all Mac audio</p>}
        </div>
      ))}
      {remote.error && <ErrorMessage message={remote.error} dismiss={() => remote.setError("")} />}
    </div>
  );
}

function ErrorMessage({ message, dismiss }: { message: string; dismiss: () => void }) {
  return <button className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 text-sm text-danger" onClick={dismiss}><RotateCcw className="size-4" />{message}<X className="size-3" /></button>;
}

const emptyState: PlayerState = { title: "", artist: "", duration: 0, position: 0, isPlaying: false };

function time(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function loadConnection(): SavedConnection | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "") as SavedConnection;
    return value?.relayUrl && value.credential?.role === "remote" && value.credential.roomId && value.credential.token ? value : undefined;
  } catch { return undefined; }
}

async function forget(connection: SavedConnection, setConnection: (value: undefined) => void): Promise<void> {
  try {
    await fetch(`${connection.relayUrl}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: connection.credential.roomId, token: connection.credential.token }),
    });
  } finally {
  localStorage.removeItem(storageKey);
  setConnection(undefined);
  }
}
