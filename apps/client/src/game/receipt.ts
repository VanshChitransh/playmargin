// The results screen is a money receipt (inspiration.md 1.7): line items that add up to
// the final number, built from the same events the server broadcasts. Food is the
// remainder, so the receipt always sums exactly even where a line is an estimate.
import { R, type BlobView, type GameEventMsg, type RateTier } from "@margin/core";
import { displayName, interestPerS } from "../hud/logic";

export interface Line {
  label: string;
  amount: number;
}

export interface Outcome {
  kind: "cashed" | "survived" | "popped";
  start: number;
  end: number;
  lines: Line[];
  rank: number;
  of: number;
  /** agar.io-style match stats for the results screen. */
  stats: Stats;
  /** Death details for the LIQUIDATED screen. */
  death?: {
    by: string;
    keeper: boolean;
    leverage: number;
    redS: number;
    /** Highest leverage this match (mass / equity), for the greed score. */
    peakLeverage: number;
    /** Match second when the ring last left green before the pop: the moment to REPAY. */
    warnAtS: number | null;
    /** Eaten by a bigger blob (not a liquidation): no certificate, different stamp. */
    eaten?: boolean;
  };
}

export interface Stats {
  foodEaten: number;
  /** Seconds alive after GO. */
  aliveS: number;
  blobsEaten: number;
  /** Best leaderboard place reached (1 = top). */
  topRank: number;
  peakEquity: number;
}

/** A pellet that vanished this close to my edge was eaten by me. */
const FOOD_REACH = 12;

export class Receipt {
  private stats: Stats = { foodEaten: 0, aliveS: 0, blobsEaten: 0, topRank: 0, peakEquity: 0 };
  private food = new Map<number, { x: number; y: number }>();
  private gains = new Map<string, number>();
  private spikes = 0;
  private fees = 0;
  private interest = 0;
  private lastMe?: BlobView;
  private redSince: number | null = null;
  private redS = 0;
  private peakLev = 1;
  private warnAt: number | null = null;
  private death?: Outcome["death"];
  private labels = new Map<string, string>();

  constructor(private me: string, private start: number = R.ENTRY_FREE * R.START_MASS_RATIO) {}

  /** Feed every frame: remembers my last alive state and how long I have been red. */
  frame(
    blobs: BlobView[],
    tier: RateTier,
    nowMs: number,
    dtS: number,
    rateBps?: number,
    elapsedS?: number,
    food?: ReadonlyArray<{ id: number; x: number; y: number }>,
  ): void {
    for (const b of blobs) this.labels.set(b.id, displayName(b));
    const me = blobs.find((b) => b.id === this.me);
    if (food) this.countFood(food, me);
    if (!me || me.state !== "alive") return;
    this.lastMe = me;
    if (elapsedS !== undefined) {
      this.stats.aliveS += dtS;
      this.stats.peakEquity = Math.max(this.stats.peakEquity, me.equity);
      const rank = blobs.filter((b) => b.kind !== "drone" && b.state === "alive" && b.equity > me.equity).length + 1;
      this.stats.topRank = this.stats.topRank ? Math.min(this.stats.topRank, rank) : rank;
    }
    this.interest += interestPerS(me.owe, tier, rateBps) * dtS;
    if (me.equity > 0) this.peakLev = Math.max(this.peakLev, (me.equity + me.owe) / me.equity);
    if (me.ring === "green") this.warnAt = null;
    else if (elapsedS !== undefined) this.warnAt ??= elapsedS;
    if (me.ring === "red") this.redSince ??= nowMs;
    else this.redSince = null;
    this.redS = this.redSince === null ? 0 : (nowMs - this.redSince) / 1000;
  }

  event(e: GameEventMsg): void {
    const add = (k: string, v: number): void => void this.gains.set(k, (this.gains.get(k) ?? 0) + v);
    switch (e.type) {
      case "boost":
        if (e.blob === this.me) this.fees += e.amount * R.BORROW_FEE;
        break;
      case "spikeHit":
        if (e.blob === this.me) this.spikes += e.damage;
        break;
      case "eat":
        if (e.by === this.me) {
          add(`Ate ${this.name(e.victim)}`, e.gained);
          this.stats.blobsEaten++;
        }
        if (e.victim === this.me) this.died(this.name(e.by), false, true);
        break;
      case "pop":
        if (e.by === this.me) {
          add(`Popped ${this.name(e.victim)}`, e.bounty);
          this.stats.blobsEaten++;
        }
        if (e.victim === this.me) this.died(e.keeper || !e.by ? "the vault" : this.name(e.by), e.keeper, false);
        break;
    }
  }

  private countFood(food: ReadonlyArray<{ id: number; x: number; y: number }>, me: BlobView | undefined): void {
    const now = new Map(food.map((f) => [f.id, { x: f.x, y: f.y }] as const));
    if (me && me.state === "alive") {
      for (const [id, p] of this.food) {
        if (!now.has(id) && Math.hypot(p.x - me.x, p.y - me.y) <= me.radius + FOOD_REACH) this.stats.foodEaten++;
      }
    }
    this.food = now;
  }

  private died(by: string, keeper: boolean, eaten: boolean): void {
    const m = this.lastMe;
    this.death = {
      by,
      keeper,
      leverage: m && m.equity > 0 ? (m.equity + m.owe) / m.equity : 0,
      redS: this.redS,
      peakLeverage: this.peakLev,
      warnAtS: this.warnAt,
      eaten,
    };
  }

  get popped(): boolean {
    return !!this.death;
  }

  /** Final receipt from the last frame (rank by equity among non-drones). */
  outcome(blobs: BlobView[]): Outcome {
    const me = blobs.find((b) => b.id === this.me);
    const ranked = blobs.filter((b) => b.kind !== "drone").sort((a, b) => b.equity - a.equity);
    const kind = this.death || me?.state === "popped" ? "popped" : me?.state === "cashed" ? "cashed" : "survived";
    const end = kind === "popped" ? 0 : Math.max(0, me?.equity ?? 0);
    const known: Line[] = [...this.gains].map(([label, amount]) => ({ label, amount }));
    if (this.spikes) known.push({ label: "Spikes", amount: -this.spikes });
    if (this.interest) known.push({ label: "Interest", amount: -this.interest });
    if (this.fees) known.push({ label: "Borrow fees", amount: -this.fees });
    if (kind === "popped") known.push({ label: "Liquidated", amount: 0 });
    const food = end - this.start - known.reduce((s, l) => s + l.amount, 0);
    const lines = kind === "popped" ? [{ label: this.death?.eaten ? "Eaten" : "Lost to liquidation", amount: -this.start }] : [{ label: "Food and moves", amount: food }, ...known];
    return {
      kind,
      start: this.start,
      end,
      lines: lines.filter((l) => Math.abs(l.amount) >= 0.005 || l.label === "Liquidated"),
      rank: Math.max(1, ranked.findIndex((b) => b.id === this.me) + 1),
      of: ranked.length,
      death: this.death,
      stats: { ...this.stats, aliveS: Math.round(this.stats.aliveS), topRank: this.stats.topRank || Math.max(1, ranked.findIndex((b) => b.id === this.me) + 1) },
    };
  }

  private name(id: string): string {
    return this.labels.get(id) ?? id;
  }
}
