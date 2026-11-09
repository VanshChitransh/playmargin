// Join refusals from the server, turned into game words for the status line.

/**
 * A join error in game words, or "" when the server simply did not answer (offline practice
 * needs no excuse then). Unknown refusals show the server's own reason.
 */
export function refusalWords(message: string): string {
  if (!message || /timeout|failed to fetch|fetch failed|networkerror|econnrefused|websocket|load failed/i.test(message)) return "";
  if (/credit/i.test(message)) return "You are out of free credits for today. They top up tomorrow.";
  if (/full|restarting|too many|rate|429/i.test(message)) return "Arenas are busy right now. Try again in a minute.";
  if (/already in this match/i.test(message)) return "Your blob is still in another match in this browser.";
  return `The server said: ${message}`;
}
