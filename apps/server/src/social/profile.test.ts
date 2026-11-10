import { describe, expect, it } from "vitest";
import { socialName } from "./profile";

const fake = (body: unknown, ok = true) => {
  const calls: string[] = [];
  const f = async (url: string) => (calls.push(url), { ok, json: async () => body });
  return { f, calls };
};

describe("socialName", () => {
  it("returns the cleaned near.social name of a mainnet account and caches it", async () => {
    const { f, calls } = fake({ name: "Vansh <b>🚀" });
    expect(await socialName("cache-a.near", f, 1)).toBe("Vansh b");
    expect(await socialName("cache-a.near", f, 2)).toBe("Vansh b");
    expect(calls).toEqual(["https://api2.near.social/v1/accounts/cache-a.near"]);
  });
  it("never looks up testnet accounts (near.social is mainnet only)", async () => {
    const { f, calls } = fake({ name: "x" });
    expect(await socialName("me.testnet", f)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("falls back to null on no profile, agent names, errors and timeouts", async () => {
    expect(await socialName("np.near", fake({ name: null }).f)).toBeNull();
    expect(await socialName("bad.near", fake({ name: "Agent-3" }).f)).toBeNull();
    expect(await socialName("down.near", fake({}, false).f)).toBeNull();
    expect(await socialName("throw.near", async () => Promise.reject(new Error("timeout")))).toBeNull();
  });
});
