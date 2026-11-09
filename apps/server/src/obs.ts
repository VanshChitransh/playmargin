// Observability without a dependency: one JSON object per line on stdout/stderr (journald keeps
// them, `journalctl -u margin-server -o cat | jq` reads them) and tick timings for /health.

type Fields = Record<string, unknown>;

function line(level: "info" | "warn" | "error", event: string, fields: Fields = {}): string {
  const f: Fields = {};
  for (const [k, v] of Object.entries(fields)) f[k] = v instanceof Error ? v.message : v;
  return JSON.stringify({ t: new Date().toISOString(), level, event, ...f });
}

export const log = {
  info: (event: string, fields?: Fields) => console.log(line("info", event, fields)),
  warn: (event: string, fields?: Fields) => console.warn(line("warn", event, fields)),
  error: (event: string, fields?: Fields) => console.error(line("error", event, fields)),
};

/** Settler gas money: a 100 Tgas call needs ~0.101 NEAR free, so warn under 0.12. Null until checked. */
export const SETTLER_LOW_NEAR = 0.12;
export const settler = { near: null as number | null, low: false, checkedAt: 0 };

/** Tick durations in ms since boot: count, mean, max and p99 from 0.1 ms buckets up to 100 ms. */
export const ticks = {
  count: 0,
  sumMs: 0,
  maxMs: 0,
  buckets: new Uint32Array(1001),
  record(ms: number): void {
    this.count++;
    this.sumMs += ms;
    if (ms > this.maxMs) this.maxMs = ms;
    this.buckets[Math.min(1000, Math.floor(ms * 10))]!++;
  },
  summary() {
    let seen = 0;
    let p99 = 0;
    for (let i = 0; this.count > 0 && i < this.buckets.length; i++) {
      seen += this.buckets[i]!;
      if (seen >= this.count * 0.99) {
        p99 = (i + 1) / 10;
        break;
      }
    }
    const r = (x: number) => Math.round(x * 100) / 100;
    return { count: this.count, meanMs: r(this.count ? this.sumMs / this.count : 0), p99Ms: r(p99), maxMs: r(this.maxMs) };
  },
};
