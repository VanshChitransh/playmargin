// Every 1-Click status maps to one of five UI states; unknown or partial deposits keep waiting.

import { describe, expect, it } from "vitest";
import { depositState } from "./addfunds";

describe("depositState", () => {
  it("maps 1-Click statuses to UI states", () => {
    expect(depositState("PENDING_DEPOSIT")).toBe("waiting");
    expect(depositState("INCOMPLETE_DEPOSIT")).toBe("waiting");
    expect(depositState("KNOWN_DEPOSIT_TX")).toBe("processing");
    expect(depositState("PROCESSING")).toBe("processing");
    expect(depositState("SUCCESS")).toBe("done");
    expect(depositState("REFUNDED")).toBe("refunded");
    expect(depositState("FAILED")).toBe("failed");
    expect(depositState("SOMETHING_NEW")).toBe("waiting");
  });
});
