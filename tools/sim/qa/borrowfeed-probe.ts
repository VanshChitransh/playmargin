// QA-C3.2 borrow-and-feed at engine level: A borrows to the cap, then partner B eats A. Does any of
// the vault's loan reach B? Expected (RULES A2): the debt is repaid to the vault first, B gains only
// 70% of A's equity, 30% scatters, and the books stay exact.
import { MICRO, step, equity } from "@margin/core";
import { leak, makeBlob, makeWorld } from "../../../packages/core/src/testkit";
const u = (x: number) => Math.round(x * MICRO);
const a = makeBlob({ id: "a", mass: u(80) });
const b = makeBlob({ id: "b", mass: u(400), x: 2500, y: 2500 });
const w = makeWorld([a, b]);
// A holds BOOST far from B for 2 s of ticks.
for (let t = 1; t <= 120; t++) step(w, new Map([["a", { seq: t, dirX: -1, dirY: 0, boost: true, repay: false, cashout: false }]]), t);
const debt = a.debt, eqA = equity(a), massA = a.mass, repaidBefore = w.vault.repaid;
a.x = b.x; a.y = b.y; // B now covers A
const ev = step(w, new Map(), 121);
const eat = w.pendingLog.find((e) => e.type === "EAT");
console.log(JSON.stringify({
  aBorrowed: debt / MICRO, aMass: massA / MICRO, aEquity: eqA / MICRO,
  eat: eat?.data, eatEvent: ev.find((e) => e.type === "eat"),
  vaultRepaidByEat: (w.vault.repaid - repaidBefore) / MICRO,
  bGainedShareOfAEquity: eat && eat.type === "EAT" ? +(eat.data.gained / eqA).toFixed(4) : null,
  leakMicro: leak(w),
}));
