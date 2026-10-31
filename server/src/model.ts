// Model client interface + the real Anthropic implementation.
import Anthropic from "@anthropic-ai/sdk";
import type { Mode } from "../../shared/events";
import type { AgentConfig } from "../agents.config";

export type MessageParam = Anthropic.MessageParam;
export type ContentBlockParam = Anthropic.ContentBlockParam;
export type ToolDef = Anthropic.Tool;

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface TurnInput {
  agent: AgentConfig;
  system: string;
  messages: MessageParam[];
  tools: ToolDef[];
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  /** Assistant content to append to the conversation before tool results. */
  assistantContent: ContentBlockParam[];
}

export interface ModelClient {
  readonly mode: Mode;
  readonly model: string;
  /** One streamed model call. `onDelta` receives text as it arrives. Throws on failure. */
  turn(input: TurnInput, onDelta: (delta: string) => void): Promise<TurnResult>;
}

export class AnthropicModel implements ModelClient {
  readonly mode = "live" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly maxTokens = 8192, // room for a full file in one save_file call
  ) {
    // Retries are done by the HQ runner (with backoff and visible status), not by the SDK.
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 120_000 });
  }

  async turn(input: TurnInput, onDelta: (delta: string) => void): Promise<TurnResult> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
    });
    stream.on("text", (delta) => onDelta(delta));
    const final = await stream.finalMessage();
    let text = "";
    const toolCalls: ToolCall[] = [];
    const assistantContent: ContentBlockParam[] = [];
    for (const block of final.content) {
      if (block.type === "text") {
        text += block.text;
        assistantContent.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
        assistantContent.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }
    }
    return { text, toolCalls, assistantContent };
  }
}

/** 4xx errors other than 408/409/429 are not worth retrying. */
export function isRetryable(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return status === 408 || status === 409 || status === 429;
    }
  }
  return true;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "unknown error";
}
