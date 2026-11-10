// This tab's seat token, kept with the route it was taken on, so a reload resumes the match
// but opening a different route (a friend's #/r/CODE after a public match) never does.

/** Where a seat lives: "judge", a private room code, or "play" (public and paid both use #/play). */
export type SeatTarget = string;

interface Stored {
  t: string;
  at: SeatTarget;
}

/** The stored form of a seat token for a target. */
export function encodeSeat(t: string, at: SeatTarget): string {
  return JSON.stringify({ t, at } satisfies Stored);
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
  set(t: string, at: SeatTarget): void {
    try {
      sessionStorage.setItem(KEY, encodeSeat(t, at));
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
