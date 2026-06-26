export const LLMS_CANONICAL_ORIGIN = "https://gitstarclub.com";

type LlmsSection = {
  title: string;
  links: Array<{ label: string; href: string }>;
};

export const llmsSections: LlmsSection[] = [
  {
    title: "Core data surfaces",
    links: [
      { label: "GitStarClub home", href: "/" },
      { label: "Open-source pulse", href: "/pulse" },
      { label: "All-time rankings", href: "/rankings" },
      { label: "June 2026 rankings", href: "/rankings/2026/6" },
      { label: "Python category rankings", href: "/categories/language/python" },
      { label: "Repository comparison", href: "/compare" },
      { label: "Vercel organization star history", href: "/o/vercel" },
      { label: "react/react star history", href: "/react/react" },
    ],
  },
  {
    title: "Methodology and docs",
    links: [
      { label: "About GitStarClub data sources", href: "/about" },
      { label: "Ranking methodology", href: "https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/RANKING.md" },
      { label: "Data contracts", href: "https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-CONTRACTS.md" },
      { label: "GEO and crawler hygiene", href: "https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/GEO.md" },
    ],
  },
];

export function buildLlmsTxt(): string {
  const lines = [
    "# GitStarClub",
    "",
    "> Deterministic GitHub star history, rankings, milestones, category views, and organization aggregates for tracked open-source repositories.",
    "",
  ];

  for (const section of llmsSections) {
    lines.push(`## ${section.title}`, "");
    for (const link of section.links) lines.push(`- [${link.label}](${absoluteLlmsUrl(link.href)})`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function absoluteLlmsUrl(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  if (href === "/") return `${LLMS_CANONICAL_ORIGIN}/`;
  return `${LLMS_CANONICAL_ORIGIN}${href}`;
}
