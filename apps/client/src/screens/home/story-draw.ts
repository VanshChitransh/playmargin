// How it plays, the canvas: draws one scene with a game camera that follows your blob, wobbly
// membranes, a striped gold debt shell, shards on hits and floating callouts. Plain 2D canvas,
// no Pixi, so it costs little and also runs on phones.
import { ZOOM, healthFactor, ringOf, type Bot, type Scene } from "./story-scene";
import { blobPath, hatchPattern, pill, spikePath } from "./story-shapes";

const R = (m: number): number => 3.6 * Math.sqrt(Math.max(m, 1));
const RING = { safe: "#16C46B", warn: "#E8B500", liq: "#E0243F" } as const;
const PELLET = ["#7CC8FF", "#B79CFF", "#F78FD0", "#9BE36B", "#FFC86B"];
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  c: string;
  s: number;
}

export class StoryPainter {
  private ctx: CanvasRenderingContext2D;
  private W = 560;
  private H = 290;
  private cam = { x: 0, y: 0, z: 1.6 };
  private shards: Shard[] = [];
  private wasHit = false;
  private wasPop = false;
  private hatch: CanvasPattern | null;
  private pel = Array.from({ length: 90 }, () => ({ x: rnd(-520, 640), y: rnd(-300, 300), r: rnd(3, 5.5), c: PELLET[Math.floor(rnd(0, 5))]!, ph: rnd(0, 6) }));
  private nina: Bot = { x: -230, y: 120, m: 70, n: "Nitro Nina", c: "#EB5DA4" };
  private t = 0;

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext("2d")!;
    this.hatch = hatchPattern(this.ctx);
    this.fit();
  }

  /** Match the backing store to the CSS size (call on resize). */
  fit(): void {
    const r = this.cv.getBoundingClientRect();
    const d = Math.min(2, devicePixelRatio || 1);
    this.W = r.width || 560;
    this.H = r.height || 290;
    this.cv.width = this.W * d;
    this.cv.height = this.H * d;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  /** A new step or a new loop: drop particles and re-arm the one-shot effects. */
  reset(): void {
    this.shards = [];
    this.wasHit = this.wasPop = false;
  }

  private spx(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.z + this.W / 2, (y - this.cam.y) * this.cam.z + this.H / 2];
  }

  private bot(b: Bot): void {
    const c = this.ctx;
    const [x, y] = this.spx(b.x, b.y);
    const r = R(b.m) * this.cam.z;
    if (r < 0.5) return;
    blobPath(this.ctx, x, y, r, this.t * 2 + b.m, 0.025);
    c.fillStyle = b.c;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "rgba(0,0,0,.16)";
    c.stroke();
    c.font = "600 12px Geist, sans-serif";
    c.textAlign = "center";
    c.fillStyle = "#0A0B0D";
    c.fillText("🤖 " + b.n, x, y - r - 8);
  }

  private burst(wx: number, wy: number, n: number, cols: string[], sp: number): void {
    for (let k = 0; k < n; k++) {
      const a = rnd(0, TAU);
      const v = rnd(60, sp);
      this.shards.push({ x: wx, y: wy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.6, 1.1), c: cols[k % cols.length]!, s: rnd(2.5, 5) });
    }
  }

  /** Draw one frame of scene o for step s; dt eases the camera (0 snaps it). */
  draw(o: Scene, s: number, now: number, dt: number): void {
    const c = this.ctx;
    const cam = this.cam;
    this.t = now;
    const tgt = o.cam ?? o.me;
    const k = dt > 0 ? Math.min(1, dt * 4) : 1;
    cam.x += (tgt.x - cam.x) * k;
    cam.y += (tgt.y - cam.y) * k;
    cam.z += (ZOOM[s]! - cam.z) * k;
    const hp = ringOf(healthFactor(o));
    const t = now;

    c.clearRect(0, 0, this.W, this.H);
    // The grid moves with the camera, so motion reads even when you stay centred.
    const g = 28 * cam.z;
    const ox = (-cam.x * cam.z + this.W / 2) % g;
    const oy = (-cam.y * cam.z + this.H / 2) % g;
    c.strokeStyle = "rgba(10,11,13,.06)";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = ox; x < this.W; x += g) c.moveTo(x, 0), c.lineTo(x, this.H);
    for (let y = oy; y < this.H; y += g) c.moveTo(0, y), c.lineTo(this.W, y);
    c.stroke();
    for (const p of this.pel) {
      const [x, y] = this.spx(p.x + Math.sin(t * 0.5 + p.ph) * 4, p.y + Math.cos(t * 0.4 + p.ph) * 4);
      if (x < -10 || x > this.W + 10 || y < -10 || y > this.H + 10) continue;
      c.fillStyle = p.c;
      c.beginPath();
      c.arc(x, y, p.r * Math.min(1.3, cam.z), 0, TAU);
      c.fill();
    }
    if (s <= 1 || s === 5) this.bot({ ...this.nina, x: this.nina.x + Math.sin(t * 0.6) * 20, y: this.nina.y + Math.cos(t * 0.5) * 12 });
    if (o.spike) {
      const [x, y] = this.spx(o.spike.x, o.spike.y);
      spikePath(this.ctx, x, y, o.spike.r * cam.z, this.t);
    }
    if (o.prey && o.prey.m > 1) this.bot(o.prey);
    if (o.hit && !this.wasHit) {
      this.wasHit = true;
      this.burst(o.me.x + 50, o.me.y + 4, 30, ["#0052FF", "#E0A21B", "#38C25A"], 260);
    }
    if (o.popped && !this.wasPop) {
      this.wasPop = true;
      this.burst(o.me.x, o.me.y, 36, ["#0052FF", "#E0A21B"], 300);
    }
    if (o.me.a > 0.02) this.me(o, hp, t);
    if (o.bear) this.bot(o.bear);
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const p = this.shards[i]!;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.93;
      p.vy *= 0.93;
      p.life -= dt;
      if (p.life <= 0) {
        this.shards.splice(i, 1);
        continue;
      }
      const [x, y] = this.spx(p.x, p.y);
      c.globalAlpha = Math.min(1, p.life * 1.5);
      c.fillStyle = p.c;
      c.beginPath();
      c.arc(x, y, p.s * cam.z, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
    this.floats(o);
  }

  private me(o: Scene, hp: keyof typeof RING, t: number): void {
    const c = this.ctx;
    const z = this.cam.z * (0.4 + 0.6 * o.me.a);
    const [x, y] = this.spx(o.me.x, o.me.y);
    const rO = R(o.m) * z;
    const rI = R(Math.max(o.m - o.d, 4)) * z;
    const pulse = hp === "liq" ? 0.5 + 0.5 * Math.sin(t * 12) : 1;
    c.globalAlpha = o.me.a;
    if (o.lines) {
      c.strokeStyle = "rgba(0,82,255,.25)";
      c.lineWidth = 3;
      c.lineCap = "round";
      for (let k = -2; k <= 2; k++) {
        const yy = y + k * rO * 0.35;
        const len = 30 + 20 * Math.abs(Math.sin(t * 9 + k));
        c.beginPath();
        c.moveTo(x - rO - 8, yy);
        c.lineTo(x - rO - 8 - len, yy);
        c.stroke();
      }
    }
    if (o.d > 1) {
      blobPath(this.ctx, x, y, rO, t * 2.2, 0.03);
      c.fillStyle = this.hatch ?? "#F3D27A";
      c.fill();
      c.setLineDash([6, 5]);
      c.lineDashOffset = -t * 18;
      c.lineWidth = 2.5;
      c.strokeStyle = "#E0A21B";
      c.stroke();
      c.setLineDash([]);
    }
    blobPath(this.ctx, x, y, rI, t * 2.2 + 1, 0.03);
    c.fillStyle = "#0052FF";
    c.fill();
    blobPath(this.ctx, x, y, rO, t * 2.2, 0.03);
    c.lineWidth = hp === "liq" ? 5 : 4;
    c.strokeStyle = RING[hp];
    c.globalAlpha = o.me.a * (0.4 + 0.6 * pulse);
    c.stroke();
    c.globalAlpha = o.me.a;
    if (hp === "liq") {
      c.globalAlpha = o.me.a * 0.18 * pulse;
      blobPath(this.ctx, x, y, rO + 10, t * 2.2, 0.03);
      c.fillStyle = "#E0243F";
      c.fill();
      c.globalAlpha = o.me.a;
    }
    c.font = `700 ${Math.round(Math.max(13, rI * 0.42))}px Geist, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#fff";
    c.fillText("you", x, y);
    c.textBaseline = "alphabetic";
    if (o.d > 1) pill(this.ctx, `owe ${Math.round(o.d)}`, x + rO + 10, y, "#FFF4D6", "#E0A21B", "#8A5A00");
    if (o.coins) {
      for (let k = 0; k < 3; k++) {
        const ph = (t * 1.4 + k / 3) % 1;
        c.globalAlpha = o.me.a * (1 - ph);
        c.fillStyle = "#E0A21B";
        c.beginPath();
        c.arc(x + Math.cos(k * 2.1) * rO * 0.7, y - rO * 0.2 - ph * 40, 4, 0, TAU);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    if (o.holdR) {
      c.font = "600 12px Geist, sans-serif";
      const w = c.measureText("Holding R").width + 18;
      c.fillStyle = "#0A0B0D";
      c.beginPath();
      c.roundRect(x - w / 2, y + rO + 10, w, 24, 12);
      c.fill();
      c.fillStyle = "#fff";
      c.textAlign = "center";
      c.fillText("Holding R", x, y + rO + 26);
    }
  }

  private floats(o: Scene): void {
    const c = this.ctx;
    for (const f of o.floats) {
      if (f.a <= 0) continue;
      let x: number;
      let y: number;
      if (f.atBear && o.bear) {
        [x, y] = this.spx(o.bear.x, o.bear.y);
        y -= R(o.bear.m) * this.cam.z + 30 + f.up;
      } else {
        [x, y] = this.spx(o.me.x, o.me.y);
        const r = R(o.m) * this.cam.z;
        y = f.below ? y + r + 22 : y - r - 18 - f.up;
      }
      c.globalAlpha = Math.min(1, f.a);
      c.font = f.big ? "800 26px Geist, sans-serif" : "700 15px Geist, sans-serif";
      c.textAlign = "center";
      c.lineWidth = 5;
      c.strokeStyle = "#fff";
      c.strokeText(f.t, x, y);
      c.fillStyle = f.c;
      c.fillText(f.t, x, y);
    }
    c.globalAlpha = 1;
  }
}
