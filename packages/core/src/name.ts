// Player names (Mini Militia style: type one, play with it). The server runs this on every
// join, so whatever a client sends, a label is plain short text: no HTML, no prompt tricks
// for the agent commander, and no posing as a labelled agent or drone, by prefix or by a bot's name.
import { BOT_NAMES } from "./botnames";

/** Bot names in lower case, so "greedy gus" or "GREEDY GUS 2" can't pass for the bot either. */
const BOT_LOWER = new Set<string>(BOT_NAMES.map((n) => n.toLowerCase()));

// 15 characters: the server label (apps/server/src/rooms/label.ts) shows 14 plus an ellipsis past that.
export const NAME_MAX = 15;

/** A safe display name from untrusted input, or null (caller falls back to "Player N"). */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  if (!s || /^(agent|drone|bot)\b/i.test(s)) return null;
  if (BOT_LOWER.has(s.toLowerCase().replace(/ \d+$/, ""))) return null; // botNames suffixes overflow names "Name 2"
  return s;
}
