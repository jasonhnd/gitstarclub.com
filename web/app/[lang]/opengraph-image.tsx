import { ImageResponse } from "next/og";

// Default social card for all [lang] pages. Star is an inline SVG (next/og's default font
// has no ★ glyph). Graphite surface + gold star, matching the brand.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GitStarClub.com — A Chronicle of Open Source";

const STAR =
  "M12 .587l3.668 7.431 8.2 1.192-5.934 5.785 1.401 8.169L12 18.896l-7.335 3.868 1.401-8.169L.132 9.21l8.2-1.192z";

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
          background: "#121316",
          color: "#e6e1e6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="84" height="84" viewBox="0 0 24 24" fill="#f4b942">
            <path d={STAR} />
          </svg>
          <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: "-0.03em" }}>GitStarClub.com</div>
        </div>
        <div style={{ marginTop: 36, fontSize: 46, color: "#cac4cf", maxWidth: 940, lineHeight: 1.25 }}>
          A chronicle of open source — 11 years of GitHub star history across 5,200+ projects.
        </div>
      </div>
    ),
    size,
  );
}
