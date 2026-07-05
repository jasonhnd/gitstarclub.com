"use client";

import { useCallback, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { SearchHit } from "@/lib/search/core";

export function useSearchKeyboardNavigation({
  active,
  hits,
  setActive,
  onClose,
  onOpen,
  onCommit,
}: {
  active: number;
  hits: readonly SearchHit[];
  setActive: Dispatch<SetStateAction<number>>;
  onClose: () => void;
  onOpen: () => void;
  onCommit: (hit: SearchHit) => void;
}) {
  return useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onOpen();
        setActive((i) => Math.min(i + 1, hits.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const hit = hits[active];
        if (hit) {
          e.preventDefault();
          onCommit(hit);
        }
      } else if (e.key === "Escape") {
        setActive(-1);
        onClose();
      }
    },
    [active, hits, onClose, onCommit, onOpen, setActive],
  );
}
