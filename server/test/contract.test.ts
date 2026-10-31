// WS event contract + end-to-end server behaviour in MOCK mode (no network, no API key).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerEventSchema, type ChatMessage, type ServerEvent } from "../../shared/events";
import { startApp, type App } from "../src/app";
import { MockModel } from "../src/mock";
import type { ModelClient, TurnInput, TurnResult } from "../src/model";

// test databases stay inside the repo (server/data is git-ignored)
const dataDir = join(import.meta.dirname, "..", "data");
mkdirSync(dataDir, { recursive: true });
const dir = mkdtempSync(join(dataDir, "test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;

interface Harness {
  app: App;
  base: string;
  events: ServerEvent[];
  ws: WebSocket;
  rawProblems: string[];
}

async function boot(model: ModelClient = new MockModel({ chunkMs: 0, workMs: 0 }), dbPath?: string, extra: Partial<Parameters<typeof startApp>[0]> = {}): Promise<Harness> {
  const app = await startApp({
    ...extra,
    model,
    dbPath: dbPath ?? join(dir, `t${++n}.sqlite`),
    port: 0,
    meetingMs: 30,
    doneHoldMs: 150,
    retries: 2,
    retryBaseMs: 5,
  });
  const base = `http://127.0.0.1:${app.port}`;
  const events: ServerEvent[] = [];
  const rawProblems: string[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  ws.on("message", (data) => {
    const raw = JSON.parse(String(data)) as unknown;
    const parsed = ServerEventSchema.safeParse(raw);
    if (!parsed.success) rawProblems.push(JSON.stringify(raw).slice(0, 200));
    // exact contract: parsing must not drop or change any field
    else if (!isDeepStrictEqual(parsed.data, raw)) rawProblems.push(`extra fields: ${JSON.stringify(raw).slice(0, 200)}`);
    if (parsed.success) events.push(parsed.data);
  });
  await new Promise<void>((r) => ws.once("open", () => r()));
  await waitFor(() => events.some((e) => e.type === "snapshot"));
  return { app, base, events, ws, rawProblems };
}

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function statuses(events: ServerEvent[], id: string): string[] {
  // status transitions only (queue-length updates re-send the same status)
  const out: string[] = [];
  let prev = "IDLE";
  for (const e of events)
    if (e.type === "agent" && e.agent.id === id && e.agent.status !== prev) {
      prev = e.agent.status;
      out.push(prev);
    }
  return out;
}

let h: Harness;
afterEach(async () => {
  h.ws.close();
  await h.app.close();
});

describe("WS contract", () => {
  beforeEach(async () => {
    h = await boot();
  });

  it("first frame is a snapshot of the 6 agents in mock mode", () => {
    const snap = h.events[0];
    expect(snap?.type).toBe("snapshot");
    if (snap?.type !== "snapshot") return;
    expect(snap.mode).toBe("mock");
    expect(snap.agents.map((a) => a.id)).toEqual(["kahn", "sektor", "sindel", "nightwolf", "sonya", "liukang"]);
    expect(snap.agents.filter((a) => a.isBoss).map((a) => a.id)).toEqual(["kahn"]);
    expect(new Set(snap.agents.map((a) => a.color)).size).toBe(6);
    expect(snap.agents.every((a) => a.status === "IDLE")).toBe(true);
  });

  it("Boss delegation via @name: meeting, work, done, report back; every frame matches the schema", async () => {
    const res = await post(h.base, "/api/agents/kahn/message", { text: "@sektor fix the build" });
    expect(res.status).toBe(202);
    await waitFor(() => statuses(h.events, "sektor").includes("DONE"));
    await waitFor(() => statuses(h.events, "sektor").at(-1) === "IDLE");
    await h.app.hq.idle();

    expect(statuses(h.events, "kahn").slice(0, 2)).toEqual(["THINKING", "MEETING"]);
    expect(statuses(h.events, "kahn")).toContain("DONE");
    expect(statuses(h.events, "sektor")).toEqual(["MEETING", "THINKING", "WORKING", "THINKING", "DONE", "IDLE"]);
    // nobody else moved
    expect(statuses(h.events, "sindel")).toEqual([]);

    const types = new Set(h.events.map((e) => e.type));
    for (const t of ["agent", "chat.message", "chat.delta", "chat.done", "activity", "brain", "counters"]) expect(types.has(t as ServerEvent["type"])).toBe(true);
    const brain = h.events.filter((e) => e.type === "brain").map((e) => (e.type === "brain" ? e.calls : -1));
    expect(Math.max(...brain)).toBeGreaterThan(0);
    expect(brain.at(-1)).toBe(0);
    expect(h.events.some((e) => e.type === "activity" && e.entry.kind === "delegation" && e.entry.text.includes("Sektor"))).toBe(true);

    // streamed text == persisted text
    const deltas = h.events.filter((e) => e.type === "chat.delta" && e.thread === "kahn").map((e) => (e.type === "chat.delta" ? e.delta : ""));
    const cyrexThread = (await (await fetch(`${h.base}/api/agents/kahn/messages`)).json()) as ChatMessage[];
    const bossReplies = cyrexThread.filter((m) => m.author === "kahn").map((m) => m.content).join("");
    expect(deltas.join("")).toBe(bossReplies);
    expect(cyrexThread.some((m) => m.author === "sektor" && m.content.startsWith("Report:"))).toBe(true);
    const rajaieThread = (await (await fetch(`${h.base}/api/agents/sektor/messages`)).json()) as ChatMessage[];
    expect(rajaieThread[0]).toMatchObject({ author: "kahn", content: "fix the build" });

    expect(h.rawProblems).toEqual([]);
  });

  it("two @mentions: one shared meeting, each agent gets only its own part", async () => {
    await post(h.base, "/api/agents/kahn/message", { text: "@sektor fix the login build and @sindel draw the new logo" });
    await waitFor(() => statuses(h.events, "sektor").includes("DONE") && statuses(h.events, "sindel").includes("DONE"));
    const first = async (id: string) => ((await (await fetch(`${h.base}/api/agents/${id}/messages`)).json()) as ChatMessage[])[0];
    expect(await first("sektor")).toMatchObject({ author: "kahn", content: "fix the login build" });
    expect(await first("sindel")).toMatchObject({ author: "kahn", content: "draw the new logo" });
    // one meeting for both: the Boss enters MEETING once
    expect(statuses(h.events, "kahn").filter((s) => s === "MEETING").length).toBe(1);
    expect(h.rawProblems).toEqual([]);
  });

  it("failures retry with backoff, end in ERROR, and never crash the server", async () => {
    await post(h.base, "/api/agents/nightwolf/message", { text: "write the pitch #fail" });
    await waitFor(() => statuses(h.events, "nightwolf").includes("ERROR"));
    const retries = h.events.filter((e) => e.type === "activity" && e.entry.text.includes("retry"));
    expect(retries.length).toBe(2);
    const last = h.events.filter((e) => e.type === "agent" && e.agent.id === "nightwolf").at(-1);
    expect(last?.type === "agent" && last.agent.error).toContain("#fail");
    expect((await fetch(`${h.base}/api/health`)).status).toBe(200);
    // the agent recovers on the next message
    await post(h.base, "/api/agents/nightwolf/message", { text: "try again" });
    await waitFor(() => statuses(h.events, "nightwolf").at(-1) === "DONE");
    expect(h.rawProblems).toEqual([]);
  });

  it("a flaky first attempt resets the streamed message and succeeds", async () => {
    await post(h.base, "/api/agents/sindel/message", { text: "draw a logo #flaky" });
    await waitFor(() => statuses(h.events, "sindel").includes("DONE"));
    expect(h.events.some((e) => e.type === "chat.reset" && e.thread === "sindel")).toBe(true);
    expect(statuses(h.events, "sindel")).not.toContain("ERROR");
  });

  it("messages queued while busy each get their own job (no mixing, request ends on the user turn)", async () => {
    await post(h.base, "/api/pause", { paused: true });
    await post(h.base, "/api/agents/sindel/message", { text: "draw the logo" });
    await post(h.base, "/api/agents/sindel/message", { text: "write the jingle" });
    await post(h.base, "/api/pause", { paused: false });
    await waitFor(() => h.events.filter((e) => e.type === "counters").length >= 2);
    await h.app.hq.idle();
    const thread = (await (await fetch(`${h.base}/api/agents/sindel/messages`)).json()) as ChatMessage[];
    const replies = thread.filter((m) => m.author === "sindel" && m.content.includes("Picking up")).map((m) => m.content);
    expect(replies.length).toBe(2);
    expect(replies.some((r) => r.includes("draw the logo"))).toBe(true);
    expect(replies.some((r) => r.includes("write the jingle"))).toBe(true);
  });

  it("a failed delegated task is reported to the Boss in a way his history keeps", async () => {
    await post(h.base, "/api/agents/kahn/message", { text: "@liukang animate the intro #fail" });
    await waitFor(() => statuses(h.events, "liukang").includes("ERROR"));
    await h.app.hq.idle();
    const thread = (await (await fetch(`${h.base}/api/agents/kahn/messages`)).json()) as ChatMessage[];
    const failed = thread.find((m) => m.author === "liukang" && m.content.startsWith("Report: FAILED"));
    expect(failed?.state).toBe("done");
  });

  it("global pause queues work; resume runs it", async () => {
    expect((await post(h.base, "/api/pause", { paused: true })).status).toBe(200);
    const r = (await (await post(h.base, "/api/agents/liukang/message", { text: "walk cycle" })).json()) as { queued: number };
    expect(r.queued).toBe(1);
    await new Promise((x) => setTimeout(x, 100));
    expect(statuses(h.events, "liukang")).toEqual([]);
    expect(h.events.some((e) => e.type === "paused" && e.paused)).toBe(true);
    await post(h.base, "/api/pause", { paused: false });
    await waitFor(() => statuses(h.events, "liukang").includes("DONE"));
  });

  it("rejects bad requests with 4xx", async () => {
    expect((await post(h.base, "/api/agents/kahn/message", { text: "" })).status).toBe(400);
    expect((await post(h.base, "/api/agents/nobody/message", { text: "hi" })).status).toBe(404);
    expect((await post(h.base, "/api/pause", { paused: "yes" })).status).toBe(400);
    const bad = await fetch(`${h.base}/api/agents/kahn/message`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    const plain = await fetch(`${h.base}/api/agents/kahn/message`, { method: "POST", body: JSON.stringify({ text: "hi" }) });
    expect(plain.status).toBe(415);
    const big = await post(h.base, "/api/agents/kahn/message", { text: "x".repeat(70 * 1024) });
    expect(big.status).toBe(413);
    const foreign = await fetch(`${h.base}/api/agents/kahn/message`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ text: "spend tokens" }),
    });
    expect(foreign.status).toBe(403);
    const local = await fetch(`${h.base}/api/health`, { headers: { origin: "http://localhost:5173" } });
    expect(local.status).toBe(200);
    // a foreign page cannot open the event stream either
    const wsForeign = new WebSocket(`ws://127.0.0.1:${h.app.port}/ws`, { origin: "https://evil.example" });
    const outcome = await new Promise<string>((r) => {
      wsForeign.once("open", () => r("open"));
      wsForeign.once("error", () => r("refused"));
    });
    expect(outcome).toBe("refused");
  });
});

describe("tools and persistence", () => {
  it("assign_task is Boss only: a worker's call returns a tool error", async () => {
    const seen: TurnInput[] = [];
    const model: ModelClient = {
      mode: "mock",
      model: "probe",
      async turn(input: TurnInput): Promise<TurnResult> {
        seen.push(structuredClone(input));
        if (seen.length === 1) {
          const call = { id: "t1", name: "assign_task", input: { agent: "sindel", task: "x" } };
          return { text: "", toolCalls: [call], assistantContent: [{ type: "tool_use", ...call }] };
        }
        const call = { id: "t2", name: "report_result", input: { summary: "ok" } };
        return { text: "fine", toolCalls: [call], assistantContent: [{ type: "tool_use", ...call }] };
      },
    };
    h = await boot(model);
    expect(seen.length).toBe(0);
    await post(h.base, "/api/agents/sektor/message", { text: "delegate this" });
    await waitFor(() => statuses(h.events, "sektor").includes("DONE"));
    expect(seen[0]?.tools.map((t) => t.name)).toEqual(["update_status", "save_file", "read_file", "list_files", "report_result"]);
    const lastMsg = seen[1]?.messages.at(-1);
    expect(JSON.stringify(lastMsg)).toContain("Only the Boss can assign tasks");
    expect(statuses(h.events, "sindel")).toEqual([]);
  });

  it("chat history survives a restart (SQLite)", async () => {
    const db = join(dir, "persist.sqlite");
    h = await boot(undefined, db);
    await post(h.base, "/api/agents/sonya/message", { text: "audit the team" });
    await waitFor(() => statuses(h.events, "sonya").includes("DONE"));
    await h.app.hq.idle();
    h.ws.close();
    await h.app.close();
    h = await boot(undefined, db);
    const thread = (await (await fetch(`${h.base}/api/agents/sonya/messages`)).json()) as ChatMessage[];
    expect(thread[0]).toMatchObject({ author: "owner", content: "audit the team" });
    expect(thread.filter((m) => m.author === "sonya").length).toBeGreaterThanOrEqual(2);
    const snap = h.events[0];
    expect(snap?.type === "snapshot" && snap.tasksDone).toBe(1);
  });

  it("save_file stores versioned deliverables; read_file/list_files see them; the report to the Boss names them", async () => {
    const seen: TurnInput[] = [];
    let step = 0;
    const call = (id: string, name: string, input: unknown): TurnResult => ({
      text: "",
      toolCalls: [{ id, name, input }],
      assistantContent: [{ type: "tool_use", id, name, input }],
    });
    const model: ModelClient = {
      mode: "mock",
      model: "probe",
      async turn(input: TurnInput): Promise<TurnResult> {
        seen.push(structuredClone(input));
        if (input.agent.isBoss) {
          if (input.messages.at(-1)?.role === "user" && typeof input.messages.at(-1)?.content === "string" && step === 0) {
            step = 1;
            return call("b1", "assign_task", { agent: "nightwolf", task: "write the pitch" });
          }
          return call(`b${seen.length}`, "report_result", { summary: "delegated" });
        }
        const n = seen.filter((s) => !s.agent.isBoss).length;
        if (n === 1) return call("z1", "save_file", { name: "pitch.md", content: "# Pitch v1", title: "Pitch" });
        if (n === 2) return call("z2", "save_file", { name: "pitch.md", content: "# Pitch v2" });
        if (n === 3) return call("z3", "save_file", { name: "../etc/passwd", content: "x" });
        if (n === 4) return call("z4", "read_file", { name: "pitch.md" });
        if (n === 5) return call("z5", "list_files", {});
        return call("z6", "report_result", { summary: "pitch drafted" });
      },
    };
    h = await boot(model);
    await post(h.base, "/api/agents/kahn/message", { text: "get a pitch written" });
    await waitFor(() => statuses(h.events, "nightwolf").includes("DONE"));
    await h.app.hq.idle();

    const toolResult = (i: number) => JSON.stringify(seen.filter((s) => !s.agent.isBoss)[i]?.messages.at(-1));
    expect(toolResult(1)).toContain("Saved pitch.md v1");
    expect(toolResult(2)).toContain("Saved pitch.md v2");
    expect(toolResult(3)).toContain("Bad file name");
    expect(toolResult(4)).toContain("# Pitch v2");
    expect(toolResult(5)).toContain("pitch.md v2 by Nightwolf");

    const fileEvents = h.events.filter((e) => e.type === "file");
    expect(fileEvents.map((e) => (e.type === "file" ? e.file.version : 0))).toEqual([1, 2]);
    const list = (await (await fetch(`${h.base}/api/files`)).json()) as { id: string; name: string; version: number; agentId: string }[];
    expect(list.map((f) => [f.name, f.version, f.agentId])).toEqual([["pitch.md", 2, "nightwolf"], ["pitch.md", 1, "nightwolf"]]);
    const v1 = (await (await fetch(`${h.base}/api/files/${list[1]?.id}`)).json()) as { content: string; title: string };
    expect(v1).toMatchObject({ content: "# Pitch v1", title: "Pitch" });
    const dl = await fetch(`${h.base}/api/files/${list[0]?.id}/download`);
    expect(dl.headers.get("content-type")).toContain("text/plain");
    expect(dl.headers.get("content-disposition")).toBe('attachment; filename="pitch.md"');
    expect(await dl.text()).toBe("# Pitch v2");
    expect((await fetch(`${h.base}/api/files/nope`)).status).toBe(404);

    const boss = (await (await fetch(`${h.base}/api/agents/kahn/messages`)).json()) as ChatMessage[];
    expect(boss.find((m) => m.author === "nightwolf")?.content).toBe("Report: pitch drafted\nFiles: pitch.md (v1), pitch.md (v2)");
    expect(h.events.some((e) => e.type === "activity" && e.entry.kind === "file")).toBe(true);
    expect(h.rawProblems).toEqual([]);
  });

  it("MOCK workers deliver a file with their report", async () => {
    h = await boot();
    await post(h.base, "/api/agents/kahn/message", { text: "@nightwolf draft the trailer script" });
    await waitFor(() => statuses(h.events, "nightwolf").includes("DONE"));
    await h.app.hq.idle();
    const list = (await (await fetch(`${h.base}/api/files`)).json()) as { name: string; agentId: string }[];
    expect(list).toEqual([expect.objectContaining({ name: "nightwolf-draft-the-trailer-script.md", agentId: "nightwolf" })]);
    const snap = (await (await fetch(`${h.base}/api/state`)).json()) as { files: unknown[] };
    expect(snap.files).toHaveLength(1);
  });
});

describe("public mode (HQ_OWNER_TOKEN)", () => {
  const TOKEN = "correct-horse-battery-staple";
  const login = async (base: string, token: string) =>
    fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });

  it("viewers watch the office without chats, tasks or files, and cannot act", async () => {
    h = await boot(undefined, undefined, { ownerToken: TOKEN });
    const snap = h.events[0];
    expect(snap?.type === "snapshot" && snap.activity).toEqual([]);
    expect((await (await fetch(`${h.base}/api/me`)).json())).toEqual({ role: "viewer", public: true, canRead: false, canAct: false });
    expect((await post(h.base, "/api/agents/kahn/message", { text: "hi" })).status).toBe(401);
    expect((await post(h.base, "/api/pause", { paused: true })).status).toBe(401);
    expect((await fetch(`${h.base}/api/agents/kahn/messages`)).status).toBe(401);
    expect((await fetch(`${h.base}/api/files`)).status).toBe(401);
    // a cross-site page is still refused
    expect((await fetch(`${h.base}/api/state`, { headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("the owner logs in with the token (cookie) and acts; the viewer stream stays redacted", async () => {
    h = await boot(undefined, undefined, { ownerToken: TOKEN });
    expect((await login(h.base, "wrong-password-xxxxxx")).status).toBe(401);
    const ok = await login(h.base, TOKEN);
    expect(ok.status).toBe(200);
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).toMatch(/^hq_owner=[0-9a-f]{64}$/);
    expect(cookie).not.toContain(TOKEN);
    expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
    const me = (await (await fetch(`${h.base}/api/me`, { headers: { cookie } })).json()) as { role: string };
    expect(me.role).toBe("owner");
    const res = await fetch(`${h.base}/api/agents/kahn/message`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "@nightwolf research the market" }),
    });
    expect(res.status).toBe(202);
    await waitFor(() => statuses(h.events, "nightwolf").includes("DONE"));
    await h.app.hq.idle();
    // h.ws is a viewer: it saw the office move, but no chat, activity, file or task text
    expect(h.events.some((e) => e.type.startsWith("chat.") || e.type === "activity" || e.type === "file")).toBe(false);
    expect(h.events.every((e) => e.type !== "agent" || e.agent.task === null)).toBe(true);
    expect((await fetch(`${h.base}/api/files`, { headers: { cookie } })).status).toBe(200);
  });

  it("HQ_PUBLIC_DETAIL=full lets viewers read but still not act", async () => {
    h = await boot(undefined, undefined, { ownerToken: TOKEN, publicDetail: "full" });
    expect((await fetch(`${h.base}/api/files`)).status).toBe(200);
    expect((await post(h.base, "/api/agents/kahn/message", { text: "hi" })).status).toBe(401);
  });

  it("rejects short owner tokens", async () => {
    await expect(startApp({ model: new MockModel(), dbPath: ":memory:", port: 0, ownerToken: "short" })).rejects.toThrow(/16 characters/);
    h = await boot();
  });
});
