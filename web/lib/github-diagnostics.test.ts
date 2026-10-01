import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchRepositoryMetadata, fetchStarCounts } from "./github";

const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

describe("github diagnostic logs", () => {
  test("partial GraphQL errors and invalid nodes omit secret canaries", async () => {
    const canary = "ghp_CANARYGITHUBTOKEN1234567890abcd";
    process.env.GITHUB_TOKEN = "fixture-github-token-value";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const partial = { errors: [{ message: `partial GitHub GraphQL 502 ${canary}` }] };
    const invalidNode = {
      databaseId: 1,
      nameWithOwner: "acme/demo",
      owner: { login: "acme", __typename: canary },
      name: "demo",
      description: null,
      primaryLanguage: null,
      languages: { edges: [] },
      repositoryTopics: { nodes: [] },
      createdAt: "2020-01-01T00:00:00Z",
      stargazerCount: 10,
      isArchived: false,
    };
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const data = body.includes("nodes(ids:")
        ? { nodes: [invalidNode] }
        : { r0: { stargazerCount: 1 } };
      return new Response(JSON.stringify({ data, ...partial }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await fetchStarCounts([{ id: 1, owner: "acme", name: "demo" }]);
      await fetchRepositoryMetadata(["R_1"]);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain("GraphQL returned partial errors");
      expect(logged).toContain("skipped invalid repository node");
      expect(logged).toContain("GitHub GraphQL 502");
      expect(logged).not.toContain("CANARY");

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ errors: [{ message: `partial GitHub GraphQL 502 ${canary}` }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
      await expect(fetchStarCounts([{ id: 1, owner: "acme", name: "demo" }])).rejects.toThrow(/GitHub GraphQL 502/);
      try {
        await fetchStarCounts([{ id: 1, owner: "acme", name: "demo" }]);
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).not.toContain("CANARY");
      }
    } finally {
      warn.mockRestore();
    }
  });
});
