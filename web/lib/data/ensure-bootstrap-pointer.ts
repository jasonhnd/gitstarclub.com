import { BootstrapPublicationPointer } from "@/lib/contracts";

export const BOOTSTRAP_POINTER_PATH = "bootstrap/latest.json";

export type ListedGeneration = {
  generation: string;
  prefix: string;
};

export type EnsureBootstrapPointerPlan =
  | { action: "already-present"; pointer: BootstrapPublicationPointer }
  | { action: "commit"; generation: string; prefix: string; candidates: ListedGeneration[] }
  | { action: "leave-legacy-flat"; reason: string; candidates: ListedGeneration[] };

export function selectBootstrapGenerationToCommit(
  pointer: BootstrapPublicationPointer | null,
  candidates: ListedGeneration[],
): EnsureBootstrapPointerPlan {
  if (pointer) return { action: "already-present", pointer };

  const unique = new Map<string, ListedGeneration>();
  for (const candidate of candidates) {
    if (!/^bootstrap-[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(candidate.generation)) continue;
    unique.set(candidate.generation, candidate);
  }
  const usable = [...unique.values()].sort((left, right) => left.generation.localeCompare(right.generation));
  if (usable.length === 0) {
    return {
      action: "leave-legacy-flat",
      reason: "no sealed bootstrap generation exists; a pointer would be a fake commit",
      candidates: [],
    };
  }
  const selected = usable.at(-1);
  if (!selected) {
    return {
      action: "leave-legacy-flat",
      reason: "no sealed bootstrap generation exists; a pointer would be a fake commit",
      candidates: usable,
    };
  }
  return {
    action: "commit",
    generation: selected.generation,
    prefix: selected.prefix,
    candidates: usable,
  };
}

export function parseListedBootstrapGenerations(prefixes: string[]): ListedGeneration[] {
  const found: ListedGeneration[] = [];
  for (const prefix of prefixes) {
    const match = prefix.match(/^bootstrap\/generations\/(bootstrap-[A-Za-z0-9][A-Za-z0-9._-]{2,120})\/?$/);
    if (!match?.[1]) continue;
    found.push({ generation: match[1], prefix: `bootstrap/generations/${match[1]}` });
  }
  return found;
}
