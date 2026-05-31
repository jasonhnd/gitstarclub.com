import { ImageResponse } from "next/og";
import { getRepoIdByFullName, getRepoEntity } from "@/lib/data";
import { fmtStars } from "@/lib/format";

// Per-repo social card: owner/name · stars · language, on the graphite/gold brand surface.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GitHub star history";

export default async function Image({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullName()).get(fullName.toLowerCase());
  const repo = id !== undefined ? await getRepoEntity(id) : null;
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
          background: "#121316",
          color: "#e6e1e6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, color: "#cac4cf" }}>
          <span style={{ color: "#f4b942" }}>★</span> GitStarClub · Star history
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: titleSize, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{fullName}</div>
          {repo && (
            <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 30, fontSize: 50 }}>
              <span style={{ color: "#f4b942", fontWeight: 800 }}>{fmtStars(repo.current_stars)} ★</span>
              {repo.language && <span style={{ color: "#cac4cf" }}>{repo.language}</span>}
            </div>
          )}
        </div>
        <div style={{ fontSize: 30, color: "#8e9099" }}>11 years of stars, charted month by month.</div>
      </div>
    ),
    size,
  );
}
