// One tick of a match, in the fixed order from DEVELOPMENT C3 (RULES + EDGE-CASES).
// Order matters: damage then keeper check, pops before eats (GR-03), largest eater first (GR-14).
// `inputs` holds commands that arrived since the last tick: cashout is a tap, boost and repay are held.
import * as C from "./constants";
import {
  accrueInterest, boostHold, canBoost, cashOut, eat, flushBoost, flushRepay, hitSpike, keeperCheck, liquidate, matchT, outweighs,
  repayHold, ring, zoneTick,
} from "./economy";
import { checkInvariant } from "./invariant";
import { move, radius, speed } from "./motion";
import type { GameEventMsg, InputCmd } from "./protocol";
import type { Blob, Micro, World } from "./types";
import { toUnits } from "./units";
import { refillFood } from "./food";
import { ranking, respawnSpikes, spikeRadius } from "./world";

const T = C.sToTicks;
const INPUT_EXPIRE_T = Math.round((C.R.INPUT_EXPIRE_MS * C.R.TICK_HZ) / 1000);
const RED_GRACE_T = Math.round((C.R.RED_GRACE_MS * C.R.TICK_HZ) / 1000);
const DT = 1 / C.R.TICK_HZ;
type Ev = GameEventMsg[];

const live = (w: World): Blob[] => [...w.blobs.values()].filter((b) => b.state === "alive");
const players = (w: World): Blob[] => live(w).filter((b) => b.kind !== "drone");
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const touching = (a: Blob, b: Blob): boolean => dist(a, b) < radius(a.mass) + radius(b.mass);
const shielded = (b: Blob, tick: number): boolean => tick < b.shieldUntil;
/** Heaviest first, id as tie-break, so every resolution order is deterministic. */
const byMassDesc = (a: Blob, b: Blob): number => b.mass - a.mass || (a.id < b.id ? -1 : 1);

function cancelCashout(b: Blob, reason: "contact" | "spike" | "threat", ev: Ev): void {
  if (!b.cashout) return;
  b.cashout = null;
  ev.push({ type: "cashoutCancel", blob: b.id, reason });
}

function canStartCashout(w: World, b: Blob, tick: number): boolean {
  const t = matchT(w, tick);
  return (
    !b.cashout && b.kind !== "drone" && t >= T(C.R.CASHOUT_OPEN_S) && t < T(C.R.CASHOUT_CLOSE_S) &&
    ring(b) !== "red" && !shielded(b, tick) && tick - b.lastThreatAt >= T(C.R.CASHOUT_NO_THREAT_S)
  );
}

const REPAY_MIN_HOLD_T = T(C.R.REPAY_COOLDOWN_S);
const BOOST_MIN_HOLD_T = T(C.R.BOOST_MIN_HOLD_S);
const BURST_COOLDOWN_T = T(C.R.BOOST_BURST_COOLDOWN_S);
const SPUTTER_T = T(C.R.BOOST_EMPTY_SPUTTER_S);
const R_BURST = C.R.BOOST_BURST_MULT;

// 1 + 3: store fresh inputs, apply taps, then zero any held input older than 250 ms and run held
// REPAY and BOOST off what is left, so a lost "release" message can't keep borrowing past 250 ms.
function applyInputs(w: World, inputs: Map<string, InputCmd>, tick: number, ev: Ev): void {
  for (const [id, cmd] of inputs) {
    const b = w.blobs.get(id);
    if (!b || b.state !== "alive") continue;
    b.lastInput = cmd;
    b.lastInputAt = tick;
    // Drones hold no stake: they only steer, so BOOST, REPAY and cash-out never apply to them.
    if (w.phase !== "LIVE" || b.kind === "drone") continue;
    if (cmd.cashout && canStartCashout(w, b, tick)) {
      b.cashout = { startedAt: tick };
      ev.push({ type: "cashoutStart", blob: b.id });
    }
  }
  for (const b of w.blobs.values()) {
    const cmd = b.lastInput && tick - b.lastInputAt <= INPUT_EXPIRE_T ? b.lastInput : null;
    b.dirX = cmd ? cmd.dirX : 0;
    b.dirY = cmd ? cmd.dirY : 0;
    if (w.phase !== "LIVE" || b.state !== "alive" || b.kind === "drone") continue;
    // REPAY wins over BOOST while both are held: paying back and borrowing in one breath is noise.
    const repayPressed = cmd?.repay === true;
    if (repayPressed && !b.repayHeld) b.repayMinUntil = tick + REPAY_MIN_HOLD_T;
    b.repayHeld = repayPressed;
    if (repayPressed || tick < b.repayMinUntil) {
      b.boostHeld = cmd?.boost === true; // no burst from a BOOST already held when REPAY lets go
      repay(w, b, tick, ev);
      continue;
    }
    const repaid = flushRepay(w, b, tick);
    if (repaid > 0) ev.push({ type: "repay", blob: b.id, amount: toUnits(repaid) });
    // A press holds for at least BOOST_MIN_HOLD_S, so a tap always borrows something you can see.
    const pressed = cmd?.boost === true;
    if (pressed && !b.boostHeld && canBoost(w, b, tick)) {
      b.boostMinUntil = tick + BOOST_MIN_HOLD_T;
      if (tick >= b.burstReadyAt) {
        // Answer the press inside one frame: a burst on top of velocity, decaying in motion.move.
        const kick = R_BURST * speed(Math.max(0, b.mass - b.debt));
        const len = Math.hypot(b.dirX, b.dirY);
        if (len > 0) [b.vx, b.vy] = [b.vx + (b.dirX / len) * kick, b.vy + (b.dirY / len) * kick];
        b.burst = kick;
        b.burstReadyAt = tick + BURST_COOLDOWN_T;
      }
    }
    const holding = pressed || tick < b.boostMinUntil;
    b.boostHeld = pressed;
    // Held and allowed: borrow this tick. Released, or not allowed any more: the hold is logged.
    if (holding && boostHold(w, b, tick) > 0) continue;
    // Still held but the tank ran dry (or BOOST got blocked): sputter down instead of a hard stop.
    if (holding && b.boostUntil === tick) b.sputterUntil = tick + SPUTTER_T;
    const amt = flushBoost(w, b, tick);
    if (amt > 0) ev.push({ type: "boost", blob: b.id, amount: toUnits(amt) });
  }
}

/**
 * One tick of held REPAY plus its events. Leaving red on it is a "clutch save" (server-confirmed,
 * never predicted), flagged clutch when a bigger blob or a drone was within CLUTCH_RADIUS_PX.
 */
function repay(w: World, b: Blob, tick: number, ev: Ev): void {
  const wasRed = ring(b) === "red";
  let amt = 0;
  boostEvent(w, b, () => (amt = repayHold(w, b, tick)), ev);
  if (amt <= 0) return;
  if (wasRed && ring(b) !== "red") {
    const r = radius(b.mass);
    const clutch = live(w).some(
      (o) => o !== b && (o.kind === "drone" || outweighs(o, b)) && dist(o, b) - radius(o.mass) - r <= C.R.CLUTCH_RADIUS_PX,
    );
    ev.push({ type: "clutchSave", blob: b.id, clutch });
  }
}

/** Run fn and tell clients about any held loan or repayment it logged, so every part of a long hold shows. */
function boostEvent(w: World, b: Blob, fn: () => unknown, ev: Ev): void {
  const [borrow, from] = [b.pendingBorrow, w.pendingLog.length];
  fn();
  if (borrow > 0 && b.pendingBorrow === 0) ev.push({ type: "boost", blob: b.id, amount: toUnits(borrow) });
  for (const e of w.pendingLog.slice(from)) {
    if (e.type === "REPAY" && e.data.blob === b.id) ev.push({ type: "repay", blob: b.id, amount: toUnits(e.data.amount) });
  }
}

function keeper(w: World, b: Blob, tick: number, ev: Ev): void {
  const r = keeperCheck(w, b, tick);
  if (r) ev.push({ type: "pop", by: null, victim: b.id, bounty: toUnits(r.bounty), keeper: true });
}

// 6: spikes are consumed on hit, respawn in 3 s, and give 1 s immunity (GR-01).
function spikes(w: World, tick: number, ev: Ev): void {
  respawnSpikes(w, tick);
  for (const b of players(w)) {
    if (tick < b.spikeImmuneUntil || shielded(b, tick)) continue;
    const r = radius(b.mass);
    const s = w.spikes.find((s) => s.respawnAt === null && dist(s, b) < r + spikeRadius(s));
    if (!s) continue;
    const dmg = hitSpike(w, b, s.id, s.big, tick);
    s.respawnAt = tick + T(C.R.SPIKE_RESPAWN_S);
    b.spikeImmuneUntil = tick + T(C.R.SPIKE_IMMUNITY_S);
    ev.push({ type: "spikeHit", blob: b.id, big: s.big, damage: toUnits(dmg) });
    cancelCashout(b, "spike", ev);
    keeper(w, b, tick, ev);
  }
}

// 7: the zone shrinks linearly to 25% by the bell; outside it, 4% of mass each second to food.
function zone(w: World, tick: number, ev: Ev): void {
  const duel = w.mode === "paid" && players(w).filter((b) => b.kind === "human").length <= 2;
  const t = matchT(w, tick);
  if (t < T(duel ? C.R.ZONE_START_S_DUEL : C.R.ZONE_START_S)) return;
  const left = C.MATCH_TICKS - t;
  if (left > 0) w.zone.r -= (w.zone.r - w.zone.targetR) / left;
  // Charged once per second like interest, so the Squeeze adds one food piece per blob per second, not 60.
  if (t % T(1) !== 0) return;
  for (const b of players(w)) {
    if (dist(b, { x: w.zone.cx, y: w.zone.cy }) <= w.zone.r) continue;
    zoneTick(w, b);
    keeper(w, b, tick, ev);
  }
}

// 9: red for 150 ms and touched = popped by the heaviest toucher. Also marks cash-out threats.
function pops(w: World, tick: number, ev: Ev): void {
  const all = live(w);
  for (const b of all) {
    if (b.kind === "drone") continue;
    for (const o of all) {
      if (o === b || o.kind === "drone" || ring(o) === "red" || !outweighs(o, b) || !touching(o, b)) continue;
      b.lastThreatAt = tick;
      cancelCashout(b, "contact", ev);
    }
  }
  const victims = all.filter(
    (v) => v.kind !== "drone" && v.redSince !== null && tick - v.redSince >= RED_GRACE_T && !shielded(v, tick),
  );
  for (const v of victims.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (v.state !== "alive") continue;
    const popper = live(w)
      .filter((o) => o !== v && !shielded(o, tick) && touching(o, v))
      .sort(byMassDesc)[0];
    if (!popper) continue;
    const r = liquidate(w, v, popper, tick);
    ev.push({ type: "pop", by: popper.id, victim: v.id, bounty: toUnits(r.bounty), keeper: false });
  }
}

// 10: blob eats resolve heaviest eater first; shielded blobs eat food only (GR-03), red blobs eat
// nothing: REPAY is the only way out of red, or greedy players eat their way back (balance B, 9 Nov).
function eats(w: World, tick: number, ev: Ev): void {
  const ps = players(w).sort(byMassDesc);
  // Free-room agents can't eat a human in the first 30 s: a first-timer gets to find their feet.
  const humanSafe = matchT(w, tick) < T(C.R.AGENT_NO_EAT_HUMAN_S);
  for (const e of ps) {
    if (e.state !== "alive" || ring(e) === "red" || shielded(e, tick)) continue;
    for (const v of ps) {
      if (v === e || v.state !== "alive" || shielded(v, tick) || !outweighs(e, v)) continue;
      if (humanSafe && e.kind === "agent" && v.kind === "human") continue;
      if (dist(e, v) >= radius(e.mass)) continue;
      const gained = eat(w, e, v, tick);
      ev.push({ type: "eat", by: e.id, victim: v.id, gained: toUnits(gained) });
    }
  }
  // Hot loop (food x blobs every tick): radii once per tick, squared distances, no sqrt. A pellet is
  // eaten when the blob touches the pellet as drawn (FOOD_RADIUS_PX), so the hitbox is what you see.
  const eaters = players(w).filter((b) => ring(b) !== "red").sort(byMassDesc).map((b) => ({ b, r2: (radius(b.mass) + C.R.FOOD_RADIUS_PX) ** 2 }));
  w.food = w.food.filter((f) => {
    const e = eaters.find(({ b, r2 }) => (b.x - f.x) ** 2 + (b.y - f.y) ** 2 < r2);
    if (e) e.b.mass += f.mass;
    return !e;
  });
}

// 11: a 4 s channel; red cancels it, success repays debt and leaves with equity.
function cashouts(w: World, tick: number, ev: Ev): void {
  for (const b of players(w)) {
    if (!b.cashout) continue;
    if (ring(b) === "red") cancelCashout(b, "threat", ev);
    else if (tick - b.cashout.startedAt >= T(C.R.CASHOUT_CHANNEL_S)) {
      ev.push({ type: "cashedOut", blob: b.id, amount: toUnits(cashOut(w, b, tick)) });
    }
  }
}

// 12: survivors settle at equity, and the final ranking is taken right there, so leftover food is
// a bonus and never a rank changer. Leftover food is split equally among everyone alive at the bell,
// agents too (dust to reserve). Nobody alive: it all goes to the vault as LP yield, since paying
// popped players would refund the very greed that got them liquidated (Vansh, 9 Nov).
function endMatch(w: World, tick: number, ev: Ev): void {
  const survivors = players(w);
  for (const b of survivors) cashOut(w, b, tick);
  for (const d of live(w)) cashOut(w, d, tick); // drones leave with their bounties
  const rankingAtBell = ranking(w);
  const leftover: Micro = w.food.reduce((s, f) => s + f.mass, w.foodPool);
  w.food = [];
  w.foodPool = 0;
  const toVault = survivors.length > 0 ? 0 : leftover;
  w.vault.interest += toVault;
  const each = survivors.length > 0 ? Math.floor(leftover / survivors.length) : 0;
  for (const b of survivors) {
    if (each === 0) break;
    b.payout += each;
    w.cashedOut += each;
    w.pendingLog.push({ type: "CASHOUT", tick, data: { blob: b.id, amount: each } });
  }
  const dust = leftover - toVault - each * survivors.length;
  w.reserve += dust;
  w.phase = "ENDED";
  const finalMasses: Record<string, Micro> = {};
  for (const b of w.blobs.values()) finalMasses[b.id] = b.payout;
  w.pendingLog.push({ type: "MATCH_END", tick, data: { tick, finalMasses, dust, toVault, ranking: rankingAtBell } });
  ev.push({ type: "phase", phase: "ENDED", tick }, { type: "matchEnd", tick });
}

/** Advance the world to `tick` (one tick at TICK_HZ). Returns what the clients should see. */
export function step(w: World, inputs: Map<string, InputCmd>, tick: number): GameEventMsg[] {
  const ev: Ev = [];
  if (w.phase === "ENDED") return ev;
  w.tick = tick;
  // 1. expire inputs / 3. taps (taps only count while LIVE; warm-up ghosts just move)
  applyInputs(w, inputs, tick, ev);
  if (w.phase !== "LIVE") {
    for (const b of w.blobs.values()) move(b, DT, tick, w.arena);
    return ev;
  }
  // 2. phase timers
  const t = matchT(w, tick);
  if (t === T(C.R.LAST_CALL_S)) ev.push({ type: "lastCall", tick });
  // 4. move
  for (const b of live(w)) move(b, DT, tick, w.arena);
  // 5. interest, once per whole second
  if (t > 0 && t % T(C.R.INTEREST_ACCRUE_S) === 0) {
    for (const b of players(w)) {
      boostEvent(w, b, () => accrueInterest(w, b, tick), ev);
      keeper(w, b, tick, ev);
    }
  }
  // 6. spikes, 7. zone
  spikes(w, tick, ev);
  zone(w, tick, ev);
  // 8. ring: start or clear the red grace clock (ultra red already popped by the keeper)
  for (const b of players(w)) b.redSince = ring(b) === "red" ? (b.redSince ?? tick) : null;
  // 9. pops before 10. eats
  pops(w, tick, ev);
  eats(w, tick, ev);
  refillFood(w); // eaten pellets come back from the pot's food pool, never more than the target
  // 11. cash-out channels
  cashouts(w, tick, ev);
  // 12. the bell
  if (t >= C.MATCH_TICKS) endMatch(w, tick, ev);
  // 13. conservation, every tick (cheap: one pass over blobs and food)
  checkInvariant(w);
  return ev;
}
