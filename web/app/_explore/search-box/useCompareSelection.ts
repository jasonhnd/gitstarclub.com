"use client";

import { useCallback, useState } from "react";

export function useCompareSelection(max: number) {
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());

  const clearCompare = useCallback(() => {
    setCompareSet(new Set());
  }, []);

  const toggleCompare = useCallback(
    (fullName: string) => {
      setCompareSet((prev) => {
        const next = new Set(prev);
        if (next.has(fullName)) next.delete(fullName);
        else if (next.size < max) next.add(fullName);
        return next;
      });
    },
    [max],
  );

  return { clearCompare, compareSet, toggleCompare };
}
