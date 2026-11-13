import { describe, expect, it } from "vitest";
import { joinFailWords, refusalWords } from "./refusal";

describe("join refusals in game words", () => {
  it("stays quiet when the server just did not answer", () => {
    expect(refusalWords("join timeout")).toBe("");
    expect(refusalWords("Failed to fetch")).toBe("");
  });
  it("names the known refusals", () => {
    expect(refusalWords("not enough credits")).toMatch(/credits/);
    expect(refusalWords("all arenas are full, try again in a minute")).toMatch(/busy/);
    expect(refusalWords("too many joins, slow down")).toMatch(/your network/);
    expect(refusalWords("HTTP 429")).toMatch(/your network/);
  });
  it("explains a server that is restarting (503, empty JSON body)", () => {
    expect(refusalWords("Unexpected end of JSON input")).toMatch(/restarting for an update/);
    expect(refusalWords("Service Unavailable")).toMatch(/restarting for an update/);
  });
  it("passes any other server reason through", () => {
    expect(refusalWords("account already in this room")).toBe("The server said: account already in this room");
  });
  it("a join that only timed out still gets words, so the client never falls back silently (QA-B-14)", () => {
    expect(joinFailWords("join timeout")).toMatch(/can't reach the arena/);
    expect(joinFailWords("Failed to fetch")).toMatch(/practice offline/);
    expect(joinFailWords("not enough credits")).toMatch(/credits/);
  });
});
