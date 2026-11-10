// Player names (Mini Militia style: type one, play with it). The server runs this on every
// join, so whatever a client sends, a label is plain short text: no HTML, no prompt tricks
// for the agent commander, and no posing as a labelled agent or drone.

// 15 characters: the server label (apps/server/src/rooms/label.ts) shows 14 plus an ellipsis past that.
export const NAME_MAX = 15;

/** A safe display name from untrusted input, or null (caller falls back to "Player N"). */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  if (!s || /^(agent|drone|bot)\b/i.test(s)) return null;
  return s;
}
