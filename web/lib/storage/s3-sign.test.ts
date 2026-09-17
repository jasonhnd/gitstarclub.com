import { describe, expect, test } from "bun:test";
import { encodeS3Path, formatAmzDate, signS3Request } from "./s3-sign";

describe("S3 SigV4 helper", () => {
  test("signs a PUT with If-Match and is stable for a fixed clock", () => {
    const url = new URL("https://00f850e853e4c7f9627233d51a6e30a1.r2.cloudflarestorage.com/gitstarclub-assets/migrate-dev/ops/a.json");
    const now = new Date("2026-09-16T00:00:00.000Z");
    const body = new TextEncoder().encode('{"ok":true}');
    const first = signS3Request({
      method: "PUT",
      url,
      headers: { "content-type": "application/json", "if-match": '"etag-1"' },
      body,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      region: "auto",
      now,
    });
    const second = signS3Request({
      method: "PUT",
      url,
      headers: { "content-type": "application/json", "if-match": '"etag-1"' },
      body,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      region: "auto",
      now,
    });
    expect(first.authorization).toBe(second.authorization);
    expect(first.authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260916/auto/s3/aws4_request");
    expect(first.authorization).toContain("SignedHeaders=");
    expect(first["if-match"]).toBe('"etag-1"');
    expect(formatAmzDate(now)).toBe("20260916T000000Z");
    expect(encodeS3Path("migrate-dev/views/a.json")).toBe("migrate-dev/views/a.json");
  });
});
