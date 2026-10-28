// Client-side mirror of server state. Only server events mutate it (plus UI selection).
import { useSyncExternalStore } from "react";
import type { ActivityEntry, AgentView, ChatMessage, Mode, ServerEvent } from "../../shared/events";

export type Tab = "roster" | "chat" | "activity";

export interface HqState {
  connected: boolean;
  agents: AgentView[];
  paused: boolean;
  mode: Mode | null;
  model: string;
  brainCalls: number;
  tasksDone: number;
  activity: ActivityEntry[];
  threads: Record<string, ChatMessage[]>;
  selected: string;
  tab: Tab;
}

let state: HqState = {
  connected: false,
  agents: [],
  paused: false,
  mode: null,
  model: "",
  brainCalls: 0,
  tasksDone: 0,
  activity: [],
  threads: {},
  selected: "cyrex",
  tab: "chat",
};

const listeners = new Set<() => void>();
function set(patch: Partial<HqState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const store = {
  get: () => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setConnected: (connected: boolean) => set({ connected }),
  select: (selected: string, tab?: Tab) => set({ selected, ...(tab ? { tab } : {}) }),
  setTab: (tab: Tab) => set({ tab }),
  setThread(thread: string, messages: ChatMessage[]): void {
    // merge: keep any live messages newer than the fetched page
    const live = (state.threads[thread] ?? []).filter((m) => !messages.some((x) => x.id === m.id));
    const all = [...messages, ...live].sort((a, b) => a.ts - b.ts);
    set({ threads: { ...state.threads, [thread]: all } });
  },
  apply(e: ServerEvent): void {
    switch (e.type) {
      case "snapshot":
        set({
          agents: e.agents,
          paused: e.paused,
          mode: e.mode,
          model: e.model,
          brainCalls: e.brainCalls,
          tasksDone: e.tasksDone,
          activity: e.activity,
        });
        return;
      case "agent": {
        const exists = state.agents.some((a) => a.id === e.agent.id);
        set({ agents: exists ? state.agents.map((a) => (a.id === e.agent.id ? e.agent : a)) : [...state.agents, e.agent] });
        return;
      }
      case "chat.message":
      case "chat.done":
        upsert(e.message);
        return;
      case "chat.delta":
        patchMessage(e.thread, e.messageId, (m) => ({ ...m, content: m.content + e.delta }));
        return;
      case "chat.reset":
        patchMessage(e.thread, e.messageId, (m) => ({ ...m, content: "" }));
        return;
      case "activity":
        set({ activity: [...state.activity.slice(-199), e.entry] });
        return;
      case "brain":
        set({ brainCalls: e.calls });
        return;
      case "paused":
        set({ paused: e.paused });
        return;
      case "counters":
        set({ tasksDone: e.tasksDone });
        return;
    }
  },
};

function upsert(m: ChatMessage): void {
  const list = state.threads[m.thread] ?? [];
  const i = list.findIndex((x) => x.id === m.id);
  const next = i >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
  set({ threads: { ...state.threads, [m.thread]: next } });
}

function patchMessage(thread: string, id: string, fn: (m: ChatMessage) => ChatMessage): void {
  const list = state.threads[thread] ?? [];
  if (!list.some((m) => m.id === id)) return;
  set({ threads: { ...state.threads, [thread]: list.map((m) => (m.id === id ? fn(m) : m)) } });
}

export function useHq<T>(selector: (s: HqState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
