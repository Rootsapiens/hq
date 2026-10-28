// WebSocket stream (with reconnect) + REST calls.
import { parseServerEvent, type ChatMessage, type PostMessageResponse } from "../../shared/events";
import { store } from "./store";

let socket: WebSocket | null = null;
let retry = 0;
let stopped = false;

export function connect(): () => void {
  stopped = false;
  open();
  return () => {
    stopped = true;
    socket?.close();
  };
}

function open(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    store.setConnected(true);
    void loadThread(store.get().selected);
  };
  ws.onmessage = (ev) => {
    const e = parseServerEvent(typeof ev.data === "string" ? ev.data : "");
    if (e) store.apply(e);
    else console.warn("[hq] dropped malformed event");
  };
  ws.onclose = () => {
    store.setConnected(false);
    if (stopped) return;
    const wait = Math.min(8000, 400 * 2 ** retry++);
    setTimeout(open, wait);
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

export async function setPaused(paused: boolean): Promise<void> {
  try {
    await fetch("/api/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused }) });
  } catch {
    /* ignore */
  }
}
