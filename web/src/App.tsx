import { useEffect, useMemo, useState } from "react";
import { Chat } from "./Chat";
import { Files } from "./Files";
import { COMPANY, ROOM_LABELS } from "../../shared/company";
import { connect, loadThread, login, logout, setPaused } from "./net";
import { OfficeCanvas, focusAgent } from "./OfficeCanvas";
import { store, useHq, type Tab } from "./store";
import { Icon, StatusBadge, Swatch, timeOf, type IconName } from "./ui";

const ROOM_NAMES: Record<string, string> = ROOM_LABELS;

function TopBar() {
  const agents = useHq((s) => s.agents);
  const tasksDone = useHq((s) => s.tasksDone);
  const paused = useHq((s) => s.paused);
  const mode = useHq((s) => s.mode);
  const model = useHq((s) => s.model);
  const connected = useHq((s) => s.connected);
  const canAct = useHq((s) => s.access.canAct);
  const working = agents.filter((a) => a.status === "WORKING" || a.status === "THINKING" || a.status === "MEETING").length;
  const needs = agents.filter((a) => a.status === "ERROR" || a.needsInput).length;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-700 bg-ink-900 px-3 py-2">
      <div className="flex items-center gap-2" data-testid="brand">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-blue-700 text-xs font-semibold uppercase tracking-wider text-ink-950">
          {COMPANY.name.slice(0, 1)}
        </span>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold tracking-tight text-slate-50">
            {COMPANY.name} <span className="font-normal text-slate-400">HQ</span>
          </h1>
          <p className="hidden text-[11px] uppercase tracking-[0.14em] text-sky-300/80 sm:block">{COMPANY.kind}</p>
        </div>
      </div>
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
            className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${mode === "mock" ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}
            title={mode === "mock" ? "Fake streamed replies, no model calls" : model}
          >
            {mode === "mock" ? "MOCK" : model.toUpperCase()}
          </span>
        )}
        <OwnerControl />
        {canAct && <button
          type="button"
          data-testid="pause"
          onClick={() => void setPaused(!paused)}
          className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ${
            paused ? "bg-amber-500 text-ink-950 ring-amber-400" : "bg-ink-800 text-slate-200 ring-ink-600 hover:bg-ink-700"
          }`}
        >
          {paused ? "RESUME" : "PAUSE"}
        </button>}
      </div>
    </header>
  );
}

function Roster() {
  const agents = useHq((s) => s.agents);
  const selected = useHq((s) => s.selected);
  return (
    <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2" data-testid="roster">
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
                {a.isBoss && <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">BOSS</span>}
                <span className="ml-auto">
                  <StatusBadge status={a.status} />
                </span>
              </div>
              <div className="truncate text-xs text-slate-400">
                {a.title} · {ROOM_NAMES[a.room] ?? a.room}
              </div>
              {(a.task || a.error || a.queue > 0 || a.needsInput) && (
                <div className="mt-1 space-y-0.5 text-xs">
                  {a.task && <div className="flex items-center gap-1 truncate text-slate-300"><Icon name="task" size={12} />{a.task}</div>}
                  {a.error && <div className="flex items-center gap-1 truncate text-red-300"><Icon name="alert" size={12} />{a.error}</div>}
                  {a.needsInput && <div className="text-amber-300">needs your input</div>}
                  {a.queue > 0 && <div className="text-slate-500">{a.queue} queued</div>}
                </div>
              )}
              {a.skills.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1" data-testid={`skills-${a.id}`}>
                  {a.skills.map((sk) => (
                    <span key={sk} className="rounded bg-ink-850 px-1.5 py-0.5 text-[11px] text-slate-300 ring-1 ring-ink-700">
                      {sk}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

const KIND_ICON: Record<string, IconName> = {
  status: "dot",
  message: "mail",
  delegation: "arrow",
  report: "check",
  file: "file",
  error: "alert",
  system: "gear",
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
            <span className="mt-0.5 shrink-0" style={a ? { color: a.color } : undefined}>
              <Icon name={KIND_ICON[e.kind] ?? "dot"} size={13} label={e.kind} />
            </span>
            <span className="min-w-0 flex-1 break-words">{e.text}</span>
            <span className="shrink-0 text-slate-500">{timeOf(e.ts)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function OwnerControl() {
  const access = useHq((s) => s.access);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!access.public) return null;
  if (access.canAct)
    return (
      <button type="button" onClick={() => void logout()} className="rounded px-2 py-1 text-xs text-slate-400 ring-1 ring-ink-600 hover:text-slate-200" data-testid="logout">
        Owner · Sign out
      </button>
    );
  return (
    <div className="relative">
      <span className="mr-2 hidden rounded bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300 sm:inline" data-testid="viewer-badge">
        Live view
      </span>
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded px-2 py-1 text-xs text-slate-300 ring-1 ring-ink-600 hover:bg-ink-800" data-testid="owner-login">
        Owner sign in
      </button>
      {open && (
        <form
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg bg-ink-850 p-3 shadow-xl ring-1 ring-ink-600"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            void login(token).then(setErr);
          }}
        >
          <label htmlFor="owner-token" className="mb-1 block text-xs text-slate-300">
            Owner password
          </label>
          <input
            id="owner-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded bg-ink-950 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-ink-600 outline-none focus:ring-sky-400"
          />
          {err && <p className="mt-1 text-xs text-red-300">{err}</p>}
          <button type="submit" className="mt-2 w-full rounded bg-sky-500 py-1.5 text-xs font-medium text-ink-950 hover:bg-sky-400">
            Sign in
          </button>
        </form>
      )}
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "roster", label: "Roster" },
  { id: "chat", label: "Chat" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];

function Panel({ className = "" }: { className?: string }) {
  const tab = useHq((s) => s.tab);
  const canRead = useHq((s) => s.access.canRead);
  const tabs = canRead ? TABS : TABS.filter((t) => t.id === "roster");
  return (
    <aside className={`flex min-h-0 flex-col bg-ink-900 ${className}`}>
      <nav className="flex border-b border-ink-700" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => store.setTab(t.id)}
            className={`min-h-11 flex-1 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? "border-b-2 border-sky-400 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col">
        {!canRead && (
          <p className="border-b border-ink-700 px-4 py-3 text-xs leading-relaxed text-slate-400" data-testid="viewer-note">
            You are watching the {COMPANY.name} AI team work live. Conversations and files are private to the owner.
          </p>
        )}
        {(tab === "roster" || !canRead) && <Roster />}
        {canRead && tab === "chat" && <Chat />}
        {canRead && tab === "files" && <Files />}
        {canRead && tab === "activity" && <Activity />}
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
        <div className="bg-amber-500/15 py-1 text-center text-xs font-semibold uppercase tracking-wider text-amber-300" data-testid="paused-banner">
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
