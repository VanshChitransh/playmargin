import { describe, expect, it } from "vitest";
import { isRoomCode, newRoomCode } from "./room-code";

describe("room codes", () => {
  it("are 4 capital letters the server accepts, never I or O", () => {
    for (let i = 0; i < 500; i++) {
      const c = newRoomCode();
      expect(c).toMatch(/^[A-Z]{4}$/);
      expect(c).not.toMatch(/[IO]/);
    }
  });

  it("rejects anything else from a link, markup included", () => {
    expect(isRoomCode("ABCD")).toBe(true);
    for (const bad of ["abcd", "ABC", "ABCDE", "AB1D", '<img src=x onerror=alert(1)>', ""]) expect(isRoomCode(bad)).toBe(false);
  });
});
