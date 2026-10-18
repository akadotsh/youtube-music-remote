import type { DeviceCredential, PlayerState } from "@yt-remote/protocol";
import { LoaderCircle, Pause, Play, RotateCcw, Search as SearchIcon, SkipBack, SkipForward, Unplug, X } from "lucide-react";
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-foreground">
      <div className="mb-8 size-14 rounded-2xl bg-primary p-4"><Play className="fill-white" /></div>
      <h1 className="text-3xl font-bold tracking-tight">Connect to your Mac</h1>
      <p className="mt-2 text-muted-foreground">Open the Chrome extension, create a pairing code, then enter it here.</p>
      <label className="mt-8 text-sm font-medium" htmlFor="relay">Relay URL</label>
      <input id="relay" type="url" value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} placeholder="https://your-worker.workers.dev" className="mt-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-primary" />
      <label className="mt-4 text-sm font-medium" htmlFor="code">Pairing code</label>
      <input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" className="mt-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-2xl tracking-[0.35em] outline-none focus:border-primary" />
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <Button className="mt-6 rounded-xl" disabled={loading || code.length !== 6 || !relayUrl} onClick={pair}>{loading ? "Connecting…" : "Connect"}</Button>
    </main>
  );
}

function Remote({ connection, onForget }: { connection: SavedConnection; onForget: () => void }) {
  const remote = useRemote(connection);
  const [screen, setScreen] = useState<"player" | "search">("player");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] text-foreground">
      <header className="flex items-center justify-between">
        <div><h1 className="font-semibold">YouTube Music Remote</h1><p className="text-xs text-muted-foreground">{remote.status === "connected" ? (remote.peerConnected ? "Mac connected" : "Waiting for Mac") : "Reconnecting…"}</p></div>
        <Button variant="ghost" size="icon" aria-label="Forget device" onClick={onForget}><Unplug className="size-5" /></Button>
      </header>

      <div className="flex flex-1 flex-col">{screen === "player" ? <Player remote={remote} /> : <Search remote={remote} />}</div>

      <nav aria-label="Main navigation" className="mt-4 grid grid-cols-2 rounded-2xl bg-muted p-1">
        <button className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm ${screen === "player" ? "bg-zinc-700" : "text-muted-foreground"}`} onClick={() => setScreen("player")}><Play className="size-4" />Now Playing</button>
        <button className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm ${screen === "search" ? "bg-zinc-700" : "text-muted-foreground"}`} onClick={() => setScreen("search")}><SearchIcon className="size-4" />Search</button>
      </nav>
    </main>
  );
}

function Player({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const state = remote.state ?? emptyState;
  const [seek, setSeek] = useState<number>();
  const shownPosition = seek ?? state.position;

  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <div className="aspect-square overflow-hidden rounded-3xl bg-muted shadow-2xl">
        {state.artwork ? <img src={state.artwork} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Play className="size-20" /></div>}
      </div>
      <h2 className="mt-8 truncate text-2xl font-bold">{state.title || "Nothing playing"}</h2>
      <p className="mt-1 truncate text-muted-foreground">{state.artist || "Open YouTube Music on your Mac"}</p>
      <input aria-label="Playback position" type="range" min="0" max={Math.max(state.duration, 1)} value={shownPosition} onChange={(event) => setSeek(Number(event.target.value))} onPointerUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} onKeyUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} className="mt-7 w-full accent-primary" />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{time(shownPosition)}</span><span>{time(state.duration)}</span></div>
      <div className="mt-7 flex items-center justify-center gap-5">
        <Button variant="ghost" size="icon" aria-label="Previous track" onClick={() => remote.send({ type: "PREVIOUS" })}><SkipBack className="size-7 fill-current" /></Button>
        <Button size="largeIcon" aria-label={state.isPlaying ? "Pause" : "Play"} onClick={() => remote.send({ type: state.isPlaying ? "PAUSE" : "PLAY" })}>{state.isPlaying ? <Pause className="size-8 fill-current" /> : <Play className="ml-1 size-8 fill-current" />}</Button>
        <Button variant="ghost" size="icon" aria-label="Next track" onClick={() => remote.send({ type: "NEXT" })}><SkipForward className="size-7 fill-current" /></Button>
      </div>
      {remote.error && <ErrorMessage message={remote.error} dismiss={() => remote.setError("")} />}
    </div>
  );
}

function Search({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);

  return (
    <section className="py-8">
      <h2 className="text-2xl font-bold">Search on your Mac</h2>
      <form className="mt-5 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!query.trim()) return; setSearched(true); remote.search(query.trim()); }}>
        <input aria-label="Search songs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Song or artist" className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-primary" />
        <Button size="icon" aria-label="Search" disabled={remote.searching}><SearchIcon className="size-5" /></Button>
      </form>
      {remote.error && <ErrorMessage message={remote.error} dismiss={() => remote.setError("")} />}
      {remote.searching && <div className="flex justify-center py-16"><LoaderCircle className="animate-spin text-muted-foreground" /></div>}
      {!remote.searching && searched && remote.results.length === 0 && !remote.error && <p className="py-16 text-center text-muted-foreground">No songs found.</p>}
      <ul className="mt-5 space-y-2">
        {remote.results.map((result) => <li key={result.id}><button className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted" onClick={() => remote.send({ type: "PLAY_RESULT", resultId: result.id })}>{result.thumbnail ? <img src={result.thumbnail} alt="" className="size-14 rounded-lg object-cover" /> : <div className="size-14 rounded-lg bg-muted" />}<span className="min-w-0"><strong className="block truncate">{result.title}</strong><span className="block truncate text-sm text-muted-foreground">{result.artist}</span></span></button></li>)}
      </ul>
    </section>
  );
}

function ErrorMessage({ message, dismiss }: { message: string; dismiss: () => void }) {
  return <button className="mt-6 flex w-full items-center justify-center gap-2 text-sm text-red-400" onClick={dismiss}><RotateCcw className="size-4" />{message}<X className="size-3" /></button>;
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
