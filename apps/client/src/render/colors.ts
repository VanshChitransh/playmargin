// Liquidation Night tokens as Pixi numbers (mirror of style.css @theme).
export const C = {
  ink: 0x070a12,
  navy: 0x0d1424,
  grid: 0x1a2742,
  paper: 0xeef2ff,
  muted: 0x8391b3,
  safe: 0x2ef29a,
  warn: 0xffd84d,
  liq: 0xe5484d,
  gold: 0xf5b83d,
  agent: 0x3be3ff,
  // Light arena (agar.io canvas feel); the dark brand stays on HUD, panels and screens.
  floor: 0xeefafd, // measured from agar.io
  floorLine: 0xd9e6ea,
  edge: 0xc9d3df,
  virus: 0x4fc94f, // agar-green virus, yellower than the safe ring so the two never read alike
  virusLine: 0x2c8a2c,
  // Health rings on the light floor: deeper than the HUD tokens so they hold contrast on white.
  ringSafe: 0x18b26b,
  ringWarn: 0xe0a100,
} as const;

/**
 * Blob fills: eight cool hues at matched strength, all clear of the ring colours (no red,
 * orange, pink, green or yellow), so a green, amber or red health ring reads on every blob.
 */
export const VIVID = [0x6d5dfc, 0x3b82f6, 0x0ea5e9, 0x06b6d4, 0x4f46e5, 0xa855f7, 0xc026d3, 0x0891b2] as const;

/**
 * Pellets: the same hues, lightened a little (fresh, saturated candy, still lighter than any
 * blob), so food reads as food and never as a small blob or a safety colour.
 */
export const PELLET = VIVID.map((c) => lighten(c, 0.22));

function hash(id: string | number): number {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Stable colour for an id (same blob keeps its colour every frame and on every client). */
export const vivid = (id: string | number): number => VIVID[hash(id) % VIVID.length]!;

/** Stable pellet colour for a food id. */
export const pellet = (id: string | number): number => PELLET[hash(id) % PELLET.length]!;

/** Same hue, mixed toward white by k. */
export function lighten(c: number, k: number): number {
  const m = (v: number): number => Math.round(v + (255 - v) * k);
  return (m(c >> 16) << 16) | (m((c >> 8) & 255) << 8) | m(c & 255);
}

/** Same hue, darker: the agar-style outline. */
export function darken(c: number, k = 0.68): number {
  return (((c >> 16) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);
}
