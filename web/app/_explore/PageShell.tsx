import type { ReactNode } from "react";
import { PAD_X } from "@/app/_explore/layout-tokens";

type PageShellWidth = "narrow" | "default" | "wide";

const WIDTH_CLASS: Record<PageShellWidth, string> = {
  narrow: "max-w-[60rem]",
  default: "max-w-[68rem]",
  wide: "max-w-[72rem]",
};

export function PageShell({
  children,
  className = "",
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: PageShellWidth;
}) {
  return (
    <main id="main" tabIndex={-1} className={`mx-auto w-full ${WIDTH_CLASS[width]} py-[clamp(1.5rem,4vw,3rem)] ${PAD_X} ${className}`}>
      {children}
    </main>
  );
}
