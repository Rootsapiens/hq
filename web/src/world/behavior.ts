// Where an agent should be for a given status. Pure: the office scene and the tests share it.
import type { AgentStatus, RoomId } from "../../../shared/events";
import type { Point } from "./astar";
import { MEETING_SEATS, WANDER_TILES, deskSeat } from "./map";

export type Activity = "wander" | "desk" | "meeting" | "hold";

export function activityFor(status: AgentStatus): Activity {
  switch (status) {
    case "IDLE":
      return "wander";
    case "WORKING":
    case "THINKING":
      return "desk";
    case "MEETING":
      return "meeting";
    case "DONE":
    case "ERROR":
      return "hold"; // stay put with a green check / red "!"
  }
}

/** Badge drawn above the head. */
export function badgeFor(status: AgentStatus): "dots" | "check" | "alert" | null {
  if (status === "WORKING" || status === "THINKING") return "dots";
  if (status === "DONE") return "check";
  if (status === "ERROR") return "alert";
  return null;
}

/** Fixed goal for desk/meeting, null for wander/hold. `seatIndex` picks a meeting chair. */
export function goalFor(status: AgentStatus, room: RoomId, seatIndex: number): Point | null {
  const a = activityFor(status);
  if (a === "desk") return deskSeat(room);
  if (a === "meeting") return MEETING_SEATS[seatIndex % MEETING_SEATS.length] ?? null;
  return null;
}

/** Random wander tile avoiding the given occupied tiles. */
export function pickWanderTile(rand: () => number, avoid: readonly Point[]): Point {
  const free = WANDER_TILES.filter((t) => !avoid.some((a) => a.x === t.x && a.y === t.y));
  const pool = free.length ? free : WANDER_TILES;
  const t = pool[Math.floor(rand() * pool.length) % pool.length];
  if (!t) throw new Error("no wander tiles");
  return t;
}
