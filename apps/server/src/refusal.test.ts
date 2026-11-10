// QA-A-07: refusals are one folded line and no stack; real errors keep theirs.
import { ServerError } from "colyseus";
import { describe, expect, it, vi } from "vitest";
import { ipHash, isRefusal, logRefusal, quietLogger, refuse } from "./refusal";

describe("refusals", () => {
  it("logs once per reason and ip within 10 s, then again after", () => {
    const t = 1_000_000;
    expect(logRefusal("too many joins, slow down", { ip: "1.1.1.1" }, t)).toBe(true);
    expect(logRefusal("too many joins, slow down", { ip: "1.1.1.1" }, t + 1)).toBe(false);
    expect(logRefusal("too many joins, slow down", { ip: "2.2.2.2" }, t + 2)).toBe(true);
    expect(logRefusal("too many joins, slow down", { ip: "1.1.1.1" }, t + 10_001)).toBe(true);
  });
  it("hashes the ip, never logs it raw", () => {
    expect(ipHash("1.2.3.4")).toMatch(/^[0-9a-f]{12}$/);
    expect(ipHash("1.2.3.4")).not.toContain("1.2.3.4");
    expect(ipHash(undefined)).toBeNull();
  });
  it("throws a ServerError with the same message and the old 523 code", () => {
    try {
      refuse("wrong room code", { room: "r1" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ServerError);
      expect((e as ServerError).message).toBe("wrong room code");
      expect((e as ServerError).code).toBe(523);
    }
  });
  it("treats only bare Errors as refusals, real faults keep their type", () => {
    expect(isRefusal(new Error("you are already in this match"))).toBe(true);
    expect(isRefusal(new TypeError("x is undefined"))).toBe(false);
    expect(isRefusal("string")).toBe(false);
  });
  it("the logger turns the ws frame-size stack into a refusal and passes real errors through", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    quietLogger.error("Max payload size exceeded\nRangeError: Max payload size exceeded\n    at Receiver.haveLength");
    expect(spy).not.toHaveBeenCalled();
    quietLogger.error("TypeError: boom\n    at real.ts:1");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
