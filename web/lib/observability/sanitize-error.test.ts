import { describe, expect, test } from "bun:test";
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

  test("ignores runtime values shorter than 16 characters", () => {
    const output = sanitizeErrorText("CRON_SECRET is not set: secret", {
      env: { CRON_SECRET: "secret" },
    });
    expect(output).toBe("CRON_SECRET is not set: secret");
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
