import { describe, expect, it } from "vitest";
import { RateLimiter, clientIp } from "./guard";

describe("RateLimiter", () => {
  it("allows max per window per key, then frees up as the window slides", () => {
    const l = new RateLimiter(2, 1000);
    expect([l.allow("a", 0), l.allow("a", 10), l.allow("a", 20), l.allow("b", 20)]).toEqual([true, true, false, true]);
    expect(l.allow("a", 1005)).toBe(true); // the hit at 0 left the window
    expect(l.allow("a", 1006)).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp({ ip: "1.2.3.4, 10.0.0.1" })).toBe("1.2.3.4");
    expect(clientIp({ ip: ["5.6.7.8"] })).toBe("5.6.7.8");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
