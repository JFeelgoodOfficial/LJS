import GameCanvasClient from "@/components/GameCanvasClient";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Pixel Runner — Blast & Collect",
  alternateName: "Pixel Runner",
  url: "https://ljs-zeta.vercel.app",
  image: "https://ljs-zeta.vercel.app/og.png",
  description:
    "A free pixel-art platform runner. Blast through four zones, collect the three golden boxes, beat the boss, and unlock the secret win screen.",
  genre: ["Platformer", "Action", "Arcade"],
  gamePlatform: "Web browser",
  applicationCategory: "Game",
  operatingSystem: "Any (modern web browser)",
  playMode: "SinglePlayer",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function Home() {
  return (
    <main className="w-full h-screen flex flex-col items-center justify-center bg-pixel-dark overflow-hidden">
      {/* The page is otherwise a bare <canvas>, which gives crawlers and screen
          readers nothing to work with. This describes the actual content. */}
      <div className="sr-only">
        <h1>Pixel Runner — Blast &amp; Collect</h1>
        <p>
          A free pixel-art platform runner that plays in your browser, with no
          download or sign-up. Run through four zones — Forest, Dungeon, Lava and
          the Final Chamber — shooting enemies, smashing brick blocks and picking
          up rapid-fire, pierce and big-shot weapons along the way.
        </p>
        <p>
          Each zone hides a golden box holding one letter. Collect all three, then
          beat the boss in the Final Chamber to place them on the pedestal and
          unlock the secret win screen.
        </p>
        <h2>Controls</h2>
        <p>
          On a keyboard: arrow keys or A and D to move, space or the up arrow to
          jump, and X or the control key to shoot. On a phone or tablet, use the
          on-screen directional pad and fire button.
        </p>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <GameCanvasClient />
    </main>
  );
}
