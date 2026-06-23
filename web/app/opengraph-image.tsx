import { ImageResponse } from "next/og";
import { OG_COLORS, OG_SIZE, OG_STAR_PATH } from "@/lib/og-theme";

// Default social card. Star is an inline SVG because next/og's default font has no ★ glyph.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitStarClub.com — A Chronicle of Open Source";
export const revalidate = 86400;

export default function Image() {
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
    size,
  );
}
