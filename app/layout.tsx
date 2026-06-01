import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Pixel Runner — Blast & Collect",
  description: "A pixel-art infinite runner with guns, golden boxes, and a secret win screen.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="bg-pixel-dark text-white overflow-hidden touch-none select-none">
        {children}
      </body>
    </html>
  );
}
