// Small shared UI bits.
import type { AgentStatus, AgentView } from "../../shared/events";

export const STATUS_STYLE: Record<AgentStatus, string> = {
  IDLE: "bg-slate-700/60 text-slate-300",
  WORKING: "bg-sky-500/20 text-sky-300",
  THINKING: "bg-violet-500/20 text-violet-300",
  MEETING: "bg-amber-500/20 text-amber-300",
  DONE: "bg-emerald-500/20 text-emerald-300",
  ERROR: "bg-red-500/25 text-red-300",
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={`rounded px-1.5 py-0.5 font-pixel text-[8px] leading-none tracking-wide ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

export function Swatch({ agent, size = 10 }: { agent: Pick<AgentView, "color">; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-sm ring-1 ring-black/40"
      style={{ width: size, height: size, background: agent.color }}
    />
  );
}

export function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
