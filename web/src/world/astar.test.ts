import { describe, expect, it } from "vitest";
import { AGENT_STATUSES, ROOM_IDS } from "../../../shared/events";
import { findPath, gridFromRows } from "./astar";
import { activityFor, badgeFor, goalFor, pickWanderTile } from "./behavior";
import { dirFromStep, fromScreen, toScreen } from "./iso";
import { MEETING_SEATS, OFFICE_GRID, WANDER_TILES, deskSeat, roomAt } from "./map";
import { SPRITE_H, SPRITE_W, buildSheetPixels, drawFrame, paletteFor } from "./sprites";

describe("A*", () => {
  it("finds the shortest 4-neighbour path around a wall", () => {
    const g = gridFromRows([
      "....", //
      ".##.",
      "....",
    ]);
    const p = findPath(g, { x: 0, y: 1 }, { x: 3, y: 1 });
    expect(p).not.toBeNull();
    expect(p?.length).toBe(6); // 5 steps: up, right x3, down
    expect(p?.[0]).toEqual({ x: 0, y: 1 });
    expect(p?.[p.length - 1]).toEqual({ x: 3, y: 1 });
    for (let i = 1; i < (p?.length ?? 0); i++) {
      const a = p?.[i - 1];
      const b = p?.[i];
      expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBe(1); // no diagonals
      expect(g.walkable(b?.x ?? -1, b?.y ?? -1)).toBe(true);
    }
  });

  it("returns null when the goal is walled off or blocked", () => {
    const g = gridFromRows(["..#..", "..#..", "..#.."]);
    expect(findPath(g, { x: 0, y: 0 }, { x: 4, y: 2 })).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 2, y: 1 })).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });

  it("start == goal is a one-tile path", () => {
    const g = gridFromRows(["..."]);
    expect(findPath(g, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
  });

  it("every desk, meeting seat and wander tile is reachable from the Commons", () => {
    const from = WANDER_TILES.find((t) => roomAt(t.x, t.y)?.id === "commons");
    expect(from).toBeDefined();
    const targets = [
      ...ROOM_IDS.filter((r) => !["meeting-room", "pantry", "commons"].includes(r)).map(deskSeat),
      ...MEETING_SEATS,
      ...WANDER_TILES,
    ];
    for (const t of targets) {
      expect(OFFICE_GRID.walkable(t.x, t.y)).toBe(true);
      expect(findPath(OFFICE_GRID, from ?? { x: 0, y: 0 }, t)).not.toBeNull();
    }
  });
});

describe("behaviour per status", () => {
  it("maps every status to a place and a badge", () => {
    expect(AGENT_STATUSES.map(activityFor)).toEqual(["wander", "desk", "desk", "meeting", "hold", "hold"]);
    expect(AGENT_STATUSES.map(badgeFor)).toEqual([null, "dots", "dots", null, "check", "alert"]);
  });

  it("WORKING/THINKING go to the desk, MEETING to the meeting room, IDLE wanders Pantry/Commons", () => {
    expect(goalFor("WORKING", "engineering", 1)).toEqual(deskSeat("engineering"));
    expect(goalFor("THINKING", "engineering", 1)).toEqual(deskSeat("engineering"));
    const seat = goalFor("MEETING", "engineering", 1);
    expect(seat && roomAt(seat.x, seat.y)?.id).toBe("meeting-room");
    expect(goalFor("IDLE", "engineering", 1)).toBeNull();
    for (let i = 0; i < 50; i++) {
      const t = pickWanderTile(Math.random, []);
      expect(["pantry", "commons"]).toContain(roomAt(t.x, t.y)?.id);
    }
  });
});

describe("iso + sprites", () => {
  it("2:1 projection round-trips and steps map to the 4 iso directions", () => {
    expect(toScreen(1, 0)).toEqual({ x: 16, y: 8 });
    expect(toScreen(0, 1)).toEqual({ x: -16, y: 8 });
    const back = fromScreen(toScreen(3.25, 7.5).x, toScreen(3.25, 7.5).y);
    expect(back.x).toBeCloseTo(3.25);
    expect(back.y).toBeCloseTo(7.5);
    expect([dirFromStep(1, 0, "SW"), dirFromStep(-1, 0, "SW"), dirFromStep(0, 1, "SE"), dirFromStep(0, -1, "SW")]).toEqual([
      "SE",
      "NW",
      "SW",
      "NE",
    ]);
  });

  it("generates 16x24 frames tinted with the agent colour, 4 walk frames that differ", () => {
    const pal = paletteFor("sektor", "#3b82f6");
    const f0 = drawFrame(pal, "front", 0);
    const f1 = drawFrame(pal, "front", 1);
    expect(f0.length).toBe(SPRITE_W * SPRITE_H);
    expect([...f0]).toContain(0x3b82f6);
    expect([...f0]).not.toEqual([...f1]);
    const sheet = buildSheetPixels(pal);
    expect(sheet.width).toBe(64);
    expect(sheet.height).toBe(72);
  });
});
