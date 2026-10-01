import type { FaqItem } from "@/lib/jsonld";

export function visibleFaqPairs(items: readonly FaqItem[]): Array<[string, string]> {
  return items.map((item) => [item.question, item.answer]);
}

export function visibleFaqSnapshot(items: readonly FaqItem[]): string {
  return ["Frequently asked questions", ...items.flatMap((item) => [item.question, item.answer])].join("\n");
}
