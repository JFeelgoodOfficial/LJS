import type { Metadata, Viewport } from "next";
import "../styles/globals.css";

const SITE_URL = "https://ljs-zeta.vercel.app";
const TITLE = "Pixel Runner — Blast & Collect";
const DESCRIPTION =
  "A free pixel-art platform runner. Blast through four zones, collect the three golden boxes, beat the boss, and unlock the secret win screen. Plays in the browser on desktop and mobile — no install.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — Pixel Runner",
  },
  description: DESCRIPTION,
  applicationName: "Pixel Runner",
  keywords: [
    "pixel runner", "browser game", "free online game", "pixel art platformer",
    "html5 game", "retro runner", "arcade shooter", "play in browser",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Pixel Runner",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Pixel Runner title screen" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  appleWebApp: {
    capable: true,
    title: "Pixel Runner",
    statusBarStyle: "black-translucent",
  },
  other: { "mobile-web-app-capable": "yes" },
};

// Next emits this itself, so the hand-written <head> meta that used to live
// here was shipping a second, conflicting viewport tag on every page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" as="image" href="/LJS-title.webp" />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/press-start-2p.woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-pixel-dark text-white overflow-hidden touch-none select-none">
        {children}
      </body>
    </html>
  );
}
