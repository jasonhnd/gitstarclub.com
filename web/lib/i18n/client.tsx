import en, { type Dict } from "./dictionaries/en";

// Server-safe chrome text helpers. Pages render the default locale into static
// HTML; the language cookie only affects small client islands such as the
// language switcher and purpose-built interactive tools.

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type ChromeKey = Leaves<Dict>;

function lookupPath(t: Dict, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], t);
}

export function resolveChromePath(t: Dict, path: string): string {
  const value = lookupPath(t, path);
  if (typeof value === "string") return value;

  const fallback = t === en ? value : lookupPath(en, path);
  if (typeof fallback === "string") return fallback;
  return path;
}

export function chromeText(path: ChromeKey): string {
  return resolveChromePath(en, path);
}

export function T({ path }: { path: ChromeKey }) {
  return <>{chromeText(path)}</>;
}
