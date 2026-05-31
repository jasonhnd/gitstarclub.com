import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GitStarClub — A Chronicle of Open Source",
    short_name: "GitStarClub",
    description: "A browsable chronicle of open source — month by month, year by year.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fbfbfd",
    theme_color: "#fbfbfd",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
