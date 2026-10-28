// The HQ orchestrator: per-agent queues, the tool loop, retries, status and events.
// Every failure ends in the ERROR status for that agent; nothing here is allowed to throw out.
import { randomUUID } from "node:crypto";
import { AGENTS, BOSS_ID, type AgentConfig } from "../agents.config";
import type { ActivityEntry, AgentStatus, AgentView, ChatMessage, ServerEvent } from "../../shared/events";
import type { HqDb } from "./db";
import { errorMessage, isRetryable, type MessageParam, type ModelClient, type ToolCall, type TurnResult } from "./model";
import { AgentStateMachine, DONE_HOLD_MS } from "./state";
import { AssignTaskInput, ReportResultInput, UpdateStatusInput, toolsFor } from "./tools";

export interface HqOptions {
  db: HqDb;
  model: ModelClient;
  meetingMs?: number;
  doneHoldMs?: number;
  retries?: number;
  retryBaseMs?: number;
  maxToolRounds?: number;
  historyLimit?: number;
}

interface Job {
  id: string;
  kind: "owner" | "task";
  from: string; // "owner" or the delegating agent id
  text: string;
}

interface Runtime {
  config: AgentConfig;
  sm: AgentStateMachine;
  queue: Job[];
  busy: boolean;
  needsInput: boolean;
}

type Listener = (e: ServerEvent) => void;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

export class Hq {
  private readonly rts = new Map<string, Runtime>();
  private readonly listeners = new Set<Listener>();
  private paused = false;
  private brainCalls = 0;
  private readonly db: HqDb;
  private readonly model: ModelClient;
  private readonly meetingMs: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly maxToolRounds: number;
  private readonly historyLimit: number;

  constructor(opts: HqOptions) {
    this.db = opts.db;
    this.model = opts.model;
    this.meetingMs = opts.meetingMs ?? 3000;
    this.retries = opts.retries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 800;
    this.maxToolRounds = opts.maxToolRounds ?? 6;
    this.historyLimit = opts.historyLimit ?? 30;
    for (const config of AGENTS) {
      const rt: Runtime = {
        config,
        queue: [],
        busy: false,
        needsInput: false,
        sm: new AgentStateMachine((c) => {
          this.emitAgent(rt);
          if (c.to === "ERROR") this.activity(config.id, "error", `${config.name}: ${rt.sm.error ?? "error"}`);
        }, opts.doneHoldMs ?? DONE_HOLD_MS),
      };
      this.rts.set(config.id, rt);
    }
  }

  // ---------- public API ----------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Extract<ServerEvent, { type: "snapshot" }> {
    return {
      type: "snapshot",
      agents: [...this.rts.values()].map((rt) => this.view(rt)),
      paused: this.paused,
      mode: this.model.mode,
      model: this.model.model,
      brainCalls: this.brainCalls,
      tasksDone: this.db.counter("tasksDone"),
      activity: this.db.activity(100),
    };
  }

  agentViews(): AgentView[] {
    return [...this.rts.values()].map((rt) => this.view(rt));
  }

  hasAgent(id: string): boolean {
    return this.rts.has(id);
  }

  messages(thread: string): ChatMessage[] {
    return this.db.messages(thread);
  }

  /** Owner writes into an agent's chat. Returns the stored message id and queue length. */
  postOwnerMessage(agentId: string, text: string): { messageId: string; queued: number } {
    const rt = this.rts.get(agentId);
    if (!rt) throw new Error(`unknown agent ${agentId}`);
    const msg = this.saveMessage({ thread: agentId, author: "owner", content: text, state: "done" });
    this.activity(agentId, "message", `Owner -> ${rt.config.name}: ${clip(text)}`);
    rt.needsInput = false;
    this.enqueue(rt, { id: msg.id, kind: "owner", from: "owner", text });
    return { messageId: msg.id, queued: rt.queue.length };
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.emit({ type: "paused", paused });
    this.activity(null, "system", paused ? "Global pause: no new jobs start." : "Resumed.");
    if (!paused) for (const rt of this.rts.values()) this.pump(rt);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Resolves when every queue is empty and no job is running (used by tests and shutdown). */
  async idle(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while ([...this.rts.values()].some((rt) => rt.busy || rt.queue.length > 0)) {
      if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for idle");
      await sleep(20);
    }
  }

  dispose(): void {
    for (const rt of this.rts.values()) rt.sm.dispose();
    this.listeners.clear();
  }

  // ---------- internals ----------

  private emit(e: ServerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error("[hq] listener failed:", errorMessage(err));
      }
    }
  }

  private view(rt: Runtime): AgentView {
    const c = rt.config;
    return {
      id: c.id,
      name: c.name,
      title: c.title,
      room: c.room,
      color: c.color,
      isBoss: c.isBoss,
      status: rt.sm.status,
      task: rt.sm.task,
      needsInput: rt.needsInput,
      queue: rt.queue.length,
      error: rt.sm.error,
    };
  }

  private emitAgent(rt: Runtime): void {
    this.emit({ type: "agent", agent: this.view(rt) });
  }

  private activity(agentId: string | null, kind: ActivityEntry["kind"], text: string): void {
    const entry = this.db.addActivity(agentId, kind, text);
    this.emit({ type: "activity", entry });
  }

  private saveMessage(m: Omit<ChatMessage, "id" | "ts">, emit = true): ChatMessage {
    const msg: ChatMessage = { id: randomUUID(), ts: Date.now(), ...m };
    this.db.saveMessage(msg);
    if (emit) this.emit({ type: "chat.message", message: msg });
    return msg;
  }

  private setStatus(rt: Runtime, to: AgentStatus, task?: string | null, error?: string): void {
    rt.sm.set(to, { task, error });
  }

  private enqueue(rt: Runtime, job: Job): void {
    rt.queue.push(job);
    this.emitAgent(rt);
    this.pump(rt);
  }

  private pump(rt: Runtime): void {
    if (this.paused || rt.busy) return;
    const job = rt.queue.shift();
    if (!job) return;
    rt.busy = true;
    void this.runJob(rt, job)
      .catch((err) => console.error("[hq] job crashed (contained):", errorMessage(err)))
      .finally(() => {
        rt.busy = false;
        this.emitAgent(rt);
        this.pump(rt);
      });
  }

  private history(rt: Runtime): MessageParam[] {
    const out: MessageParam[] = [];
    for (const m of this.db.messages(rt.config.id, this.historyLimit)) {
      if (m.state === "error" || !m.content.trim() || m.author === "system") continue;
      const role = m.author === rt.config.id ? "assistant" : "user";
      let text = m.content;
      if (role === "user" && m.author !== "owner") {
        const name = this.rts.get(m.author)?.config.name ?? m.author;
        text = `[from ${name}] ${text}`;
      }
      const prev = out[out.length - 1];
      if (prev && prev.role === role && typeof prev.content === "string") prev.content += `\n\n${text}`;
      else out.push({ role, content: text });
    }
    while (out.length && out[0]?.role !== "user") out.shift();
    return out;
  }

  /** One streamed model call with retry + backoff. Streams into a chat message created on first text. */
  private async callModel(rt: Runtime, messages: MessageParam[]): Promise<{ result: TurnResult; message: ChatMessage | null }> {
    const thread = rt.config.id;
    let message: ChatMessage | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const wait = this.retryBaseMs * 2 ** (attempt - 1);
        this.activity(thread, "system", `${rt.config.name}: retry ${attempt}/${this.retries} in ${wait} ms (${clip(errorMessage(lastErr), 60)})`);
        if (message) {
          message.content = "";
          this.emit({ type: "chat.reset", thread, messageId: message.id, attempt });
        }
        await sleep(wait);
      }
      this.brainCalls++;
      this.emit({ type: "brain", calls: this.brainCalls });
      try {
        const result = await this.model.turn(
          { agent: rt.config, system: rt.config.systemPrompt, messages, tools: toolsFor(rt.config) },
          (delta) => {
            if (!message) message = this.saveMessage({ thread, author: thread, content: "", state: "streaming" });
            message.content += delta;
            this.emit({ type: "chat.delta", thread, messageId: message.id, delta });
          },
        );
        if (message) {
          const done: ChatMessage = { ...(message as ChatMessage), content: result.text || (message as ChatMessage).content, state: "done" };
          this.db.saveMessage(done);
          this.emit({ type: "chat.done", message: done });
          message = done;
        }
        return { result, message };
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) break;
      } finally {
        this.brainCalls--;
        this.emit({ type: "brain", calls: this.brainCalls });
      }
    }
    if (message) {
      const failed: ChatMessage = { ...(message as ChatMessage), state: "error" };
      this.db.saveMessage(failed);
      this.emit({ type: "chat.done", message: failed });
    }
    throw lastErr ?? new Error("model call failed");
  }

  private async runJob(rt: Runtime, job: Job): Promise<void> {
    const name = rt.config.name;
    let report: string | null = null;
    let lastText = "";
    try {
      this.setStatus(rt, "THINKING", clip(job.text.replace(/^\[from [^\]]+\]\s*/i, ""), 60));
      const messages = this.history(rt);
      if (messages.length === 0) messages.push({ role: "user", content: job.text });
      for (let round = 0; round < this.maxToolRounds; round++) {
        this.setStatus(rt, "THINKING");
        const { result } = await this.callModel(rt, messages);
        if (result.text.trim()) lastText = result.text.trim();
        if (result.toolCalls.length === 0) break;
        messages.push({ role: "assistant", content: result.assistantContent });
        const toolResults: MessageParam = { role: "user", content: [] };
        for (const call of result.toolCalls) {
          const { content, isError, reported } = await this.runTool(rt, call);
          if (reported !== undefined) report = reported;
          if (Array.isArray(toolResults.content)) {
            toolResults.content.push({ type: "tool_result", tool_use_id: call.id, content, is_error: isError });
          }
        }
        messages.push(toolResults);
        if (report !== null) break;
      }
      this.setStatus(rt, "DONE");
      const tasksDone = this.db.increment("tasksDone");
      this.emit({ type: "counters", tasksDone });
      const summary = report ?? clip(lastText || "finished", 200);
      this.activity(rt.config.id, "report", `${name} done: ${clip(summary, 120)}`);
      if (job.kind === "task" && job.from !== rt.config.id && this.rts.has(job.from)) {
        this.saveMessage({ thread: job.from, author: rt.config.id, content: `Report: ${summary}`, state: "done" });
      }
    } catch (err) {
      const msg = errorMessage(err);
      this.setStatus(rt, "ERROR", undefined, msg);
      this.saveMessage({ thread: rt.config.id, author: "system", content: `Error: ${msg}`, state: "error" });
      if (job.kind === "task" && this.rts.has(job.from)) {
        this.saveMessage({ thread: job.from, author: rt.config.id, content: `Report: FAILED (${msg})`, state: "error" });
      }
    }
  }

  private async runTool(rt: Runtime, call: ToolCall): Promise<{ content: string; isError: boolean; reported?: string }> {
    try {
      switch (call.name) {
        case "assign_task": {
          if (!rt.config.isBoss) return { content: "Only the Boss can assign tasks.", isError: true };
          const input = AssignTaskInput.parse(call.input);
          const target = this.rts.get(input.agent.toLowerCase());
          if (!target || target.config.isBoss) return { content: `Unknown team member "${input.agent}".`, isError: true };
          await this.delegate(rt, target, input.task);
          return { content: `Assigned to ${target.config.name} (queue ${target.queue.length + (target.busy ? 1 : 0)}).`, isError: false };
        }
        case "update_status": {
          const input = UpdateStatusInput.parse(call.input);
          this.setStatus(rt, input.status, input.note ? clip(input.note, 60) : undefined);
          return { content: "ok", isError: false };
        }
        case "report_result": {
          const input = ReportResultInput.parse(call.input);
          rt.needsInput = input.needs_input === true;
          return { content: "recorded", isError: false, reported: input.summary };
        }
        default:
          return { content: `Unknown tool ${call.name}`, isError: true };
      }
    } catch (err) {
      return { content: `Tool error: ${errorMessage(err)}`, isError: true };
    }
  }

  /** Boss and target meet in the Meeting Room, then the task joins the target's queue. */
  private async delegate(boss: Runtime, target: Runtime, task: string): Promise<void> {
    const short = clip(task, 60);
    this.activity(boss.config.id, "delegation", `${boss.config.name} -> ${target.config.name}: ${clip(task, 120)}`);
    this.setStatus(boss, "MEETING", `Briefing ${target.config.name}`);
    const joins = !target.busy && target.queue.length === 0;
    if (joins) this.setStatus(target, "MEETING", short);
    if (this.meetingMs > 0) await sleep(this.meetingMs);
    this.saveMessage({ thread: target.config.id, author: boss.config.id, content: task, state: "done" });
    // The target stays in MEETING until its job starts (immediately unless paused).
    this.enqueue(target, { id: randomUUID(), kind: "task", from: boss.config.id, text: `[from ${boss.config.name}] ${task}` });
    if (joins && this.paused) this.setStatus(target, "IDLE");
    this.setStatus(boss, "WORKING");
  }
}

export { BOSS_ID };
