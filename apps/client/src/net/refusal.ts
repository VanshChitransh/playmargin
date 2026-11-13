// Join refusals from the server, turned into game words for the status line.

/**
 * A join error in game words, or "" when the server simply did not answer (offline practice
 * needs no excuse then). Unknown refusals show the server's own reason.
 */
export function refusalWords(message: string): string {
  if (!message || /timeout|failed to fetch|fetch failed|networkerror|econnrefused|websocket|load failed/i.test(message)) return "";
  if (/credit/i.test(message)) return "You are out of free credits for today. They top up tomorrow.";
  // The per network join limit is not a busy server: say so, a judge behind a shared office IP can hit it (F10).
  if (/too many joins|slow down|\b429\b/i.test(message)) return "Too many joins from your network. Try again in a few seconds.";
  if (/full|restarting|rate/i.test(message)) return "Arenas are busy right now. Try again in a minute.";
  if (/already in this match/i.test(message)) return "Your blob is still in another match in this browser.";
  // A draining server answers matchmaking with 503 and an empty JSON body (Colyseus, before our routes).
  if (/end of json|json input|\b503\b|service unavailable/i.test(message)) return "The server is restarting for an update. Try again in a few seconds.";
  return `The server said: ${message}`;
}

/** Words for any failed join: the refusal reason, or for silence a plain "unreachable" (never empty). */
export function joinFailWords(message: string): string {
  return refusalWords(message) || "We can't reach the arena right now. Check your connection and retry, or practice offline (nothing counts).";
}
