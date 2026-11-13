// QA-D-07: a dead first RPC must fall through to the next one, not read as "unknown key".
// A local fake JSON-RPC stands in for NEAR (no live network in unit tests).
import { createServer, type Server } from "node:http";
import { generateKey } from "near-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Chain, chainConfigFromEnv } from "./chain";

const known = generateKey().publicKey.toString();
const settler = generateKey();
let rpc: Server;
let url = "";
let hits = 0;

beforeAll(async () => {
  rpc = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits++;
      const { id, params } = JSON.parse(body) as { id: unknown; params: { public_key?: string } };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          params.public_key === known
            ? { jsonrpc: "2.0", id, result: { nonce: 1, permission: "FullAccess", block_height: 1, block_hash: "11111111111111111111111111111111" } }
            : // exactly what rpc.testnet.fastnear.com answers for a missing key (captured 10 Nov)
              { jsonrpc: "2.0", id, result: { block_hash: "11111111111111111111111111111111", block_height: 1, error: `access key ${params.public_key} does not exist while viewing`, logs: [] } },
        ),
      );
    });
  });
  await new Promise<void>((r) => rpc.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(rpc.address() as { port: number }).port}`;
});
afterAll(() => rpc.close());

const DEAD = "http://127.0.0.1:1"; // nothing listens: connection refused
const chain = (rpcUrls: string[]) =>
  // Backoff 0: the test checks the fallback behaviour, not the waits, so it is fast on any machine.
  new Chain({ network: "testnet", contractId: "margin.testnet", settlerId: "settler.testnet", privateKey: settler.secretKey, rpcUrls }, 0);

describe("Chain.accessKey with a dead first RPC", () => {
  it("finds a real key through the fallback (was null before the fix)", async () => {
    hits = 0;
    const k = await chain([DEAD, url]).accessKey("p.testnet", known);
    expect(k?.permission).toBe("FullAccess");
    expect(hits).toBe(1);
  });
  it("still answers null for a key that is not on the account", async () => {
    expect(await chain([DEAD, url]).accessKey("p.testnet", generateKey().publicKey.toString())).toBeNull();
  });
  it("throws when every RPC is unreachable, never a false 'unknown key'", async () => {
    await expect(chain([DEAD]).accessKey("p.testnet", known)).rejects.toThrow();
  });
});

describe("chainConfigFromEnv RPC order (QA-D-02)", () => {
  it("keyed RPC_URLS first, then FastNEAR, then NEAR's own RPC", () => {
    const c = chainConfigFromEnv({ NETWORK: "testnet", CONTRACT_ID: "c", SETTLER_ID: "s", SETTLER_PRIVATE_KEY: "k", RPC_URLS: "https://keyed.example" });
    expect(c?.rpcUrls).toEqual(["https://keyed.example", "https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"]);
    expect(chainConfigFromEnv({ NETWORK: "mainnet", CONTRACT_ID: "c", SETTLER_ID: "s", SETTLER_PRIVATE_KEY: "k" })?.rpcUrls).toEqual([
      "https://rpc.mainnet.fastnear.com",
      "https://rpc.mainnet.near.org",
    ]);
  });
});
