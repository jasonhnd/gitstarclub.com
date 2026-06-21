"use client";

const LIGHT_BG = "#fbfbfd";
const DARK_BG = "#121316";

function toggleTheme() {
  const root = document.documentElement;
  const attr = root.getAttribute("data-theme");
  const current =
    attr ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem("theme", next);
  } catch {
    // private mode / storage disabled — toggle still applies for the session
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? DARK_BG : LIGHT_BG);
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Switch theme"
      title="Switch theme"
      className="theme-toggle grid size-11 cursor-pointer place-items-center rounded-full bg-surface-container-high text-on-surface transition-[background,transform] duration-200 ease-[var(--ease-emphasized)] hover:bg-surface-container-highest active:scale-90"
    >
      <svg className="i-moon size-[22px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor" />
      </svg>
      <svg
        className="i-sun size-[22px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
