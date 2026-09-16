import { createHash, createHmac } from "node:crypto";

export const AWS_EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function encodeS3Path(pathname: string): string {
  return pathname.split("/").map(encodeRfc3986).join("/");
}

export function formatAmzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export function awsSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function canonicalizeQuery(searchParams: URLSearchParams): string {
  const pairs = [...searchParams.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

function normalizeHeaderMap(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[key.toLowerCase()] = value.trim();
  }
  return normalized;
}

export type SignS3RequestArgs = {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: Uint8Array;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  now?: Date;
};

export function signS3Request(args: SignS3RequestArgs): Record<string, string> {
  const service = args.service ?? "s3";
  const now = args.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const body = args.body ?? new Uint8Array();
  const payloadHash = body.byteLength === 0 ? AWS_EMPTY_PAYLOAD_HASH : sha256Hex(body);
  const headers: Record<string, string> = {
    ...normalizeHeaderMap(args.headers ?? {}),
    host: args.url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    args.method.toUpperCase(),
    args.url.pathname,
    canonicalizeQuery(args.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${args.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(awsSigningKey(args.secretAccessKey, dateStamp, args.region, service), stringToSign).toString("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
