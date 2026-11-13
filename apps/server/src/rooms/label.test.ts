import { describe, expect, it } from "vitest";
import { LABEL_MAX, displayLabel } from "./label";
import { withLabels } from "./MatchRoom";

describe("displayLabel", () => {
  it("keeps short names and trims spaces", () => {
    expect(displayLabel("  vansh  ")).toBe("vansh");
    expect(displayLabel("exactly15chars!")).toBe("exactly15chars!");
  });
  it("shortens wallet names to 14 plus an ellipsis, 15 code points total", () => {
    const l = displayLabel("playingmargin.testnet");
    expect(l).toBe("playingmargin.…");
    expect([...l]).toHaveLength(LABEL_MAX);
  });
  it("counts code points, not UTF 16 units", () => {
    const l = displayLabel("\u{1F916}".repeat(20));
    expect([...l]).toHaveLength(LABEL_MAX);
    expect(l.endsWith("\u{1F916}…")).toBe(true);
  });
});

describe("uniqueLabel", () => {
  it("numbers a duplicate name and keeps it within 15 code points (QA-C-03)", async () => {
    const { uniqueLabel } = await import("./label");
    expect(uniqueLabel("Gus", [])).toBe("Gus");
    expect(uniqueLabel("Gus", ["Gus"])).toBe("Gus 2");
    expect(uniqueLabel("Gus", ["Gus", "Gus 2"])).toBe("Gus 3");
    const long = uniqueLabel("playingmargin.testnet", ["playingmargin.…"]);
    expect(long).toBe("playingmargin 2");
    expect([...long].length).toBeLessThanOrEqual(LABEL_MAX);
  });
});

describe("withLabels (F14)", () => {
  it("shows names, not raw ids, longest id first, in one pass", () => {
    const blobs = new Map([["agent-1", { label: "Agent-1" }], ["agent-10", { label: "Agent-10" }], ["Xy_9a", { label: "agent-1 fan" }]]);
    expect(withLabels("agent-10 chases Xy_9a while agent-1 waits", { blobs })).toBe("Agent-10 chases agent-1 fan while Agent-1 waits");
    expect(withLabels(null, { blobs })).toBeNull();
  });
});
