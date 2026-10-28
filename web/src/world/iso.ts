// 2:1 isometric projection. Tile (x, y) centre maps to screen (sx, sy).
export const TILE_W = 32;
export const TILE_H = 16;

export type Dir = "SE" | "SW" | "NE" | "NW";

/** Screen position of a tile-space point (tile centres are at integer + 0.5 handled by callers). */
export function toScreen(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

export function fromScreen(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Grid step to iso facing: +x = SE (right-down), -x = NW, +y = SW (left-down), -y = NE. */
export function dirFromStep(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? "SE" : "NW";
  if (dy !== 0) return dy > 0 ? "SW" : "NE";
  return fallback;
}

/** Depth key for y-sorting: larger is nearer the camera. */
export function depth(x: number, y: number): number {
  return x + y;
}
