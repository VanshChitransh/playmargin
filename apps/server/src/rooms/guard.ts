// Abuse limits that sit in front of the game: joins per IP (each free join can mint a guest user
// and a daily top-up) and a cap on live rooms (each one runs a 60 Hz loop). In memory, per process.
// ponytail: single droplet, so in-process counters are enough; move to Redis if we ever run >1 node.

/** Sliding-window counter: at most `max` hits per `windowMs` per key. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and says whether it is within the limit. */
  allow(key: string, nowMs = Date.now()): boolean {
    if (this.hits.size > 10_000) for (const [k, ts] of this.hits) if (nowMs - ts[ts.length - 1]! > this.windowMs) this.hits.delete(k);
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    const ok = recent.length < this.max;
    if (ok) recent.push(nowMs);
    this.hits.set(key, recent);
    return ok;
  }
}

/** 12 joins a minute per IP: a real player needs about one per match (~2 min). */
export const joinLimit = new RateLimiter(12, 60_000);

/** Live rooms on this process; onCreate refuses past MAX_ROOMS (env, default 100 = 1,200 seats). */
export const rooms = { live: 0, max: Number(process.env.MAX_ROOMS ?? 100) };

/** Client IP as Caddy reports it (X-Real-IP is set by our Caddyfile, never trusted from clients directly). */
export function clientIp(ctx: { ip?: string | string[] } | undefined): string {
  const ip = Array.isArray(ctx?.ip) ? ctx.ip[0] : ctx?.ip;
  return (ip ?? "unknown").split(",")[0]!.trim();
}
