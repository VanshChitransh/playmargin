// Path router: old hash links map to clean paths, and unknown paths fall to the 404 route.
import { describe, expect, it } from "vitest";
import { legacyPath, match, pickRoute, reloadOnce } from "./router";

describe("router", () => {
  it("rewrites old hash links to clean paths, keeping the query", () => {
    expect(legacyPath("#/verify/abc", "")).toBe("/verify/abc");
    expect(legacyPath("#/stats", "?key=k")).toBe("/stats?key=k");
    expect(legacyPath("#/r/ABCD?x=1", "?y=2")).toBe("/r/ABCD?x=1");
    expect(legacyPath("", "")).toBeNull();
    expect(legacyPath("#top", "")).toBeNull();
  });

  it("picks the first matching route, else 404", () => {
    const routes = ["/", "/verify/:id", "/r/:code", "*"];
    expect(pickRoute(routes, "/verify/m%201")).toEqual({ key: "/verify/:id", params: { id: "m 1" } });
    expect(pickRoute(routes, "/r/ABCD").params.code).toBe("ABCD");
    expect(pickRoute(routes, "/nope").key).toBe("*");
    expect(pickRoute(routes, "/verify/").key).toBe("*");
    expect(match("/", "/")).toEqual({});
  });

  it("never reloads twice in a minute after a failed chunk, or without storage", () => {
    const store = { getItem: () => "1000", setItem: () => {} };
    expect(reloadOnce(store, 30_000)).toBe(false);
    expect(reloadOnce(null, 1_000_000)).toBe(false);
  });
});
