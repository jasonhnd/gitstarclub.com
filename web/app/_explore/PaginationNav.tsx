import Link from "next/link";

export function PaginationNav({
  currentPage,
  pageCount,
  hrefForPage,
  label,
  previousLabel,
  nextLabel,
  labels,
}: {
  currentPage: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
  label: string;
  previousLabel?: string;
  nextLabel?: string;
  labels?: {
    previous: string;
    next: string;
  };
}) {
  if (pageCount <= 1) return null;

  const text = {
    previous: previousLabel ?? labels?.previous ?? "Previous",
    next: nextLabel ?? labels?.next ?? "Next",
  };
  const windowStart = Math.max(1, currentPage - 2);
  const windowEnd = Math.min(pageCount, currentPage + 2);
  const pages = Array.from({ length: windowEnd - windowStart + 1 }, (_, index) => windowStart + index);

  return (
    <nav aria-label={label} className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[0.78rem]">
      {currentPage > 1 && (
        <Link rel="prev" href={hrefForPage(currentPage - 1)} className="rounded-full bg-surface-container px-3 py-2 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
          {text.previous}
        </Link>
      )}
      {windowStart > 1 && <PageLink page={1} currentPage={currentPage} hrefForPage={hrefForPage} />}
      {windowStart > 2 && <span className="px-1 text-on-surface-variant">...</span>}
      {pages.map((page) => (
        <PageLink key={page} page={page} currentPage={currentPage} hrefForPage={hrefForPage} />
      ))}
      {windowEnd < pageCount - 1 && <span className="px-1 text-on-surface-variant">...</span>}
      {windowEnd < pageCount && <PageLink page={pageCount} currentPage={currentPage} hrefForPage={hrefForPage} />}
      {currentPage < pageCount && (
        <Link rel="next" href={hrefForPage(currentPage + 1)} className="rounded-full bg-surface-container px-3 py-2 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
          {text.next}
        </Link>
      )}
    </nav>
  );
}

function PageLink({
  page,
  currentPage,
  hrefForPage,
}: {
  page: number;
  currentPage: number;
  hrefForPage: (page: number) => string;
}) {
  const isCurrent = page === currentPage;
  return (
    <Link
      href={hrefForPage(page)}
      aria-current={isCurrent ? "page" : undefined}
      className={
        isCurrent
          ? "rounded-full bg-primary px-3 py-2 text-on-primary"
          : "rounded-full bg-surface-container px-3 py-2 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      }
    >
      {page}
    </Link>
  );
}
