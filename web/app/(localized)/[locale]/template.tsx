import type { ReactNode } from "react";
import { PageTemplate } from "../../_shell/PageTemplate";

export default function Template({ children }: { children: ReactNode }) {
  return <PageTemplate>{children}</PageTemplate>;
}
