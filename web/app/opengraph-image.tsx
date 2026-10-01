import { siteCard, OG_SIZE } from "@/lib/og-card";

// Default social card. Star is an inline SVG because next/og's default font has no ★ glyph.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitStarClub.com — A Chronicle of Open Source";
export const revalidate = 86400;

export default function Image() {
  return siteCard();
}
