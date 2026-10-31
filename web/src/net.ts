// WebSocket stream (with reconnect) + REST calls.
import { FileSchema, parseServerEvent, type ChatMessage, type HqFile, type PostMessageResponse } from "../../shared/events";
import { store } from "./store";

/**
 * Opens the event stream and keeps it open. Returns a stop function.
 * Each call owns its own socket and timer, so a stopped connection can never
 * reconnect behind a newer one (React StrictMode mounts effects twice).
 */
export function connect(): () => void {
  let stopped = false;
  let retry = 0;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    socket = ws;
    ws.onopen = () => {
      if (stopped) return ws.close();
      retry = 0;
      store.setConnected(true);
      void loadAccess().then(() => {
        if (store.get().access.canRead) void loadThread(store.get().selected);
      });
    };
    ws.onmessage = (ev) => {
      if (stopped || socket !== ws) return;
      const e = parseServerEvent(typeof ev.data === "string" ? ev.data : "");
      if (e) store.apply(e);
      else console.warn("[hq] dropped malformed event");
    };
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      store.setConnected(false);
      timer = setTimeout(open, Math.min(8000, 400 * 2 ** retry++));
    };
  };
  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
    socket = null;
  };
}

export async function loadThread(id: string): Promise<void> {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}/messages`);
    if (!res.ok) return;
    store.setThread(id, (await res.json()) as ChatMessage[]);
  } catch {
    /* offline: the stream will refill */
  }
}

export async function sendMessage(id: string, text: string): Promise<PostMessageResponse | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return (await res.json()) as PostMessageResponse | { ok: false; error: string };
  } catch {
    return { ok: false, error: "server unreachable" };
  }
}

export async function loadAccess(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const me = (await res.json()) as { public: boolean; canRead: boolean; canAct: boolean };
    store.setAccess({ public: !!me.public, canRead: !!me.canRead, canAct: !!me.canAct });
  } catch {
    /* offline */
  }
}

/** Owner login (public HQ). On success the page reloads so the stream reconnects as the owner. */
export async function login(token: string): Promise<string | null> {
  try {
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (res.ok) {
      location.reload();
      return null;
    }
    const body = (await res.json()) as { error?: string };
    return body.error ?? "login failed";
  } catch {
    return "server unreachable";
  }
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  location.reload();
}

export async function loadFile(id: string): Promise<HqFile | null> {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const parsed = FileSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const fileDownloadUrl = (id: string) => `/api/files/${encodeURIComponent(id)}/download`;

export async function setPaused(paused: boolean): Promise<void> {
  try {
    await fetch("/api/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused }) });
  } catch {
    /* ignore */
  }
}
