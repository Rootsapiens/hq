// 16x24 pixel characters drawn in code, shirt tinted by the agent colour.
// Sheet layout (also the format for overrides in /web/public/sprites/<agentId>.png, 64x72):
//   row 0: walk, facing camera (SW), 4 frames      row 1: walk, facing away (NW), 4 frames
//   row 2: typing, facing camera, frames 0-1 (cols 2-3 unused)
// SE and NE are the SW / NW frames mirrored, giving 4 iso directions.

export const SPRITE_W = 16;
export const SPRITE_H = 24;
export const SHEET_COLS = 4;
export const SHEET_ROWS = 3;

export interface Palette {
  shirt: number;
  skin: number;
  hair: number;
}

type RGB = readonly [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const shade = (hex: number, f: number): number => {
  const [r, g, b] = rgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
};

const OUTLINE = 0x15121d;
const PANTS = 0x2d3550;
const SHOES = 0x17151f;
const EYES = 0x1b1724;

const LOOKS: Record<string, { skin: number; hair: number }> = {
  kahn: { skin: 0xc68c5d, hair: 0x2a1d17 },
  sektor: { skin: 0xe0ac7e, hair: 0x111014 },
  sindel: { skin: 0xb07446, hair: 0x6b3b1f },
  nightwolf: { skin: 0xd99f74, hair: 0x3b2a20 },
  sonya: { skin: 0xf0c49a, hair: 0x8a3b2b },
  liukang: { skin: 0x9a6440, hair: 0x23201d },
};

export function paletteFor(agentId: string, colorHex: string): Palette {
  const look = LOOKS[agentId] ?? { skin: 0xd8a27a, hair: 0x2b2018 };
  return { shirt: parseInt(colorHex.slice(1), 16), ...look };
}

/** Pixel grid of colours (or -1 for transparent) for one frame. */
export type Frame = Int32Array;

export function drawFrame(p: Palette, facing: "front" | "back", frame: number, typing = false): Frame {
  const px = new Int32Array(SPRITE_W * SPRITE_H).fill(-1);
  const set = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < SPRITE_W && y < SPRITE_H) px[y * SPRITE_W + x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const step = frame % 4;
  const bob = !typing && (step === 1 || step === 3) ? -1 : 0;
  const shirtDark = shade(p.shirt, 0.72);
  const shirtLight = shade(p.shirt, 1.18);
  const skinDark = shade(p.skin, 0.82);

  // legs + shoes (not bobbing). Lifted leg is one pixel shorter.
  const leftLift = !typing && step === 3 ? 1 : 0;
  const rightLift = !typing && step === 1 ? 1 : 0;
  rect(5, 18, 7, 21 - leftLift, PANTS);
  rect(8, 18, 10, 21 - rightLift, PANTS);
  rect(4, 22 - leftLift, 7, 23 - leftLift, SHOES);
  rect(8, 22 - rightLift, 11, 23 - rightLift, SHOES);

  const b = bob;
  // torso
  rect(4, 10 + b, 11, 16 + b, p.shirt);
  rect(11, 10 + b, 11, 16 + b, shirtDark);
  rect(4, 17 + b, 11, 17 + b, shade(PANTS, 0.7)); // belt
  if (facing === "front") rect(7, 10 + b, 8, 10 + b, shirtLight); // collar
  // arms
  if (typing) {
    const up = frame % 2;
    rect(3, 10 + b, 3, 12 + b, p.shirt);
    rect(12, 10 + b, 12, 12 + b, shirtDark);
    rect(4, 13 - up, 5, 13 - up, p.skin);
    rect(10, 12 + up, 11, 12 + up, p.skin);
  } else {
    const swing = step === 1 ? 1 : step === 3 ? -1 : 0;
    rect(3, 10 + b + swing, 3, 13 + b + swing, p.shirt);
    rect(12, 10 + b - swing, 12, 13 + b - swing, shirtDark);
    rect(3, 14 + b + swing, 3, 15 + b + swing, p.skin);
    rect(12, 14 + b - swing, 12, 15 + b - swing, skinDark);
  }
  // neck + head
  rect(7, 9 + b, 8, 9 + b, skinDark);
  rect(5, 3 + b, 10, 8 + b, p.skin);
  rect(6, 1 + b, 9, 1 + b, p.hair);
  rect(5, 2 + b, 10, 3 + b, p.hair);
  if (facing === "front") {
    rect(5, 4 + b, 5, 5 + b, p.hair);
    rect(10, 4 + b, 10, 6 + b, p.hair);
    rect(6, 4 + b, 7, 4 + b, p.hair); // fringe swept left: the sprite faces left-down (SW)
    set(6, 6 + b, EYES);
    set(8, 6 + b, EYES);
    set(7, 8 + b, skinDark);
  } else {
    rect(5, 2 + b, 10, 7 + b, p.hair);
    rect(6, 8 + b, 9, 8 + b, skinDark);
  }

  // 1px outline around the silhouette
  const out = Int32Array.from(px);
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++) {
      if (px[y * SPRITE_W + x] !== -1) continue;
      const n = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx = -1, ny = -1]) => nx >= 0 && ny >= 0 && nx < SPRITE_W && ny < SPRITE_H && px[ny * SPRITE_W + nx] !== -1);
      if (n) out[y * SPRITE_W + x] = OUTLINE;
    }
  return out;
}

/** Full sheet as RGBA bytes (SHEET_COLS x SHEET_ROWS frames). */
export function buildSheetPixels(p: Palette): { width: number; height: number; data: Uint8ClampedArray } {
  const width = SPRITE_W * SHEET_COLS;
  const height = SPRITE_H * SHEET_ROWS;
  const data = new Uint8ClampedArray(width * height * 4);
  const blit = (f: Frame, col: number, row: number) => {
    for (let y = 0; y < SPRITE_H; y++)
      for (let x = 0; x < SPRITE_W; x++) {
        const c = f[y * SPRITE_W + x] ?? -1;
        if (c === -1) continue;
        const i = ((row * SPRITE_H + y) * width + col * SPRITE_W + x) * 4;
        const [r, g, b] = rgb(c);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
  };
  for (let i = 0; i < 4; i++) {
    blit(drawFrame(p, "front", i), i, 0);
    blit(drawFrame(p, "back", i), i, 1);
  }
  blit(drawFrame(p, "front", 0, true), 0, 2);
  blit(drawFrame(p, "front", 1, true), 1, 2);
  return { width, height, data };
}

export function sheetCanvas(p: Palette): HTMLCanvasElement {
  const { width, height, data } = buildSheetPixels(p);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/** Loads /sprites/<id>.png if present (must be 64x72, layout above). Returns null otherwise. */
export async function loadOverride(agentId: string): Promise<HTMLCanvasElement | null> {
  try {
    const res = await fetch(`/sprites/${agentId}.png`, { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const bmp = await createImageBitmap(await res.blob());
    if (bmp.width !== SPRITE_W * SHEET_COLS || bmp.height !== SPRITE_H * SHEET_ROWS) {
      console.warn(`[hq] /sprites/${agentId}.png must be ${SPRITE_W * SHEET_COLS}x${SPRITE_H * SHEET_ROWS}; using generated sprite`);
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}
