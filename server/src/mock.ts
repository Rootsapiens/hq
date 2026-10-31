// MOCK mode: fake streamed replies and fake delegation through the same tool loop as the real model.
// Triggers for demos/tests: "#fail" -> every attempt fails (agent ends in ERROR),
// "#flaky" -> first attempt fails, the retry succeeds, "#ask" -> report_result with needs_input.
import { AGENTS } from "../agents.config";
import { extractMentions } from "../../shared/events";
import type { ContentBlockParam, MessageParam, ModelClient, ToolCall, TurnInput, TurnResult } from "./model";

export interface MockOptions {
  chunkMs: number; // delay between streamed words
  workMs: number; // fake "work" time before the closing turn
}

const KEYWORDS: ReadonlyArray<[RegExp, string]> = [
  [/\b(code|build|bug|test|qa|deploy|server|fix|program|platform|live|web|api|automat\w*|integrat\w*)\b/i, "sektor"],
  [/\b(design|ux|ui|brand|logo|wireframe|image|visual)\b/i, "sindel"],
  [/\b(research|market|competitor|strategy|proposal|pricing|price|assessment|pitch)\b/i, "nightwolf"],
  [/\b(team|hire|hiring|onboard\w*|people|training|role|audit|hr)\b/i, "sonya"],
  [/\b(video|demo|explainer|content|social|media|animate|animation)\b/i, "liukang"],
];

class MockApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function blockText(content: MessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

function hasToolResult(m: MessageParam | undefined): boolean {
  return !!m && typeof m.content !== "string" && m.content.some((b) => b.type === "tool_result");
}

function lastUserText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      // history merges consecutive user turns with a blank line; the newest one is last
      const t = blockText(m.content).split(/\n\n/).pop() ?? "";
      if (t.trim()) return t;
    }
  }
  return "";
}

/** "@a do x and @b do y" -> { a: "do x and", b: "do y" } (the caller trims joiners). */
function splitByMention(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const hits = [...text.matchAll(/@([a-zA-Z][\w-]*)/g)];
  hits.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = hits[i + 1]?.index ?? text.length;
    out.set((m[1] ?? "").toLowerCase(), text.slice(start, end).trim());
  });
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockModel implements ModelClient {
  readonly mode = "mock" as const;
  readonly model = "mock";
  private flakySeen = new Set<string>();
  private seq = 0;

  constructor(private readonly opts: MockOptions = { chunkMs: 45, workMs: 6000 }) {}

  async turn(input: TurnInput, onDelta: (delta: string) => void): Promise<TurnResult> {
    const lastMsg = input.messages[input.messages.length - 1];
    const secondRound = hasToolResult(lastMsg);
    const userText = lastUserText(input.messages);
    const task = userText.replace(/^\[from [^\]]+\]\s*/i, "").trim();
    const short = task.length > 60 ? `${task.slice(0, 57)}...` : task;

    // The Boss passes "#fail" on to the @mentioned agent instead of failing himself.
    const bossForwards = input.agent.isBoss && extractMentions(userText).length > 0;
    if (/#fail\b/i.test(userText) && !bossForwards) {
      await sleep(this.opts.chunkMs * 4);
      throw new MockApiError("mock: model unavailable (#fail)", 503);
    }
    if (/#flaky\b/i.test(userText) && !this.flakySeen.has(userText)) {
      this.flakySeen.add(userText);
      await this.stream("Starting", onDelta);
      throw new MockApiError("mock: connection reset (#flaky)", 529);
    }

    const calls: ToolCall[] = [];
    const id = () => `mock_tool_${++this.seq}`;
    let text: string;

    if (input.agent.isBoss) {
      if (!secondRound) {
        let targets = extractMentions(userText).filter((m) => AGENTS.some((a) => a.id === m && !a.isBoss));
        if (targets.length === 0) {
          const hit = KEYWORDS.find(([re]) => re.test(task));
          targets = [hit ? hit[1] : "sektor"];
        }
        const names = targets.map((t) => AGENTS.find((a) => a.id === t)?.name ?? t);
        text = `[MOCK] On it. Routing this to ${names.join(" and ")}. I'll meet them in the Meeting Room and approve only from proof.`;
        const parts = splitByMention(task);
        for (const agent of targets) {
          const own = parts.get(agent) ?? task.replace(/@[\w-]+/g, "");
          const clean =
            own
              .replace(/\s+/g, " ")
              .replace(/^(and|then)\s+|[\s,]+(and|then)?$/gi, "")
              .trim() || "the owner's request";
          calls.push({ id: id(), name: "assign_task", input: { agent, task: clean } });
        }
      } else {
        text = "[MOCK] Delegated. I'll post their reports here as they land.";
        calls.push({ id: id(), name: "report_result", input: { summary: `Delegated: ${short}` } });
      }
    } else if (!secondRound) {
      text = `[MOCK] ${input.agent.name} here. Picking up "${short}". Heading to my desk in ${input.agent.room.replace("-", " ")}.`;
      calls.push({ id: id(), name: "update_status", input: { status: "WORKING", note: short } });
    } else {
      await sleep(this.opts.workMs);
      const ask = /#ask\b/i.test(userText);
      text = ask
        ? `[MOCK] I need one decision from the owner before I can finish "${short}".`
        : `[MOCK] Done with "${short}". Proof: fake run, exit code 0 (mock mode, nothing was executed).`;
      if (!ask) {
        const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
        calls.push({
          id: id(),
          name: "save_file",
          input: {
            name: `${input.agent.id}-${slug}.md`,
            title: short,
            content: `# ${short}\n\nAuthor: ${input.agent.name} (${input.agent.title})\n\n> MOCK deliverable: placeholder text, no model was called and nothing was executed.\n\n## Request\n\n${task}\n\n## Plan\n\n1. Scope the request.\n2. Draft the work.\n3. Check it and hand it over.\n`,
          },
        });
      }
      calls.push({
        id: id(),
        name: "report_result",
        input: { summary: ask ? `Needs owner input on: ${short}` : `Finished: ${short} (mock)`, needs_input: ask },
      });
    }

    await this.stream(text, onDelta);
    const assistantContent: ContentBlockParam[] = [{ type: "text", text }];
    for (const c of calls) assistantContent.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    return { text, toolCalls: calls, assistantContent };
  }

  private async stream(text: string, onDelta: (d: string) => void): Promise<void> {
    const parts = text.match(/\S+\s*/g) ?? [text];
    for (const p of parts) {
      if (this.opts.chunkMs > 0) await sleep(this.opts.chunkMs);
      onDelta(p);
    }
  }
}
