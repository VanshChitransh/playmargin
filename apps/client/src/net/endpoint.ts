// The match server's address, on its own so a page can call the API without loading the game SDK.

/** Colyseus + REST base URL: VITE_SERVER_URL, or this host on port 2567 in dev. */
export const ENDPOINT = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;
