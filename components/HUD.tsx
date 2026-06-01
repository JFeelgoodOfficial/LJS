"use client";

interface HUDProps {
  score: number;
  level: number;
  lives: number;
  collectedBoxes: boolean[];
  ammo: number;
}

export default function HUD({ score, level, lives, collectedBoxes, ammo }: HUDProps) {
  const letters = ["A", "B", "C"];

  return (
    <div
      className="absolute top-0 left-0 w-full flex items-center justify-between px-4 py-2 z-10 pointer-events-none"
      style={{
        background: "linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)",
        fontFamily: '"Press Start 2P", cursive',
      }}
    >
      {/* Left: Score + Level */}
      <div className="flex flex-col gap-1">
        <span className="text-yellow-300 text-xs" style={{ fontSize: "9px" }}>
          SCORE: {String(score).padStart(6, "0")}
        </span>
        <span className="text-cyan-300 text-xs" style={{ fontSize: "9px" }}>
          LEVEL: {level === 4 ? "FINAL" : level}
        </span>
      </div>

      {/* Center: Collected Boxes */}
      <div className="flex gap-2 items-center">
        {collectedBoxes.map((collected, i) => (
          <div
            key={i}
            className="flex flex-col items-center"
            style={{ gap: "2px" }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                background: collected ? "#FFD700" : "#333",
                border: `2px solid ${collected ? "#FFA500" : "#555"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "8px",
                color: collected ? "#000" : "#666",
                fontFamily: '"Press Start 2P", cursive',
                imageRendering: "pixelated",
              }}
            >
              {collected ? letters[i] : "?"}
            </div>
          </div>
        ))}
      </div>

      {/* Right: Lives + Ammo */}
      <div className="flex flex-col gap-1 items-end">
        <span className="text-red-400 text-xs" style={{ fontSize: "9px" }}>
          {"♥ ".repeat(Math.max(0, lives)).trim()}
        </span>
        <span className="text-orange-300 text-xs" style={{ fontSize: "9px" }}>
          AMMO: {ammo === Infinity ? "∞" : ammo}
        </span>
      </div>
    </div>
  );
}
