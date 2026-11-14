// Matchmaking timing and agent fill (RULES: Matchmaking, Paid rooms).
import { R, sToTicks } from "@margin/core";
import { describe, expect, it } from "vitest";
import { agentFill, droneFill, parseRoomKey, PRIVATE_SOLO_WAIT_S, PRIVATE_WAIT_S, warmupNext } from "./lobby";

const at = (s: number) => sToTicks(s);

describe("parseRoomKey", () => {
  it("defaults to public free", () => expect(parseRoomKey(undefined)).toEqual({ mode: "free", roomCode: null }));
  it("keeps a valid code and paid mode", () =>
    expect(parseRoomKey({ mode: "paid", roomCode: "ABCD" })).toEqual({ mode: "paid", roomCode: "ABCD" }));
  it("drops a bad code", () => expect(parseRoomKey({ roomCode: "ab'; --" }).roomCode).toBeNull());
});

describe("warmupNext", () => {
  it("free starts at 8 s whatever the head count", () => {
    expect(warmupNext({ mode: "free", humans: 1, phaseTick: at(7.9), startNow: false })).toBe("wait");
    expect(warmupNext({ mode: "free", humans: 1, phaseTick: at(8), startNow: false })).toBe("countdown");
  });
  it("paid waits 20 s, or starts early on start-now with 2+ humans", () => {
    expect(warmupNext({ mode: "paid", humans: 2, phaseTick: at(10), startNow: false })).toBe("wait");
    expect(warmupNext({ mode: "paid", humans: 2, phaseTick: at(10), startNow: true })).toBe("countdown");
    expect(warmupNext({ mode: "paid", humans: 1, phaseTick: at(10), startNow: true })).toBe("wait");
    expect(warmupNext({ mode: "paid", humans: 3, phaseTick: at(20), startNow: false })).toBe("countdown");
  });
  it("paid closes with nobody charged if one human waited 20 s", () =>
    expect(warmupNext({ mode: "paid", humans: 1, phaseTick: at(20), startNow: false })).toBe("close"));
  it("private waits for the host's start with a friend in, or a full room, never a timer", () => {
    const p = { mode: "free" as const, private: true };
    expect(warmupNext({ ...p, humans: 3, phaseTick: at(60), startNow: false })).toBe("wait");
    expect(warmupNext({ ...p, humans: 1, phaseTick: at(60), startNow: true })).toBe("wait");
    expect(warmupNext({ ...p, humans: 2, phaseTick: at(1), startNow: true })).toBe("countdown");
    expect(warmupNext({ ...p, humans: R.ROOM_SIZE, phaseTick: at(1), startNow: false })).toBe("countdown");
    expect(warmupNext({ ...p, humans: 1, phaseTick: at(PRIVATE_SOLO_WAIT_S), startNow: false })).toBe("close"); // L2-02: a lone host waits 2 min
    expect(warmupNext({ ...p, humans: 2, phaseTick: at(PRIVATE_SOLO_WAIT_S), startNow: false })).toBe("wait");
    expect(warmupNext({ ...p, humans: 2, phaseTick: at(PRIVATE_WAIT_S), startNow: false })).toBe("close");
  });
});

describe("agentFill", () => {
  it("fills to ROOM_SIZE with labelled agents", () => {
    const a = agentFill(2, 42);
    expect(a).toHaveLength(R.ROOM_SIZE - 2);
    // Named, but always labelled as AI: kind agent, robot glyph, ids stay agent-N.
    expect(a.every((p, i) => p.kind === "agent" && p.label.endsWith("\u{1F916}") && p.id === `agent-${i + 1}`)).toBe(true);
    expect(new Set(a.map((p) => p.label)).size).toBe(a.length);
    expect(agentFill(2, 42)).toEqual(a); // seeded
    expect(agentFill(R.ROOM_SIZE, 42)).toHaveLength(0);
  });
});

describe("droneFill", () => {
  it("min(3, ceil(humans / 3)) labelled drones with no account", () => {
    expect([2, 3, 4, 9, 12].map((h) => droneFill(h).length)).toEqual([1, 1, 2, 3, 3]);
    expect(droneFill(4).every((d) => d.kind === "drone" && d.accountId === null && d.label.endsWith("(liquidator)"))).toBe(true);
  });
});
