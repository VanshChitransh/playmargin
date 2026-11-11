import { describe, expect, it } from "vitest";
import { anchorVerdict, configVerdict, droneVerdict, relayVerdict, sessionKeyVerdict, settleVerdict, type RawTx } from "./claims";

const C = "playmargin.testnet";
const b64 = (o: object): string => btoa(JSON.stringify(o));
const call = (method: string, args: object, fail = false): RawTx => ({
  transaction: { signer_id: "settler." + C, receiver_id: C, actions: [{ FunctionCall: { method_name: method, args: b64(args) } }] },
  receipts_outcome: [{ outcome: { status: fail ? { Failure: {} } : { SuccessValue: "" } } }],
});
const settleArgs = { match_id: "m1", lent: "2870000", vault_repaid: "2870000", head: "abc123", payouts: [["drone-1." + C, "92521"]] };

describe("judges desk verdicts", () => {
  it("config: right USDC and a paid entry, or FAIL", () => {
    expect(configVerdict({ owner: "o", settler: "s", usdc: "usdc." + C, entry_stake: "1000000" }, "usdc." + C).state).toBe("ok");
    expect(configVerdict({ owner: "o", settler: "s", usdc: "fake", entry_stake: "1000000" }, "usdc." + C).state).toBe("fail");
  });
  it("settle: OK only when the tx succeeded and the contract holds the same head as Settled", () => {
    const rec = { status: "Settled", head: "abc123", stakes: "2000000" };
    expect(settleVerdict(call("settle", settleArgs), rec).state).toBe("ok");
    expect(settleVerdict(call("settle", settleArgs, true), rec).state).toBe("fail");
    expect(settleVerdict(call("settle", settleArgs), { ...rec, head: "other" }).state).toBe("fail");
    expect(settleVerdict(call("settle", settleArgs), null).state).toBe("fail");
    expect(settleVerdict(call("anchor", settleArgs), rec).state).toBe("fail");
  });
  it("drone: registered and actually paid by that settle", () => {
    expect(droneVerdict("drone-1." + C, true, "183805", call("settle", settleArgs)).state).toBe("ok");
    expect(droneVerdict("drone-1." + C, false, "0", call("settle", settleArgs)).state).toBe("fail");
    expect(droneVerdict("drone-2." + C, true, "0", call("settle", settleArgs)).state).toBe("fail");
  });
  it("session key: enter_arena on our contract only", () => {
    const fc = (methods: string[], receiver = C) => ({ FunctionCall: { receiver_id: receiver, method_names: methods, allowance: "50000000000000000000000" } });
    expect(sessionKeyVerdict(fc(["enter_arena"]), C).state).toBe("ok");
    expect(sessionKeyVerdict(fc(["enter_arena", "withdraw"]), C).state).toBe("fail");
    expect(sessionKeyVerdict(fc([]), C).state).toBe("fail"); // empty list = any method
    expect(sessionKeyVerdict(fc(["enter_arena"], "evil.testnet"), C).state).toBe("fail");
    expect(sessionKeyVerdict("FullAccess", C).state).toBe("fail");
  });
  it("relay: a zero-deposit enter_arena delegate to our contract", () => {
    const relay = (method: string, deposit: string): RawTx => ({
      transaction: { signer_id: "relayer." + C, receiver_id: "p." + C, actions: [{ Delegate: { delegate_action: { sender_id: "p." + C, receiver_id: C, actions: [{ FunctionCall: { method_name: method, deposit } }] } } }] },
      receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
    });
    expect(relayVerdict(relay("enter_arena", "0"), C).state).toBe("ok");
    expect(relayVerdict(relay("withdraw", "0"), C).state).toBe("fail");
    expect(relayVerdict(relay("enter_arena", "1"), C).state).toBe("fail");
    expect(relayVerdict(call("settle", settleArgs), C).state).toBe("fail");
  });
  it("anchor: NONE YET when there is none, else its age", () => {
    expect(anchorVerdict(null, 0).state).toBe("none");
    expect(anchorVerdict({ seq: 7, head: "h", at: 3.6e12 }, 2 * 3.6e6).detail).toContain("1.0 h ago");
  });
});
