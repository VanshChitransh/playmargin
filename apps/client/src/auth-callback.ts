// /auth/callback: NEAR Auth redirects here (whitelisted exactly as
// https://playmargin.fun/auth/callback). The path is served by the SPA fallback; S4's
// resumeEmail finishes the sign-in, then #/cash shows the balance or asks a new player for a name.
import { resumeEmail } from "./chain/wallet";

/** True if this page load is the auth redirect (then the caller skips the normal router). */
export function isAuthCallback(): boolean {
  return location.pathname === "/auth/callback";
}

/** Finish sign-in, then return to the app on its hash route. */
export async function runAuthCallback(root: HTMLElement): Promise<void> {
  root.innerHTML = `<main class="grid h-full place-items-center bg-liq p-4 text-center text-ink">
    <div><img src="/brand/margin-cat-cutout.svg" alt="" class="mx-auto w-32" />
    <p data-msg class="mt-4 font-display text-3xl">Signing you in</p></div></main>`;
  const msg = root.querySelector<HTMLElement>("[data-msg]")!;
  try {
    if ((await resumeEmail()) === "out") throw new Error("not logged in after the redirect");
    location.replace("/#/cash");
  } catch (e) {
    msg.textContent = "Sign-in failed. Try again from the home page.";
    console.error(e);
  }
}
