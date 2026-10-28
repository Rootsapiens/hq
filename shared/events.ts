// Single WebSocket + REST contract between /server and /web.
// The server is the only source of truth; the web client only renders these events.
import { z } from "zod";

export const AGENT_STATUSES = ["IDLE", "WORKING", "THINKING", "MEETING", "DONE", "ERROR"] as const;
export const AgentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const ROOM_IDS = [
  "command-deck",
  "engineering",
  "art-studio",
  "writers-room",
  "hr",
  "animation-bay",
  "meeting-room",
  "pantry",
  "commons",
] as const;
export const RoomIdSchema = z.enum(ROOM_IDS);
export type RoomId = z.infer<typeof RoomIdSchema>;

/** Public view of an agent (never contains the system prompt). */
export const AgentViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),
  room: RoomIdSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  isBoss: z.boolean(),
  status: AgentStatusSchema,
  task: z.string().nullable(),
  needsInput: z.boolean(),
  queue: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type AgentView = z.infer<typeof AgentViewSchema>;

export const ChatAuthorSchema = z.string().min(1); // "owner" | "system" | agent id
export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  thread: z.string().min(1), // agent id whose chat this belongs to
  author: ChatAuthorSchema,
  content: z.string(),
  ts: z.number().int(),
  state: z.enum(["streaming", "done", "error"]),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ActivityKindSchema = z.enum(["status", "message", "delegation", "report", "error", "system"]);
export const ActivityEntrySchema = z.object({
  id: z.number().int(),
  ts: z.number().int(),
  agentId: z.string().nullable(),
  kind: ActivityKindSchema,
  text: z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ModeSchema = z.enum(["mock", "live"]);
export type Mode = z.infer<typeof ModeSchema>;

// ---------- server -> client ----------
export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    agents: z.array(AgentViewSchema),
    paused: z.boolean(),
    mode: ModeSchema,
    model: z.string(),
    brainCalls: z.number().int().nonnegative(),
    tasksDone: z.number().int().nonnegative(),
    activity: z.array(ActivityEntrySchema),
  }),
  z.object({ type: z.literal("agent"), agent: AgentViewSchema }),
  z.object({ type: z.literal("chat.message"), message: ChatMessageSchema }),
  z.object({ type: z.literal("chat.delta"), thread: z.string(), messageId: z.string(), delta: z.string() }),
  z.object({ type: z.literal("chat.reset"), thread: z.string(), messageId: z.string(), attempt: z.number().int() }),
  z.object({ type: z.literal("chat.done"), message: ChatMessageSchema }),
  z.object({ type: z.literal("activity"), entry: ActivityEntrySchema }),
  z.object({ type: z.literal("brain"), calls: z.number().int().nonnegative() }),
  z.object({ type: z.literal("paused"), paused: z.boolean() }),
  z.object({ type: z.literal("counters"), tasksDone: z.number().int().nonnegative() }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type ServerEventType = ServerEvent["type"];

// ---------- client -> server (REST bodies) ----------
export const PostMessageBodySchema = z.object({ text: z.string().trim().min(1).max(8000) });
export type PostMessageBody = z.infer<typeof PostMessageBodySchema>;

export const PauseBodySchema = z.object({ paused: z.boolean() });
export type PauseBody = z.infer<typeof PauseBodySchema>;

export const PostMessageResponseSchema = z.object({ ok: z.literal(true), messageId: z.string(), queued: z.number().int() });
export type PostMessageResponse = z.infer<typeof PostMessageResponseSchema>;

/** Parse an unknown WS payload. Returns null instead of throwing. */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  const result = ServerEventSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Statuses during which the character sits at its desk and types. */
export function isBusy(status: AgentStatus): boolean {
  return status === "WORKING" || status === "THINKING";
}

/** Extracts @mentions (lower-cased ids) from chat text. */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  const re = /@([a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = (m[1] ?? "").toLowerCase();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
