// Own-blob prediction against a simulated server that runs the same motion one-way latency behind.
import { describe, expect, it } from "vitest";
import { OwnPredictor, type Input } from "./predict";

const M = { speed: 300, ease: 0.08 };
const ARENA = { w: 4000, h: 4000 };
const R0 = 30;

/** Steer a zigzag; returns the input at time t (ms). */
const zigzag = (t: number): Input => {
  const a = Math.floor(t / 700) % 2 ? 0.8 : -0.8;
  return { dirX: Math.cos(a), dirY: Math.sin(a), boost: false };
};

/**
 * Run the client predictor against a server: inputs reach the server rtt/2 later, server positions
 * reach the client rtt/2 later, patches every 50 ms. offset is a drift the client cannot see (a burst).
 */
function run(rtt: number, seconds: number, offset = 0) {
  const client = new OwnPredictor();
  const server = new OwnPredictor();
  client.snap(2000, 2000, 0);
  server.snap(2000, 2000, 0);
  const inbox: Array<{ at: number; x: number; y: number }> = [];
  let snaps = 0;
  const cl: Array<[number, number, number]> = [];
  const sv = new Map<number, [number, number]>();
  const dt = 1000 / 60;
  for (let t = dt; t <= seconds * 1000; t += dt) {
    client.step(dt / 1000, t, zigzag(t), M, R0, ARENA);
    server.step(dt / 1000, t, zigzag(t - rtt / 2), M, R0, ARENA);
    if (Math.round(t) % 50 < dt) inbox.push({ at: t + rtt / 2, x: server.x + offset, y: server.y });
    while (inbox.length && inbox[0]!.at <= t) {
      const p = inbox.shift()!;
      if (client.reconcile(p.x, p.y, t, rtt, t) === "snap") snaps++;
    }
    cl.push([t, client.x, client.y]);
    sv.set(Math.round(t), [server.x + offset, server.y]);
  }
  // The point of prediction: what I see now is where the server will have me rtt/2 later.
  let worst = 0;
  for (const [t, x, y] of cl) {
    if (t < 2000) continue;
    const later = sv.get(Math.round(t + rtt / 2)) ?? [...sv.entries()].find(([k]) => Math.abs(k - (t + rtt / 2)) < 9)?.[1];
    if (later) worst = Math.max(worst, Math.hypot(x - later[0], y - later[1]));
  }
  return { client, server, snaps, worst };
}

describe("own-blob prediction", () => {
  it("steers on my input at once, and at 300 ms round trip never snaps or drifts away", () => {
    const { snaps, worst } = run(300, 8);
    expect(snaps).toBe(0);
    expect(worst).toBeLessThan(6); // px, at 300 px/s: under 20 ms of motion
  });

  it("folds a real drift in smoothly: converges with no overshoot", () => {
    const c = new OwnPredictor();
    c.snap(1000, 1000, 0);
    const still: Input = { dirX: 0, dirY: 0, boost: false };
    let max = 0;
    for (let i = 1; i <= 60; i++) {
      const t = i * (1000 / 60);
      c.step(1 / 60, t, still, M, R0, ARENA);
      if (i % 3 === 0) c.reconcile(1030, 1000, t, 0, t); // the server says I am 30 px further right
      max = Math.max(max, c.x - 1000);
    }
    expect(c.x).toBeCloseTo(1030, 0);
    expect(max).toBeLessThanOrEqual(30.5);
  });

  it("snaps on a big jump (a pop, a respawn at GO)", () => {
    const c = new OwnPredictor();
    c.snap(500, 500, 0);
    c.step(1 / 60, 16, { dirX: 0, dirY: 0, boost: false }, M, R0, ARENA);
    expect(c.reconcile(3000, 3000, 16, 0, 16)).toBe("snap");
    expect(c.x).toBeCloseTo(3000, 0);
  });

  it("never predicts through a wall", () => {
    const c = new OwnPredictor();
    c.snap(40, 2000, 0);
    for (let i = 1; i <= 60; i++) c.step(1 / 60, i * 16, { dirX: -1, dirY: 0, boost: false }, M, R0, ARENA);
    expect(c.x).toBeGreaterThanOrEqual(R0 * 0.65 - 1e-9);
    expect(c.vx).toBe(0);
  });
});
