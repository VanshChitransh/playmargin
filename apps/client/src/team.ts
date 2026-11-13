// Team link (?team=<TEAM_KEY>): marks this browser as one of ours so /stats leaves us out of the
// real user numbers. One call, then the key leaves the address bar and history at once.
import { ENDPOINT } from "./net/endpoint";
import { guestKey } from "./net/guest";

/** If the URL carries ?team=, send it once and strip it. */
export function markTeamFromUrl(): void {
  const url = new URL(location.href);
  const key = url.searchParams.get("team");
  if (!key) return;
  url.searchParams.delete("team");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  let browserId: string | null = null;
  try {
    browserId = localStorage.getItem("margin.aid"); // the anonymous analytics id (analytics/track.ts)
  } catch {
    /* storage blocked: the guest key still marks this browser */
  }
  // text/plain keeps it a simple request: no CORS preflight.
  void fetch(`${ENDPOINT}/api/team`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ key, guestKey: guestKey(), browserId }),
  })
    .then((r) => console.info(r.ok ? "MARGIN: this browser is marked as team." : `MARGIN: team link refused (HTTP ${r.status}).`))
    .catch(() => {});
}
