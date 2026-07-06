import Link from "next/link";

export type RelatedPageItem = {
  href: `/${string}`;
  label: string;
};

export function RelatedPages({
  title,
  description,
  items,
  className = "",
}: {
  title: string;
  description: string;
  items: readonly RelatedPageItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className={`mt-[clamp(2rem,4vw,3rem)] ${className}`}>
      <div className="max-w-[64ch]">
        <h2 className="text-[1.25rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-on-surface-variant">{description}</p>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={`${item.href}:${item.label}`}>
            <Link
              href={item.href}
              className="group flex h-full min-h-16 items-center justify-between gap-3 rounded-lg bg-surface-container px-4 py-3 text-on-surface transition-colors hover:bg-surface-container-high"
            >
              <span className="min-w-0 text-[0.95rem] font-semibold leading-snug group-hover:underline group-hover:underline-offset-2">{item.label}</span>
              <span aria-hidden className="shrink-0 font-mono text-[1rem] text-on-surface-variant transition-colors group-hover:text-on-surface">
                &rarr;
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
