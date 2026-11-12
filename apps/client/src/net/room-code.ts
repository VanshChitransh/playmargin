// Private rooms: a 4-letter code (the server accepts exactly /^[A-Z]{4}$/) and the link a
// friend opens to land in the same warm-up lobby.

import { shareLink } from "../share/link";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: they read as 1 and 0 when typed

/** A fresh random room code. */
export function newRoomCode(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => LETTERS[Math.floor(rand() * LETTERS.length)]).join("");
}

/** The only codes the server accepts; anything else in a /r/ link is rejected before use. */
export const isRoomCode = (c: string): boolean => /^[A-Z]{4}$/.test(c);

export const roomLink = (code: string): string => `${location.origin}/r/${code}`;

/** Share the room link (share sheet on phones, clipboard elsewhere). */
export const shareRoom = (code: string): ReturnType<typeof shareLink> => shareLink(`Beat me in MARGIN. Room ${code}.`, roomLink(code));
