// Display labels for humans: at most 15 characters everywhere (blob, leaderboard, match log),
// so every client agrees. Long wallet names keep their start plus an ellipsis. The full
// accountId stays on the seat untouched, settlement never reads the label.

export const LABEL_MAX = 15;

/** Trim, then cap at LABEL_MAX code points: longer becomes the first 14 plus "…". */
export function displayLabel(name: string): string {
  const cps = [...name.trim()];
  return cps.length <= LABEL_MAX ? cps.join("") : `${cps.slice(0, LABEL_MAX - 1).join("")}…`;
}
