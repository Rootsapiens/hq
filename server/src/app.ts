// HTTP + WebSocket server. REST for commands, one WS stream (/ws) for every state event.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { PauseBodySchema, PostMessageBodySchema, type ServerEvent } from "../../shared/events";
import { Access, type PublicDetail, type Role } from "./access";
import { HqDb } from "./db";
import { Hq, type HqOptions } from "./hq";
import { errorMessage, type ModelClient } from "./model";

export interface AppOptions extends Omit<HqOptions, "db" | "model"> {
  model: ModelClient;
  dbPath: string;
  port: number;
  host?: string;
  /** Set to make HQ public: viewers watch, the owner logs in with this token. */
  ownerToken?: string;
  publicDetail?: PublicDetail;
  /** Serve the built web app (web/dist) from this folder. */
  staticDir?: string;
}

export interface App {
  hq: Hq;
  server: Server;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Only pages served from this machine may talk to HQ (blocks drive-by requests from other sites). */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl, server-to-server, same-origin GET
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      req.resume();
      reject(new HttpError(415, "content-type must be application/json"));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) tooLarge = true; // keep draining so we can answer 413
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return reject(new HttpError(413, "body too large"));
      try {
        resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown) : {});
      } catch {
        reject(new HttpError(400, "invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(root: string, path: string, res: ServerResponse): Promise<void> {
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
  let file = join(root, rel);
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep) && file !== root) return send(res, 404, { ok: false, error: "not found" });
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
  } catch {
    file = join(root, "index.html"); // single-page app
  }
  try {
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  } catch {
    send(res, 404, { ok: false, error: "web app not built (npm run build)" });
  }
}

export async function startApp(opts: AppOptions): Promise<App> {
  const db = new HqDb(opts.dbPath);
  const hq = new Hq({ ...opts, db, model: opts.model });
  const access = new Access({ ownerToken: opts.ownerToken, publicDetail: opts.publicDetail });
  const secure = (req: IncomingMessage) => req.headers["x-forwarded-proto"] === "https";
  // crude login throttle: 10 tries per IP per 10 minutes
  const tries = new Map<string, { n: number; since: number }>();

  const clients = new Map<WebSocket, Role>();
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[http] handler error:", errorMessage(err));
      if (!res.headersSent) send(res, 500, { ok: false, error: "internal error" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (!access.originAllowed(req)) return send(res, 403, { ok: false, error: "origin not allowed" });
    const role = access.role(req);
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true, mode: opts.model.mode, clients: clients.size });
    if (req.method === "GET" && path === "/api/me")
      return send(res, 200, { role, public: access.isPublic, canRead: access.canRead(role), canAct: role === "owner" });
    if (req.method === "POST" && path === "/api/login") {
      if (!access.isPublic) return send(res, 200, { ok: true, role: "owner" });
      const ip = req.socket.remoteAddress ?? "?";
      const t = tries.get(ip);
      const now = Date.now();
      if (t && now - t.since < 600_000 && t.n >= 10) return send(res, 429, { ok: false, error: "too many attempts, wait 10 minutes" });
      let raw: unknown;
      try {
        raw = await readJson(req);
      } catch (err) {
        return send(res, err instanceof HttpError ? err.status : 400, { ok: false, error: errorMessage(err) });
      }
      const token = typeof raw === "object" && raw && "token" in raw && typeof raw.token === "string" ? raw.token : "";
      if (!access.checkToken(token)) {
        tries.set(ip, t && now - t.since < 600_000 ? { n: t.n + 1, since: t.since } : { n: 1, since: now });
        return send(res, 401, { ok: false, error: "wrong owner password" });
      }
      tries.delete(ip);
      res.setHeader("set-cookie", access.sessionCookie(secure(req)));
      return send(res, 200, { ok: true, role: "owner" });
    }
    if (req.method === "POST" && path === "/api/logout") {
      res.setHeader("set-cookie", access.sessionCookie(secure(req), true));
      return send(res, 200, { ok: true });
    }
    const write = req.method !== "GET" && req.method !== "HEAD";
    if (path.startsWith("/api/") && write && role !== "owner") return send(res, 401, { ok: false, error: "owner login required" });
    const privateRead = path === "/api/files" || path.startsWith("/api/files/") || /^\/api\/agents\/[\w-]+\/messages$/.test(path);
    if (privateRead && !access.canRead(role)) return send(res, 401, { ok: false, error: "owner login required" });
    if (req.method === "GET" && path === "/api/state") {
      const snap = access.filter(hq.snapshot(), role);
      return send(res, 200, snap);
    }
    if (req.method === "GET" && path === "/api/agents") return send(res, 200, hq.agentViews());

    if (req.method === "GET" && path === "/api/files") return send(res, 200, hq.files());
    const fileMatch = /^\/api\/files\/([\w-]+)(\/download)?$/.exec(path);
    if (req.method === "GET" && fileMatch) {
      const f = hq.file(fileMatch[1] ?? "");
      if (!f) return send(res, 404, { ok: false, error: "unknown file" });
      if (!fileMatch[2]) return send(res, 200, f);
      // served as plain text, never rendered, so an agent-written .html/.svg cannot run in the HQ origin
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${f.name}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "no-store",
      });
      res.end(f.content);
      return;
    }

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
          return send(res, err instanceof HttpError ? err.status : 400, { ok: false, error: errorMessage(err) });
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
        return send(res, err instanceof HttpError ? err.status : 400, { ok: false, error: errorMessage(err) });
      }
      const body = PauseBodySchema.safeParse(raw);
      if (!body.success) return send(res, 400, { ok: false, error: "body must be {\"paused\": boolean}" });
      hq.setPaused(body.data.paused);
      return send(res, 200, { ok: true, paused: hq.isPaused() });
    }
    if (opts.staticDir && (req.method === "GET" || req.method === "HEAD") && !path.startsWith("/api/")) return serveStatic(opts.staticDir, path, res);
    send(res, 404, { ok: false, error: "not found" });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !access.originAllowed(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws, req: IncomingMessage) => {
    const role = access.role(req);
    clients.set(ws, role);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    ws.send(JSON.stringify(access.filter(hq.snapshot(), role)));
  });
  const unsubscribe = hq.subscribe((e: ServerEvent) => {
    const cache = new Map<Role, string | null>();
    for (const [ws, role] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (!cache.has(role)) {
        const f = access.filter(e, role);
        cache.set(role, f ? JSON.stringify(f) : null);
      }
      const data = cache.get(role);
      if (data) ws.send(data);
    }
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
      // stop new jobs and give running ones a moment to finish before the DB closes
      hq.setPaused(true);
      await hq.settle(3000);
      unsubscribe();
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      hq.dispose();
      db.close();
    },
  };
}
