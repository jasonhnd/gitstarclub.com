import { describe, expect, test } from "bun:test";
import { resolveRepoRoute } from "./repo-route";

describe("resolveRepoRoute", () => {
  test("resolves a current full_name case-insensitively", () => {
    const ids = new Map([["facebook/react", 10270250]]);

    expect(resolveRepoRoute("Facebook/React", ids, null, null)).toEqual({ kind: "found", id: 10270250 });
  });

  test("redirects a stale alias to the current full_name for the same repo id", () => {
    const ids = new Map<string, number>();
    const aliases = { "facebook/react": 10270250 };
    const repos = { "10270250": { full_name: "react/react" } };

    expect(resolveRepoRoute("facebook/react", ids, aliases, repos)).toEqual({
      kind: "redirect",
      location: "/react/react",
    });
  });

  test("does not redirect a self-alias", () => {
    const ids = new Map<string, number>();
    const aliases = { "facebook/react": 10270250 };
    const repos = { "10270250": { full_name: "facebook/react" } };

    expect(resolveRepoRoute("facebook/react", ids, aliases, repos)).toEqual({ kind: "missing" });
  });

  test("returns missing for an unknown slug", () => {
    expect(resolveRepoRoute("ghost/missing", new Map(), {}, {})).toEqual({ kind: "missing" });
  });
});
