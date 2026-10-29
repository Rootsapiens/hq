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

async function boot(model: ModelClient = new MockModel({ chunkMs: 0, workMs: 0 }), dbPath?: string): Promise<Harness> {
  const app = await startApp({
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
    expect(snap.agents.map((a) => a.id)).toEqual(["cyrex", "rajaie", "aktham", "zurub", "razan", "nedal"]);
    expect(snap.agents.filter((a) => a.isBoss).map((a) => a.id)).toEqual(["cyrex"]);
    expect(new Set(snap.agents.map((a) => a.color)).size).toBe(6);
    expect(snap.agents.every((a) => a.status === "IDLE")).toBe(true);
  });

  it("Boss delegation via @name: meeting, work, done, report back; every frame matches the schema", async () => {
    const res = await post(h.base, "/api/agents/cyrex/message", { text: "@rajaie fix the build" });
    expect(res.status).toBe(202);
    await waitFor(() => statuses(h.events, "rajaie").includes("DONE"));
    await waitFor(() => statuses(h.events, "rajaie").at(-1) === "IDLE");
    await h.app.hq.idle();

    expect(statuses(h.events, "cyrex").slice(0, 2)).toEqual(["THINKING", "MEETING"]);
    expect(statuses(h.events, "cyrex")).toContain("DONE");
    expect(statuses(h.events, "rajaie")).toEqual(["MEETING", "THINKING", "WORKING", "THINKING", "DONE", "IDLE"]);
    // nobody else moved
    expect(statuses(h.events, "aktham")).toEqual([]);

    const types = new Set(h.events.map((e) => e.type));
    for (const t of ["agent", "chat.message", "chat.delta", "chat.done", "activity", "brain", "counters"]) expect(types.has(t as ServerEvent["type"])).toBe(true);
    const brain = h.events.filter((e) => e.type === "brain").map((e) => (e.type === "brain" ? e.calls : -1));
    expect(Math.max(...brain)).toBeGreaterThan(0);
    expect(brain.at(-1)).toBe(0);
    expect(h.events.some((e) => e.type === "activity" && e.entry.kind === "delegation" && e.entry.text.includes("Rajaie"))).toBe(true);

    // streamed text == persisted text
    const deltas = h.events.filter((e) => e.type === "chat.delta" && e.thread === "cyrex").map((e) => (e.type === "chat.delta" ? e.delta : ""));
    const cyrexThread = (await (await fetch(`${h.base}/api/agents/cyrex/messages`)).json()) as ChatMessage[];
    const bossReplies = cyrexThread.filter((m) => m.author === "cyrex").map((m) => m.content).join("");
    expect(deltas.join("")).toBe(bossReplies);
    expect(cyrexThread.some((m) => m.author === "rajaie" && m.content.startsWith("Report:"))).toBe(true);
    const rajaieThread = (await (await fetch(`${h.base}/api/agents/rajaie/messages`)).json()) as ChatMessage[];
    expect(rajaieThread[0]).toMatchObject({ author: "cyrex", content: "fix the build" });

    expect(h.rawProblems).toEqual([]);
  });

  it("two @mentions: one shared meeting, each agent gets only its own part", async () => {
    await post(h.base, "/api/agents/cyrex/message", { text: "@rajaie fix the login build and @aktham draw the new logo" });
    await waitFor(() => statuses(h.events, "rajaie").includes("DONE") && statuses(h.events, "aktham").includes("DONE"));
    const first = async (id: string) => ((await (await fetch(`${h.base}/api/agents/${id}/messages`)).json()) as ChatMessage[])[0];
    expect(await first("rajaie")).toMatchObject({ author: "cyrex", content: "fix the login build" });
    expect(await first("aktham")).toMatchObject({ author: "cyrex", content: "draw the new logo" });
    // one meeting for both: the Boss enters MEETING once
    expect(statuses(h.events, "cyrex").filter((s) => s === "MEETING").length).toBe(1);
    expect(h.rawProblems).toEqual([]);
  });

  it("failures retry with backoff, end in ERROR, and never crash the server", async () => {
    await post(h.base, "/api/agents/zurub/message", { text: "write the pitch #fail" });
    await waitFor(() => statuses(h.events, "zurub").includes("ERROR"));
    const retries = h.events.filter((e) => e.type === "activity" && e.entry.text.includes("retry"));
    expect(retries.length).toBe(2);
    const last = h.events.filter((e) => e.type === "agent" && e.agent.id === "zurub").at(-1);
    expect(last?.type === "agent" && last.agent.error).toContain("#fail");
    expect((await fetch(`${h.base}/api/health`)).status).toBe(200);
    // the agent recovers on the next message
    await post(h.base, "/api/agents/zurub/message", { text: "try again" });
    await waitFor(() => statuses(h.events, "zurub").at(-1) === "DONE");
    expect(h.rawProblems).toEqual([]);
  });

  it("a flaky first attempt resets the streamed message and succeeds", async () => {
    await post(h.base, "/api/agents/aktham/message", { text: "draw a logo #flaky" });
    await waitFor(() => statuses(h.events, "aktham").includes("DONE"));
    expect(h.events.some((e) => e.type === "chat.reset" && e.thread === "aktham")).toBe(true);
    expect(statuses(h.events, "aktham")).not.toContain("ERROR");
  });

  it("messages queued while busy each get their own job (no mixing, request ends on the user turn)", async () => {
    await post(h.base, "/api/pause", { paused: true });
    await post(h.base, "/api/agents/aktham/message", { text: "draw the logo" });
    await post(h.base, "/api/agents/aktham/message", { text: "write the jingle" });
    await post(h.base, "/api/pause", { paused: false });
    await waitFor(() => h.events.filter((e) => e.type === "counters").length >= 2);
    await h.app.hq.idle();
    const thread = (await (await fetch(`${h.base}/api/agents/aktham/messages`)).json()) as ChatMessage[];
    const replies = thread.filter((m) => m.author === "aktham" && m.content.includes("Picking up")).map((m) => m.content);
    expect(replies.length).toBe(2);
    expect(replies.some((r) => r.includes("draw the logo"))).toBe(true);
    expect(replies.some((r) => r.includes("write the jingle"))).toBe(true);
  });

  it("a failed delegated task is reported to the Boss in a way his history keeps", async () => {
    await post(h.base, "/api/agents/cyrex/message", { text: "@nedal animate the intro #fail" });
    await waitFor(() => statuses(h.events, "nedal").includes("ERROR"));
    await h.app.hq.idle();
    const thread = (await (await fetch(`${h.base}/api/agents/cyrex/messages`)).json()) as ChatMessage[];
    const failed = thread.find((m) => m.author === "nedal" && m.content.startsWith("Report: FAILED"));
    expect(failed?.state).toBe("done");
  });

  it("global pause queues work; resume runs it", async () => {
    expect((await post(h.base, "/api/pause", { paused: true })).status).toBe(200);
    const r = (await (await post(h.base, "/api/agents/nedal/message", { text: "walk cycle" })).json()) as { queued: number };
    expect(r.queued).toBe(1);
    await new Promise((x) => setTimeout(x, 100));
    expect(statuses(h.events, "nedal")).toEqual([]);
    expect(h.events.some((e) => e.type === "paused" && e.paused)).toBe(true);
    await post(h.base, "/api/pause", { paused: false });
    await waitFor(() => statuses(h.events, "nedal").includes("DONE"));
  });

  it("rejects bad requests with 4xx", async () => {
    expect((await post(h.base, "/api/agents/cyrex/message", { text: "" })).status).toBe(400);
    expect((await post(h.base, "/api/agents/nobody/message", { text: "hi" })).status).toBe(404);
    expect((await post(h.base, "/api/pause", { paused: "yes" })).status).toBe(400);
    const bad = await fetch(`${h.base}/api/agents/cyrex/message`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    const plain = await fetch(`${h.base}/api/agents/cyrex/message`, { method: "POST", body: JSON.stringify({ text: "hi" }) });
    expect(plain.status).toBe(415);
    const big = await post(h.base, "/api/agents/cyrex/message", { text: "x".repeat(70 * 1024) });
    expect(big.status).toBe(413);
    const foreign = await fetch(`${h.base}/api/agents/cyrex/message`, {
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
          const call = { id: "t1", name: "assign_task", input: { agent: "aktham", task: "x" } };
          return { text: "", toolCalls: [call], assistantContent: [{ type: "tool_use", ...call }] };
        }
        const call = { id: "t2", name: "report_result", input: { summary: "ok" } };
        return { text: "fine", toolCalls: [call], assistantContent: [{ type: "tool_use", ...call }] };
      },
    };
    h = await boot(model);
    expect(seen.length).toBe(0);
    await post(h.base, "/api/agents/rajaie/message", { text: "delegate this" });
    await waitFor(() => statuses(h.events, "rajaie").includes("DONE"));
    expect(seen[0]?.tools.map((t) => t.name)).toEqual(["update_status", "report_result"]);
    const lastMsg = seen[1]?.messages.at(-1);
    expect(JSON.stringify(lastMsg)).toContain("Only the Boss can assign tasks");
    expect(statuses(h.events, "aktham")).toEqual([]);
  });

  it("chat history survives a restart (SQLite)", async () => {
    const db = join(dir, "persist.sqlite");
    h = await boot(undefined, db);
    await post(h.base, "/api/agents/razan/message", { text: "audit the team" });
    await waitFor(() => statuses(h.events, "razan").includes("DONE"));
    await h.app.hq.idle();
    h.ws.close();
    await h.app.close();
    h = await boot(undefined, db);
    const thread = (await (await fetch(`${h.base}/api/agents/razan/messages`)).json()) as ChatMessage[];
    expect(thread[0]).toMatchObject({ author: "owner", content: "audit the team" });
    expect(thread.filter((m) => m.author === "razan").length).toBeGreaterThanOrEqual(2);
    const snap = h.events[0];
    expect(snap?.type === "snapshot" && snap.tasksDone).toBe(1);
  });
});
