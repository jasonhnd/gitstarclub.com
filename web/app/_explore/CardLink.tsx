import Link, { type LinkProps } from "next/link";
import type { ReactNode } from "react";

export function CardLink({
  href,
  eyebrow,
  title,
  description,
  meta,
  ariaLabel,
  className = "",
}: {
  href: LinkProps["href"];
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`block min-w-0 rounded-lg bg-surface-container px-4 py-4 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high ${className}`}
    >
      {eyebrow ? <span className="block font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{eyebrow}</span> : null}
      <span className={eyebrow ? "mt-2 block text-[1rem] font-extrabold text-on-surface" : "block text-[1rem] font-extrabold text-on-surface"}>{title}</span>
      {description ? <span className="mt-2 block text-[0.95rem] leading-relaxed text-on-surface-variant">{description}</span> : null}
      {meta ? <span className="mt-3 block font-mono text-[0.75rem] text-on-surface-variant">{meta}</span> : null}
    </Link>
  );
}
