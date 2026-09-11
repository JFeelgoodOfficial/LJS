"use client";

import dynamic from "next/dynamic";

// The canvas renders nothing meaningful on the server - it is empty until the
// RAF loop starts - and the module touches window/navigator/localStorage on
// mount. Skipping SSR drops a large server render plus its hydration, and takes
// the chunk off the critical path.
const GameCanvas = dynamic(() => import("./GameCanvas"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-pixel-dark" aria-hidden="true" />,
});

export default function GameCanvasClient() {
  return <GameCanvas />;
}
