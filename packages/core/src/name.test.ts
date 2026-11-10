import { describe, expect, it } from "vitest";
import { BOT_NAMES } from "./botnames";
import { cleanName, NAME_MAX, nameProblem } from "./name";

describe("cleanName", () => {
  it("keeps NEAR account ids and plain names", () => {
    expect(cleanName("vansh.testnet")).toBe("vansh.testnet");
    expect(cleanName("  Rocky   Bhai ")).toBe("Rocky Bhai");
  });
  it("strips markup and caps the length", () => {
    expect(cleanName("<img src=x onerror=alert(1)>")).toBe("img srcx onerro");
    expect(cleanName("a".repeat(50))).toHaveLength(NAME_MAX);
    expect(NAME_MAX).toBe(15);
    expect(cleanName("Fifteen chars ok")).toBe("Fifteen chars o");
  });
  it("refuses empty, non-strings and agent lookalikes", () => {
    for (const bad of ["", "   ", "<>", 42, null, "Agent-3", "drone 1", "BOT"]) expect(cleanName(bad)).toBeNull();
    expect(cleanName("Botswana")).toBe("Botswana");
  });
  it("refuses a bot's display name in any case, with or without a number (QA-A-05)", () => {
    for (const bad of ["Greedy Gus", "greedy gus", "  GREEDY   GUS ", "Greedy Gus 2", "Max Pain", "Squeeze Sid"]) expect(cleanName(bad)).toBeNull();
    for (const name of BOT_NAMES) expect(cleanName(name)).toBeNull();
    expect(cleanName("Greedy Gussie")).toBe("Greedy Gussie");
    expect(cleanName("Max")).toBe("Max");
  });
  it("explains every change or refusal in player words (QA-B-09)", () => {
    expect(nameProblem("Rocky Bhai")).toBeNull();
    expect(nameProblem("   ")).toBe("Type a name: letters or numbers.");
    expect(nameProblem("\u0645\u062D\u0645\u062F")).toBe("Use English letters, numbers and spaces.");
    expect(nameProblem("Agent-3")).toBe("That name belongs to the AI players. Pick another.");
    expect(nameProblem("max pain")).toBe("That name belongs to the AI players. Pick another.");
    expect(nameProblem("\u{1F525}greedy\u{1F525}")).toBe("Only English letters, numbers and spaces: some characters were dropped.");
    expect(nameProblem("a".repeat(20))).toBe("15 characters max: the name was shortened.");
    // Every refusal by cleanName comes with a reason.
    for (const raw of ["", "  ", "<>", "Agent-3", "drone 1", "BOT", "Greedy Gus", "\u0645\u062D\u0645\u062F"]) {
      expect(cleanName(raw)).toBeNull();
      expect(nameProblem(raw)).not.toBeNull();
    }
  });
});
