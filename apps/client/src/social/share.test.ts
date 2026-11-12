import { describe, expect, it } from "vitest";
import { postUrl, profileUrl, socialProfile } from "./profile";
import { postArgs, resultText, waitIndexed } from "./share";

describe("near.social share", () => {
  it("writes one post key with the real result and the verify link", () => {
    const text = resultText({ survived: true, rank: 2, of: 12, kept: "226.86", verifyUrl: "https://playmargin.fun/verify/abc" });
    expect(text).toContain("#2 of 12, kept 226.86");
    expect(text).toContain("https://playmargin.fun/verify/abc");
    expect(postArgs("1762790000000", text)).toEqual({ "post/1762790000000": { text } });
    expect(/[\u2013\u2014]/.test(text)).toBe(false);
  });
  it("links posts as /{account}/post/{id} and profiles as /{account}", () => {
    expect(postUrl("you.near", "1762790000000")).toBe("https://near.social/you.near/post/1762790000000");
    expect(profileUrl("you.near")).toBe("https://near.social/you.near");
  });
  it("waits until the indexer serves the post", async () => {
    let n = 0;
    const f = (async () => ({ ok: ++n >= 3 })) as unknown as typeof fetch;
    expect(await waitIndexed("you.near", "1", f, 5, 0)).toBe(true);
    expect(n).toBe(3);
    const never = (async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await waitIndexed("you.near", "1", never, 2, 0)).toBe(false);
  });
  it("reads a profile on mainnet builds and nothing on testnet", async () => {
    const f = (async () => ({ ok: true, json: async () => ({ has_profile: true, name: "Vansh", avatar_url: "https://main.fastfs.io/a.webp" }) })) as unknown as typeof fetch;
    expect(await socialProfile("p1.near", f, true)).toEqual({ accountId: "p1.near", name: "Vansh", avatarUrl: "https://main.fastfs.io/a.webp", url: "https://near.social/p1.near" });
    expect(await socialProfile("p2.near", f, false)).toBeNull();
  });
});

describe("mountSocialShare", () => {
  it("renders nothing on testnet builds or when signed out", async () => {
    const { mountSocialShare } = await import("./mount");
    const el = { innerHTML: "" } as HTMLElement;
    const r = { survived: true, rank: 1, of: 12, kept: "1.00", verifyUrl: "x" };
    mountSocialShare(el, r, "you.near", false);
    mountSocialShare(el, r, null, true);
    expect(el.innerHTML).toBe("");
  });
});
