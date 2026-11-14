// CORS for /matchmake and every Colyseus HTTP answer. B09: Colyseus reflected ANY origin with
// credentials. Now only our site, its Pages previews and a local dev client get their origin back, WITH
// Allow-Credentials: @colyseus/sdk fetches /matchmake with credentials: "include", and a browser drops
// the answer without it (the 13 Nov P0: nobody could join). Safe because the origin is pinned.
// L5-03: no *.pages.dev (old preview builds must not talk to prod). localhost stays for `npm run dev`.
const ORIGIN_OK = /^(https:\/\/(www\.)?playmargin\.fun|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
/** x-stats-key: the private /stats page sends its key as a header, not in the URL (L5-04). */
const ALLOW_HEADERS = "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-stats-key";

/** CORS headers for one request Origin. Anything not ours gets playmargin.fun and no credentials. */
export function corsFor(origin: string): Record<string, string> {
  return ORIGIN_OK.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": ALLOW_HEADERS, Vary: "Origin" }
    : { "Access-Control-Allow-Origin": "https://playmargin.fun", Vary: "Origin" };
}
