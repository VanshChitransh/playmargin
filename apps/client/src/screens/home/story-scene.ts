// How it plays, the script: each step is a pure function of time since the step became active,
// so it loops cleanly and the Mass, Debt, Equity and Health numbers always match the picture.
// Numbers follow the rules: start 80, borrow to 200 (debt 120), eat to 260, spike to 170, red at 146.

export interface Pt {
  x: number;
  y: number;
}
export interface Bot extends Pt {
  m: number;
  n: string;
  c: string;
}
export interface Float {
  t: string;
  c: string;
  a: number;
  up: number;
  big?: boolean;
  below?: boolean;
  atBear?: boolean;
}
export interface Scene {
  m: number;
  d: number;
  me: Pt & { a: number };
  prey: Bot | null;
  bear: Bot | null;
  spike: (Pt & { r: number }) | null;
  floats: Float[];
  lines: boolean;
  popped: boolean;
  hit: boolean;
  coins: boolean;
  rewind: boolean;
  holdR: boolean;
  cam: Pt | null;
}

export interface Toast {
  clk: string;
  ico: string;
  c: string;
  t1: string;
  t2: string;
}

/** The notification each step ends on. */
export const TOAST: Toast[] = [
  { clk: "0:08", ico: "●", c: "#0052FF", t1: "You spawned", t2: "80 mass, no debt. Equity 80." },
  { clk: "0:19", ico: "↑", c: "#E0A21B", t1: "Borrowed 120 from the vault", t2: "The gold shell is what you owe." },
  { clk: "0:24", ico: "+", c: "#16C46B", t1: "You ate 🤖 Dip Buyer", t2: "+60 mass. Equity 80 to 140." },
  { clk: "0:51", ico: "!", c: "#E8B500", t1: "Spike hit. Interest ticking", t2: "−78 spike, −12 interest. Ring is yellow." },
  { clk: "1:02", ico: "✕", c: "#E0243F", t1: "🤖 Bear Bjorn popped you", t2: "He takes an 8% bounty. The vault takes its loan back." },
  { clk: "0:24", ico: "✓", c: "#0A0B0D", t1: "Paid off at the peak", t2: "Held R for 0.8 s. You keep 140." },
];

/** A lead-in notification shown until the step's own event lands at `at` seconds. */
export const LEAD: Record<number, Toast & { at: number }> = {
  2: { at: 1.9, clk: "0:24", ico: "→", c: "#0052FF", t1: "Chasing 🤖 Dip Buyer", t2: "Bigger eats smaller. Close in." },
  3: { at: 1.2, clk: "0:51", ico: "%", c: "#E0A21B", t1: "Interest ticking", t2: "The vault charges every second." },
  4: { at: 2.3, clk: "1:02", ico: "!", c: "#E0243F", t1: "Red. Any touch pops you", t2: "🤖 Bear Bjorn is closing in." },
};

/** Seconds each step's event loops over, and the camera zoom it settles at. */
export const LOOP = [4, 4.5, 5, 5, 5.5, 4.5];
export const ZOOM = [1.6, 1.15, 1.0, 1.0, 0.82, 1.05];

const cl = (x: number): number => Math.max(0, Math.min(1, x));
const ez = (x: number): number => {
  const k = cl(x);
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Where everything is at `te` seconds into step `s`, and what the numbers say. */
export function scene(s: number, te: number): Scene {
  const o: Scene = {
    m: 80, d: 0, me: { x: 0, y: 0, a: 1 }, prey: null, bear: null, spike: null, floats: [],
    lines: false, popped: false, hit: false, coins: false, rewind: false, holdR: false, cam: null,
  };
  if (s === 0) {
    o.me.x = Math.sin(te * 1.2) * 14;
    o.me.y = Math.cos(te) * 8;
  }
  if (s === 1) {
    const k = ez((te - 0.3) / 1.2);
    o.m = lerp(80, 200, k);
    o.d = lerp(0, 120, k);
    o.me.x = lerp(-40, 70, ez(te / 1.8));
    o.lines = te > 0.2 && te < 1.8;
    if (te > 0.5) o.floats.push({ t: "+120 borrowed", c: "#B07A00", a: cl((3.6 - te) / 0.5), up: (te - 0.5) * 10 });
  }
  if (s === 2) {
    o.d = 120;
    const px = 170 + 25 * Math.min(te, 1.6);
    const py = -20;
    o.me.x = lerp(-30, px - 40, ez((te - 0.2) / 1.4));
    o.me.y = lerp(10, py, ez((te - 0.2) / 1.4));
    const sw = ez((te - 1.6) / 0.3);
    if (te < 1.95) o.prey = { x: lerp(px, o.me.x, sw), y: lerp(py, o.me.y, sw), m: 60 * (1 - sw), n: "Dip Buyer", c: "#F2994A" };
    o.m = lerp(200, 260, sw);
    o.lines = te > 0.2 && te < 1.6;
    if (te > 1.9) o.floats.push({ t: "+60", c: "#0B8F4D", big: true, a: cl((4.4 - te) / 0.5), up: (te - 1.9) * 14 });
    o.cam = { x: lerp((o.me.x + px) / 2, o.me.x, ez((te - 1.6) / 0.6)), y: (o.me.y + py) / 2 };
  }
  if (s === 3) {
    o.d = 120;
    o.me.x = lerp(-50, 70, ez((te - 0.3) / 1.0));
    o.me.y = 10;
    const hit = te >= 1.2;
    if (!hit) o.spike = { x: 160, y: 18, r: 30 };
    o.m = hit ? lerp(260, 182, ez((te - 1.2) / 0.25)) - 12 * ez((te - 1.6) / 1.4) : 260;
    o.hit = hit && te < 1.5;
    if (hit) o.floats.push({ t: "−78 spike", c: "#E0243F", big: true, a: cl((3.2 - te) / 0.4), up: (te - 1.2) * 12 });
    if (te > 1.6) o.floats.push({ t: "−0.12/s interest", c: "#9A6B00", a: cl((4.8 - te) / 0.4), up: 0, below: true });
    o.coins = te > 1.6 && te < 4.6;
  }
  if (s === 4) {
    o.d = 120;
    o.m = lerp(170, 146, ez(te / 0.6));
    if (te < 0.9) o.floats.push({ t: "−24 interest", c: "#9A6B00", a: cl((0.9 - te) / 0.3), up: te * 10 });
    const bx = lerp(430, 46, ez((te - 0.7) / 1.4));
    const by = lerp(60, 10, ez((te - 0.7) / 1.4));
    const eng = ez((te - 2.0) / 0.35);
    o.bear = { x: bx, y: by, m: 420 + 40 * eng, n: "Bear Bjorn", c: "#9B51E0" };
    o.me.x = lerp(0, bx, eng * 0.8);
    o.me.y = lerp(0, by, eng * 0.8);
    o.me.a = 1 - eng;
    o.popped = te > 2.3;
    if (te > 2.4) o.floats.push({ t: "+8% bounty", c: "#7A2BC2", big: true, atBear: true, a: cl((5.3 - te) / 0.4), up: (te - 2.4) * 10 });
    o.cam = { x: lerp(60, 30, eng), y: 20 };
  }
  if (s === 5) {
    const k = ez((te - 0.8) / 0.8);
    o.m = lerp(260, 140, k);
    o.d = lerp(120, 0, k);
    o.rewind = te < 0.8;
    o.holdR = te >= 0.8 && te < 1.7;
    if (te > 1.6) o.floats.push({ t: "PAID OFF", c: "#0A0B0D", big: true, a: cl((4.4 - te) / 0.4), up: (te - 1.6) * 8 });
  }
  return o;
}

/** Health factor (mass x 0.8 / debt), or null with no loan. */
export const healthFactor = (o: Scene): number | null => (o.d > 0.5 ? (o.m * 0.8) / o.d : null);

/** Ring state from the health factor: green at 1.15 and up, yellow from 1.0, red below. */
export const ringOf = (hf: number | null): "safe" | "warn" | "liq" => (!hf || hf >= 1.15 ? "safe" : hf >= 1 ? "warn" : "liq");
