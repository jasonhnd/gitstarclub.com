import type { ReactNode } from "react";

type ContentGridColumns = 2 | 3 | 4;

const COLUMN_CLASS: Record<ContentGridColumns, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function ContentGrid({
  children,
  className = "",
  columns = 3,
}: {
  children: ReactNode;
  className?: string;
  columns?: ContentGridColumns;
}) {
  return <div className={`grid gap-3 ${COLUMN_CLASS[columns]} ${className}`}>{children}</div>;
}
