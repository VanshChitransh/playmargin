// Server picker: lowest median ping wins, dead servers are skipped, nothing alive means home.
import { describe, expect, it, vi } from "vitest";
import { HOME, pickFastest, regionOf } from "./region";

const US = { id: "us", label: "US East", url: "https://us.example" };

describe("server picker", () => {
  it("takes the lower median, so one slow sample does not decide", () => {
    expect(pickFastest([{ region: HOME, ms: [220, 210, 900] }, { region: US, ms: [40, 600, 45] }])).toBe(US);
    expect(pickFastest([{ region: HOME, ms: [30, 35, 32] }, { region: US, ms: [180, 190, 170] }])).toBe(HOME);
  });

  it("skips a server that never answered, and falls back home when none did", () => {
    expect(pickFastest([{ region: HOME, ms: [] }, { region: US, ms: [300] }])).toBe(US);
    expect(pickFastest([{ region: HOME, ms: [] }, { region: US, ms: [] }])).toBe(HOME);
  });

  it("reads link hints, ignoring unknown ones", () => {
    expect(regionOf("in")).toBe(HOME);
    expect(regionOf("mars")).toBeNull();
    expect(regionOf(null)).toBeNull();
  });

  it("routes US ids and room hints to the US box, everything else home", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_US_SERVER_URL", "https://us.example");
    const m = await import("./region");
    expect(m.serverFor("u-AbCdEfGhI").id).toBe("us");
    expect(m.serverFor("6NfmDEyNv").id).toBe("in");
    expect(m.serverFor("u-AbC:tok".split(":")[0]).url).toBe("https://us.example");
    expect(m.roomRegion("?s=us").id).toBe("us");
    expect(m.roomRegion("").id).toBe("in");
    expect(m.hintFor(m.roomRegion("?s=us"))).toBe("?s=us");
    expect(m.hintFor(m.HOME)).toBe("");
    vi.unstubAllEnvs();
  });
});
