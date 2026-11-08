import { describe, expect, it } from "vitest";
import { match } from "./router";

describe("match", () => {
  it("matches static and param routes", () => {
    expect(match("/", "/")).toEqual({});
    expect(match("/play", "/play")).toEqual({});
    expect(match("/verify/:id", "/verify/m-42")).toEqual({ id: "m-42" });
    expect(match("/r/:code", "/r/AB%20C")).toEqual({ code: "AB C" });
  });
  it("rejects wrong shapes and empty params", () => {
    expect(match("/play", "/judge")).toBeNull();
    expect(match("/verify/:id", "/verify/")).toBeNull();
    expect(match("/verify/:id", "/verify/a/b")).toBeNull();
  });
});
