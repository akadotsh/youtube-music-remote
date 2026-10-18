import {
  parseServerMessage,
  type Command,
  type DeviceCredential,
  type PlayerState,
  type SearchResult,
} from "@yt-remote/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { websocketUrl } from "./connection";

export type SavedConnection = { relayUrl: string; credential: DeviceCredential };
type Status = "disconnected" | "connecting" | "connected";

export function useRemote(connection: SavedConnection | undefined) {
  const [status, setStatus] = useState<Status>("disconnected");
  const [peerConnected, setPeerConnected] = useState(false);
  const [state, setState] = useState<PlayerState>();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);

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
        delay = 1_000;
        setStatus("connected");
        sendOn(socket, { type: "GET_STATE" });
      });
      socket.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") return;
        const message = parseServerMessage(data);
        if (!message) return;
        if (message.type === "STATE") setState(message.state);
        if (message.type === "PEER_STATUS") setPeerConnected(message.connected);
        if (message.type === "SEARCH_RESULTS") {
          setResults(message.results);
          setSearching(false);
        }
        if (message.type === "ERROR") {
          setError(message.message);
          setSearching(false);
        }
      });
      socket.addEventListener("close", () => {
        setStatus("disconnected");
        setPeerConnected(false);
        if (active) {
          timer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      });
    };

    connect();
    return () => {
      active = false;
      clearTimeout(timer);
      socket.close();
    };
  }, [connection]);

  const send = useCallback((command: Command) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return setError("Relay is disconnected");
    setError("");
    socket.send(JSON.stringify({ type: "COMMAND", requestId: crypto.randomUUID(), command }));
  }, []);

  const search = useCallback((query: string) => {
    setResults([]);
    setSearching(true);
    send({ type: "SEARCH", query });
  }, [send]);

  return { status, peerConnected, state, results, searching, error, setError, send, search };
}

function sendOn(socket: WebSocket, command: Command): void {
  socket.send(JSON.stringify({ type: "COMMAND", requestId: crypto.randomUUID(), command }));
}
