import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_STATUSES, type AgentStatus } from "../../shared/events";
import { AgentStateMachine, TRANSITIONS, canTransition, type StatusChange } from "../src/state";

describe("status transitions table", () => {
  it("covers every status", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...AGENT_STATUSES].sort());
  });

  it.each<[AgentStatus, AgentStatus, boolean]>([
    ["IDLE", "THINKING", true],
    ["IDLE", "WORKING", true],
    ["IDLE", "MEETING", true],
    ["IDLE", "ERROR", true],
    ["IDLE", "DONE", false], // must work before it can be done
    ["THINKING", "WORKING", true],
    ["WORKING", "THINKING", true],
    ["THINKING", "DONE", true],
    ["MEETING", "THINKING", true],
    ["DONE", "IDLE", true],
    ["ERROR", "IDLE", true],
    ["ERROR", "THINKING", true],
    ["ERROR", "DONE", false], // a failed job is never reported as done
    ["WORKING", "WORKING", true], // re-assert is a no-op
  ])("%s -> %s is %s", (from, to, ok) => {
    expect(canTransition(from, to)).toBe(ok);
  });
});

describe("AgentStateMachine", () => {
  afterEach(() => vi.useRealTimers());

  it("emits changes and rejects invalid transitions without throwing", () => {
    const seen: StatusChange[] = [];
    const sm = new AgentStateMachine((c) => seen.push(c));
    expect(sm.set("DONE")).toBe(false);
    expect(sm.status).toBe("IDLE");
    expect(sm.set("THINKING", { task: "plan" })).toBe(true);
    expect(sm.set("WORKING")).toBe(true);
    expect(sm.task).toBe("plan");
    expect(seen.map((c) => `${c.from}>${c.to}`)).toEqual(["IDLE>THINKING", "THINKING>WORKING"]);
    sm.dispose();
  });

  it("DONE falls back to IDLE after the hold time (green check for 5 s)", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const sm = new AgentStateMachine((c) => seen.push(c.to), 5000);
    sm.set("THINKING", { task: "x" });
    sm.set("DONE");
    vi.advanceTimersByTime(4999);
    expect(sm.status).toBe("DONE");
    vi.advanceTimersByTime(1);
    expect(sm.status).toBe("IDLE");
    expect(sm.task).toBeNull();
    expect(seen).toEqual(["THINKING", "DONE", "IDLE"]);
  });

  it("a new job during DONE cancels the fallback", () => {
    vi.useFakeTimers();
    const sm = new AgentStateMachine(() => {}, 5000);
    sm.set("WORKING");
    sm.set("DONE");
    sm.set("THINKING");
    vi.advanceTimersByTime(6000);
    expect(sm.status).toBe("THINKING");
  });

  it("ERROR keeps the error text until the agent recovers", () => {
    const sm = new AgentStateMachine(() => {});
    sm.set("THINKING");
    sm.set("ERROR", { error: "503 overloaded" });
    expect(sm.error).toBe("503 overloaded");
    sm.set("THINKING");
    expect(sm.error).toBeNull();
  });
});
