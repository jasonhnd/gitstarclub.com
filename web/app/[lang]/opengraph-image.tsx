import { ImageResponse } from "next/og";

// Default social card for all [lang] pages (overridden per-route where a richer card exists).
// Graphite surface + gold star, matching the brand. Flexbox + inline styles only (next/og subset).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GitStarClub — A Chronicle of Open Source";

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
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ fontSize: 90, color: "#f4b942" }}>★</div>
          <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: "-0.03em" }}>GitStarClub</div>
        </div>
        <div style={{ marginTop: 36, fontSize: 46, color: "#cac4cf", maxWidth: 940, lineHeight: 1.25 }}>
          A chronicle of open source — 11 years of GitHub star history across 5,200+ projects.
        </div>
      </div>
    ),
    size,
  );
}
