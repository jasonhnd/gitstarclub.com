export function parsePositiveIntegerParam(value: string | null): number | null {
  if (value === null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function safeInternalRedirectPath(next: string | null, requestUrl: URL | string): string {
  if (!next || !next.startsWith("/") || hasUnsafeRedirectSyntax(next)) return "/";

  try {
    const base = new URL(requestUrl);
    const resolved = new URL(next, base);
    if (resolved.origin !== base.origin || resolved.username || resolved.password) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

function hasUnsafeRedirectSyntax(value: string): boolean {
  let decoded = value;

  // Validate nested percent-encoding without changing the path returned to the
  // caller. Each pass decodes octets only; malformed percent text stays inert.
  for (let pass = 0; pass < 8; pass += 1) {
    if (hasUnsafeDecodedRedirectSyntax(decoded)) return true;
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === decoded) return false;
    decoded = next;
  }

  return hasUnsafeDecodedRedirectSyntax(decoded);
}

function hasUnsafeDecodedRedirectSyntax(value: string): boolean {
  return value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value);
}
