import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fastfsSimple } from "./fastfs";

describe("fastfsSimple", () => {
  it("matches the borsh layout in near.social/skill.md", () => {
    const data = Buffer.from([1, 2, 3]);
    const { path, payload } = fastfsSimple(data, "image/png", "png");
    const sha = createHash("sha256").update(data).digest("hex");
    expect(path).toBe(`media/${sha}.png`);
    const le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
    const want = [0, ...le(path.length), ...Buffer.from(path), 1, ...le(9), ...Buffer.from("image/png"), ...le(3), 1, 2, 3];
    expect([...payload]).toEqual(want);
  });
  it("refuses files over 1 MiB", () => {
    expect(() => fastfsSimple(Buffer.alloc((1 << 20) + 1), "image/png", "png")).toThrow(/1 MiB/);
  });
});
