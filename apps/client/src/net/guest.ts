// This browser's guest key, kept light (no game SDK) so any page can read it.

/** Stable per-browser guest key; storage can be blocked (private mode), so fall back to memory. */
export function guestKey(): string {
  try {
    const k = localStorage.getItem("margin.guest") ?? crypto.randomUUID();
    localStorage.setItem("margin.guest", k);
    return k;
  } catch {
    return crypto.randomUUID();
  }
}
