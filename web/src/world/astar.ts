// A* on a 4-neighbour tile grid (4 iso directions, no diagonal moves).

export interface Point {
  x: number;
  y: number;
}

export interface WalkGrid {
  width: number;
  height: number;
  walkable(x: number, y: number): boolean;
}

const key = (x: number, y: number, w: number) => y * w + x;

/** Binary min-heap keyed by f-score. */
class Heap {
  private items: { k: number; f: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(k: number, f: number): void {
    const a = this.items;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pi = a[p];
      const ii = a[i];
      if (!pi || !ii || pi.f <= ii.f) break;
      a[p] = ii;
      a[i] = pi;
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        const am = () => a[m]?.f ?? Infinity;
        if (l < a.length && (a[l]?.f ?? Infinity) < am()) m = l;
        if (r < a.length && (a[r]?.f ?? Infinity) < am()) m = r;
        if (m === i) break;
        const tmp = a[i];
        const am2 = a[m];
        if (!tmp || !am2) break;
        a[i] = am2;
        a[m] = tmp;
        i = m;
      }
    }
    return top?.k;
  }
}

/**
 * Shortest 4-neighbour path from start to goal, inclusive of both ends.
 * Returns null when the goal is unreachable or either end is blocked.
 */
export function findPath(grid: WalkGrid, start: Point, goal: Point): Point[] | null {
  const { width: w, height: h } = grid;
  const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  if (!inside(start) || !inside(goal)) return null;
  if (!grid.walkable(start.x, start.y) || !grid.walkable(goal.x, goal.y)) return null;
  const startK = key(start.x, start.y, w);
  const goalK = key(goal.x, goal.y, w);
  if (startK === goalK) return [{ ...start }];

  const g = new Map<number, number>([[startK, 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const heur = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const open = new Heap();
  open.push(startK, heur(start.x, start.y));
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === undefined) break;
    if (cur === goalK) {
      const path: Point[] = [];
      let k: number | undefined = cur;
      while (k !== undefined) {
        path.push({ x: k % w, y: Math.floor(k / w) });
        k = came.get(k);
      }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    const cg = g.get(cur) ?? Infinity;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !grid.walkable(nx, ny)) continue;
      const nk = key(nx, ny, w);
      if (closed.has(nk)) continue;
      const ng = cg + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur);
        open.push(nk, ng + heur(nx, ny));
      }
    }
  }
  return null;
}

/** Builds a WalkGrid from rows of text: '#' blocked, anything else walkable. */
export function gridFromRows(rows: string[]): WalkGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return { width, height, walkable: (x, y) => (rows[y]?.[x] ?? "#") !== "#" };
}
