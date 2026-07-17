export type SearchKeyboardAction =
  | { type: "commit"; index: number }
  | { type: "focus"; index: number }
  | { type: "close" }
  | { type: "native" };

export function inputSearchKeyboardAction(key: string, itemCount: number): SearchKeyboardAction {
  if (key === "Escape") return { type: "close" };
  if (itemCount <= 0) return { type: "native" };
  if (key === "ArrowDown") return { type: "focus", index: 0 };
  if (key === "ArrowUp") return { type: "focus", index: itemCount - 1 };
  if (key === "Enter") return { type: "commit", index: 0 };
  return { type: "native" };
}

export function panelSearchKeyboardAction(key: string, index: number, itemCount: number): SearchKeyboardAction {
  if (key === "Escape") return { type: "close" };
  if (itemCount <= 0) return { type: "native" };
  if (key === "ArrowDown") return { type: "focus", index: Math.min(index + 1, itemCount - 1) };
  if (key === "ArrowUp") return { type: "focus", index: Math.max(index - 1, 0) };
  return { type: "native" };
}
