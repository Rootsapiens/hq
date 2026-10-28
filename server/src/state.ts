// Agent status state machine. The server owns it; the web only renders what it emits.
import type { AgentStatus } from "../../shared/events";

/** Allowed transitions. Anything not listed is rejected. */
export const TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = {
  IDLE: ["THINKING", "WORKING", "MEETING", "ERROR"],
  THINKING: ["WORKING", "MEETING", "DONE", "ERROR", "IDLE"],
  WORKING: ["THINKING", "MEETING", "DONE", "ERROR", "IDLE"],
  MEETING: ["THINKING", "WORKING", "DONE", "ERROR", "IDLE"],
  DONE: ["IDLE", "THINKING", "WORKING", "MEETING", "ERROR"],
  ERROR: ["IDLE", "THINKING", "WORKING", "MEETING"],
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  if (from === to) return true; // re-asserting a status is a no-op, not an error
  return TRANSITIONS[from].includes(to);
}

export const DONE_HOLD_MS = 5000;

export interface StatusChange {
  from: AgentStatus;
  to: AgentStatus;
  task: string | null;
}

/**
 * One agent's status. DONE automatically falls back to IDLE after `doneHoldMs`
 * (the client shows the green check for exactly that long).
 */
export class AgentStateMachine {
  private _status: AgentStatus = "IDLE";
  private _task: string | null = null;
  private _error: string | null = null;
  private doneTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onChange: (change: StatusChange) => void,
    private readonly doneHoldMs: number = DONE_HOLD_MS,
  ) {}

  get status(): AgentStatus {
    return this._status;
  }
  get task(): string | null {
    return this._task;
  }
  get error(): string | null {
    return this._error;
  }

  /** Returns true when the transition was applied. Invalid transitions are ignored (never throw). */
  set(to: AgentStatus, opts: { task?: string | null; error?: string | null } = {}): boolean {
    const from = this._status;
    if (!canTransition(from, to)) return false;
    if (this.doneTimer) {
      clearTimeout(this.doneTimer);
      this.doneTimer = null;
    }
    const taskChanged = opts.task !== undefined && opts.task !== this._task;
    if (opts.task !== undefined) this._task = opts.task;
    this._error = to === "ERROR" ? (opts.error ?? this._error ?? "unknown error") : null;
    if (to === "IDLE") this._task = null;
    this._status = to;
    if (to === "DONE") {
      this.doneTimer = setTimeout(() => {
        this.doneTimer = null;
        if (this._status === "DONE") this.set("IDLE");
      }, this.doneHoldMs);
    }
    if (from !== to || taskChanged || to === "ERROR") this.onChange({ from, to, task: this._task });
    return true;
  }

  dispose(): void {
    if (this.doneTimer) clearTimeout(this.doneTimer);
    this.doneTimer = null;
  }
}
