// This tab's seat token, kept with the route it was taken on, so a reload resumes the match
// but opening a different route (a friend's #/r/CODE after a public match) never does.

/** Where a seat lives: "judge", a private room code, or "play" (public and paid both use #/play). */
export type SeatTarget = string;

interface Stored {
  t: string;
  at: SeatTarget;
  /** The match had started (after GO): losing this seat means a blob was left behind. */
  live?: boolean;
}

/** The stored form of a seat token for a target. */
export function encodeSeat(t: string, at: SeatTarget, live = false): string {
  return JSON.stringify({ t, at, live } satisfies Stored);
}

/** True when the stored seat for this target was in a match that had started. */
export function seatWasLive(raw: string | null, target: SeatTarget): boolean {
  if (!raw || seatToken(raw, target) === null) return false;
  try {
    return (JSON.parse(raw) as Partial<Stored>).live === true;
  } catch {
    return false;
  }
}

/** The token to resume for this target, or null. Old plain string tokens count as "play". */
export function seatToken(raw: string | null, target: SeatTarget): string | null {
  if (!raw) return null;
  let s: Stored;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    s = typeof v?.t === "string" && typeof v.at === "string" ? (v as Stored) : { t: raw, at: "play" };
  } catch {
    s = { t: raw, at: "play" };
  }
  return s.at === target ? s.t : null;
}

const KEY = "margin.seat";

/** sessionStorage: survives a reload, not a new tab. Private mode just joins a new room. */
export const seat = {
  get(target: SeatTarget): string | null {
    try {
      return seatToken(sessionStorage.getItem(KEY), target);
    } catch {
      return null;
    }
  },
  /** Was the held seat for this target in a started match (QA-B-10: only then warn about a lost blob). */
  wasLive(target: SeatTarget): boolean {
    try {
      return seatWasLive(sessionStorage.getItem(KEY), target);
    } catch {
      return false;
    }
  },
  set(t: string, at: SeatTarget, live = false): void {
    try {
      sessionStorage.setItem(KEY, encodeSeat(t, at, live));
    } catch {
      /* private mode */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing stored */
    }
  },
};
