import type { ReactNode } from "react";

export function PageHero({
  eyebrow,
  title,
  lede,
  actions,
  aside,
  className = "",
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-end ${className}`}>
      <div className="min-w-0">
        <p className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{eyebrow}</p>
        <h1 className="mt-3 max-w-[16ch] animate-rise text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] tracking-[-0.035em] text-on-surface">
          {title}
        </h1>
        <p className="mt-5 max-w-[52ch] text-[clamp(1.05rem,1.8vw,1.3rem)] text-on-surface-variant">{lede}</p>
        {actions ? <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {aside ? <aside className="min-w-0 lg:justify-self-end">{aside}</aside> : null}
    </section>
  );
}
