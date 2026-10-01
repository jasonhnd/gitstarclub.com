import { ImageResponse } from "next/og";
import { fmtStars } from "@/lib/format";
import { OG_COLORS, OG_SIZE, OG_STAR_PATH } from "@/lib/og-theme";
import type { RepoOpenGraphCard } from "@/lib/repo-og";

// Shared social cards. Graphite/gold brand surface; stars are inline SVG
// (next/og's default font has no ★ glyph). See docs/SEO.md for the OG-card strategy.
export { OG_SIZE };

function Star({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={OG_COLORS.primaryFixedDim}>
      <path d={OG_STAR_PATH} />
    </svg>
  );
}

/** Site card. Unknown repository paths use this same card and do not paint the URL. */
export function siteCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "90px",
          background: OG_COLORS.surface,
          color: OG_COLORS.onSurface,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="84" height="84" viewBox="0 0 24 24" fill={OG_COLORS.primaryFixedDim}>
            <path d={OG_STAR_PATH} />
          </svg>
          <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: 0 }}>GitStarClub.com</div>
        </div>
        <div style={{ marginTop: 36, fontSize: 46, color: OG_COLORS.onSurfaceVariant, maxWidth: 940, lineHeight: 1.25 }}>
          A chronicle of open source — more than a decade of GitHub star history across 5,300+ projects.
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

type RepoCard = Extract<RepoOpenGraphCard, { kind: "repo" }>;

/** Known repository: stored full_name, star count, and primary language. */
export function repoCard(card: RepoCard): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: OG_COLORS.surface,
          color: OG_COLORS.onSurface,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, color: OG_COLORS.onSurfaceVariant }}>
          <Star s={34} />
          GitStarClub.com · Star history
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: card.titleSize, fontWeight: 800, letterSpacing: 0, lineHeight: 1.05 }}>{card.fullName}</div>
          <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 22, fontSize: 50 }}>
            <Star s={46} />
            <span style={{ color: OG_COLORS.primaryFixedDim, fontWeight: 800 }}>{fmtStars(card.stars)}</span>
            {card.language ? <span style={{ color: OG_COLORS.onSurfaceVariant }}>{card.language}</span> : null}
          </div>
        </div>
        <div style={{ fontSize: 30, color: OG_COLORS.outline }}>More than a decade of stars, charted month by month.</div>
      </div>
    ),
    OG_SIZE,
  );
}

/** Heading label (e.g. "June 2024" / "2024") + that period's top-3 repos by stars gained. */
export function rankingCard(label: string, rows: ReadonlyArray<{ full: string; gained: number }>): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: OG_COLORS.surface,
          color: OG_COLORS.onSurface,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, color: OG_COLORS.onSurfaceVariant }}>
          <Star s={34} />
          GitStarClub.com · Star rankings
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: 0, lineHeight: 1.05 }}>{label}</div>
          <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 16 }}>
            {rows.map((r, i) => (
              <div key={r.full} style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 40 }}>
                <span style={{ color: OG_COLORS.primaryFixedDim, fontWeight: 800, width: 60 }}>#{i + 1}</span>
                <span style={{ fontWeight: 700, overflow: "hidden" }}>{r.full}</span>
                <span style={{ color: OG_COLORS.primaryFixedDim, marginLeft: "auto", fontWeight: 800, display: "flex", alignItems: "center", gap: 12 }}>
                  <Star s={34} />+{fmtStars(r.gained)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 30, color: OG_COLORS.outline }}>Top repositories by stars gained · charted month by month.</div>
      </div>
    ),
    OG_SIZE,
  );
}
