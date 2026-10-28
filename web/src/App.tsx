import { useEffect, useMemo } from "react";
import { Chat } from "./Chat";
import { connect, loadThread, setPaused } from "./net";
import { OfficeCanvas, focusAgent } from "./OfficeCanvas";
import { store, useHq, type Tab } from "./store";
import { StatusBadge, Swatch, timeOf } from "./ui";

const ROOM_NAMES: Record<string, string> = {
  "command-deck": "Command Deck",
  engineering: "Engineering",
  "art-studio": "Art Studio",
  "writers-room": "Writers Room",
  hr: "HR",
  "animation-bay": "Animation Bay",
};

function TopBar() {
  const agents = useHq((s) => s.agents);
  const tasksDone = useHq((s) => s.tasksDone);
  const paused = useHq((s) => s.paused);
  const mode = useHq((s) => s.mode);
  const model = useHq((s) => s.model);
  const connected = useHq((s) => s.connected);
  const working = agents.filter((a) => a.status === "WORKING" || a.status === "THINKING" || a.status === "MEETING").length;
  const needs = agents.filter((a) => a.status === "ERROR" || a.needsInput).length;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-700 bg-ink-900 px-3 py-2">
      <h1 className="font-pixel text-sm text-violet-300">HQ</h1>
      <span className="hidden text-xs text-slate-500 sm:inline">Creative Studio</span>
      <div className="flex items-center gap-1.5 text-xs" data-testid="counters">
        <span className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-300" data-testid="count-working">
          <b>{working}</b> working
        </span>
        <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300" data-testid="count-done">
          <b>{tasksDone}</b> done
        </span>
        <span
          className={`rounded px-2 py-0.5 ${needs ? "bg-red-500/20 text-red-300" : "bg-slate-700/40 text-slate-400"}`}
          data-testid="count-needs"
        >
          <b>{needs}</b> needs input
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span
          title={connected ? "connected" : "reconnecting"}
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "animate-pulse bg-red-400"}`}
        />
        {mode && (
          <span
            data-testid="mode-badge"
            className={`rounded px-1.5 py-0.5 font-pixel text-[7px] ${mode === "mock" ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}
            title={mode === "mock" ? "Fake streamed replies, no model calls" : model}
          >
            {mode === "mock" ? "MOCK" : model.toUpperCase()}
          </span>
        )}
        <button
          type="button"
          data-testid="pause"
          onClick={() => void setPaused(!paused)}
          className={`rounded px-2 py-1 font-pixel text-[8px] ring-1 ${
            paused ? "bg-amber-500 text-ink-950 ring-amber-400" : "bg-ink-800 text-slate-200 ring-ink-600 hover:bg-ink-700"
          }`}
        >
          {paused ? "RESUME" : "PAUSE"}
        </button>
      </div>
    </header>
  );
}

function Roster() {
  const agents = useHq((s) => s.agents);
  const selected = useHq((s) => s.selected);
  return (
    <ul className="scroll-thin flex h-full flex-col gap-1.5 overflow-y-auto p-2" data-testid="roster">
      {agents.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            data-testid={`roster-${a.id}`}
            data-status={a.status}
            onClick={() => {
              store.select(a.id, "chat");
              void loadThread(a.id);
              focusAgent(a.id);
            }}
            className={`flex w-full items-start gap-3 rounded-lg p-2.5 text-left ring-1 ${
              a.id === selected ? "bg-ink-800 ring-ink-600" : "ring-transparent hover:bg-ink-850"
            }`}
          >
            <Swatch agent={a} size={14} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-100">{a.name}</span>
                {a.isBoss && <span className="font-pixel text-[7px] text-amber-300">BOSS</span>}
                <span className="ml-auto">
                  <StatusBadge status={a.status} />
                </span>
              </div>
              <div className="truncate text-xs text-slate-400">
                {a.title} · {ROOM_NAMES[a.room] ?? a.room}
              </div>
              {(a.task || a.error || a.queue > 0 || a.needsInput) && (
                <div className="mt-1 space-y-0.5 text-xs">
                  {a.task && <div className="truncate text-slate-300">▸ {a.task}</div>}
                  {a.error && <div className="truncate text-red-300">! {a.error}</div>}
                  {a.needsInput && <div className="text-amber-300">needs your input</div>}
                  {a.queue > 0 && <div className="text-slate-500">{a.queue} queued</div>}
                </div>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

const KIND_ICON: Record<string, string> = {
  status: "•",
  message: "✉",
  delegation: "→",
  report: "✓",
  error: "!",
  system: "◆",
};

function Activity() {
  const activity = useHq((s) => s.activity);
  const agents = useHq((s) => s.agents);
  const items = useMemo(() => [...activity].reverse(), [activity]);
  return (
    <ul className="scroll-thin h-full space-y-1 overflow-y-auto p-2 text-xs" data-testid="activity">
      {items.length === 0 && <li className="mt-6 text-center text-slate-500">No activity yet.</li>}
      {items.map((e) => {
        const a = agents.find((x) => x.id === e.agentId);
        return (
          <li key={e.id} className={`flex gap-2 rounded px-2 py-1.5 ${e.kind === "error" ? "bg-red-500/10 text-red-200" : "text-slate-300"}`}>
            <span className="w-3 shrink-0 text-center" style={a ? { color: a.color } : undefined}>
              {KIND_ICON[e.kind] ?? "•"}
            </span>
            <span className="min-w-0 flex-1 break-words">{e.text}</span>
            <span className="shrink-0 text-slate-500">{timeOf(e.ts)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "roster", label: "Roster" },
  { id: "chat", label: "Chat" },
  { id: "activity", label: "Activity" },
];

function Panel({ className = "" }: { className?: string }) {
  const tab = useHq((s) => s.tab);
  return (
    <aside className={`flex min-h-0 flex-col bg-ink-900 ${className}`}>
      <nav className="flex border-b border-ink-700" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => store.setTab(t.id)}
            className={`flex-1 py-2 text-sm ${tab === t.id ? "border-b-2 border-violet-400 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {tab === "roster" && <Roster />}
        {tab === "chat" && <Chat />}
        {tab === "activity" && <Activity />}
      </div>
    </aside>
  );
}

export function App() {
  useEffect(() => connect(), []);
  const paused = useHq((s) => s.paused);
  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      <TopBar />
      {paused && (
        <div className="bg-amber-500/15 py-1 text-center font-pixel text-[8px] text-amber-300" data-testid="paused-banner">
          PAUSED · no new jobs start
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <OfficeCanvas className="h-[44vh] shrink-0 md:h-auto md:flex-1" />
        <Panel className="min-h-0 flex-1 border-t border-ink-700 md:w-[400px] md:flex-none md:border-l md:border-t-0" />
      </main>
    </div>
  );
}
