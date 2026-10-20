import type { DeviceCredential, PlayerState } from "@yt-remote/protocol";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Unplug, X } from "lucide-react";
import { useEffect, useState } from "react";
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
      <p className="mt-2 text-muted-foreground">Open the desktop app, create a pairing code, then enter it here.</p>
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] text-foreground">
      <header className="flex items-center justify-between">
        <div><h1 className="font-semibold">YouTube Music Remote</h1><p className="text-xs text-muted-foreground">{remote.status === "connected" ? (remote.peerConnected ? "Mac connected" : "Waiting for Mac") : "Reconnecting…"}</p></div>
        <Button variant="ghost" size="icon" aria-label="Forget device" onClick={onForget}><Unplug className="size-5" /></Button>
      </header>

      <div className="flex flex-1 flex-col"><Player remote={remote} /></div>
    </main>
  );
}

function Player({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const state = remote.state ?? emptyState;
  const [seek, setSeek] = useState<number>();
  const [volume, setVolume] = useState<number>();
  useEffect(() => setVolume(undefined), [state.volume, remote.error]);
  const shownPosition = seek ?? state.position;

  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <div className="aspect-square overflow-hidden rounded-3xl bg-muted shadow-2xl">
        {state.artwork ? <img src={state.artwork} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Play className="size-20" /></div>}
      </div>
      <h2 className="mt-8 truncate text-2xl font-bold">{state.title || "Nothing playing"}</h2>
      <p className="mt-1 truncate text-muted-foreground">{state.artist || "Start music on your Mac"}</p>
      {state.source && <p className="mt-1 truncate text-xs text-muted-foreground">{state.source}</p>}
      <input aria-label="Playback position" type="range" min="0" max={Math.max(state.duration, 1)} value={shownPosition} onChange={(event) => setSeek(Number(event.target.value))} onPointerUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} onKeyUp={() => { if (seek !== undefined) remote.send({ type: "SEEK", position: seek }); setSeek(undefined); }} className="mt-7 w-full accent-primary" />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{time(shownPosition)}</span><span>{time(state.duration)}</span></div>
      <div className="mt-7 flex items-center justify-center gap-5">
        <Button variant="ghost" size="icon" aria-label="Previous track" onClick={() => remote.send({ type: "PREVIOUS" })}><SkipBack className="size-7 fill-current" /></Button>
        <Button size="largeIcon" aria-label={state.isPlaying ? "Pause" : "Play"} onClick={() => remote.send({ type: state.isPlaying ? "PAUSE" : "PLAY" })}>{state.isPlaying ? <Pause className="size-8 fill-current" /> : <Play className="ml-1 size-8 fill-current" />}</Button>
        <Button variant="ghost" size="icon" aria-label="Next track" onClick={() => remote.send({ type: "NEXT" })}><SkipForward className="size-7 fill-current" /></Button>
      </div>
      {state.volume !== undefined && (
        <div className="mt-7">
          <div className="flex justify-between text-xs text-muted-foreground">
            <label htmlFor="music-volume">Music volume</label>
            <span>{Math.round((volume ?? state.volume) * 100)}%</span>
          </div>
          <input id="music-volume" type="range" min="0" max="100" step="1"
            value={Math.round((volume ?? state.volume) * 100)}
            onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)}
            onPointerUp={(event) => remote.send({ type: "SET_VOLUME", volume: Number(event.currentTarget.value) / 100 })}
            onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) remote.send({ type: "SET_VOLUME", volume: Number(event.currentTarget.value) / 100 }); }}
            onPointerCancel={() => setVolume(undefined)}
            className="mt-2 w-full accent-primary" />
        </div>
      )}
      {remote.error && <ErrorMessage message={remote.error} dismiss={() => remote.setError("")} />}
    </div>
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
