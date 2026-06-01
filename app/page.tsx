import GameCanvas from "@/components/GameCanvas";

export default function Home() {
  return (
    <main className="w-full h-screen flex flex-col items-center justify-center bg-pixel-dark overflow-hidden">
      <GameCanvas />
    </main>
  );
}
