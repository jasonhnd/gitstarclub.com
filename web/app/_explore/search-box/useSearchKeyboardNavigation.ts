"use client";

import { useCallback, useState, type KeyboardEvent } from "react";

export function useSearchKeyboardNavigation({
  itemCount,
  onCommit,
  onEscape,
  onOpen,
}: {
  itemCount: number;
  onCommit: (index: number) => void;
  onEscape: () => void;
  onOpen: () => void;
}) {
  const [active, setActive] = useState(-1);

  const resetActive = useCallback(() => {
    setActive(-1);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onOpen();
        setActive((index) => (itemCount > 0 ? Math.min(index + 1, itemCount - 1) : -1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((index) => (itemCount > 0 ? Math.max(index - 1, 0) : -1));
      } else if (e.key === "Enter") {
        if (active >= 0 && active < itemCount) {
          e.preventDefault();
          onCommit(active);
        }
      } else if (e.key === "Escape") {
        onEscape();
        resetActive();
      }
    },
    [active, itemCount, onCommit, onEscape, onOpen, resetActive],
  );

  return { active, onKeyDown, resetActive, setActive };
}
