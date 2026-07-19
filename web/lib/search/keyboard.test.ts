import { describe, expect, test } from "bun:test";
import { inputSearchKeyboardAction, panelSearchKeyboardAction } from "./keyboard";

describe("search dialog keyboard contract", () => {
  test("input Arrow keys move real focus and Enter commits the first result", () => {
    expect(inputSearchKeyboardAction("ArrowDown", 3)).toEqual({ type: "focus", index: 0 });
    expect(inputSearchKeyboardAction("ArrowUp", 3)).toEqual({ type: "focus", index: 2 });
    expect(inputSearchKeyboardAction("Enter", 3)).toEqual({ type: "commit", index: 0 });
  });

  test("Escape closes while Tab remains native", () => {
    expect(inputSearchKeyboardAction("Escape", 3)).toEqual({ type: "close" });
    expect(inputSearchKeyboardAction("Tab", 3)).toEqual({ type: "native" });
    expect(panelSearchKeyboardAction("Escape", 1, 3)).toEqual({ type: "close" });
    expect(panelSearchKeyboardAction("Tab", 1, 3)).toEqual({ type: "native" });
  });

  test("panel Arrow keys move between result links without wrapping", () => {
    expect(panelSearchKeyboardAction("ArrowDown", 0, 3)).toEqual({ type: "focus", index: 1 });
    expect(panelSearchKeyboardAction("ArrowDown", 2, 3)).toEqual({ type: "focus", index: 2 });
    expect(panelSearchKeyboardAction("ArrowUp", 2, 3)).toEqual({ type: "focus", index: 1 });
    expect(panelSearchKeyboardAction("ArrowUp", 0, 3)).toEqual({ type: "focus", index: 0 });
  });
});
