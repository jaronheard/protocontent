// Space Durable Object — one instance per spaceId. LIVE FANOUT ONLY.
//
// Responsibilities (intentionally minimal):
//   - Accept hibernatable WebSocket connections from live viewers of the
//     session index page (GET /__live in the Worker is routed here).
//   - On an internal POST /notify (sent by the publish path), broadcast a
//     {"type":"changed"} message to every connected viewer so they re-fetch
//     the artifact list.
//
// No R2, no D1, no content serving happens here — that all stays stateless in
// the Worker. This object is purely connection management + broadcast.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

export class Space extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal notify hook: publish path calls this to fan out a change event.
    if (url.pathname === "/notify" && request.method === "POST") {
      this.broadcast({ type: "changed" });
      return new Response(null, { status: 204 });
    }

    // WebSocket upgrade for a live viewer.
    if (url.pathname === "/__live") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Hibernatable WebSockets: hand the server end to the runtime so this
      // object can be evicted from memory while the connection stays open.
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  /** Broadcast a JSON message to all connected viewers. */
  private broadcast(message: unknown): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // Best effort: drop sockets that fail to send.
        try {
          ws.close(1011, "send failed");
        } catch {
          /* ignore */
        }
      }
    }
  }

  // --- Hibernatable WebSocket handlers ---

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // Viewers don't need to send anything; reply to a "ping" for liveness.
    if (typeof message === "string" && message === "ping") {
      ws.send("pong");
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(code, "closing");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Nothing to do; the runtime removes the socket from getWebSockets().
  }
}
