"use client";

import { useCallback, useMemo, useState } from "react";
import { MAX_COMPARE } from "@/lib/compare/constants";
import { nextCompareSelection } from "@/lib/compare/selection";

export function useCompareSelection(max = MAX_COMPARE) {
  const [compareSet, setCompareSet] = useState<Set<string>>(() => new Set());

  const toggleCompare = useCallback(
    (fullName: string) => {
      setCompareSet((current) => nextCompareSelection(current, fullName, max));
    },
    [max],
  );

  const clearCompare = useCallback(() => {
    setCompareSet(new Set());
  }, []);

  const compareParam = useMemo(() => encodeURIComponent([...compareSet].join(",")), [compareSet]);

  return { compareSet, toggleCompare, clearCompare, compareParam };
}
