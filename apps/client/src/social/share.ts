// Post a match result to the player's own near.social feed, signed by their own wallet. The write is
// a FunctionCall "__fastdata_kv" to the account "social" (no contract there, so the receipt fails by
// design, near.social/skill.md). We confirm by polling the indexer for the post, never by the receipt.
import { wallet } from "../chain/wallet";
import { SOCIAL_API, SOCIAL_ON, postUrl } from "./profile";

export interface ResultPost {
  survived: boolean;
  /** Final rank and room size, e.g. 2 of 12. */
  rank: number;
  of: number;
  /** Credits or dollars kept, already formatted ("226.86", "$1.37"). */
  kept: string;
  verifyUrl: string;
}

/** The post text: plain, real numbers only, one link (the verify page is the proof). */
export function resultText(r: ResultPost): string {
  const head = r.survived ? `Survived a MARGIN match: #${r.rank} of ${r.of}, kept ${r.kept}.` : `Got liquidated in MARGIN (#${r.rank} of ${r.of}).`;
  return `${head} BOOST is a loan, the vault pops the greedy.\nCheck the match yourself: ${r.verifyUrl}\n#MARGIN #NEARHackathon`;
}

/** The FastData KV args for one new top-level post. */
export const postArgs = (postId: string, text: string): Record<string, { text: string }> => ({ [`post/${postId}`]: { text } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True once the indexer serves the post (usually about 3 s after the block). */
export async function waitIndexed(accountId: string, postId: string, f: typeof fetch = fetch, tries = 15, gapMs = 2000): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await f(`${SOCIAL_API}/posts/${encodeURIComponent(accountId)}/${postId}`).catch(() => null);
    if (r?.ok) return true;
    await sleep(gapMs);
  }
  return false;
}

/** Sign and send the post with the player's wallet, wait until near.social shows it, return its page. */
export async function postResult(accountId: string, text: string): Promise<string> {
  if (!SOCIAL_ON) throw new Error("near.social runs on mainnet only");
  const postId = String(Date.now());
  const sent = (await wallet())
    .signAndSendTransaction({
      signerId: accountId,
      receiverId: "social",
      actions: [{ type: "FunctionCall", params: { methodName: "__fastdata_kv", args: postArgs(postId, text), gas: "1000000000", deposit: "0" } }],
    })
    // The receipt always fails (CodeDoesNotExist) while the data is still indexed, so a wallet error
    // is not a verdict: the indexer below is. A rejected signature simply never shows up.
    .catch((e: unknown) => e);
  if (!(await waitIndexed(accountId, postId))) {
    throw sent instanceof Error ? sent : new Error("near.social has not shown the post yet, check your profile in a minute");
  }
  return postUrl(accountId, postId);
}
