// Browsers can matchmake only if our origins get credentials back (the SDK sends credentials: "include").
import { describe, expect, it } from "vitest";
import { corsFor } from "./cors";

describe("corsFor", () => {
  it("our origins: echoed WITH Allow-Credentials, or every browser join fails (13 Nov P0)", () => {
    for (const o of ["https://playmargin.fun", "https://www.playmargin.fun", "http://localhost:1234", "http://127.0.0.1:5173"])
      expect(corsFor(o)).toMatchObject({ "Access-Control-Allow-Origin": o, "Access-Control-Allow-Credentials": "true" });
  });
  it("anything else: never reflected, no credentials (B09)", () => {
    for (const o of ["https://abc123.playmargin.pages.dev", "https://evil.example", "https://playmargin.fun.evil.example", "http://playmargin.fun", ""]) {
      const h = corsFor(o);
      expect(h["Access-Control-Allow-Origin"]).toBe("https://playmargin.fun");
      expect(h["Access-Control-Allow-Credentials"]).toBeUndefined();
    }
  });
});
