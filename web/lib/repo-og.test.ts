import { describe, expect, test } from "bun:test";
import { repoOpenGraphCard } from "./repo-og";

describe("repoOpenGraphCard", () => {
  test("uses the generic card when the path did not resolve to a repo id", () => {
    expect(repoOpenGraphCard(undefined, null)).toEqual({ kind: "generic" });
  });

  test("uses the generic card when the id resolved but the entity is missing", () => {
    expect(repoOpenGraphCard(7, null)).toEqual({ kind: "generic" });
  });

  test("uses the generic card when the stored name is not renderable", () => {
    expect(repoOpenGraphCard(7, { full_name: "not a repo", current_stars: 10, language: "Go" })).toEqual({ kind: "generic" });
    expect(repoOpenGraphCard(7, { full_name: "owner/name?q", current_stars: 10, language: null })).toEqual({ kind: "generic" });
    expect(repoOpenGraphCard(7, { full_name: "owner/name#frag", current_stars: 10, language: null })).toEqual({ kind: "generic" });
  });

  test("draws the stored name rather than any other spelling", () => {
    expect(
      repoOpenGraphCard(7, {
        full_name: "vercel/next.js",
        current_stars: 120_000,
        language: "JavaScript",
      }),
    ).toEqual({
      kind: "repo",
      fullName: "vercel/next.js",
      stars: 120_000,
      language: "JavaScript",
      titleSize: 88,
    });
  });

  test("drops an empty language and shrinks long stored names", () => {
    const medium = `${"o".repeat(10)}/${"n".repeat(8)}`;
    const long = `${"o".repeat(14)}/${"n".repeat(14)}`;
    expect(medium).toHaveLength(19);
    expect(long).toHaveLength(29);

    expect(repoOpenGraphCard(1, { full_name: medium, current_stars: 3, language: "" })).toEqual({
      kind: "repo",
      fullName: medium,
      stars: 3,
      language: null,
      titleSize: 72,
    });
    expect(repoOpenGraphCard(1, { full_name: long, current_stars: 3, language: null })).toMatchObject({
      kind: "repo",
      titleSize: 56,
    });
  });
});
