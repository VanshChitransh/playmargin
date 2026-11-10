import { afterEach, describe, expect, it, vi } from "vitest";
import { laptopCapable } from "./device";

const media = (coarse: boolean, fine: boolean): void => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("any-pointer: fine") ? fine : q.includes("pointer: coarse") ? coarse : false }));
};

describe("laptop only: decided by the input hardware, never the user agent", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("a phone or tablet (finger only) cannot play", () => {
    media(true, false);
    expect(laptopCapable()).toBe(false);
  });
  it("a laptop, a touch laptop and an iPad with a trackpad can", () => {
    media(false, true);
    expect(laptopCapable()).toBe(true);
    media(true, true);
    expect(laptopCapable()).toBe(true);
  });
});
