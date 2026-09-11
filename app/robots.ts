import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://ljs-zeta.vercel.app/sitemap.xml",
    host: "https://ljs-zeta.vercel.app",
  };
}
