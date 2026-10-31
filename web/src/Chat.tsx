import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentView, ChatMessage, FileMeta } from "../../shared/events";
import { loadThread, sendMessage } from "./net";
import { focusAgent } from "./OfficeCanvas";
import { store, useHq } from "./store";
import { StatusBadge, Swatch, timeOf } from "./ui";

const EMPTY: ChatMessage[] = [];

function Bubble({ m, agents, self, files }: { m: ChatMessage; agents: AgentView[]; self: AgentView | undefined; files: FileMeta[] }) {
  const author = agents.find((a) => a.id === m.author);
  const mine = m.author === "owner";
  const system = m.author === "system";
  const fromOther = author && self && author.id !== self.id; // e.g. a report or a brief from the Boss
  if (!m.content && m.state !== "streaming") return null;
  // a report ends with "Files: a.md (v2), b.csv (v1)": show those as buttons that open the file
  const fm = /\nFiles: (.+)$/.exec(m.content);
  const body = fm ? m.content.slice(0, fm.index) : m.content;
  const chips = fm
    ? [...(fm[1] ?? "").matchAll(/([^\s,]+) \(v(\d+)\)/g)]
        .map((x) => files.find((f) => f.name === x[1] && f.version === Number(x[2])))
        .filter((f): f is FileMeta => !!f)
    : [];
  return (
    <div data-testid="chat-message" data-author={m.author} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
          mine
            ? "bg-violet-600/80 text-white"
            : system || m.state === "error"
              ? "bg-red-500/15 text-red-200 ring-1 ring-red-500/30"
              : fromOther
                ? "bg-ink-700 text-slate-200 ring-1 ring-ink-600"
                : "bg-ink-800 text-slate-100"
        }`}
      >
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
          {author && <Swatch agent={author} size={8} />}
          <span className="font-pixel text-[7px] uppercase tracking-wide" style={author ? { color: author.color } : undefined}>
            {mine ? "You" : system ? "System" : (author?.name ?? m.author)}
          </span>
          <span>{timeOf(m.ts)}</span>
        </div>
        <div className={`whitespace-pre-wrap break-words ${m.state === "streaming" ? "caret" : ""}`}>{body}</div>
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((f) => (
              <button
                key={f.id}
                type="button"
                data-testid="file-chip"
                onClick={() => store.openFile(f.id)}
                className="rounded bg-ink-900/70 px-1.5 py-0.5 font-mono text-[11px] text-sky-300 ring-1 ring-ink-600 hover:ring-sky-400"
              >
                ▤ {f.name} v{f.version}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Chat() {
  const agents = useHq((s) => s.agents);
  const selected = useHq((s) => s.selected);
  const messages = useHq((s) => s.threads[selected] ?? EMPTY);
  const files = useHq((s) => s.files);
  const agent = agents.find((a) => a.id === selected);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadThread(selected);
  }, [selected]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, selected]);

  // @mention autocomplete (Boss chat only)
  const mention = useMemo(() => {
    if (!agent?.isBoss) return null;
    const m = /@([\w-]*)$/.exec(text);
    if (!m) return null;
    const q = (m[1] ?? "").toLowerCase();
    const opts = agents.filter((a) => !a.isBoss && (a.id.startsWith(q) || a.name.toLowerCase().startsWith(q)));
    return opts.length ? { q, opts } : null;
  }, [text, agent, agents]);

  const pick = (a: AgentView) => {
    setText((t) => t.replace(/@([\w-]*)$/, `@${a.id} `));
    inputRef.current?.focus();
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    const r = await sendMessage(selected, t);
    setSending(false);
    if (r.ok) setText("");
    else setError(r.error);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
      e.preventDefault();
      const first = mention.opts[0];
      if (first) pick(first);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-ink-700 px-2 py-2" data-testid="thread-picker">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              store.select(a.id);
              focusAgent(a.id);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs ${
              a.id === selected ? "bg-ink-700 text-white ring-1 ring-ink-600" : "text-slate-400 hover:bg-ink-800"
            }`}
          >
            <Swatch agent={a} size={8} />
            {a.name}
          </button>
        ))}
      </div>
      {agent && (
        <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2 text-xs text-slate-400">
          <span className="font-medium text-slate-200">{agent.name}</span>
          <span className="truncate">{agent.title}</span>
          <span className="ml-auto">
            <StatusBadge status={agent.status} />
          </span>
        </div>
      )}
      <div ref={listRef} className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3" data-testid="chat-list">
        {messages.length === 0 && (
          <p className="mt-6 text-center text-xs text-slate-500">
            {agent?.isBoss ? "Brief the Boss. Use @name to delegate, e.g. “@rajaie fix the build”." : `No messages with ${agent?.name ?? "this agent"} yet.`}
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} agents={agents} self={agent} files={files} />
        ))}
      </div>
      <div className="relative border-t border-ink-700 p-2">
        {mention && (
          <div className="absolute bottom-full left-2 mb-1 w-56 overflow-hidden rounded-md bg-ink-800 shadow-lg ring-1 ring-ink-600" data-testid="mention-menu">
            {mention.opts.map((a) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-ink-700"
              >
                <Swatch agent={a} size={8} />
                <span className="text-slate-200">@{a.id}</span>
                <span className="truncate text-slate-500">{a.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            data-testid="chat-input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={agent?.isBoss ? "Message Cyrex… (@name to delegate)" : `Message ${agent?.name ?? ""}…`}
            className="min-h-[40px] flex-1 resize-none rounded-md bg-ink-850 px-3 py-2 text-[13px] text-slate-100 placeholder:text-slate-500 ring-1 ring-ink-600 outline-none focus:ring-violet-500"
          />
          <button
            type="button"
            data-testid="chat-send"
            onClick={() => void submit()}
            disabled={sending || !text.trim()}
            className="rounded-md bg-violet-600 px-3 py-2 font-pixel text-[8px] text-white disabled:opacity-40"
          >
            SEND
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      </div>
    </div>
  );
}
