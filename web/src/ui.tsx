// Small shared UI bits.
import type { AgentStatus, AgentView } from "../../shared/events";

export const STATUS_STYLE: Record<AgentStatus, string> = {
  IDLE: "bg-slate-700/60 text-slate-300",
  WORKING: "bg-sky-500/20 text-sky-300",
  THINKING: "bg-cyan-500/15 text-cyan-300",
  MEETING: "bg-amber-500/20 text-amber-300",
  DONE: "bg-emerald-500/20 text-emerald-300",
  ERROR: "bg-red-500/25 text-red-300",
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-wider ${STATUS_STYLE[status]}`}
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

// Stroke icons (Lucide geometry, 24px grid). Decorative unless `label` is given.
const PATHS = {
  dot: "M12 12h.01",
  mail: "M4 4h16v16H4zM22 6l-10 7L2 6",
  arrow: "M5 12h14M13 5l7 7-7 7",
  back: "M19 12H5M11 19l-7-7 7-7",
  check: "M20 6 9 17l-5-5",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  task: "M9 18l6-6-6-6",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, className = "", label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dot" ? 6 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
