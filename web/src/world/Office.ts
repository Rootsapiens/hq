// PixiJS v8 isometric office. Renders only what the server says: each character's motion
// is derived from its AgentView.status (see behavior.ts).
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureStyle } from "pixi.js";
import type { AgentStatus, AgentView } from "../../../shared/events";
import { findPath, type Point } from "./astar";
import { activityFor, badgeFor, goalFor, pickWanderTile } from "./behavior";
import { BRAIN_CENTER, FURNITURE, GRID_H, GRID_W, OFFICE_GRID, ROOMS, ROOM_W, isWall, roomAt, type Furniture } from "./map";
import { dirFromStep, toScreen, type Dir } from "./iso";
import { SPRITE_H, SPRITE_W, loadOverride, paletteFor, sheetCanvas } from "./sprites";

TextureStyle.defaultOptions.scaleMode = "nearest";

const PIXEL_FONT = '"Press Start 2P", monospace';
const WALK_SPEED = 4; // tiles per second
const DONE_SHOW_MS = 5000;

export interface CharacterDebug {
  id: string;
  status: AgentStatus;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  room: string | null;
  moving: boolean;
  dir: Dir;
  badge: string | null;
}

interface Frames {
  front: Texture[];
  back: Texture[];
  type: Texture[];
}

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
const shade = (c: number, f: number) => {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
};
const tileCenter = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 });

function framesFrom(canvas: HTMLCanvasElement): Frames {
  const base = Texture.from(canvas);
  base.source.scaleMode = "nearest";
  const cut = (col: number, row: number) =>
    new Texture({ source: base.source, frame: new Rectangle(col * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H) });
  return {
    front: [0, 1, 2, 3].map((i) => cut(i, 0)),
    back: [0, 1, 2, 3].map((i) => cut(i, 1)),
    type: [0, 1].map((i) => cut(i, 2)),
  };
}

class Character {
  readonly root = new Container();
  private readonly body: Sprite;
  private readonly shadow = new Graphics();
  private readonly ring = new Graphics();
  private readonly badge = new Container();
  private readonly badgeG = new Graphics();
  private readonly badgeText: Text;
  private readonly label: Text;
  view: AgentView;
  frames: Frames;
  /** Float tile-space position of the feet (tile centres at .5). */
  pos: { x: number; y: number };
  path: Point[] = [];
  dir: Dir = "SW";
  private animT = 0;
  private waitUntil = 0;
  private statusSince = performance.now();
  private lastStatus: AgentStatus;
  private goal: Point | null = null;
  seatIndex = 0;
  selected = false;

  constructor(view: AgentView, frames: Frames, start: Point, onTap: (id: string) => void) {
    this.view = view;
    this.frames = frames;
    this.lastStatus = view.status;
    this.pos = tileCenter(start);
    const color = hexNum(view.color);

    this.shadow.ellipse(0, 0, 7, 3.5).fill({ color: 0x000000, alpha: 0.35 });
    this.ring.ellipse(0, 0, 10, 5).stroke({ width: 1.5, color, alpha: 0.95 });
    this.ring.visible = false;
    this.body = new Sprite(frames.front[0]);
    this.body.anchor.set(0.5, 1);

    this.label = new Text({
      text: view.name.toUpperCase(),
      style: { fontFamily: PIXEL_FONT, fontSize: 6, fill: 0xffffff, stroke: { color: 0x0b0a10, width: 2 } },
      resolution: 4,
    });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, -SPRITE_H - 2);
    const plate = new Graphics();
    const w = this.label.width + 6;
    plate.roundRect(-w / 2, -SPRITE_H - 11, w, 9, 2).fill({ color: shade(color, 0.45), alpha: 0.85 });

    this.badgeText = new Text({
      text: "",
      style: { fontFamily: PIXEL_FONT, fontSize: 7, fill: 0xffffff },
      resolution: 4,
    });
    this.badgeText.anchor.set(0.5, 0.5);
    this.badge.addChild(this.badgeG, this.badgeText);
    this.badge.position.set(0, -SPRITE_H - 20);
    this.badge.visible = false;

    this.root.addChild(this.shadow, this.ring, this.body, plate, this.label, this.badge);
    this.root.eventMode = "static";
    this.root.cursor = "pointer";
    this.root.hitArea = new Rectangle(-10, -SPRITE_H - 12, 20, SPRITE_H + 16);
    this.root.on("pointertap", () => onTap(view.id));
  }

  get tile(): Point {
    return { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y) };
  }

  setFrames(f: Frames): void {
    this.frames = f;
  }

  setView(v: AgentView, now: number): void {
    this.view = v;
    if (v.status !== this.lastStatus) {
      this.lastStatus = v.status;
      this.statusSince = now;
      this.goal = null;
      this.waitUntil = 0;
      // keep walking to the current tile centre, then re-route
      this.path = this.path.slice(0, 1);
    }
  }

  private routeTo(goal: Point): void {
    this.goal = goal;
    const here = this.path[0] ?? this.tile;
    const p = findPath(OFFICE_GRID, here, goal);
    if (p) this.path = p;
    else {
      // unreachable (should not happen with the shipped map): snap rather than freeze
      this.pos = tileCenter(goal);
      this.path = [];
    }
  }

  update(dtMs: number, now: number, occupied: Point[]): void {
    const status = this.view.status;
    const act = activityFor(status);
    // choose a goal
    if (this.path.length === 0) {
      const fixed = goalFor(status, this.view.room, this.seatIndex);
      if (fixed) {
        const t = this.tile;
        if (t.x !== fixed.x || t.y !== fixed.y) this.routeTo(fixed);
        else this.goal = fixed;
      } else if (act === "wander" && now >= this.waitUntil) {
        this.routeTo(pickWanderTile(Math.random, occupied));
        this.waitUntil = this.path.length ? Number.POSITIVE_INFINITY : now + 1000; // set on arrival
      }
    }

    // move along the path
    let moving = false;
    if (this.path.length > 0) {
      const next = this.path[0];
      if (next) {
        const target = tileCenter(next);
        const dx = target.x - this.pos.x;
        const dy = target.y - this.pos.y;
        const dist = Math.hypot(dx, dy);
        const stepLen = (WALK_SPEED * dtMs) / 1000;
        if (dist <= stepLen) {
          this.pos = target;
          this.path.shift();
          if (this.path.length === 0 && act === "wander") this.waitUntil = now + 1800 + Math.random() * 3500;
        } else {
          this.pos = { x: this.pos.x + (dx / dist) * stepLen, y: this.pos.y + (dy / dist) * stepLen };
          this.dir = dirFromStep(dx, dy, this.dir);
        }
        moving = dist > 0.001;
      }
    }

    // face the desk / table when seated
    const seated = !moving && this.path.length === 0 && this.goal !== null;
    if (seated && act === "desk") this.dir = "SW";
    if (seated && act === "meeting") this.dir = this.seatIndex % 8 < 4 ? "SW" : "NE";

    // animation frame
    this.animT += dtMs;
    const back = this.dir === "NE" || this.dir === "NW";
    const mirror = this.dir === "SE" || this.dir === "NE";
    let tex: Texture | undefined;
    if (moving) tex = (back ? this.frames.back : this.frames.front)[Math.floor(this.animT / 125) % 4];
    else if (seated && act === "desk") tex = this.frames.type[Math.floor(this.animT / 220) % 2];
    else tex = (back ? this.frames.back : this.frames.front)[0];
    if (tex) this.body.texture = tex;
    this.body.scale.x = mirror ? -1 : 1;

    // badge
    let kind = badgeFor(status);
    if (kind === "check" && now - this.statusSince > DONE_SHOW_MS) kind = null;
    if (kind === "dots" && !seated) kind = null; // the "..." bubble shows while typing at the desk
    this.drawBadge(kind, now);

    const s = toScreen(this.pos.x, this.pos.y);
    this.root.position.set(s.x, s.y);
    this.root.zIndex = this.pos.x + this.pos.y + 0.05;
    this.ring.visible = this.selected;
    this.moving = moving;
  }

  moving = false;
  badgeKind: string | null = null;

  private badgeKey = "";

  private drawBadge(kind: "dots" | "check" | "alert" | null, now: number): void {
    this.badge.visible = kind !== null;
    this.badgeKind = kind;
    if (kind === null) {
      this.badgeKey = "";
      return;
    }
    const lit = kind === "dots" ? Math.floor(now / 300) % 4 : 0; // 0..3 dots lit, cycling
    const key = `${kind}:${lit}`;
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const g = this.badgeG;
    g.clear();
    this.badgeText.text = "";
    if (kind === "dots") {
      g.roundRect(-12, -7, 24, 13, 4).fill(0xf5f3ff).stroke({ width: 1, color: 0x15121d });
      g.poly([-4, 6, 2, 6, -5, 10]).fill(0xf5f3ff);
      for (let i = 0; i < 3; i++) g.rect(-7 + i * 5, -2, 3, 3).fill(i < lit || lit === 0 ? 0x15121d : 0xb8b2cc);
    } else if (kind === "check") {
      g.circle(0, 0, 7).fill(0x22c55e).stroke({ width: 1, color: 0x0b3d1f });
      g.moveTo(-3.5, 0).lineTo(-1, 2.8).lineTo(3.8, -2.6).stroke({ width: 2, color: 0xffffff });
    } else {
      g.circle(0, 0, 7).fill(0xef4444).stroke({ width: 1, color: 0x450a0a });
      g.rect(-1, -4.5, 2.4, 5.5).fill(0xffffff);
      g.rect(-1, 2.2, 2.4, 2.2).fill(0xffffff);
    }
  }

  debug(): CharacterDebug {
    const t = this.tile;
    return {
      id: this.view.id,
      status: this.view.status,
      x: +this.pos.x.toFixed(3),
      y: +this.pos.y.toFixed(3),
      tileX: t.x,
      tileY: t.y,
      room: roomAt(t.x, t.y)?.id ?? null,
      moving: this.moving,
      dir: this.dir,
      badge: this.badgeKind,
    };
  }
}

export interface OfficeOptions {
  onSelect: (id: string) => void;
}

export class Office {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly floor = new Container();
  private readonly objects = new Container();
  private readonly overlay = new Container();
  private readonly chars = new Map<string, Character>();
  private brain = new Graphics();
  private brainLabel!: Text;
  private brainCalls = 0;
  private zoom = 1;
  private follow: string | null = null;
  private camTarget: { x: number; y: number } | null = null;
  private destroyed = false;
  private ready = false;
  private resizeObs: ResizeObserver | null = null;
  private userMovedCamera = false;
  private dragDist = 0;

  constructor(private readonly opts: OfficeOptions) {}

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x0d0c14,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    try {
      await document.fonts.load(`8px ${PIXEL_FONT}`);
    } catch {
      /* fall back to monospace */
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.imageRendering = "pixelated";
    this.app.canvas.setAttribute("data-testid", "office-canvas");
    this.objects.sortableChildren = true;
    this.world.addChild(this.floor, this.objects, this.overlay);
    this.app.stage.addChild(this.world);
    this.buildFloor();
    this.buildWalls();
    this.buildFurniture();
    this.buildBrain();
    this.installCamera();
    this.fit();
    this.resizeObs = new ResizeObserver(() => {
      if (!this.userMovedCamera) this.fit();
    });
    this.resizeObs.observe(host);
    this.app.ticker.add((t) => this.tick(t.deltaMS));
    this.ready = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObs?.disconnect();
    if (this.ready) this.app.destroy(true, { children: true });
  }

  // ---------- scene ----------

  private buildFloor(): void {
    const g = new Graphics();
    for (let y = 0; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++) {
        if (isWall(x, y)) continue;
        const r = roomAt(x, y);
        const base = r ? r.floor : 0x34303f; // doorways
        const c = (x + y) % 2 === 0 ? base : shade(base, 1.08);
        const a = toScreen(x, y);
        const b = toScreen(x + 1, y);
        const cc = toScreen(x + 1, y + 1);
        const d = toScreen(x, y + 1);
        g.poly([a.x, a.y, b.x, b.y, cc.x, cc.y, d.x, d.y]).fill(c);
      }
    this.floor.addChild(g);
    for (const r of ROOMS) {
      const t = new Text({
        text: r.label,
        style: { fontFamily: PIXEL_FONT, fontSize: 6, fill: 0xffffff },
        resolution: 4,
      });
      t.alpha = 0.55;
      t.anchor.set(0.5, 0.5);
      const p = toScreen(r.x0 + ROOM_W / 2 + 0.5, r.y1 + 0.5);
      t.position.set(p.x, p.y - 2);
      this.overlay.addChild(t);
    }
  }

  private block(tx: number, ty: number, h: number, top: number, inset = 0): Graphics {
    const g = new Graphics();
    const i = inset;
    const a = toScreen(tx + i, ty + i);
    const b = toScreen(tx + 1 - i, ty + i);
    const c = toScreen(tx + 1 - i, ty + 1 - i);
    const d = toScreen(tx + i, ty + 1 - i);
    g.poly([d.x, d.y, c.x, c.y, c.x, c.y - h, d.x, d.y - h]).fill(shade(top, 0.62));
    g.poly([c.x, c.y, b.x, b.y, b.x, b.y - h, c.x, c.y - h]).fill(shade(top, 0.8));
    g.poly([a.x, a.y - h, b.x, b.y - h, c.x, c.y - h, d.x, d.y - h]).fill(top);
    g.zIndex = tx + ty + 1;
    this.objects.addChild(g);
    return g;
  }

  private buildWalls(): void {
    for (let y = 0; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++) {
        if (!isWall(x, y)) continue;
        const back = x === 0 || y === 0;
        const front = x === GRID_W - 1 || y === GRID_H - 1;
        const h = back ? 26 : front ? 4 : 9;
        this.block(x, y, h, back ? 0x4b4762 : 0x5d5876);
      }
  }

  private buildFurniture(): void {
    const seen = new Set<string>();
    for (const f of FURNITURE) this.furniture(f, seen);
  }

  private furniture(f: Furniture, seen: Set<string>): void {
    const k = `${f.kind}:${roomAt(f.x, f.y)?.id ?? ""}`;
    const first = !seen.has(k);
    seen.add(k);
    switch (f.kind) {
      case "desk": {
        const g = this.block(f.x, f.y, 10, 0x9a7650, 0.04);
        if (first) {
          const p = toScreen(f.x + 0.5, f.y + 0.5);
          g.rect(p.x - 6, p.y - 22, 12, 9).fill(0x1c1b26);
          g.rect(p.x - 5, p.y - 21, 10, 7).fill(0x5eead4);
          g.rect(p.x - 1, p.y - 13, 2, 3).fill(0x1c1b26);
        }
        break;
      }
      case "table":
        this.block(f.x, f.y, 9, 0x7c5a3c, 0);
        break;
      case "counter": {
        const g = this.block(f.x, f.y, 14, 0xc9c3d8, 0.02);
        if (first) {
          const p = toScreen(f.x + 0.5, f.y + 0.5);
          g.rect(p.x - 4, p.y - 26, 8, 10).fill(0x2a2735);
          g.rect(p.x - 2, p.y - 24, 4, 3).fill(0xf97316);
        }
        break;
      }
      case "plant": {
        const g = this.block(f.x, f.y, 6, 0xa0522d, 0.3);
        const p = toScreen(f.x + 0.5, f.y + 0.5);
        g.circle(p.x, p.y - 12, 6).fill(0x2f7d4a);
        g.circle(p.x - 3, p.y - 15, 4).fill(0x3da35d);
        g.circle(p.x + 3, p.y - 16, 3).fill(0x4cc26f);
        break;
      }
      case "shelf": {
        const g = this.block(f.x, f.y, 26, 0x6b4a34, 0.1);
        const p = toScreen(f.x + 0.5, f.y + 1 - 0.1);
        const colors = [0xef4444, 0x3b82f6, 0xeab308, 0x22c55e];
        for (let i = 0; i < 4; i++) g.rect(p.x - 10 + i * 3, p.y - 22, 2, 7).fill(colors[i] ?? 0xffffff);
        break;
      }
      case "easel": {
        const g = new Graphics();
        const p = toScreen(f.x + 0.5, f.y + 0.5);
        g.moveTo(p.x - 6, p.y).lineTo(p.x, p.y - 26).lineTo(p.x + 6, p.y).stroke({ width: 1.5, color: 0x8b5a2b });
        g.rect(p.x - 8, p.y - 24, 16, 13).fill(0xfdf6e3).stroke({ width: 1, color: 0x8b5a2b });
        g.circle(p.x - 2, p.y - 18, 3).fill(0xec4899);
        g.rect(p.x + 1, p.y - 16, 5, 3).fill(0x3b82f6);
        g.zIndex = f.x + f.y + 1;
        this.objects.addChild(g);
        break;
      }
      case "screen": {
        const g = this.block(f.x, f.y, 22, 0x1f2937, 0.15);
        const p = toScreen(f.x + 0.5, f.y + 0.85);
        g.rect(p.x - 7, p.y - 22, 9, 12).fill(0x38bdf8);
        break;
      }
      case "sofa":
        this.block(f.x, f.y, 7, 0x2f6f73, 0.05);
        break;
      case "brain":
        this.block(f.x, f.y, 5, 0x2a2838, 0);
        break;
    }
  }

  private buildBrain(): void {
    const p = toScreen(BRAIN_CENTER.x, BRAIN_CENTER.y);
    this.brain.position.set(p.x, p.y - 26);
    this.brain.zIndex = BRAIN_CENTER.x + BRAIN_CENTER.y + 1.5;
    this.objects.addChild(this.brain);
    this.brainLabel = new Text({
      text: "THE BRAIN",
      style: { fontFamily: PIXEL_FONT, fontSize: 6, fill: 0xc4b5fd, stroke: { color: 0x0b0a10, width: 2 } },
      resolution: 4,
    });
    this.brainLabel.anchor.set(0.5, 0);
    this.brainLabel.position.set(p.x, p.y + 4);
    this.brainLabel.zIndex = 999;
    this.objects.addChild(this.brainLabel);
  }

  private drawBrain(now: number): void {
    const active = this.brainCalls > 0;
    const t = now / 1000;
    const pulse = active ? 0.5 + 0.5 * Math.sin(t * 9) : 0.5 + 0.5 * Math.sin(t * 1.5);
    const r = active ? 11 + pulse * 3 : 10 + pulse;
    const g = this.brain;
    g.clear();
    g.circle(0, 0, r + 10).fill({ color: active ? 0xa855f7 : 0x6d28d9, alpha: active ? 0.18 + pulse * 0.2 : 0.08 });
    g.circle(0, 0, r + 5).fill({ color: active ? 0xc084fc : 0x7c3aed, alpha: active ? 0.3 + pulse * 0.25 : 0.14 });
    g.circle(0, 0, r).fill(active ? 0xe9d5ff : 0x8b5cf6);
    g.circle(-r * 0.35, -r * 0.35, r * 0.3).fill({ color: 0xffffff, alpha: 0.7 });
    g.ellipse(0, 22, 14, 5).fill({ color: active ? 0xc084fc : 0x7c3aed, alpha: 0.25 + pulse * 0.2 });
    this.brainLabel.text = active ? `THE BRAIN x${this.brainCalls}` : "THE BRAIN";
  }

  // ---------- camera ----------

  private installCamera(): void {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    let pinchZoom = 1;
    stage.on("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      this.dragDist = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (a && b) {
          pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
          pinchZoom = this.zoom;
        }
      }
    });
    stage.on("globalpointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.global.x - prev.x;
      const dy = e.global.y - prev.y;
      pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (a && b && pinchStart > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinchZoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart);
        return;
      }
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      if (this.dragDist > 4) {
        this.follow = null;
        this.camTarget = null;
        this.userMovedCamera = true;
        this.world.x += dx;
        this.world.y += dy;
      }
    });
    const up = (e: { pointerId: number }) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
    };
    stage.on("pointerup", up);
    stage.on("pointerupoutside", up);
    this.app.canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const rect = this.app.canvas.getBoundingClientRect();
        this.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, this.zoom * Math.exp(-ev.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private zoomAt(sx: number, sy: number, z: number): void {
    const nz = Math.max(0.35, Math.min(4, z));
    const wx = (sx - this.world.x) / this.zoom;
    const wy = (sy - this.world.y) / this.zoom;
    this.zoom = nz;
    this.world.scale.set(nz);
    this.world.x = sx - wx * nz;
    this.world.y = sy - wy * nz;
    this.userMovedCamera = true;
  }

  /** Fit the whole office into the canvas. */
  /** Fit the office into the canvas. On narrow screens (unless `whole`) zoom in on the Commons instead. */
  fit(whole = false): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const left = toScreen(0, GRID_H).x;
    const right = toScreen(GRID_W, 0).x;
    const top = -30;
    const bottom = toScreen(GRID_W, GRID_H).y + 6;
    const mw = right - left;
    const mh = bottom - top;
    this.zoom = Math.max(0.35, Math.min(3, Math.min((w - 16) / mw, (h - 16) / mh)));
    this.world.scale.set(this.zoom);
    this.world.x = w / 2 - ((left + right) / 2) * this.zoom;
    this.world.y = h / 2 - ((top + bottom) / 2) * this.zoom;
    if (!whole && w < 640 && this.zoom < 0.9) {
      this.zoom = 0.9;
      this.world.scale.set(this.zoom);
      const c = toScreen(BRAIN_CENTER.x, BRAIN_CENTER.y);
      this.world.x = w / 2 - c.x * this.zoom;
      this.world.y = h / 2 - (c.y - 10) * this.zoom;
    }
    this.userMovedCamera = false;
  }

  focus(id: string): void {
    if (!this.chars.has(id)) return;
    this.follow = id;
    if (this.zoom < 1.6) {
      const c = this.chars.get(id);
      if (c) {
        const s = toScreen(c.pos.x, c.pos.y);
        const sx = this.world.x + s.x * this.zoom;
        const sy = this.world.y + (s.y - 12) * this.zoom;
        this.zoomAt(sx, sy, 1.8);
      }
    }
    this.userMovedCamera = true;
  }

  // ---------- state from the server ----------

  setBrain(calls: number): void {
    this.brainCalls = calls;
  }

  setSelected(id: string | null): void {
    for (const c of this.chars.values()) c.selected = c.view.id === id;
  }

  setAgents(views: AgentView[]): void {
    if (!this.ready) return;
    const now = performance.now();
    views.forEach((v, idx) => {
      let c = this.chars.get(v.id);
      if (!c) {
        const start = goalFor(v.status, v.room, idx) ?? pickWanderTile(Math.random, this.occupied());
        c = new Character(v, framesFrom(sheetCanvas(paletteFor(v.id, v.color))), start, (id) => {
          if (this.dragDist <= 4) this.opts.onSelect(id);
        });
        c.seatIndex = idx;
        this.chars.set(v.id, c);
        this.objects.addChild(c.root);
        const ch = c;
        void loadOverride(v.id).then((canvas) => {
          if (canvas) ch.setFrames(framesFrom(canvas));
        });
      }
      c.setView(v, now);
    });
  }

  private occupied(): Point[] {
    return [...this.chars.values()].map((c) => c.path[c.path.length - 1] ?? c.tile);
  }

  private tick(dtMs: number): void {
    const now = performance.now();
    const dt = Math.min(dtMs, 100);
    const occ = this.occupied();
    for (const c of this.chars.values()) c.update(dt, now, occ);
    this.drawBrain(now);
    if (this.follow) {
      const c = this.chars.get(this.follow);
      if (c) {
        const s = toScreen(c.pos.x, c.pos.y);
        this.camTarget = {
          x: this.app.screen.width / 2 - s.x * this.zoom,
          y: this.app.screen.height / 2 - (s.y - 12) * this.zoom,
        };
      }
    }
    if (this.camTarget) {
      const k = 1 - Math.exp(-dt / 120);
      this.world.x += (this.camTarget.x - this.world.x) * k;
      this.world.y += (this.camTarget.y - this.world.y) * k;
    }
  }

  debug(): CharacterDebug[] {
    return [...this.chars.values()].map((c) => c.debug());
  }

  resetView(): void {
    this.follow = null;
    this.camTarget = null;
    this.fit(true);
  }
}
