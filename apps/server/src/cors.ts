// CORS for /matchmake and every Colyseus HTTP answer. B09: Colyseus reflected ANY origin with
// credentials. Now only our site, its Pages previews and a local dev client get their origin back, WITH
// Allow-Credentials: @colyseus/sdk fetches /matchmake with credentials: "include", and a browser drops
// the answer without it (the 13 Nov P0: nobody could join). Safe because the origin is pinned.
const ORIGIN_OK = /^(https:\/\/(www\.)?playmargin\.fun|https:\/\/([a-z0-9-]+\.)?playmargin\.pages\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** CORS headers for one request Origin. Anything not ours gets playmargin.fun and no credentials. */
export function corsFor(origin: string): Record<string, string> {
  return ORIGIN_OK.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
    : { "Access-Control-Allow-Origin": "https://playmargin.fun", Vary: "Origin" };
}
