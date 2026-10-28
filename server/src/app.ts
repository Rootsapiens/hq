// HTTP + WebSocket server. REST for commands, one WS stream (/ws) for every state event.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { PauseBodySchema, PostMessageBodySchema, type ServerEvent } from "../../shared/events";
import { HqDb } from "./db";
import { Hq, type HqOptions } from "./hq";
import { errorMessage, type ModelClient } from "./model";

export interface AppOptions extends Omit<HqOptions, "db" | "model"> {
  model: ModelClient;
  dbPath: string;
  port: number;
  host?: string;
}

export interface App {
  hq: Hq;
  server: Server;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export async function startApp(opts: AppOptions): Promise<App> {
  const db = new HqDb(opts.dbPath);
  const hq = new Hq({ ...opts, db, model: opts.model });

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[http] handler error:", errorMessage(err));
      if (!res.headersSent) send(res, 500, { ok: false, error: "internal error" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true, mode: opts.model.mode });
    if (req.method === "GET" && path === "/api/state") return send(res, 200, hq.snapshot());
    if (req.method === "GET" && path === "/api/agents") return send(res, 200, hq.agentViews());

    const msgMatch = /^\/api\/agents\/([\w-]+)\/(messages|message)$/.exec(path);
    if (msgMatch) {
      const id = msgMatch[1] ?? "";
      if (!hq.hasAgent(id)) return send(res, 404, { ok: false, error: `unknown agent ${id}` });
      if (req.method === "GET" && msgMatch[2] === "messages") return send(res, 200, hq.messages(id));
      if (req.method === "POST" && msgMatch[2] === "message") {
        let raw: unknown;
        try {
          raw = await readJson(req);
        } catch (err) {
          return send(res, 400, { ok: false, error: errorMessage(err) });
        }
        const body = PostMessageBodySchema.safeParse(raw);
        if (!body.success) return send(res, 400, { ok: false, error: "body must be {\"text\": string}" });
        const r = hq.postOwnerMessage(id, body.data.text);
        return send(res, 202, { ok: true, messageId: r.messageId, queued: r.queued });
      }
    }
    if (req.method === "POST" && path === "/api/pause") {
      let raw: unknown;
      try {
        raw = await readJson(req);
      } catch (err) {
        return send(res, 400, { ok: false, error: errorMessage(err) });
      }
      const body = PauseBodySchema.safeParse(raw);
      if (!body.success) return send(res, 400, { ok: false, error: "body must be {\"paused\": boolean}" });
      hq.setPaused(body.data.paused);
      return send(res, 200, { ok: true, paused: hq.isPaused() });
    }
    send(res, 404, { ok: false, error: "not found" });
  }

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    ws.send(JSON.stringify(hq.snapshot()));
  });
  const unsubscribe = hq.subscribe((e: ServerEvent) => {
    const data = JSON.stringify(e);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    hq,
    server,
    port,
    async close() {
      unsubscribe();
      for (const ws of clients) ws.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      hq.dispose();
      db.close();
    },
  };
}
