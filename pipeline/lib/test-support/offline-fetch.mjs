// @ts-nocheck -- Subprocess-only test transport. Never imported by production code.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const originalFetch = globalThis.fetch;
const originalConnect = net.Socket.prototype.connect;
const originalTlsConnect = tls.connect;
const denySocket = () => { throw new Error("offline backfill test refused a network socket"); };
net.Socket.prototype.connect = denySocket;
tls.connect = denySocket;
syncBuiltinESMExports();

const config = JSON.parse(readFileSync(process.env.BACKFILL_FIXTURE_CONFIG, "utf8"));
const trace = process.env.BACKFILL_FIXTURE_TRACE;
const remoteFile = process.env.BACKFILL_FIXTURE_REMOTE;
const log = (entry) => appendFileSync(trace, `${JSON.stringify(entry)}\n`);
const json = (body) => new Response(JSON.stringify(body), { status: 200 });
const etag = (body) => `"${createHash("sha256").update(body).digest("hex")}"`;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  if (config.github && url.hostname === "api.github.com") {
    log({ service: "github", method, path: url.pathname, query: url.searchParams.get("q") });
    if (config.githubError) return json({ errors: [{ message: "injected GraphQL failure" }] });
    if (url.pathname === "/search/repositories" && method === "GET") {
      const items = config.repositories.map((repo) => ({
        id: repo.id, node_id: repo.node_id, name: repo.name,
        full_name: repo.full_name, owner: { login: repo.owner }, stargazers_count: repo.current_stars,
      })).sort((a, b) => b.stargazers_count - a.stargazers_count);
      const top = url.searchParams.get("per_page") === "1";
      return json({ total_count: items.length, incomplete_results: !!config.incompleteSearch, items: top ? items.slice(0, 1) : items });
    }
    if (url.pathname === "/graphql" && method === "POST") {
      const ids = JSON.parse(init.body).variables.ids;
      return json({ data: { nodes: ids.map((id) => {
        const repo = config.repositories.find((r) => r.node_id === id);
        if (!repo || config.missingNode === id) return null;
        return {
          databaseId: repo.id, nameWithOwner: repo.full_name, name: repo.name,
          owner: { login: repo.owner, __typename: repo.owner_type }, description: repo.description,
          primaryLanguage: repo.language ? { name: repo.language } : null,
          repositoryTopics: { nodes: repo.topics.map((name) => ({ topic: { name } })) },
          createdAt: repo.created_at, stargazerCount: repo.current_stars, isArchived: repo.is_archived,
        };
      }) } });
    }
    throw new Error(`unexpected synthetic GitHub request ${method} ${url.pathname}`);
  }

  if (config.r2 && url.origin === "https://r2.invalid") {
    const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));
    const headers = new Headers(init.headers);
    log({ service: "r2", method, key, ifMatch: headers.get("if-match"), ifNoneMatch: headers.get("if-none-match") });
    const objects = JSON.parse(readFileSync(remoteFile, "utf8"));
    const stored = objects[key];
    const body = stored === undefined ? null : Buffer.from(stored, "base64");
    if (method === "GET") {
      return body === null
        ? new Response(null, { status: 404 })
        : new Response(body, { status: 200, headers: { etag: etag(body) } });
    }
    if (method === "PUT") {
      if ((headers.get("if-none-match") === "*" && body !== null)
        || (headers.has("if-match") && (body === null || headers.get("if-match") !== etag(body)))) {
        return new Response(null, { status: 412 });
      }
      const next = Buffer.from(init.body);
      objects[key] = next.toString("base64");
      writeFileSync(remoteFile, JSON.stringify(objects));
      return new Response(null, { status: 200, headers: { etag: etag(next) } });
    }
    if (method === "DELETE") {
      delete objects[key];
      writeFileSync(remoteFile, JSON.stringify(objects));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected synthetic R2 request ${method} ${key}`);
  }

  log({ service: "denied", method, origin: url.origin });
  throw new Error(`offline backfill test refused fetch ${method} ${url.origin}`);
};

process.on("exit", () => {
  globalThis.fetch = originalFetch;
  net.Socket.prototype.connect = originalConnect;
  tls.connect = originalTlsConnect;
  syncBuiltinESMExports();
});
