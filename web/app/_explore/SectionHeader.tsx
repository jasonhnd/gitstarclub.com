import type { ReactNode } from "react";

export function SectionHeader({
  eyebrow,
  title,
  lede,
  actions,
  className = "",
  headingId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 md:flex-row md:items-end md:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow ? <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{eyebrow}</p> : null}
        <h2
          id={headingId}
          className={eyebrow ? "mt-2 text-[1.3rem] font-extrabold tracking-tight text-on-surface" : "text-[1.3rem] font-extrabold tracking-tight text-on-surface"}
        >
          {title}
        </h2>
        {lede ? <p className="mt-1 max-w-[58ch] text-[0.95rem] leading-relaxed text-on-surface-variant">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
