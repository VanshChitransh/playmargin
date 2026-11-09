import { describe, expect, it } from "vitest";
import { newRoomCode } from "./room-code";

describe("room codes", () => {
  it("are 4 capital letters the server accepts, never I or O", () => {
    for (let i = 0; i < 500; i++) {
      const c = newRoomCode();
      expect(c).toMatch(/^[A-Z]{4}$/);
      expect(c).not.toMatch(/[IO]/);
    }
  });
});
