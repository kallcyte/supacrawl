import { DurableObject } from "cloudflare:workers"

interface CrawlProgress {
  crawlId: string
  total: number
  checked: number
  changed: number
  broken: number
  skipped: number
  currentUrl?: string
  status: "running" | "completed" | "failed"
  startedAt: string
}

/**
 * Durable Object that manages WebSocket connections for a single crawl session.
 * Queue consumers send progress updates via fetch(), and connected dashboard
 * clients receive them over WebSocket.
 */
export class CrawlSession extends DurableObject<import("../index").Env> {
  private sessions: WebSocket[] = []

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket upgrade — dashboard client connects
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server!)
      this.sessions.push(server!)
      return new Response(null, { status: 101, webSocket: client })
    }

    // Progress update from a Queue consumer
    if (url.pathname === "/progress" && request.method === "POST") {
      const progress: CrawlProgress = await request.json()
      const payload = JSON.stringify(progress)
      // Fan out to all connected clients
      for (const ws of this.sessions) {
        try {
          ws.send(payload)
        } catch {
          // Client disconnected — will be cleaned up in webSocketClose
        }
      }
      return new Response("ok")
    }

    return new Response("Not found", { status: 404 })
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.sessions = this.sessions.filter((s) => s !== ws)
    ws.close(1011, "DO closing")
  }

  async webSocketError(_ws: WebSocket): Promise<void> {
    this.sessions = this.sessions.filter((s) => s !== _ws)
  }
}
