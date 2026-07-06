import type { ReactNode } from "react";

export function TwoColumnLayout({
  children,
  aside,
  className = "",
}: {
  children: ReactNode;
  aside: ReactNode;
  className?: string;
}) {
  return (
    <section className={`grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start ${className}`}>
      <div className="min-w-0">{children}</div>
      <aside className="min-w-0">{aside}</aside>
    </section>
  );
}
