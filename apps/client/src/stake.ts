// The paid entry as a price tag ("$1", "$0.10"), read from the contract's config so the
// buttons always say what PLAY actually charges. Falls back to "$1" when the chain is unreachable.

let label: Promise<string> | null = null;

/** "$1" for whole dollars, else two decimals ("$0.10"). USDC base units have 6 decimals. */
export const priceTag = (base: bigint): string => {
  const cents = Number(base / 10_000n);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
};

/** The entry stake as a price tag. The chain code loads lazily, so the landing page stays light. */
export function stakeLabel(): Promise<string> {
  label ??= import("./chain/funds")
    .then((m) => m.entryStake())
    .then((s) => priceTag(BigInt(s)))
    .catch(() => ((label = null), "$1"));
  return label;
}

/** Fills every [data-stake] under root with the real price once it is known; returns it. */
export async function showStake(root: ParentNode): Promise<string> {
  const l = await stakeLabel();
  root.querySelectorAll("[data-stake]").forEach((e) => (e.textContent = l));
  return l;
}
