// /auth/callback: NEAR Auth redirects here (whitelisted exactly as
// https://playmargin.fun/auth/callback). The path is served by the SPA fallback; S4's
// chain/auth.ts finishes the sign-in. import.meta.glob keeps this compiling before it lands.
const handlers = import.meta.glob<{ handleAuthCallback: (url: URL) => Promise<void> }>("./chain/auth.ts");

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
    const load = handlers["./chain/auth.ts"];
    if (!load) throw new Error("sign-in is not wired up yet");
    await (await load()).handleAuthCallback(new URL(location.href));
    location.replace("/#/");
  } catch (e) {
    msg.textContent = "Sign-in failed. Try again from the home page.";
    console.error(e);
  }
}
