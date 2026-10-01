import { describe, expect, spyOn, test } from "bun:test";
import * as runtimeEnv from "@/lib/workers-host/runtime-env";
import { SANITIZED_ERROR_MAX_CODE_POINTS, sanitizeErrorText } from "./sanitize-error";

const BEARER = "CANARYBEARERTOKEN1234567890abcd";
const CRON = "CANARYCRONSECRET1234567890abcd";
const BLOB = "vercel_blob_rw_CANARYBLOBTOKEN123456";
const R2 = "CANARYR2SECRETACCESSKEY1234567890";
const URL_PASSWORD = "CANARYURLPASSWORD1234567890";
const QUERY = "CANARYQUERYTOKEN1234567890abcd";
const GITHUB = "ghp_CANARYGITHUBTOKEN1234567890abcd";
const AWS = "AKIAIOSFODNN7EXAMPLE";

const CANARY_ENV = {
  CRON_SECRET: CRON,
  BLOB_READ_WRITE_TOKEN: BLOB,
  R2_SECRET_ACCESS_KEY: R2,
  GITHUB_TOKEN: GITHUB,
};

function leaked(value: string): string | null {
  for (const canary of [BEARER, CRON, "CANARYBLOB", R2, URL_PASSWORD, QUERY, "CANARYGITHUB", AWS]) {
    if (value.includes(canary)) return canary;
  }
  return null;
}

describe("sanitizeErrorText", () => {
  test("keeps a useful failure category and drops every synthetic canary", () => {
    const input = [
      "GitHub GraphQL 502:",
      `Authorization: Bearer ${BEARER}`,
      CRON,
      BLOB,
      R2,
      GITHUB,
      AWS,
      `https://reader:${URL_PASSWORD}@example.invalid/obj?token=${QUERY}`,
    ].join(" ");

    const output = sanitizeErrorText(input, { env: CANARY_ENV });

    expect(output).toContain("GitHub GraphQL 502");
    expect(output).toContain("Bearer [redacted]");
    expect(output).toContain("[redacted-url]");
    expect(leaked(output)).toBeNull();
    expect(output).not.toContain("example.invalid");
  });

  test("leaves ordinary diagnostics unchanged", () => {
    const samples = [
      "schema validation failed",
      "timeout",
      "HTTP 503",
      "GitHub request https://api.github.com/graphql failed: HTTP 502",
      "enqueue unavailable; failed to release fencing token 1",
    ];
    for (const sample of samples) {
      expect(sanitizeErrorText(sample, { env: {} })).toBe(sample);
    }
  });

  test("redacts bearer headers, credential URLs, query secrets, and token shapes without env", () => {
    const output = sanitizeErrorText(
      [
        "metadata fetch failed",
        `Bearer ${BEARER}`,
        `https://user:${URL_PASSWORD}@blob.example/path`,
        `https://hooks.example/alert?token=${QUERY}`,
        GITHUB,
        BLOB,
        AWS,
        `api_key=${R2}`,
        `CRON_SECRET=${CRON}`,
        `AWS_SECRET_ACCESS_KEY=${R2}`,
      ].join(" "),
      { env: {} },
    );

    expect(output).toContain("metadata fetch failed");
    expect(output).toContain("Bearer [redacted]");
    expect(output).toContain("[redacted-url]");
    expect(output).toContain("api_key=[redacted]");
    expect(output).toContain("CRON_SECRET=[redacted]");
    expect(output).toContain("AWS_SECRET_ACCESS_KEY=[redacted]");
    expect(leaked(output)).toBeNull();
    expect(output).not.toContain("blob.example");
    expect(output).not.toContain("hooks.example");
  });

  test("redacts a runtime secret that is only known from env", () => {
    const output = sanitizeErrorText(`refresh failed: ${CRON}`, { env: { CRON_SECRET: CRON } });
    expect(output).toBe("refresh failed: [redacted]");
  });

  test("redacts a secret webhook URL and any query string glued to it", () => {
    const output = sanitizeErrorText(
      `request to https://hooks.example.com/alert?token=${QUERY} failed`,
      { env: { ALERT_WEBHOOK_URL: "https://hooks.example.com/alert" } },
    );
    expect(output).toBe("request to [redacted-url] failed");
    expect(output).not.toContain("CANARY");
  });

  test("redacts every nonempty known secret, including values auth accepts", () => {
    const output = sanitizeErrorText("CRON_SECRET is not set: CANARYshort42 Bearer CANARY7", {
      env: { CRON_SECRET: "CANARYshort42" },
    });
    expect(output).toBe("CRON_SECRET is not set: [redacted] Bearer [redacted]");
    expect(output).not.toContain("CANARY");
  });

  test("redacts a live Worker binding secret that differs from process.env", () => {
    const live = "CANARYLIVEWORKERSECRET1234567890";
    const stale = "CANARYSTALEPROCESSSECRET1234567890";
    const previous = process.env.R2_SECRET_ACCESS_KEY;
    process.env.R2_SECRET_ACCESS_KEY = stale;
    const spy = spyOn(runtimeEnv, "resolveRuntimeEnv").mockReturnValue({
      R2_SECRET_ACCESS_KEY: live,
    });
    try {
      const output = sanitizeErrorText(`R2 request failed ${live} stale ${stale}`);
      expect(output).toBe("R2 request failed [redacted] stale [redacted]");
      expect(output).not.toContain("CANARY");
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
      else process.env.R2_SECRET_ACCESS_KEY = previous;
    }
  });

  test("redacts a credential whose terminator sits past the old scan window", () => {
    const password = "CANARYLONGPASS";
    const input = `fetch failed https://user:${password}${"A".repeat(850)}@example.invalid/path`;
    const output = sanitizeErrorText(input, { env: {} });
    expect(output).toContain("fetch failed");
    expect(output).toContain("[redacted-url]");
    expect(output).not.toContain("CANARY");
    expect(output).not.toContain("example.invalid");
    expect([...output].length).toBeLessThanOrEqual(SANITIZED_ERROR_MAX_CODE_POINTS);
  });

  test("redacts username-only URL credentials and quoted assignments", () => {
    const output = sanitizeErrorText(
      'metadata fetch failed https://CANARYUSERINFOTOKEN1234567890@example.invalid/path {"token":"CANARYQUOTEDTOKEN1234567890"}',
      { env: {} },
    );
    expect(output).toContain("metadata fetch failed");
    expect(output).toContain("[redacted-url]");
    expect(output).toContain('"token"=[redacted]');
    expect(output).not.toContain("CANARY");
    expect(output).not.toContain("example.invalid");
  });

  test("redacts quoted secrets that contain punctuation and JSON-escaped runtime values", () => {
    const quoted = sanitizeErrorText('metadata fetch failed {"token":"CANARYstart:CANARYtail!"}', { env: {} });
    expect(quoted).toContain("metadata fetch failed");
    expect(quoted).toContain('"token"=[redacted]');
    expect(quoted).not.toContain("CANARY");

    const secret = 'CANARYruntime"quoted';
    const encoded = sanitizeErrorText(JSON.stringify({ message: `GitHub GraphQL 502 ${secret}` }), {
      env: { CRON_SECRET: secret },
    });
    expect(encoded).toContain("GitHub GraphQL 502");
    expect(encoded).not.toContain("CANARY");
  });

  test("redacts the Vercel automation bypass secret from live bindings and from an explicit env map", () => {
    const live = "CANARYVERCELBYPASS1234567890";
    const stale = "CANARYSTALEBYPASS1234567890";
    const previous = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = stale;
    const spy = spyOn(runtimeEnv, "resolveRuntimeEnv").mockReturnValue({
      VERCEL_AUTOMATION_BYPASS_SECRET: live,
    });
    try {
      const output = sanitizeErrorText(`bypass failed ${live} stale ${stale}`);
      expect(output).toContain("bypass failed");
      expect(output).not.toContain("CANARY");
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = previous;
    }

    const explicit = sanitizeErrorText(`header leaked ${live}`, {
      env: { VERCEL_AUTOMATION_BYPASS_SECRET: live },
    });
    expect(explicit).toContain("header leaked");
    expect(explicit).not.toContain("CANARY");
  });

  test("reads an Error message and stays idempotent", () => {
    const once = sanitizeErrorText(new Error(`GitHub GraphQL 502 ${GITHUB}`), { env: {} });
    expect(once).toContain("GitHub GraphQL 502");
    expect(once).not.toContain("CANARY");
    expect(sanitizeErrorText(once, { env: CANARY_ENV })).toBe(once);
  });

  test("redacts a secret that starts inside the retained prefix before truncating", () => {
    const secret = CRON;
    const input = `${"x".repeat(490)}${secret} tail`;
    const output = sanitizeErrorText(input, { env: { CRON_SECRET: secret }, maxCodePoints: 500 });
    expect(output).not.toContain("CANARY");
    expect([...output].length).toBeLessThanOrEqual(500);
    expect(output.startsWith("x".repeat(80))).toBe(true);
  });

  test("bounds the result at the default code-point cap", () => {
    const output = sanitizeErrorText(`${"schema validation failed ".repeat(80)} ${CRON}`, {
      env: { CRON_SECRET: CRON },
    });
    expect([...output].length).toBeLessThanOrEqual(SANITIZED_ERROR_MAX_CODE_POINTS);
    expect(output).toContain("schema validation failed");
    expect(output).not.toContain("CANARY");
  });

  test("redacts a JSON web token and keeps the surrounding category", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const output = sanitizeErrorText(`session check failed ${jwt}`, { env: {} });
    expect(output).toBe("session check failed [redacted]");
  });
});
