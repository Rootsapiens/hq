// The office floor plan: a 3x3 grid of rooms joined by doorways, with furniture as blocked tiles.
import type { RoomId } from "../../../shared/events";
import { ROOM_LABELS } from "../../../shared/company";
import type { Point, WalkGrid } from "./astar";

export const ROOM_W = 8;
export const ROOM_H = 6;
export const GRID_W = 3 * ROOM_W + 4; // 28
export const GRID_H = 3 * ROOM_H + 4; // 22

export type FurnitureKind = "desk" | "table" | "counter" | "plant" | "shelf" | "brain" | "screen" | "sofa" | "easel";

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
}

export interface RoomDef {
  id: RoomId;
  label: string;
  col: number;
  row: number;
  floor: number; // floor colour
  /** Interior bounds (inclusive x0..x1, y0..y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const LAYOUT: ReadonlyArray<{ id: RoomId; label: string; col: number; row: number; floor: number }> = [
  { id: "command-deck", label: ROOM_LABELS["command-deck"].toUpperCase(), col: 0, row: 0, floor: 0xe7e2da },
  { id: "engineering", label: ROOM_LABELS["engineering"].toUpperCase(), col: 1, row: 0, floor: 0xe3e1dc },
  { id: "art-studio", label: ROOM_LABELS["art-studio"].toUpperCase(), col: 2, row: 0, floor: 0xe8e1dd },
  { id: "meeting-room", label: ROOM_LABELS["meeting-room"].toUpperCase(), col: 0, row: 1, floor: 0xe5e0d6 },
  { id: "commons", label: ROOM_LABELS["commons"].toUpperCase(), col: 1, row: 1, floor: 0xebe7e0 },
  { id: "pantry", label: ROOM_LABELS["pantry"].toUpperCase(), col: 2, row: 1, floor: 0xe6e0d7 },
  { id: "writers-room", label: ROOM_LABELS["writers-room"].toUpperCase(), col: 0, row: 2, floor: 0xe2e2db },
  { id: "hr", label: ROOM_LABELS["hr"].toUpperCase(), col: 1, row: 2, floor: 0xe5e0e0 },
  { id: "animation-bay", label: ROOM_LABELS["animation-bay"].toUpperCase(), col: 2, row: 2, floor: 0xe7e0d8 },
];

export const ROOMS: readonly RoomDef[] = LAYOUT.map((r) => {
  const x0 = 1 + r.col * (ROOM_W + 1);
  const y0 = 1 + r.row * (ROOM_H + 1);
  return { ...r, x0, y0, x1: x0 + ROOM_W - 1, y1: y0 + ROOM_H - 1 };
});

export function room(id: RoomId): RoomDef {
  const r = ROOMS.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
}

export function roomAt(x: number, y: number): RoomDef | undefined {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
}

// ---- walls with doorways ----
function isWallTile(x: number, y: number): boolean {
  if (x <= 0 || y <= 0 || x >= GRID_W - 1 || y >= GRID_H - 1) return true;
  const vWall = (x % (ROOM_W + 1)) === 0;
  const hWall = (y % (ROOM_H + 1)) === 0;
  if (vWall && hWall) return true;
  if (vWall) {
    const rowY = (y - 1) % (ROOM_H + 1); // position inside the room row
    return !(rowY === 2 || rowY === 3); // 2-tile door in the middle
  }
  if (hWall) {
    const colX = (x - 1) % (ROOM_W + 1);
    return !(colX === 3 || colX === 4);
  }
  return false;
}

// ---- furniture (relative to each room's interior origin) ----
const rel = (r: RoomDef, dx: number, dy: number) => ({ x: r.x0 + dx, y: r.y0 + dy });

/** Work rooms: desk at (3,2)-(4,2); the owner sits behind it at (3,1) facing the camera. */
const WORK_ROOMS: readonly RoomId[] = ["command-deck", "engineering", "art-studio", "writers-room", "hr", "animation-bay"];

function buildFurniture(): Furniture[] {
  const f: Furniture[] = [];
  for (const id of WORK_ROOMS) {
    const r = room(id);
    f.push({ kind: "desk", ...rel(r, 3, 2) }, { kind: "desk", ...rel(r, 4, 2) });
    f.push({ kind: "plant", ...rel(r, 0, 0) });
    f.push({ kind: id === "art-studio" || id === "animation-bay" ? "easel" : "shelf", ...rel(r, 7, 0) });
    if (id === "command-deck") f.push({ kind: "screen", ...rel(r, 6, 4) }, { kind: "screen", ...rel(r, 7, 4) });
  }
  const meet = room("meeting-room");
  for (let dx = 2; dx <= 5; dx++) for (let dy = 2; dy <= 3; dy++) f.push({ kind: "table", ...rel(meet, dx, dy) });
  f.push({ kind: "plant", ...rel(meet, 0, 0) }, { kind: "plant", ...rel(meet, 7, 5) });
  const pantry = room("pantry");
  for (let dy = 0; dy <= 3; dy++) f.push({ kind: "counter", ...rel(pantry, 7, dy) }); // kitchen counter on the outer wall
  f.push({ kind: "plant", ...rel(pantry, 7, 5) }, { kind: "sofa", ...rel(pantry, 1, 5) });
  const commons = room("commons");
  for (const [dx, dy] of [[3, 2], [4, 2], [3, 3], [4, 3]] as const) f.push({ kind: "brain", ...rel(commons, dx, dy) });
  f.push({ kind: "plant", ...rel(commons, 0, 0) }, { kind: "plant", ...rel(commons, 7, 0) });
  f.push({ kind: "sofa", ...rel(commons, 0, 5) }, { kind: "sofa", ...rel(commons, 1, 5) });
  return f;
}

export const FURNITURE: readonly Furniture[] = buildFurniture();

const blocked = new Set<number>();
for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (isWallTile(x, y)) blocked.add(y * GRID_W + x);
for (const item of FURNITURE) blocked.add(item.y * GRID_W + item.x);

export function isWall(x: number, y: number): boolean {
  return isWallTile(x, y);
}

export const OFFICE_GRID: WalkGrid = {
  width: GRID_W,
  height: GRID_H,
  walkable: (x, y) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && !blocked.has(y * GRID_W + x),
};

/** Seat behind the desk in a work room. */
export function deskSeat(id: RoomId): Point {
  return rel(room(id), 3, 1);
}

/** Seats around the meeting table, in fill order. */
export const MEETING_SEATS: readonly Point[] = (() => {
  const m = room("meeting-room");
  return [
    rel(m, 2, 1), rel(m, 5, 1), rel(m, 3, 1), rel(m, 4, 1),
    rel(m, 2, 4), rel(m, 5, 4), rel(m, 3, 4), rel(m, 4, 4),
  ];
})();

/** Walkable tiles in the Pantry and Commons, where IDLE agents wander. */
export const WANDER_TILES: readonly Point[] = (() => {
  const out: Point[] = [];
  for (const id of ["pantry", "commons"] as const) {
    const r = room(id);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (OFFICE_GRID.walkable(x, y)) out.push({ x, y });
  }
  return out;
})();

/** Centre of the Brain orb in tile units. */
export const BRAIN_CENTER: Point = (() => {
  const c = room("commons");
  return { x: c.x0 + 4, y: c.y0 + 3 }; // corner shared by the 4 brain tiles
})();
