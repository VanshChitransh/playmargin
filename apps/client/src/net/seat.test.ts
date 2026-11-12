import { describe, expect, it } from "vitest";
import { encodeSeat, seatToken, seatWasLive } from "./seat";

describe("seat resume follows the route", () => {
  it("resumes only on the route the seat was taken on", () => {
    const raw = encodeSeat("tok", "play");
    expect(seatToken(raw, "play")).toBe("tok");
    expect(seatToken(raw, "BVMT")).toBeNull();
    expect(seatToken(encodeSeat("r", "BVMT"), "BVMT")).toBe("r");
    expect(seatToken(raw, "judge")).toBeNull();
  });
  it("treats an old plain token as a /play seat", () => {
    expect(seatToken("abc123", "play")).toBe("abc123");
    expect(seatToken("abc123", "BVMT")).toBeNull();
    expect(seatToken(null, "play")).toBeNull();
  });
  it("only a seat from a started match counts as a lost blob (warm-up leaves nothing behind)", () => {
    expect(seatWasLive(encodeSeat("t", "play"), "play")).toBe(false);
    expect(seatWasLive(encodeSeat("t", "play", true), "play")).toBe(true);
    expect(seatWasLive(encodeSeat("t", "play", true), "BVMT")).toBe(false);
    expect(seatWasLive("plain-old-token", "play")).toBe(false);
  });
});
