import type { DeviceCredential, PlayerState } from "@yt-remote/protocol";
import { LoaderCircle, Pause, Play, RotateCcw, Search, Settings, SkipBack, SkipForward, Unplug, Volume2, X } from "lucide-react";
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
    <main className="app-shell pairing-shell">
      <section className="pairing-card">
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
      </section>
    </main>
  );
}

function Remote({ connection, onForget }: { connection: SavedConnection; onForget: () => void }) {
  const remote = useRemote(connection);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="min-w-0"><h1 className="font-semibold">Music Remote</h1><p className="connection-status" role="status"><span aria-hidden="true" className={`status-dot ${remote.status === "connected" && remote.peerConnected ? "is-connected" : ""}`} />{remote.status === "connected" ? (remote.peerConnected ? "Connected" : "Waiting to connect") : "Reconnecting…"}</p></div>
        <div className="flex">
          {(remote.state?.volume !== undefined || remote.state?.systemVolume !== undefined) && <VolumePopover remote={remote} />}
          <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" aria-label={searchOpen ? "Back to player" : "Search songs"} aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>{searchOpen ? <X className="size-5" /> : <Search className="size-5" />}</Button>
          <Button variant={settingsOpen ? "secondary" : "ghost"} size="icon" aria-label="Connection settings" aria-expanded={settingsOpen} aria-controls="connection-settings" onClick={() => setSettingsOpen(!settingsOpen)}><Settings className="size-5" /></Button>
        </div>
      </header>

      <div className="app-content">{searchOpen ? <SongSearch remote={remote} onPlay={() => setSearchOpen(false)} /> : <Player remote={remote} />}</div>
      {searchOpen && remote.state?.title && <MiniPlayer remote={remote} onOpen={() => setSearchOpen(false)} />}
      {settingsOpen && <section id="connection-settings" className="connection-settings" aria-label="Connection settings">
        <div className="flex items-center justify-between"><h2 className="text-sm font-medium">Connection settings</h2><Button variant="ghost" size="icon" aria-label="Close connection settings" onClick={() => setSettingsOpen(false)}><X className="size-4" /></Button></div>
        <Button variant="secondary" className="w-full" onClick={onForget}><Unplug className="mr-2 size-4" />Forget paired Mac</Button>
      </section>}
    </main>
  );
}

export function MiniPlayer({ remote, onOpen }: { remote: ReturnType<typeof useRemote>; onOpen: () => void }) {
  const state = remote.state ?? emptyState;
  return <footer className="mini-player" aria-label="Now playing">
    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Back to player" onClick={onOpen}>
      {state.artwork && <img src={state.artwork} alt="" className="size-12 flex-none rounded-lg object-cover" />}
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{state.title || "Nothing playing"}</span><span className="block truncate text-xs text-muted-foreground">{state.artist}</span></span>
    </button>
    <Button variant="ghost" size="icon" aria-label={state.isPlaying ? "Pause" : "Play"} onClick={() => remote.send({ type: state.isPlaying ? "PAUSE" : "PLAY" })}>{state.isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}</Button>
  </footer>;
}

export function SongSearch({ remote, onPlay }: { remote: ReturnType<typeof useRemote>; onPlay: () => void }) {
  const [query, setQuery] = useState("");
  const connected = remote.status === "connected" && remote.peerConnected;
  return (
    <section className="search-screen">
      <div className="search-header">
      <h2 className="text-xl font-semibold">Search songs</h2>
      <form className="song-search mt-4" onSubmit={(event) => { event.preventDefault(); remote.search(query); }}>
        <label className="sr-only" htmlFor="song-search">Song or artist</label>
        <input id="song-search" type="search" enterKeyHint="search" maxLength={200} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Song or artist" className="min-w-0 flex-1" />
        <Button type="submit" variant="ghost" size="icon" aria-label="Search songs" disabled={!connected || remote.searching || !query.trim()}>{remote.searching ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="size-5" aria-hidden="true" />}</Button>
      </form>
      <p className="mt-3 text-sm text-muted-foreground">Plays in YouTube Music on your Mac.</p>
      {!connected && <p role="status" className="mt-3 text-sm text-muted-foreground">Connect your Mac to search and play.</p>}
      {remote.searchError && <p role="alert" className="mt-4 text-sm text-danger">{remote.searchError}</p>}
      {remote.error && !remote.searchError && <p role="alert" className="mt-4 text-sm text-danger">{remote.error}</p>}
      <div role="status" aria-live="polite" className="mt-4 text-sm text-muted-foreground">
        {remote.searching ? "Searching…" : remote.searchResults ? `${remote.searchResults.length} songs found` : ""}
      </div>
      </div>
      <ul className="search-results mt-3" aria-label="Search results">
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

export function Player({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const state = remote.state ?? emptyState;
  const [seek, setSeek] = useState<number>();
  const shownPosition = seek ?? state.position;

  return (
    <div className="player">
      <p className="eyebrow mb-3">Now playing{state.source ? ` · ${state.source}` : ""}</p>
      <div className="player-artwork overflow-hidden rounded-2xl bg-muted">
        {state.artwork ? <img src={state.artwork} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Play className="size-20" /></div>}
      </div>
      <h2 className="mt-4 truncate text-2xl font-semibold">{state.title || "Nothing playing"}</h2>
      <p className="mt-1 truncate text-muted-foreground">{state.artist || "Start music on your Mac"}</p>
      <input aria-label="Playback position" type="range" min="0" max={Math.max(state.duration, 1)} value={shownPosition} onChange={(event) => setSeek(Number(event.target.value))} onPointerUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} onKeyUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} className="mt-4 w-full" />
      <div className="time-label flex justify-between text-xs text-muted-foreground"><span>{time(shownPosition)}</span><span>{time(state.duration)}</span></div>
      <div className="my-3 flex items-center justify-center gap-5">
        <Button variant="ghost" size="icon" aria-label="Previous track" onClick={() => remote.send({ type: "PREVIOUS" })}><SkipBack className="size-7 fill-current" /></Button>
        <Button size="largeIcon" aria-label={state.isPlaying ? "Pause" : "Play"} onClick={() => remote.send({ type: state.isPlaying ? "PAUSE" : "PLAY" })}>{state.isPlaying ? <Pause className="size-8 fill-current" /> : <Play className="ml-1 size-8 fill-current" />}</Button>
        <Button variant="ghost" size="icon" aria-label="Next track" onClick={() => remote.send({ type: "NEXT" })}><SkipForward className="size-7 fill-current" /></Button>
      </div>
      {remote.error && <ErrorMessage message={remote.error} dismiss={() => remote.setError("")} />}
    </div>
  );
}

export function VolumePopover({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const state = remote.state ?? emptyState;
  return <>
    <Button variant="ghost" size="icon" aria-label="Volume controls" popoverTarget="volume-controls"><Volume2 className="size-5" /></Button>
    <div id="volume-controls" popover="auto" className="volume-popover" role="group" aria-label="Volume controls">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-medium">Volume</h2><Button variant="ghost" size="icon" aria-label="Close volume controls" popoverTarget="volume-controls" popoverTargetAction="hide"><X className="size-4" /></Button></div>
      <div className="flex justify-center gap-6">
        {state.volume !== undefined && <VolumeControl id="music-volume" label="Music" value={state.volume} onChange={(volume) => remote.send({ type: "SET_VOLUME", volume })} />}
        {state.systemVolume !== undefined && <VolumeControl id="mac-volume" label="Mac" value={state.systemVolume} onChange={(volume) => remote.send({ type: "SET_SYSTEM_VOLUME", volume })} />}
      </div>
      {state.systemVolume !== undefined && <p className="mt-3 text-xs text-muted-foreground">Mac changes all laptop audio</p>}
    </div>
  </>;
}

function VolumeControl({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return <div className="volume-control">
    <label htmlFor={id} className="text-xs font-medium">{label}</label>
    <input id={id} aria-label={`${label} volume`} type="range" min="0" max="100" step="1" value={Math.round(value * 100)} onChange={(event) => onChange(Number(event.currentTarget.value) / 100)} />
    <span className="time-label text-xs text-muted-foreground">{Math.round(value * 100)}%</span>
  </div>;
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
