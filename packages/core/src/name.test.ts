import { describe, expect, it } from "vitest";
import { cleanName, NAME_MAX } from "./name";

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
});
