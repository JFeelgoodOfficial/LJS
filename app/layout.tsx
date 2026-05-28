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
      <body className="bg-pixel-dark text-white overflow-hidden">
        {children}
      </body>
    </html>
  );
}
