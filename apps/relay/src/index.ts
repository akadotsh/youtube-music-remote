import { parseClientMessage, type DeviceCredential, type PairingSession, type Role } from "@yt-remote/protocol";
import { DurableObject } from "cloudflare:workers";
import { canSend } from "./rules";

type Env = {
  ROOMS: DurableObjectNamespace<RelayRoom>;
  PAIRING_LIMITER: DurableObjectNamespace<PairingLimiter>;
};

const PAIRING_TTL_MS = 5 * 60_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method === "GET" && url.pathname === "/health") return cors(json({ ok: true }));

    if (request.method === "POST" && url.pathname === "/pair/start") {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const room = env.ROOMS.getByName(code);
        const response = await room.fetch(new Request("https://room/initialize", { method: "POST" }));
        if (response.ok) return cors(response);
      }
      return cors(json({ error: "Could not allocate a pairing code" }, 503));
    }

    if (request.method === "POST" && url.pathname === "/pair/complete") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const limiter = env.PAIRING_LIMITER.getByName("global");
      const allowed = await limiter.fetch(new Request(`https://limiter/check?key=${encodeURIComponent(ip)}`, { method: "POST" }));
      if (!allowed.ok) return cors(json({ error: "Too many pairing attempts" }, 429));

      const body = await safeJson(request);
      if (!body || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
        return cors(json({ error: "Enter a six-digit pairing code" }, 400));
      }
      return cors(await env.ROOMS.getByName(body.code).fetch(new Request("https://room/pair", { method: "POST" })));
    }

    if (request.method === "GET" && url.pathname === "/connect") {
      const roomId = url.searchParams.get("room");
      if (!roomId || request.headers.get("Upgrade") !== "websocket") {
        return cors(json({ error: "Expected a WebSocket connection" }, 400));
      }
      return env.ROOMS.getByName(roomId).fetch(request);
    }

    return cors(json({ error: "Not found" }, 404));
  },
};

export class RelayRoom extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/initialize" && request.method === "POST") {
      if (await this.ctx.storage.get("extensionTokenHash")) return new Response(null, { status: 409 });
      const token = randomToken();
      const expiresAt = Date.now() + PAIRING_TTL_MS;
      await this.ctx.storage.put({ extensionTokenHash: await hash(token), expiresAt });
      const roomId = this.ctx.id.name ?? "";
      return json({ roomId, pairingCode: roomId, token, role: "extension", expiresAt } satisfies PairingSession);
    }

    if (url.pathname === "/pair" && request.method === "POST") {
      const expiresAt = await this.ctx.storage.get<number>("expiresAt");
      if (!expiresAt || Date.now() > expiresAt) return json({ error: "Pairing code expired" }, 410);
      if (await this.ctx.storage.get("remoteTokenHash")) return json({ error: "Pairing code already used" }, 409);

      const token = randomToken();
      await this.ctx.storage.put("remoteTokenHash", await hash(token));
      return json({ roomId: this.ctx.id.name ?? "", token, role: "remote" } satisfies DeviceCredential);
    }

    if (url.pathname === "/connect" && request.headers.get("Upgrade") === "websocket") {
      const token = url.searchParams.get("token");
      const role = token ? await this.roleForToken(token) : undefined;
      if (!role) return json({ error: "Unauthorized" }, 401);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [role]);
      this.broadcastStatus();
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(null, { status: 404 });
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") return socket.close(1003, "Text messages only");
    const message = parseClientMessage(raw);
    const role = this.ctx.getTags(socket)[0] as Role | undefined;
    if (!message || !role || !canSend(role, message)) return socket.send(JSON.stringify({ type: "ERROR", message: "Invalid message" }));

    const recipient = role === "remote" ? "extension" : "remote";
    for (const peer of this.ctx.getWebSockets(recipient)) peer.send(raw);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    socket.close(code, reason);
    this.broadcastStatus();
  }

  webSocketError(): void {
    this.broadcastStatus();
  }

  private async roleForToken(token: string): Promise<Role | undefined> {
    const tokenHash = await hash(token);
    if (tokenHash === (await this.ctx.storage.get("extensionTokenHash"))) return "extension";
    if (tokenHash === (await this.ctx.storage.get("remoteTokenHash"))) return "remote";
  }

  private broadcastStatus(): void {
    queueMicrotask(() => {
      const extensionConnected = this.ctx.getWebSockets("extension").length > 0;
      const remoteConnected = this.ctx.getWebSockets("remote").length > 0;
      for (const socket of this.ctx.getWebSockets("extension")) {
        socket.send(JSON.stringify({ type: "PEER_STATUS", connected: remoteConnected }));
      }
      for (const socket of this.ctx.getWebSockets("remote")) {
        socket.send(JSON.stringify({ type: "PEER_STATUS", connected: extensionConnected }));
      }
    });
  }
}

export class PairingLimiter extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const key = new URL(request.url).searchParams.get("key") ?? "unknown";
    const now = Date.now();
    const attempts = (await this.ctx.storage.get<number[]>(key))?.filter((time) => now - time < PAIRING_TTL_MS) ?? [];
    if (attempts.length >= 10) return new Response(null, { status: 429 });
    attempts.push(now);
    await this.ctx.storage.put(key, attempts);
    return new Response(null, { status: 204 });
  }
}

function randomCode(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, "0");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function safeJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function cors(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("Access-Control-Allow-Origin", "*");
  result.headers.set("Access-Control-Allow-Headers", "Content-Type");
  result.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return result;
}
