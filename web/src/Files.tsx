// Deliverables the agents saved with save_file: list (newest first) and a read-only viewer.
import { useEffect, useMemo, useState } from "react";
import type { HqFile } from "../../shared/events";
import { fileDownloadUrl, loadFile } from "./net";
import { store, useHq } from "./store";
import { Icon, Swatch, timeOf } from "./ui";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function Viewer({ id }: { id: string }) {
  const agents = useHq((s) => s.agents);
  const [file, setFile] = useState<HqFile | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    setFile("loading");
    void loadFile(id).then((f) => live && setFile(f));
    return () => {
      live = false;
    };
  }, [id]);
  if (file === "loading") return <p className="p-4 text-xs text-slate-500">Loading…</p>;
  if (!file) return <p className="p-4 text-xs text-red-300">This file could not be loaded.</p>;
  const a = agents.find((x) => x.id === file.agentId);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="file-viewer">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2 text-xs">
        <button type="button" onClick={() => store.openFile(null)} className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-slate-400 hover:bg-ink-800" data-testid="file-back">
          <Icon name="back" size={13} className="mr-1 align-[-2px]" />
          Files
        </button>
        <span className="truncate font-mono text-slate-100">{file.name}</span>
        <span className="text-slate-500">v{file.version}</span>
        <a href={fileDownloadUrl(file.id)} className="ml-auto shrink-0 rounded bg-ink-800 px-2 py-0.5 text-sky-300 ring-1 ring-ink-600 hover:ring-sky-400" data-testid="file-download">
          <Icon name="download" size={13} className="mr-1 align-[-2px]" />
          Download
        </a>
      </div>
      <div className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-slate-400">
        {a && <Swatch agent={a} size={8} />}
        <span>{a?.name ?? file.agentId}</span>
        <span>· {file.title}</span>
        <span className="ml-auto">{kb(file.size)} · {timeOf(file.ts)}</span>
      </div>
      <pre className="scroll-thin m-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-ink-950 p-3 font-mono text-[12px] leading-relaxed text-slate-200 ring-1 ring-ink-700" data-testid="file-content">
        {file.content}
      </pre>
    </div>
  );
}

export function Files() {
  const files = useHq((s) => s.files);
  const agents = useHq((s) => s.agents);
  const open = useHq((s) => s.openFile);
  const [who, setWho] = useState<string>("all");
  const shown = useMemo(() => (who === "all" ? files : files.filter((f) => f.agentId === who)), [files, who]);
  if (open) return <Viewer id={open} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-ink-700 px-2 py-2">
        {[{ id: "all", name: "All", color: "#64748b" }, ...agents].map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setWho(a.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs ${who === a.id ? "bg-ink-700 text-white ring-1 ring-ink-600" : "text-slate-400 hover:bg-ink-800"}`}
          >
            <Swatch agent={a} size={8} />
            {a.name}
          </button>
        ))}
      </div>
      <ul className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2" data-testid="files">
        {shown.length === 0 && (
          <li className="mt-6 px-4 text-center text-xs text-slate-500">
            No files yet. Agents save drafts, scripts, plans and code here when they finish a task.
          </li>
        )}
        {shown.map((f) => {
          const a = agents.find((x) => x.id === f.agentId);
          return (
            <li key={f.id}>
              <button
                type="button"
                data-testid="file-row"
                onClick={() => store.openFile(f.id)}
                className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left hover:bg-ink-850"
              >
                <span className="mt-0.5" style={a ? { color: a.color } : undefined}><Icon name="file" size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate font-mono text-sm text-slate-100">{f.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">v{f.version}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {a?.name ?? f.agentId} · {f.title}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-slate-500">
                  {kb(f.size)}
                  <br />
                  {timeOf(f.ts)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
