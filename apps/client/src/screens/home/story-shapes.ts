// How it plays, stateless canvas shapes: the wobbly membrane path, the spike, the owe pill and
// the striped gold pattern of the debt shell. Shared by story-draw.ts.
const TAU = Math.PI * 2;

/** The gold debt shell texture: a pale gold tile with one darker diagonal stripe. */
export function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = document.createElement("canvas");
  c.width = c.height = 10;
  const g = c.getContext("2d")!;
  g.fillStyle = "#F3D27A";
  g.fillRect(0, 0, 10, 10);
  g.strokeStyle = "rgba(176,122,0,.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 10);
  g.lineTo(10, 0);
  g.stroke();
  return ctx.createPattern(c, "repeat");
}

/** A blob outline that breathes: two sine waves on the radius, phase ph, strength amp. */
export function blobPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  ph: number,
  amp: number,
): void {
  c.beginPath();
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * TAU;
    const w = 1 + amp * (Math.sin(a * 3 + ph) * 0.6 + Math.sin(a * 5 - ph * 1.3) * 0.4);
    const px = x + Math.cos(a) * r * w;
    const py = y + Math.sin(a) * r * w;
    if (k) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
}

/** A slowly turning virus spike with a dark rim. */
export function spikePath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
): void {
  c.beginPath();
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * TAU + t * 0.3;
    const rr = k % 2 ? r : r * 0.82;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = "#38C25A";
  c.fill();
  c.lineWidth = 2.5;
  c.strokeStyle = "#0A0B0D";
  c.stroke();
}

/** A small rounded label (the "owe 120" tag) anchored at its left edge. */
export function pill(
  c: CanvasRenderingContext2D,
  txt: string,
  tx: number,
  y: number,
  bg: string,
  line: string,
  ink: string,
): void {
  c.font = "600 12px 'Geist Mono', monospace";
  const w = c.measureText(txt).width + 14;
  c.fillStyle = bg;
  c.strokeStyle = line;
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(tx, y - 11, w, 22, 11);
  c.fill();
  c.stroke();
  c.fillStyle = ink;
  c.textAlign = "left";
  c.fillText(txt, tx + 7, y + 4);
}
