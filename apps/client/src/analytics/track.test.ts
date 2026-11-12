import { describe, expect, it } from "vitest";
import { EVENTS, optedOut, viewEvent } from "./track";
import { EVENTS as SERVER_EVENTS } from "../../../server/src/analytics";

describe("analytics client", () => {
  it("sends exactly the names the server accepts", () => expect([...EVENTS]).toEqual([...SERVER_EVENTS]));
  it("respects Do Not Track, Global Privacy Control and the local opt-out", () => {
    expect(optedOut({ doNotTrack: "1" }, null)).toBe(true);
    expect(optedOut({ globalPrivacyControl: true }, null)).toBe(true);
    expect(optedOut({}, "1")).toBe(true);
    expect(optedOut({ doNotTrack: "0" }, null)).toBe(false);
  });
  it("maps routes to page views, and ignores game routes", () => {
    expect(viewEvent("/")).toBe("home_view");
    expect(viewEvent("/how")).toBe("how_view");
    expect(viewEvent("/judges")).toBe("judges_view");
    expect(viewEvent("/verify/abc")).toBe("verify_view");
    expect(viewEvent("/play")).toBeNull();
    expect(viewEvent("/stats")).toBeNull(); // the private page never counts itself
  });
});
