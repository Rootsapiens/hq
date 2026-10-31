// Who may do what when HQ is reachable from the internet.
// Local mode (no HQ_OWNER_TOKEN): only pages from this machine may connect, and they are the owner.
// Public mode (HQ_OWNER_TOKEN set): anyone may watch; only a browser that logged in with the token
// (HttpOnly cookie) may send messages, pause, or read chats and files, unless HQ_PUBLIC_DETAIL=full.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ServerEvent } from "../../shared/events";

export type Role = "owner" | "viewer";
/** "office": viewers see the office and statuses only. "full": viewers also read chats, activity and files. */
export type PublicDetail = "office" | "full";

export const COOKIE = "hq_owner";

export interface AccessOptions {
  ownerToken?: string;
  publicDetail?: PublicDetail;
}

export class Access {
  readonly isPublic: boolean;
  readonly detail: PublicDetail;
  private readonly cookieValue: string | null;

  constructor(opts: AccessOptions) {
    const token = (opts.ownerToken ?? "").trim();
    if (token && token.length < 16) throw new Error("HQ_OWNER_TOKEN must be at least 16 characters");
    this.isPublic = token.length > 0;
    this.detail = opts.publicDetail ?? "office";
    // the cookie carries a derived value, never the token itself
    this.cookieValue = token ? createHmac("sha256", token).update("hq-owner-session-v1").digest("hex") : null;
  }

  checkToken(candidate: string): boolean {
    if (!this.cookieValue) return false;
    const a = Buffer.from(createHmac("sha256", candidate).update("hq-owner-session-v1").digest("hex"));
    const b = Buffer.from(this.cookieValue);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  sessionCookie(secure: boolean, clear = false): string {
    const parts = [`${COOKIE}=${clear ? "" : this.cookieValue}`, "Path=/", "HttpOnly", "SameSite=Strict", clear ? "Max-Age=0" : "Max-Age=2592000"];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  /** May this request connect at all? Local mode: only local pages. Public mode: any page of this same site. */
  originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // curl, same-origin GET
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const hostname = host.replace(/:\d+$/, "");
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
    return this.isPublic && host === (req.headers.host ?? "");
  }

  role(req: IncomingMessage): Role {
    if (!this.isPublic) return "owner";
    const raw = req.headers.cookie ?? "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE && this.cookieValue) {
        const a = Buffer.from(v.join("="));
        const b = Buffer.from(this.cookieValue);
        if (a.length === b.length && timingSafeEqual(a, b)) return "owner";
      }
    }
    return "viewer";
  }

  /** May this role read chats, activity and files? */
  canRead(role: Role): boolean {
    return role === "owner" || this.detail === "full";
  }

  /** The event as this role may see it, or null to drop it. */
  filter(e: ServerEvent, role: Role): ServerEvent | null {
    if (this.canRead(role)) return e;
    switch (e.type) {
      case "snapshot":
        return { ...e, agents: e.agents.map(redactAgent), activity: [], files: [] };
      case "agent":
        return { ...e, agent: redactAgent(e.agent) };
      case "chat.message":
      case "chat.delta":
      case "chat.reset":
      case "chat.done":
      case "activity":
      case "file":
        return null;
      default:
        return e;
    }
  }
}

function redactAgent<T extends { task: string | null; error: string | null }>(a: T): T {
  return { ...a, task: null, error: a.error ? "error" : null };
}
