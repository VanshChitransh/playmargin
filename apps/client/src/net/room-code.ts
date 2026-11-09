// Private rooms: a 4-letter code (the server accepts exactly /^[A-Z]{4}$/) and the link a
// friend opens to land in the same warm-up lobby.

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: they read as 1 and 0 when typed

/** A fresh random room code. */
export function newRoomCode(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => LETTERS[Math.floor(rand() * LETTERS.length)]).join("");
}

export const roomLink = (code: string): string => `${location.origin}/#/r/${code}`;

/** Native share sheet on phones, clipboard elsewhere. Resolves with what happened. */
export async function shareRoom(code: string): Promise<"shared" | "copied" | "failed"> {
  const url = roomLink(code);
  const data = { title: "MARGIN", text: `Beat me in MARGIN. Room ${code}.`, url };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
