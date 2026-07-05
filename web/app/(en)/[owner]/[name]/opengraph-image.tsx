import { ImageResponse } from "next/og";
import { getRepoIdByFullNameDaily, getRepoEntityDaily } from "@/lib/data";
import { fmtStars } from "@/lib/format";
import { OG_COLORS, OG_SIZE, OG_STAR_PATH } from "@/lib/og-theme";

// Per-repo social card: owner/name · stars · language. Stars are inline SVG (no ★ glyph in
// next/og's default font), on the graphite/gold brand surface.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitHub star history";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullNameDaily()).get(fullName.toLowerCase());
  const repo = id !== undefined ? await getRepoEntityDaily(id) : null;
  const titleSize = fullName.length > 28 ? 56 : fullName.length > 18 ? 72 : 88;

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
          <svg width="34" height="34" viewBox="0 0 24 24" fill={OG_COLORS.primaryFixedDim}>
            <path d={OG_STAR_PATH} />
          </svg>
          GitStarClub.com · Star history
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: titleSize, fontWeight: 800, letterSpacing: 0, lineHeight: 1.05 }}>{fullName}</div>
          {repo && (
            <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 22, fontSize: 50 }}>
              <svg width="46" height="46" viewBox="0 0 24 24" fill={OG_COLORS.primaryFixedDim}>
                <path d={OG_STAR_PATH} />
              </svg>
              <span style={{ color: OG_COLORS.primaryFixedDim, fontWeight: 800 }}>{fmtStars(repo.current_stars)}</span>
              {repo.language && <span style={{ color: OG_COLORS.onSurfaceVariant }}>{repo.language}</span>}
            </div>
          )}
        </div>
        <div style={{ fontSize: 30, color: OG_COLORS.outline }}>More than a decade of stars, charted month by month.</div>
      </div>
    ),
    size,
  );
}
