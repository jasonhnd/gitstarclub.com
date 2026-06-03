import { ImageResponse } from "next/og";
import { fmtStars } from "@/lib/format";

// Shared ranking social card (period + year). Graphite/gold brand surface; stars are inline SVG
// (next/og's default font has no ★ glyph). See docs/IMPLEMENTATION-PLAN.md (v0.2 §4).

export const OG_SIZE = { width: 1200, height: 630 };

const STAR =
  "M12 .587l3.668 7.431 8.2 1.192-5.934 5.785 1.401 8.169L12 18.896l-7.335 3.868 1.401-8.169L.132 9.21l8.2-1.192z";

function Star({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#f4b942">
      <path d={STAR} />
    </svg>
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
          background: "#121316",
          color: "#e6e1e6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, color: "#cac4cf" }}>
          <Star s={34} />
          GitStarClub.com · Star rankings
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{label}</div>
          <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 16 }}>
            {rows.map((r, i) => (
              <div key={r.full} style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 40 }}>
                <span style={{ color: "#f4b942", fontWeight: 800, width: 60 }}>#{i + 1}</span>
                <span style={{ fontWeight: 700, overflow: "hidden" }}>{r.full}</span>
                <span style={{ color: "#f4b942", marginLeft: "auto", fontWeight: 800, display: "flex", alignItems: "center", gap: 12 }}>
                  <Star s={34} />+{fmtStars(r.gained)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 30, color: "#8e9099" }}>Top repositories by stars gained · charted month by month.</div>
      </div>
    ),
    OG_SIZE,
  );
}
