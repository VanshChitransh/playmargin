// Which game server a free match uses: Mumbai (home, also paid, relayer and stats) or US East.
// On first need the page pings each /health a few times and keeps the fastest one that answers.
// A private room link carries its host's server (?s=us) so a friend lands in the same room.
import { ENDPOINT } from "./endpoint";

export interface Region {
  /** Short key used in links (?s=us). */
  id: string;
  /** What the lobby shows ("Server: US East"). */
  label: string;
  url: string;
}

/** Home server: paid play, relayer, stats and every match id without a hint. */
export const HOME: Region = { id: "in", label: "Mumbai", url: ENDPOINT };
const US_URL = import.meta.env.VITE_US_SERVER_URL as string | undefined;
/** Every server that hosts free matches, home first. */
export const REGIONS: Region[] = US_URL ? [HOME, { id: "us", label: "US East", url: US_URL }] : [HOME];

const SAMPLES = 3;
const TIMEOUT_MS = 1500;

/** The region whose median ping is lowest; dead ones (no sample) are skipped, none alive gives home. */
export function pickFastest(results: Array<{ region: Region; ms: number[] }>): Region {
  let best: { region: Region; med: number } | null = null;
  for (const { region, ms } of results) {
    if (!ms.length) continue;
    const s = [...ms].sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)]!;
    if (!best || med < best.med) best = { region, med };
  }
  return best?.region ?? HOME;
}

/** The region a link hint names (?s=us), or null for none or an unknown one. */
export function regionOf(hint: string | null | undefined): Region | null {
  return REGIONS.find((r) => r.id === hint) ?? null;
}

async function ping(url: string): Promise<number | null> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${url}/health`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? performance.now() - t0 : null;
  } catch {
    return null;
  }
}

let picked: Promise<Region> | null = null;

/** The free-play server for this page load (pinged once, then cached). One region skips the pings. */
export function freeRegion(): Promise<Region> {
  if (REGIONS.length === 1) return Promise.resolve(HOME);
  picked ??= Promise.all(
    REGIONS.map(async (region) => {
      const ms: number[] = [];
      // In series: parallel samples to one server would share one TLS handshake and lie.
      for (let i = 0; i < SAMPLES; i++) {
        const t = await ping(region.url);
        if (t === null) break; // down or too slow: one miss is enough to skip it
        ms.push(t);
      }
      return { region, ms };
    }),
  ).then(pickFastest);
  return picked;
}
