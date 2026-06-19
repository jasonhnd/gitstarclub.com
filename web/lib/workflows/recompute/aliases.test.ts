import { test, expect, describe } from "bun:test";
import { buildAliasMap } from "./aliases";

// Pure builder for lookup/aliases.json: old (renamed-away) full_name → current repo id.
// The repo route consults this on a slug miss and 308-redirects to the id's CURRENT slug,
// so stale URLs (e.g. /facebook/react after the repo moved to /react/react) keep working.
// repo_id is stable across GitHub renames, so we key the redirect target by id, not by name.

type Rename = { id: number; old_full_name: string; new_full_name: string };
type Lookup = Record<string, { full_name: string }>;

const lookup = (...pairs: Array<[number, string]>): Lookup =>
  Object.fromEntries(pairs.map(([id, full_name]) => [String(id), { full_name }]));

describe("buildAliasMap", () => {
  test("maps a renamed repo's old full_name (lowercased) to its stable id", () => {
    const renames: Rename[] = [{ id: 10270250, old_full_name: "facebook/react", new_full_name: "react/react" }];
    const out = buildAliasMap(renames, lookup([10270250, "react/react"]));
    expect(out).toEqual({ "facebook/react": 10270250 });
  });

  test("lowercases the alias key so lookup is case-insensitive", () => {
    const renames: Rename[] = [{ id: 1, old_full_name: "Facebook/React-Native", new_full_name: "react/react-native" }];
    const out = buildAliasMap(renames, lookup([1, "react/react-native"]));
    expect(out).toEqual({ "facebook/react-native": 1 });
  });

  test("excludes a rename whose id is no longer tracked (dropped from the lookup)", () => {
    const renames: Rename[] = [{ id: 999, old_full_name: "old/gone", new_full_name: "new/gone" }];
    const out = buildAliasMap(renames, lookup([10270250, "react/react"]));
    expect(out).toEqual({});
  });

  test("excludes a self-alias (old name already equals the id's current full_name)", () => {
    // A repo renamed away and back, or a no-op rename: old == current → no redirect needed.
    const renames: Rename[] = [{ id: 7, old_full_name: "acme/tool", new_full_name: "acme/tool" }];
    const out = buildAliasMap(renames, lookup([7, "acme/tool"]));
    expect(out).toEqual({});
  });

  test("excludes an old name that is now a LIVE repo's current full_name (live repo wins)", () => {
    // repo 1 vacated "shared/name" (now at moved/name); repo 2 currently occupies "shared/name".
    const renames: Rename[] = [{ id: 1, old_full_name: "shared/name", new_full_name: "moved/name" }];
    const out = buildAliasMap(renames, lookup([1, "moved/name"], [2, "shared/name"]));
    expect(out).toEqual({});
  });

  test("resolves a rename chain A→B→C: both A and B alias to the stable id (current C)", () => {
    const renames: Rename[] = [
      { id: 42, old_full_name: "a/a", new_full_name: "b/b" },
      { id: 42, old_full_name: "b/b", new_full_name: "c/c" },
    ];
    const out = buildAliasMap(renames, lookup([42, "c/c"]));
    expect(out).toEqual({ "a/a": 42, "b/b": 42 });
  });

  test("unions renames across runs and keeps every still-tracked old name", () => {
    const renames: Rename[] = [
      { id: 63537249, old_full_name: "facebook/create-react-app", new_full_name: "react/create-react-app" }, // earlier run
      { id: 10270250, old_full_name: "facebook/react", new_full_name: "react/react" }, // latest run
    ];
    const out = buildAliasMap(renames, lookup([10270250, "react/react"], [63537249, "react/create-react-app"]));
    expect(out).toEqual({ "facebook/react": 10270250, "facebook/create-react-app": 63537249 });
  });

  test("returns an empty map when there are no renames", () => {
    expect(buildAliasMap([], lookup([1, "a/a"]))).toEqual({});
  });
});
