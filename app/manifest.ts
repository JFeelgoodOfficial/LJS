import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pixel Runner — Blast & Collect",
    short_name: "Pixel Runner",
    description:
      "A free pixel-art platform runner. Blast through four zones, collect the golden boxes, beat the boss.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icon.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
