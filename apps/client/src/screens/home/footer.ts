// Footer inside the dark proof block: the judges' desk line, links, and the giant MARGIN wordmark
// drawn as a dot grid that little blobs roam and eat (eaten dots regrow, so the word always reads,
// a blob 1.15x wider pops a smaller one). The loop only runs while the wordmark is on screen.
import "./hero.css";
import "./sections.css";
import { VERIFY_EXAMPLE } from "./proof";

const REPO = "https://github.com/VanshChitransh/playmargin";
const COLORS = ["#0052FF", "#9B51E0", "#F2994A", "#EB5DA4", "#16C46B"];
const FULL = "#F4F5F7";
const EMPTY = "#16181D";
const LIQ = "#E0243F";
const TAU = Math.PI * 2;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.round(Math.min(255, c * k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

const html = `<footer class="foot">
  <p class="ask">Judging MARGIN? Start with the <a href="/judges">judges' desk</a>.</p>
  <div class="fmid">
    <span class="flogo"><img src="/brand/margin-cat-cutout.svg" alt="" /></span>
    <nav class="flinks" aria-label="Footer"><a href="/how">How it works</a><a href="${VERIFY_EXAMPLE}">Verify a match</a><a href="/judge">Judge Run</a><a href="${REPO}" target="_blank" rel="noopener">GitHub</a><a href="https://x.com/playmargin" target="_blank" rel="noopener">@playmargin</a></nav>
    <p class="copy">Built on NEAR for the NEAR Hackathon 2026. Open source, MIT.</p>
  </div>
  <canvas class="word" aria-hidden="true"></canvas><p class="word-text" aria-hidden="true">MARGIN</p>
</footer>`;

interface Cell {
  on: boolean;
  eatenAt: number;
  back: number;
  grownAt: number;
}
interface Blob {
  color: string;
  m: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: number;
  wob: number;
}

/** Render the footer into box; returns its cleanup. */
export function mountFooter(box: HTMLElement): () => void {
  box.innerHTML = html;
  const cv = box.querySelector<HTMLCanvasElement>("canvas.word")!;
  const ctx = cv.getContext("2d")!;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0;
  let H = 0;
  let C = 0;
  let cols = 0;
  let rows = 0;
  let cells: Cell[] = [];
  let letters: number[] = [];
  let blobs: Blob[] = [];
  let pops: { x: number; y: number; r: number; t: number }[] = [];
  let now = 0;
  const rOf = (m: number): number => C * 0.42 * Math.sqrt(m);
  const alive = (i: number): boolean => cells[i]!.on && cells[i]!.eatenAt < 0;
  const spawn = (color: string, anywhere: boolean): Blob => ({
    color, m: rnd(10, 18), x: anywhere ? rnd(0, W) : Math.random() < 0.5 ? -C * 4 : W + C * 4,
    y: rnd(H * 0.3, H * 0.85), vx: 0, vy: 0, target: -1, wob: rnd(0, 6),
  });

  function build(): void {
    W = cv.clientWidth;
    if (!W) return;
    C = W / 150; // 150 dot columns across the page
    const o = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const font = (s: number): void => {
      o.font = `900 ${s}px Geist`;
      o.letterSpacing = `${-0.07 * s}px`;
    };
    let s = 100;
    font(s);
    s *= (W * 0.97) / o.measureText("MARGIN").width;
    font(s);
    const m = o.measureText("MARGIN");
    const top = C * 6; // headroom so blobs can roam above the letters
    H = Math.ceil(top + m.actualBoundingBoxAscent + C * 2);
    o.canvas.width = W;
    o.canvas.height = H;
    font(s);
    o.fillStyle = "#000";
    o.fillText("MARGIN", (W - m.width) / 2, top + m.actualBoundingBoxAscent);
    const px = o.getImageData(0, 0, W, H).data;
    cols = Math.floor(W / C);
    rows = Math.floor(H / C);
    cells = [];
    letters = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const on = px[(Math.floor((r + 0.5) * C) * W + Math.floor((c + 0.5) * C)) * 4 + 3]! > 128;
        cells.push({ on, eatenAt: -1, back: 0, grownAt: 0 });
        if (on) letters.push(r * cols + c);
      }
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    blobs = still ? [] : COLORS.map((col) => spawn(col, true));
  }

  function pickTarget(b: Blob): number {
    // Nearest of a few random dots: wanders, but eats in trails.
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < 14; k++) {
      const i = letters[(Math.random() * letters.length) | 0]!;
      if (!alive(i)) continue;
      const d = Math.hypot(((i % cols) + 0.5) * C - b.x, (((i / cols) | 0) + 0.5) * C - b.y);
      if (d < bd) [bd, best] = [d, i];
    }
    return best;
  }

  function step(dt: number): void {
    for (const cell of cells)
      if (cell.eatenAt >= 0 && now - cell.eatenAt > cell.back) [cell.eatenAt, cell.grownAt] = [-1, now];
    for (const b of blobs) {
      if (b.target < 0 || !alive(b.target)) b.target = pickTarget(b);
      const r = rOf(b.m);
      const dx = b.target >= 0 ? ((b.target % cols) + 0.5) * C - b.x : 0;
      const dy = b.target >= 0 ? (((b.target / cols) | 0) + 0.5) * C - b.y : 0;
      const d = Math.hypot(dx, dy) || 1;
      const sp = C * 11 * Math.pow(2 / (r / C), 0.4); // bigger is slower, like agar
      b.wob += dt * 2;
      const ax = (dx / d) * sp + Math.cos(b.wob) * sp * 0.25;
      const ay = (dy / d) * sp + Math.sin(b.wob * 1.3) * sp * 0.25;
      b.vx += (ax - b.vx) * Math.min(1, dt * 3);
      b.vy += (ay - b.vy) * Math.min(1, dt * 3);
      for (const o of blobs) {
        // Near-equal blobs nudge apart so they spread over the word.
        if (o === b || o.m > b.m * 1.32 || b.m > o.m * 1.32) continue;
        const qx = b.x - o.x;
        const qy = b.y - o.y;
        const q = Math.hypot(qx, qy) || 1;
        if (q < (r + rOf(o.m)) * 1.6) [b.vx, b.vy] = [b.vx + (qx / q) * sp * 4 * dt, b.vy + (qy / q) * sp * 4 * dt];
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const c0 = Math.max(0, ((b.x - r) / C) | 0);
      const c1 = Math.min(cols - 1, ((b.x + r) / C) | 0);
      const r0 = Math.max(0, ((b.y - r) / C) | 0);
      const r1 = Math.min(rows - 1, ((b.y + r) / C) | 0);
      for (let rr = r0; rr <= r1; rr++)
        for (let cc = c0; cc <= c1; cc++) {
          const i = rr * cols + cc;
          if (alive(i) && Math.hypot((cc + 0.5) * C - b.x, (rr + 0.5) * C - b.y) < r * 0.85) {
            cells[i]!.eatenAt = now;
            cells[i]!.back = rnd(1400, 2800);
            b.m = Math.min(45, b.m + 0.25);
          }
        }
      b.m = Math.max(8, b.m * (1 - 0.05 * dt)); // interest: size drains while you sit on it
    }
    for (const a of blobs)
      for (const v of blobs) {
        if (a === v || a.m < v.m * 1.32) continue; // 1.15x radius is 1.32x mass
        const ra = rOf(a.m);
        const rv = rOf(v.m);
        if (Math.hypot(a.x - v.x, a.y - v.y) < ra - rv * 0.4) {
          pops.push({ x: v.x, y: v.y, r: rv, t: now });
          a.m = Math.min(45, a.m + v.m * 0.7);
          Object.assign(v, spawn(v.color, false));
        }
      }
    pops = pops.filter((p) => now - p.t < 450);
  }

  function draw(): void {
    ctx.clearRect(0, 0, W, H);
    const s = C * 0.78;
    const off = (C - s) / 2;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const x = (i % cols) * C;
      const y = ((i / cols) | 0) * C;
      ctx.beginPath();
      if (cell.on && cell.eatenAt < 0) {
        const k = s * (0.4 + 0.6 * (cell.grownAt ? Math.min(1, (now - cell.grownAt) / 300) : 1));
        ctx.fillStyle = FULL;
        ctx.roundRect(x + (C - k) / 2, y + (C - k) / 2, k, k, k * 0.22);
      } else {
        ctx.globalAlpha = Math.min(1, ((i / cols) | 0) / 8);
        ctx.fillStyle = EMPTY;
        ctx.roundRect(x + off, y + off, s, s, s * 0.22);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const p of pops) {
      const t = (now - p.t) / 450;
      ctx.strokeStyle = LIQ;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = C * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + t * 1.2), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const b of [...blobs].sort((a, c) => a.m - c.m)) {
      const r = rOf(b.m);
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const ex = b.vx / sp;
      const ey = b.vy / sp;
      ctx.fillStyle = b.color;
      ctx.strokeStyle = shade(b.color, 0.7);
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      for (const side of [-1, 1]) {
        // Ghost eyes: the pupils look where the blob is heading.
        const cx = b.x + side * r * 0.36 + ex * r * 0.12;
        const cy = b.y - r * 0.15 + ey * r * 0.1;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#0A0B0D";
        ctx.beginPath();
        ctx.arc(cx + ex * r * 0.09, cy + ey * r * 0.09, r * 0.1, 0, TAU);
        ctx.fill();
      }
    }
  }

  let visible = false;
  let last = 0;
  let raf = 0;
  const frame = (t: number): void => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    now = t;
    step(dt);
    draw();
    if (visible) raf = requestAnimationFrame(frame);
  };
  const io = new IntersectionObserver(([e]) => {
    const was = visible;
    visible = !!e?.isIntersecting && !still;
    if (visible && !was) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  });
  io.observe(cv);
  let rt = 0;
  const onResize = (): void => {
    clearTimeout(rt);
    rt = window.setTimeout(() => (build(), draw()), 150);
  };
  addEventListener("resize", onResize);
  let gone = false;
  void document.fonts.load("900 100px Geist").then(() => {
    if (gone) return;
    build();
    draw();
    box.querySelector(".word-text")?.remove(); // the canvas drew, so the text fallback can go
  });
  return () => {
    gone = true;
    visible = false;
    io.disconnect();
    cancelAnimationFrame(raf);
    clearTimeout(rt);
    removeEventListener("resize", onResize);
  };
}
