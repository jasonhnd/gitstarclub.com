import type { ReactNode } from "react";

/** Static React rendering only: category bodies have no hydration directive. */
export default function Body({ content }: { content: ReactNode }) { return content; }
