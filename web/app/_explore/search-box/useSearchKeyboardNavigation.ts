"use client";

import { useCallback, type KeyboardEvent } from "react";
import { inputSearchKeyboardAction, panelSearchKeyboardAction, type SearchKeyboardAction } from "@/lib/search/keyboard";

export function useSearchKeyboardNavigation({
  itemCount,
  onCommit,
  onEscape,
  onFocusItem,
  onOpen,
}: {
  itemCount: number;
  onCommit: (index: number) => void;
  onEscape: () => void;
  onFocusItem: (index: number) => void;
  onOpen: () => void;
}) {
  const handleAction = useCallback(
    (event: KeyboardEvent<HTMLElement>, action: SearchKeyboardAction) => {
      if (action.type === "native") return;
      event.preventDefault();
      if (action.type === "close") {
        onEscape();
      } else if (action.type === "commit") {
        onCommit(action.index);
      } else {
        onOpen();
        onFocusItem(action.index);
      }
    },
    [onCommit, onEscape, onFocusItem, onOpen],
  );

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      handleAction(event, inputSearchKeyboardAction(event.key, itemCount));
    },
    [handleAction, itemCount],
  );

  const onResultKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number) => {
      handleAction(event, panelSearchKeyboardAction(event.key, index, itemCount));
    },
    [handleAction, itemCount],
  );

  return { onInputKeyDown, onResultKeyDown };
}
