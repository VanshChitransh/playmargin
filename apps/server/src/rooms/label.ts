// Display labels for humans: at most 15 characters everywhere (blob, leaderboard, match log),
// so every client agrees. Long wallet names keep their start plus an ellipsis. The full
// accountId stays on the seat untouched, settlement never reads the label.

export const LABEL_MAX = 15;

/** Trim, then cap at LABEL_MAX code points: longer becomes the first 14 plus "…". */
export function displayLabel(name: string): string {
  const cps = [...name.trim()];
  return cps.length <= LABEL_MAX ? cps.join("") : `${cps.slice(0, LABEL_MAX - 1).join("")}…`;
}

/** displayLabel, made unique in the room: a second "Gus" is "Gus 2", trimmed so it still fits 15. */
export function uniqueLabel(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = displayLabel(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const tail = ` ${n}`;
    const cps = [...base.replace(/…$/, "")];
    const label = `${cps.slice(0, LABEL_MAX - tail.length).join("").trimEnd()}${tail}`;
    if (!used.has(label)) return label;
  }
}
