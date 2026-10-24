import {
  parseServerMessage,
  type Command,
  type DeviceCredential,
  type PlayerState,
  type SearchResult,
} from "@yt-remote/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { websocketUrl } from "./connection";
import { type PendingControls, reconcileControls, VolumeQueue } from "./feedback";

export type SavedConnection = { relayUrl: string; credential: DeviceCredential };
type Status = "disconnected" | "connecting" | "connected";

export function useRemote(connection: SavedConnection | undefined) {
  const [status, setStatus] = useState<Status>("disconnected");
  const [peerConnected, setPeerConnected] = useState(false);
  const [state, setState] = useState<PlayerState>();
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const reportedState = useRef<PlayerState | undefined>(undefined);
  const pending = useRef<PendingControls>({});
  const volumeQueues = useRef({ volume: new VolumeQueue(), systemVolume: new VolumeQueue() });
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [searchResults, setSearchResults] = useState<SearchResult[]>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRequest = useRef<string | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!connection) return;
    let active = true;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1_000;

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      socket = new WebSocket(websocketUrl(connection.relayUrl, connection.credential));
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (!active) return;
        delay = 1_000;
        setStatus("connected");
        sendOn(socket, { type: "GET_STATE" });
      });
      socket.addEventListener("message", ({ data }) => {
        if (!active) return;
        if (typeof data !== "string") return;
        const message = parseServerMessage(data);
        if (!message) return;
        if (message.type === "SEARCH_RESULTS" && message.requestId === searchRequest.current) {
          clearTimeout(searchTimer.current);
          searchRequest.current = undefined;
          setSearchResults(message.results);
          setSearching(false);
        }
        if (message.type === "STATE") {
          reportedState.current = message.state;
          setState(reconcileControls(message.state, pending.current));
        }
        if (message.type === "ACK") {
          for (const control of Object.values(pending.current)) {
            if (control.requestId === message.requestId) control.acknowledged = true;
          }
          for (const key of ["volume", "systemVolume"] as const) {
            const type = key === "volume" ? "SET_VOLUME" : "SET_SYSTEM_VOLUME";
            const requestId = volumeQueues.current[key].acknowledge(message.requestId,
              (volume) => sendOn(socket, { type, volume }));
            const control = pending.current[key];
            if (requestId && control) control.requestId = requestId;
          }
          setState(reconcileControls(reportedState.current, pending.current));
        }
        if (message.type === "PEER_STATUS") setPeerConnected(message.connected);
        if (message.type === "ERROR") {
          if (message.requestId && message.requestId === searchRequest.current) {
            clearTimeout(searchTimer.current);
            searchRequest.current = undefined;
            setSearching(false);
            setSearchError(message.message);
            return;
          }
          pending.current = {};
          Object.values(volumeQueues.current).forEach((queue) => queue.reset());
          setState(reportedState.current);
          setError(message.message);
        }
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setStatus("disconnected");
        setPeerConnected(false);
        if (searchRequest.current) setSearchError("Disconnected from the Mac. Try searching again after reconnecting.");
        clearTimeout(searchTimer.current);
        searchRequest.current = undefined;
        setSearching(false);
        clearTimeout(feedbackTimer.current);
        pending.current = {};
        Object.values(volumeQueues.current).forEach((queue) => queue.reset());
        setState(reportedState.current);
        if (active) {
          timer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      });
    };

    connect();
    const refresh = () => {
      if (document.visibilityState === "visible" && socket.readyState === WebSocket.OPEN) {
        sendOn(socket, { type: "GET_STATE" });
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
      clearTimeout(timer);
      clearTimeout(feedbackTimer.current);
      clearTimeout(searchTimer.current);
      pending.current = {};
      Object.values(volumeQueues.current).forEach((queue) => queue.reset());
      socket.close();
    };
  }, [connection]);

  const send = useCallback((command: Command) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return setError("Relay is disconnected");
    setError("");
    const expiresAt = Date.now() + 5_000;
    if (command.type === "PLAY" || command.type === "PAUSE") {
      pending.current.isPlaying = { value: command.type === "PLAY", acknowledged: false, expiresAt };
    }
    if (command.type === "SET_VOLUME" || command.type === "SET_SYSTEM_VOLUME") {
      const key = command.type === "SET_VOLUME" ? "volume" : "systemVolume";
      const type = command.type;
      pending.current[key] = {
        value: command.volume, acknowledged: false, expiresAt,
        requestId: volumeQueues.current[key].send(command.volume,
          (volume) => sendOn(socket, { type, volume })),
      };
    } else {
      const requestId = sendOn(socket, command);
      if (command.type === "PLAY" || command.type === "PAUSE") {
        pending.current.isPlaying!.requestId = requestId;
      }
    }
    setState(reconcileControls(reportedState.current, pending.current));
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      if (Object.keys(pending.current).length) setError("The Mac did not confirm the change. Try again.");
      pending.current = {};
      Object.values(volumeQueues.current).forEach((queue) => queue.reset());
      setState(reportedState.current);
    }, 5_000);
  }, []);

  const search = useCallback((query: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !peerConnected) {
      return setSearchError("Connect your Mac before searching.");
    }
    if (!query.trim() || query.length > 200) return setSearchError("Enter a search of 1–200 characters.");
    clearTimeout(searchTimer.current);
    setSearching(true);
    setError("");
    setSearchError("");
    setSearchResults(undefined);
    searchRequest.current = sendOn(socket, { type: "SEARCH", query: query.trim() });
    searchTimer.current = setTimeout(() => {
      searchRequest.current = undefined;
      setSearching(false);
      setSearchError("Search timed out. Check that YouTube Music is open on your Mac.");
    }, 20_000);
  }, [peerConnected]);

  return { status, peerConnected, state, error, setError, send, search, searching, searchResults, searchError };
}

function sendOn(socket: WebSocket, command: Command): string {
  const requestId = crypto.randomUUID();
  socket.send(JSON.stringify({ type: "COMMAND", requestId, command }));
  return requestId;
}
