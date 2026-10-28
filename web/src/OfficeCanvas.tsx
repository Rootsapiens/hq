import { useEffect, useRef } from "react";
import { Office, type CharacterDebug } from "./world/Office";
import { loadThread } from "./net";
import { store } from "./store";

declare global {
  interface Window {
    __hq?: { characters: () => CharacterDebug[]; focus: (id: string) => void };
  }
}

let current: Office | null = null;

/** Focus the camera on an agent (used by the roster). */
export function focusAgent(id: string): void {
  current?.focus(id);
}

export function OfficeCanvas({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const office = new Office({
      onSelect: (id) => {
        store.select(id, "chat");
        void loadThread(id);
        office.focus(id);
      },
    });
    current = office;
    let last = store.get();
    let unsub = () => {};
    void office.init(el).then(() => {
      const push = () => {
        const s = store.get();
        if (s.agents !== last.agents || !last.agents.length) office.setAgents(s.agents);
        office.setBrain(s.brainCalls);
        office.setSelected(s.selected);
        last = s;
      };
      office.setAgents(store.get().agents);
      push();
      unsub = store.subscribe(push);
    });
    window.__hq = { characters: () => office.debug(), focus: (id) => office.focus(id) };
    return () => {
      unsub();
      if (current === office) current = null;
      office.destroy();
    };
  }, []);

  return (
    <div className={`relative overflow-hidden bg-ink-950 ${className}`}>
      <div ref={host} className="absolute inset-0 touch-none" />
      <div className="pointer-events-none absolute bottom-2 left-2 font-pixel text-[7px] text-slate-500">
        drag to pan · wheel/pinch to zoom · click an agent
      </div>
      <div className="absolute right-2 top-2 flex gap-1">
        <button
          type="button"
          onClick={() => current?.resetView()}
          className="rounded bg-ink-800/90 px-2 py-1 font-pixel text-[8px] text-slate-300 ring-1 ring-ink-600 hover:bg-ink-700"
        >
          FIT
        </button>
      </div>
    </div>
  );
}
