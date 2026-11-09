// Liquidation Night tokens as Pixi numbers (mirror of style.css @theme).
export const C = {
  ink: 0x070a12,
  navy: 0x0d1424,
  grid: 0x1a2742,
  paper: 0xeef2ff,
  muted: 0x8391b3,
  safe: 0x2ef29a,
  warn: 0xffd84d,
  liq: 0xff3d5a,
  gold: 0xf5b83d,
  agent: 0x3be3ff,
  // Light arena (agar.io canvas feel); the dark brand stays on HUD, panels and screens.
  floor: 0xeefafd, // measured from agar.io
  floorLine: 0xd9e6ea,
  edge: 0xc9d3df,
  virus: 0x5fd068,
  virusLine: 0x2f8f3d,
} as const;

/** Vivid fills for blobs and food: no pure red or pure green, so health rings never clash. */
export const VIVID = [0x7c5cff, 0x3b82f6, 0xff8a3d, 0xff4fb4, 0x14b8c4, 0xa855f7, 0x6366f1, 0x0ea5e9, 0xf472b6, 0xfb923c, 0x8b5cf6, 0x06b6d4] as const;

/** Stable colour for an id (same blob or food keeps its colour every frame and on every client). */
export function vivid(id: string | number): number {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return VIVID[(h >>> 0) % VIVID.length]!;
}

/** Same hue, darker: the agar-style outline. */
export function darken(c: number, k = 0.68): number {
  return (((c >> 16) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);
}
