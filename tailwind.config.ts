import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', "cursive"],
      },
      colors: {
        "pixel-yellow": "#FFD700",
        "pixel-orange": "#FF8C00",
        "pixel-red": "#DC143C",
        "pixel-green": "#228B22",
        "pixel-blue": "#1E90FF",
        "pixel-dark": "#0a0a0a",
      },
    },
  },
  plugins: [],
};
export default config;
