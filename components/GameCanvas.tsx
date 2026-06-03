"use client";

import { useEffect, useRef, useState } from "react";
import HUD from "./HUD";

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const CANVAS_W = 800;
const CANVAS_H = 450;
const GRAVITY = 0.55;
const JUMP_FORCE = -13;
const PLAYER_SPEED = 4;
const BULLET_SPEED = 10;
const GROUND_Y = CANVAS_H - 130;
const TILE = 32;

const SCROLL_SPEEDS = [3, 4.5, 6, 2];
const BOSS_ROOM_W = 2400;

const LEVEL_PALETTES = [
  { sky: "#1a1a2e", ground: "#2d5a27", accent: "#4CAF50", block: "#8B4513", trim: "#A0522D" },
  { sky: "#0d0d1a", ground: "#1a1a4a", accent: "#3333aa", block: "#444", trim: "#666" },
  { sky: "#2d0000", ground: "#5a0000", accent: "#ff4444", block: "#8B0000", trim: "#CC0000" },
  { sky: "#0a0a0a", ground: "#1a1200", accent: "#FFD700", block: "#3d3000", trim: "#806000" },
];

// ─────────────────────────────────────────────
//  TOUCH CONTROL LAYOUT  (in canvas-space coords)
// ─────────────────────────────────────────────
const TC = {
  // Left cluster — D-pad
  LEFT:  { x: 30,  y: CANVAS_H - 110, w: 60, h: 60 },
  RIGHT: { x: 150, y: CANVAS_H - 110, w: 60, h: 60 },
  JUMP:  { x: 90,  y: CANVAS_H - 170, w: 60, h: 60 },
  // Right cluster — shoot button
  SHOOT: { x: CANVAS_W - 110, y: CANVAS_H - 160, w: 90, h: 90 },
};

// ─────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────
interface Rect { x: number; y: number; w: number; h: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface Bullet { x: number; y: number; vx: number; active: boolean; big?: boolean; pierce?: boolean; }
interface Block { x: number; y: number; w: number; h: number; hp: number; maxHp: number; color: string; broken: boolean; }
interface GoldenBox { x: number; y: number; w: number; h: number; collected: boolean; letter: string; spawned: boolean; }
interface AmmoCrate { x: number; y: number; w: number; h: number; collected: boolean; }
interface WeaponPickup { x: number; y: number; w: number; h: number; collected: boolean; type: "rapid" | "double" | "big" | "pierce"; }
interface Enemy {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number; hp: number;
  onGround: boolean; active: boolean;
  type: "walker" | "jumper" | "flyer";
  jumpTimer: number;
  sinOffset: number;
}
interface Platform { x: number; y: number; w: number; h: number; }
interface Star { x: number; y: number; size: number; twinkle: number; }
interface PedestalSlot { x: number; y: number; filled: boolean; letter: string; }
interface Boss {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  phase: number;
  active: boolean;
  onGround: boolean;
  defeated: boolean;
  chargeTimer: number;
  jumpTimer: number;
  chargeActive: boolean;
  chargeFrames: number;
  // Level 4 boss state machine
  attackType: "idle" | "spray" | "bombs" | "stomp";
  attackTimer: number;
  attackCooldown: number;
  sprayParticles: Array<{x: number; y: number; vx: number; vy: number; life: number; maxLife: number}>;
  bombs: Array<{x: number; y: number; vx: number; vy: number; landed: boolean; explodeTimer: number; active: boolean}>;
  stompRising: boolean;
  stompTargetX: number;
  stompY: number;
  stompPasses: number;
  defeatedTimer: number;
}

interface GameState {
  phase: "title" | "playing" | "dead" | "levelComplete" | "win";
  level: number;
  score: number;
  lives: number;
  ammo: number;
  collectedBoxes: boolean[];
  collectedLetters: string[];
  letterReveal: { letter: string; timer: number; maxTimer: number } | null;

  px: number;
  py: number;
  pvx: number;
  pvy: number;
  pOnGround: boolean;
  pFacing: number;
  pFrame: number;
  pAnimTimer: number;
  pInvincible: number;
  pFlash: boolean;

  scrollX: number;
  scrollSpeed: number;
  levelProgress: number;
  levelLength: number;

  blocks: Block[];
  bullets: Bullet[];
  particles: Particle[];
  enemies: Enemy[];
  platforms: Platform[];
  goldenBox: GoldenBox | null;
  ammoCrates: AmmoCrate[];
  weaponPickups: WeaponPickup[];
  activeWeapon: { type: "rapid" | "double" | "big" | "pierce"; shotsLeft: number } | null;
  stars: Star[];
  boss: Boss | null;

  pedestalSlots: PedestalSlot[];
  boxesToPlace: string[];
  placingIndex: number;
  placeTimer: number;
  nameRevealTimer: number;

  keys: Record<string, boolean>;
  shootCooldown: number;
  isFiring: boolean;
  levelTransTimer: number;
  deathTimer: number;
  deathCause: string;
  titleAnimTimer: number;
  bgParticles: Particle[];

  shakeTimer: number;
  comboCount: number;
  comboTimer: number;
  cliffX: number | null;
  l4Phase: "boss" | "pedestal";
  cameraX: number;
}

// ─────────────────────────────────────────────
//  WEB AUDIO
// ─────────────────────────────────────────────
function createAudio() {
  let ctx: AudioContext | null = null;
  function getCtx() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function playTone(freq: number, duration: number, type: OscillatorType = "square", vol = 0.15) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, c.currentTime + duration);
      gain.gain.setValueAtTime(vol, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration);
    } catch {}
  }
  function playJump()    { playTone(300, 0.15, "square", 0.12); }
  function playShoot()   { playTone(800, 0.08, "square", 0.1); }
  function playHit()     { playTone(150, 0.1, "sawtooth", 0.15); }
  function playCollect() {
    playTone(523, 0.1, "square", 0.15);
    setTimeout(() => playTone(659, 0.1, "square", 0.15), 100);
    setTimeout(() => playTone(784, 0.15, "square", 0.15), 200);
  }
  function playDeath() {
    playTone(400, 0.1, "sawtooth", 0.2);
    setTimeout(() => playTone(300, 0.1, "sawtooth", 0.2), 100);
    setTimeout(() => playTone(200, 0.2, "sawtooth", 0.2), 200);
  }
  function playLevelUp() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.15, "square", 0.18), i * 120));
  }
  function playWin() {
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((f, i) => setTimeout(() => playTone(f, 0.2, "square", 0.2), i * 160));
  }
  function playPlace()    { playTone(440, 0.12, "square", 0.18); }
  function playEnemyDie() { playTone(200, 0.12, "sawtooth", 0.13); }
  function playTypeTick(freq: number) { playTone(freq, 0.08, "square", 0.08); }

  return { playJump, playShoot, playHit, playCollect, playDeath, playLevelUp, playWin, playPlace, playEnemyDie, playTone, playTypeTick };
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function rectsOverlap(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function spawnParticles(particles: Particle[], x: number, y: number, color: string, count = 8, speed = 4) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const s = speed * (0.5 + Math.random());
    particles.push({ x, y, vx: Math.cos(angle) * s, vy: Math.sin(angle) * s - 2, life: 40 + Math.random() * 20, maxLife: 60, color, size: 3 + Math.random() * 3 });
  }
}

function makeEnemy(x: number, y: number, vx: number, hp: number, type: "walker" | "jumper" | "flyer"): Enemy {
  const sinOffset = Math.random(); // for flyers: scales dive interval randomness (0-1)
  const startY = type === "flyer" ? GROUND_Y - 160 : y;
  // flyers start with a random cruising countdown (-40 to -160 so dives are staggered)
  const jumpTimer = type === "flyer" ? -(40 + Math.floor(sinOffset * 80)) : Math.floor(Math.random() * 90);
  return { x, y: startY, w: 28, h: 28, vx, vy: 0, hp, onGround: false, active: true, type, jumpTimer, sinOffset };
}

const WEAPON_TYPES: Array<"rapid" | "double" | "big" | "pierce"> = ["rapid", "pierce"];
const WEAPON_SHOTS: Record<string, number> = { rapid: 20, double: 12, big: 10, pierce: 8 };

function generateLevel(level: number, scrollX: number): { blocks: Block[]; platforms: Platform[]; enemies: Enemy[]; ammoCrates: AmmoCrate[]; weaponPickups: WeaponPickup[] } {
  const blocks: Block[] = [];
  const platforms: Platform[] = [];
  const enemies: Enemy[] = [];
  const ammoCrates: AmmoCrate[] = [];
  const weaponPickups: WeaponPickup[] = [];
  const pal = LEVEL_PALETTES[level - 1] ?? LEVEL_PALETTES[0];
  const startX = scrollX + CANVAS_W + 100;

  function maybeSpawnCrate(px: number, py: number) {
    const roll = Math.random();
    if (roll < 0.15) {
      // weapon pickup (~15% chance)
      const type = WEAPON_TYPES[Math.floor(Math.random() * WEAPON_TYPES.length)];
      weaponPickups.push({ x: px + 50 + Math.random() * 20, y: py - 26, w: 22, h: 22, collected: false, type });
    } else if (roll < 0.40) {
      // ammo crate (~25% chance)
      ammoCrates.push({ x: px + 30 + Math.random() * 20, y: py - 24, w: 20, h: 20, collected: false });
    }
  }

  if (level === 1) {
    // 2 gap chunks + normal platforms
    const gapPositions = new Set<number>();
    while (gapPositions.size < 2) gapPositions.add(Math.floor(Math.random() * 10) + 1);

    let curX = startX;
    for (let i = 0; i < 12; i++) {
      if (gapPositions.has(i)) {
        curX += 220;
        continue;
      }
      const x = curX + Math.random() * 40;
      const y = GROUND_Y - 60 - Math.random() * 80;
      platforms.push({ x, y, w: 80 + Math.random() * 60, h: 16 });
      if (Math.random() > 0.4) blocks.push({ x: x + 10, y: y - TILE, w: TILE, h: TILE, hp: 2, maxHp: 2, color: pal.block, broken: false });
      enemies.push(makeEnemy(x + 20, y - 32, -1.2, 2, "walker"));
      maybeSpawnCrate(x, y);
      curX += 180 + Math.random() * 60;
    }
  } else if (level === 2) {
    // 1 gauntlet chunk + normal platforms
    const gauntletPos = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < 10; i++) {
      const x = startX + i * 200 + Math.random() * 40;
      const y = GROUND_Y - 80 - Math.random() * 60;

      if (i === gauntletPos) {
        platforms.push({ x, y, w: 90, h: 16 });
        enemies.push(makeEnemy(x + 5, y - 32, -1.8, 3, Math.random() > 0.5 ? "jumper" : "walker"));
        enemies.push(makeEnemy(x + 30, y - 32, -1.8, 3, "jumper"));
        enemies.push(makeEnemy(x + 55, y - 32, -1.8, 3, Math.random() > 0.5 ? "jumper" : "walker"));
        maybeSpawnCrate(x, y);
        continue;
      }

      platforms.push({ x, y, w: 60, h: 16 });
      for (let j = 0; j < 3; j++) blocks.push({ x: x + j * (TILE + 4), y: y - TILE - Math.random() * 32, w: TILE, h: TILE, hp: 3, maxHp: 3, color: pal.block, broken: false });
      enemies.push(makeEnemy(x + 10, y - 32, -1.8, 3, Math.random() > 0.5 ? "jumper" : "walker"));
      maybeSpawnCrate(x, y);
    }
  } else if (level === 3) {
    // 1 tower chunk + 1 gauntlet chunk + normal platforms
    const towerPos = 1 + Math.floor(Math.random() * 3);
    const gauntletPos = 5 + Math.floor(Math.random() * 2);
    for (let i = 0; i < 8; i++) {
      const x = startX + i * 240 + Math.random() * 80;
      const y = GROUND_Y - 50 - Math.random() * 100;

      if (i === towerPos) {
        platforms.push({ x, y, w: 100, h: 16 });
        for (let row = 0; row < 3; row++) {
          blocks.push({ x: x + 30, y: y - TILE * (row + 1), w: TILE, h: TILE, hp: 4, maxHp: 4, color: pal.block, broken: false });
        }
        enemies.push(makeEnemy(x, y - 32, -2.5, 4, "flyer"));
        maybeSpawnCrate(x, y);
        continue;
      }

      if (i === gauntletPos) {
        platforms.push({ x, y, w: 120, h: 16 });
        enemies.push(makeEnemy(x + 5, y - 32, -2.5, 4, "flyer"));
        enemies.push(makeEnemy(x + 40, y - 32, -2.5, 4, "flyer"));
        enemies.push(makeEnemy(x + 75, y - 32, -2.5, 2, "walker"));
        maybeSpawnCrate(x, y);
        continue;
      }

      platforms.push({ x, y, w: 100 + Math.random() * 60, h: 16 });
      blocks.push({ x: x + 5, y: y - TILE, w: TILE, h: TILE, hp: 4, maxHp: 4, color: pal.block, broken: false });
      blocks.push({ x: x + 45, y: y - TILE, w: TILE, h: TILE, hp: 4, maxHp: 4, color: pal.block, broken: false });
      enemies.push(makeEnemy(x, y - 32, -2.5, 4, Math.random() > 0.5 ? "flyer" : "walker"));
      if (Math.random() > 0.4) enemies.push(makeEnemy(x + 80, y - 32, -2.5, 2, "flyer"));
      maybeSpawnCrate(x, y);
    }
  } else {
    platforms.push({ x: startX, y: GROUND_Y - 40, w: 600, h: 16 });
  }

  return { blocks, platforms, enemies, ammoCrates, weaponPickups };
}

function initGameState(level: number, prevState?: Partial<GameState>): GameState {
  const stars: Star[] = [];
  for (let i = 0; i < 80; i++) {
    stars.push({ x: Math.random() * CANVAS_W, y: Math.random() * (CANVAS_H / 2), size: Math.random() * 2 + 0.5, twinkle: Math.random() * Math.PI * 2 });
  }

  const { blocks, platforms, enemies, ammoCrates, weaponPickups } = generateLevel(level, 0);

  const bgParticles: Particle[] = [];
  if (level === 3) {
    for (let i = 0; i < 20; i++) {
      bgParticles.push({ x: Math.random() * CANVAS_W, y: GROUND_Y + Math.random() * 80, vx: (Math.random() - 0.5) * 0.5, vy: -0.5 - Math.random(), life: 60, maxLife: 80, color: "#ff6600", size: 4 + Math.random() * 4 });
    }
  }
  if (level === 4) {
    for (let i = 0; i < 30; i++) {
      bgParticles.push({ x: Math.random() * BOSS_ROOM_W, y: Math.random() * GROUND_Y, vx: (Math.random() - 0.5) * 0.4, vy: -0.3 - Math.random() * 0.5, life: Math.floor(Math.random() * 80), maxLife: 80, color: Math.random() > 0.5 ? "#cc2200" : "#ff4400", size: 3 + Math.random() * 4 });
    }
  }

  const goldenBox: GoldenBox = {
    x: 2800 + (level - 1) * 200,
    y: GROUND_Y - 60,
    w: 36, h: 36,
    collected: false,
    letter: ["L", "J", "S"][level - 1] ?? "?",
    spawned: false,
  };

  const pedestalSlots: PedestalSlot[] = level === 4
    ? [
        { x: CANVAS_W / 2 - 120, y: GROUND_Y - 80, filled: false, letter: "L" },
        { x: CANVAS_W / 2,       y: GROUND_Y - 80, filled: false, letter: "J" },
        { x: CANVAS_W / 2 + 120, y: GROUND_Y - 80, filled: false, letter: "S" },
      ]
    : [];

  // Level 4 boss room setup
  let l4Boss: Boss | null = null;
  let l4AmmoCrates = ammoCrates;
  let l4WeaponPickups = weaponPickups;
  let l4Platforms = platforms;
  if (level === 4) {
    l4Boss = {
      x: BOSS_ROOM_W / 2 - 40, y: GROUND_Y - 80,
      w: 80, h: 80,
      vx: 1, vy: 0,
      hp: 30, maxHp: 30,
      phase: 1,
      active: true,
      onGround: true,
      defeated: false,
      chargeTimer: 0,
      jumpTimer: 0,
      chargeActive: false,
      chargeFrames: 0,
      attackType: "idle",
      attackTimer: 0,
      attackCooldown: 120 + Math.floor(Math.random() * 60),
      sprayParticles: [],
      bombs: [],
      stompRising: false,
      stompTargetX: BOSS_ROOM_W / 2,
      stompY: GROUND_Y - 80,
      stompPasses: 0,
      defeatedTimer: 0,
    };
    l4AmmoCrates = [
      { x: 200, y: GROUND_Y - 24, w: 20, h: 20, collected: false },
      { x: 600, y: GROUND_Y - 24, w: 20, h: 20, collected: false },
      { x: 1000, y: GROUND_Y - 24, w: 20, h: 20, collected: false },
      { x: 1400, y: GROUND_Y - 24, w: 20, h: 20, collected: false },
      { x: 1800, y: GROUND_Y - 24, w: 20, h: 20, collected: false },
      { x: 2200, y: GROUND_Y - 24, w: 20, h: 20, collected: false },
    ];
    l4WeaponPickups = [
      { x: 400,  y: GROUND_Y - 30, w: 22, h: 22, collected: false, type: "rapid" },
      { x: 800,  y: GROUND_Y - 30, w: 22, h: 22, collected: false, type: "pierce" },
      { x: 1400, y: GROUND_Y - 30, w: 22, h: 22, collected: false, type: "rapid" },
      { x: 1900, y: GROUND_Y - 30, w: 22, h: 22, collected: false, type: "pierce" },
    ];
    l4Platforms = [
      { x: 300, y: GROUND_Y - 100, w: 120, h: 16 },
      { x: 900, y: GROUND_Y - 140, w: 100, h: 16 },
      { x: 1500, y: GROUND_Y - 110, w: 130, h: 16 },
      { x: 2100, y: GROUND_Y - 130, w: 110, h: 16 },
    ];
  }

  return {
    phase: "playing",
    level,
    score: prevState?.score ?? 0,
    lives: prevState?.lives ?? 3,
    ammo: level === 4 ? Infinity : 30,
    collectedBoxes: prevState?.collectedBoxes ?? [false, false, false],
    collectedLetters: prevState?.collectedLetters ?? [],
    letterReveal: null,

    px: level === 4 ? 120 : 80, py: GROUND_Y - 60,
    pvx: 0, pvy: 0,
    pOnGround: false, pFacing: 1,
    pFrame: 0, pAnimTimer: 0,
    pInvincible: 0, pFlash: false,

    scrollX: 0, scrollSpeed: SCROLL_SPEEDS[level - 1] ?? 3,
    levelProgress: 0, levelLength: level === 4 ? 800 : 3200,

    blocks, bullets: [], particles: [], enemies,
    platforms: level === 4 ? l4Platforms : platforms,
    goldenBox: level <= 3 ? goldenBox : null,
    ammoCrates: level === 4 ? l4AmmoCrates : ammoCrates,
    weaponPickups: level === 4 ? l4WeaponPickups : weaponPickups,
    activeWeapon: null,
    stars,
    boss: l4Boss,

    pedestalSlots,
    boxesToPlace: [...(prevState?.collectedLetters ?? [])],
    placingIndex: 0, placeTimer: 0, nameRevealTimer: 0,

    keys: {}, shootCooldown: 0, isFiring: false,
    levelTransTimer: 0, deathTimer: 0, deathCause: "", titleAnimTimer: 0,
    bgParticles,

    shakeTimer: 0,
    cliffX: null,
    comboCount: 0,
    comboTimer: 0,
    l4Phase: level === 4 ? "boss" : "pedestal",
    cameraX: 0,
  };
}

// ─────────────────────────────────────────────
//  DRAW HELPERS
// ─────────────────────────────────────────────
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  facing: number, frame: number, invincible: number,
  isFiring: boolean,
  runFrames: (HTMLImageElement | null)[],
  fireFrame: HTMLImageElement | null,
) {
  if (invincible > 0 && Math.floor(invincible / 4) % 2 === 0) return;
  const sprite = isFiring ? fireFrame : runFrames[frame % 6] ?? runFrames[0];
  const rx = Math.round(x); const ry = Math.round(y);
  if (sprite) {
    ctx.save();
    if (facing < 0) {
      ctx.translate(rx + 32, 0); ctx.scale(-1, 1); ctx.translate(-rx, 0);
    }
    ctx.drawImage(sprite, rx, ry, 32, 40);
    ctx.restore();
    return;
  }
  // Fallback: original pixel art
  const flip = facing < 0;
  ctx.save();
  if (flip) { ctx.translate(rx + 24, 0); ctx.scale(-1, 1); ctx.translate(-rx, 0); }
  ctx.fillStyle = "#FF69B4"; ctx.fillRect(rx + 4, ry + 8, 20, 18);
  ctx.fillStyle = "#FFDAB9"; ctx.fillRect(rx + 6, ry, 16, 14);
  ctx.fillStyle = "#8B4513"; ctx.fillRect(rx + 6, ry, 16, 5);
  ctx.fillStyle = "#000"; ctx.fillRect(rx + 9, ry + 6, 3, 3); ctx.fillRect(rx + 16, ry + 6, 3, 3);
  ctx.fillStyle = "#FFDAB9"; ctx.fillRect(rx + 22, ry + 10, 10, 6);
  ctx.fillStyle = "#888"; ctx.fillRect(rx + 30, ry + 9, 6, 5);
  const legOff = frame % 2 === 0 ? 0 : 3;
  ctx.fillStyle = "#C71585";
  ctx.fillRect(rx + 5, ry + 24, 9, 14 - legOff);
  ctx.fillRect(rx + 14, ry + 24, 9, 14 + legOff - 3);
  ctx.fillStyle = "#7B0040";
  ctx.fillRect(rx + 4, ry + 36 - legOff, 10, 5);
  ctx.fillRect(rx + 13, ry + 34 + legOff - 3, 10, 5);
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, tick: number, enemyFrames?: Record<string, (HTMLImageElement | null)[]>) {
  if (!e.active) return;
  const rx = Math.round(e.x); const ry = Math.round(e.y);
  const frameIdx = Math.floor(tick / 6) % 6;
  const frames = enemyFrames?.[e.type];
  const sprite = frames?.[frameIdx] ?? frames?.[0] ?? null;

  // Flip sprite to face movement direction (enemies move left by default)
  const facingLeft = e.vx <= 0;

  if (sprite) {
    ctx.save();
    if (!facingLeft) {
      ctx.translate(rx + e.w, 0); ctx.scale(-1, 1); ctx.translate(-rx, 0);
    }
    ctx.drawImage(sprite, rx, ry, e.w, e.h);
    ctx.restore();
    // HP bar above sprite
    ctx.fillStyle = "#333"; ctx.fillRect(rx, ry - 6, e.w, 4);
    const hpColor = e.type === "jumper" ? "#CC44FF" : e.type === "flyer" ? "#FF4444" : "#00FF00";
    ctx.fillStyle = hpColor; ctx.fillRect(rx, ry - 6, (e.w * e.hp) / 4, 4);
    return;
  }

  // Fallback pixel art
  if (e.type === "jumper") {
    ctx.fillStyle = "#7B2FBE"; ctx.fillRect(rx, ry + 6, e.w, e.h - 6);
    ctx.fillStyle = "#5A1F8A";
    ctx.beginPath(); ctx.arc(rx + e.w / 2, ry + 8, e.w / 2 - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9B4FDE";
    ctx.fillRect(rx + 4, ry + e.h - 4, 6, 6); ctx.fillRect(rx + e.w - 10, ry + e.h - 4, 6, 6);
    ctx.fillRect(rx + 4, ry + e.h + 2, 4, 4); ctx.fillRect(rx + e.w - 8, ry + e.h + 2, 4, 4);
    ctx.fillStyle = "#FF0"; ctx.fillRect(rx + 7, ry + 4, 4, 4); ctx.fillRect(rx + 17, ry + 4, 4, 4);
    ctx.fillStyle = "#333"; ctx.fillRect(rx, ry - 6, e.w, 4);
    ctx.fillStyle = "#CC44FF"; ctx.fillRect(rx, ry - 6, (e.w * e.hp) / 4, 4);
  } else if (e.type === "flyer") {
    ctx.fillStyle = "#8B0000"; ctx.fillRect(rx + 4, ry + 4, e.w - 8, e.h - 8);
    const wingFlap = Math.sin(tick * 0.3 + e.sinOffset) * 4;
    ctx.fillStyle = "#CC2222";
    ctx.fillRect(rx - 10, ry + 6 + wingFlap, 14, 8); ctx.fillRect(rx + e.w - 4, ry + 6 + wingFlap, 14, 8);
    ctx.fillStyle = "#FF4"; ctx.fillRect(rx + 7, ry + 6, 4, 4); ctx.fillRect(rx + 17, ry + 6, 4, 4);
    ctx.fillStyle = "#333"; ctx.fillRect(rx, ry - 6, e.w, 4);
    ctx.fillStyle = "#FF4444"; ctx.fillRect(rx, ry - 6, (e.w * e.hp) / 4, 4);
  } else {
    ctx.fillStyle = "#6B8E23"; ctx.fillRect(rx, ry + 8, e.w, e.h - 8);
    ctx.fillStyle = "#556B2F";
    ctx.beginPath(); ctx.arc(rx + e.w / 2, ry + 10, e.w / 2 - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#FF0000"; ctx.fillRect(rx + 7, ry + 6, 4, 4); ctx.fillRect(rx + 17, ry + 6, 4, 4);
    ctx.fillStyle = "#333"; ctx.fillRect(rx, ry - 6, e.w, 4);
    ctx.fillStyle = "#00FF00"; ctx.fillRect(rx, ry - 6, (e.w * e.hp) / 4, 4);
  }
}

function drawAmmoCrate(ctx: CanvasRenderingContext2D, c: AmmoCrate, tick: number, frames?: (HTMLImageElement | null)[]) {
  if (c.collected) return;
  const rx = Math.round(c.x); const ry = Math.round(c.y);
  const frameIdx = Math.floor(tick / 6) % 6;
  const sprite = frames?.[frameIdx] ?? frames?.[0] ?? null;
  if (sprite) { ctx.drawImage(sprite, rx, ry, c.w, c.h); return; }
  ctx.fillStyle = "#FF8C00"; ctx.fillRect(rx, ry, c.w, c.h);
  ctx.strokeStyle = "#CC5500"; ctx.lineWidth = 2; ctx.strokeRect(rx + 1, ry + 1, c.w - 2, c.h - 2);
  ctx.fillStyle = "#FFF"; ctx.font = 'bold 12px "Press Start 2P", cursive';
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("+", rx + c.w / 2, ry + c.h / 2 + 1);
  ctx.textBaseline = "alphabetic";
}

const WEAPON_COLORS: Record<string, string> = { rapid: "#00CFFF", double: "#AA44FF", big: "#FF4400", pierce: "#FFD700" };
const WEAPON_LABELS: Record<string, string> = { rapid: "R", double: "2", big: "B", pierce: "P" };

function drawWeaponPickup(ctx: CanvasRenderingContext2D, p: WeaponPickup, tick: number, allFrames?: Record<string, (HTMLImageElement | null)[]>) {
  if (p.collected) return;
  const bob = Math.sin(tick * 0.07) * 3;
  const rx = Math.round(p.x); const ry = Math.round(p.y + bob);
  const frameIdx = Math.floor(tick / 6) % 6;
  const frames = allFrames?.[p.type];
  const sprite = frames?.[frameIdx] ?? frames?.[0] ?? null;
  if (sprite) { ctx.drawImage(sprite, rx, ry, p.w, p.h); return; }
  const col = WEAPON_COLORS[p.type];
  ctx.globalAlpha = 0.25 + 0.15 * Math.sin(tick * 0.1);
  ctx.fillStyle = col; ctx.fillRect(rx - 4, ry - 4, p.w + 8, p.h + 8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = col; ctx.fillRect(rx, ry, p.w, p.h);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(rx + 1, ry + 1, p.w - 2, p.h - 2);
  ctx.fillStyle = "#000"; ctx.font = 'bold 9px "Press Start 2P", cursive';
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(WEAPON_LABELS[p.type], rx + p.w / 2, ry + p.h / 2 + 1);
  ctx.textBaseline = "alphabetic";
}

function drawBoss(ctx: CanvasRenderingContext2D, boss: Boss, tick: number) {
  if (!boss.active || boss.defeated) return;
  const phase3 = boss.hp <= 10;
  const redFlash = phase3 && Math.floor(tick / 6) % 2 === 0;
  // In phase 3 boss is drawn at 2x size — adjust draw origin so bottom stays on ground
  const drawW = phase3 ? boss.w * 2 : boss.w;
  const drawH = phase3 ? boss.h * 2 : boss.h;
  const rx = Math.round(boss.x) - (phase3 ? boss.w / 2 : 0);
  const ry = Math.round(boss.y) - (phase3 ? boss.h : 0);
  const isStorming = boss.attackType === "stomp" && !boss.onGround;
  const isSpray = boss.attackType === "spray";

  // Red flash overlay for phase 3
  if (redFlash) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#FF0000";
    ctx.fillRect(rx - 8, ry - 8, drawW + 16, drawH + 16);
    ctx.globalAlpha = 1;
  }

  // Orange glow during spray attack
  if (isSpray) {
    const glowAlpha = 0.15 + 0.1 * Math.sin(tick * 0.3);
    ctx.globalAlpha = glowAlpha;
    ctx.fillStyle = "#FF8800";
    ctx.fillRect(rx - 16, ry - 16, drawW + 32, drawH + 32);
    ctx.globalAlpha = 1;
  }

  // Wings during stomp/flight
  if (isStorming) {
    const wFlap = Math.sin(tick * 0.4) * 10;
    const wingW = phase3 ? 50 : 30;
    ctx.fillStyle = "#330033";
    ctx.fillRect(rx - wingW, ry + 10 + wFlap, wingW, 16);
    ctx.fillRect(rx + drawW, ry + 10 - wFlap, wingW, 16);
    ctx.fillStyle = "#660066";
    ctx.fillRect(rx - wingW + 6, ry + 12 + wFlap, wingW - 6, 10);
    ctx.fillRect(rx + drawW, ry + 12 - wFlap, wingW - 6, 10);
  }

  // Main body — dark purple/black
  ctx.fillStyle = "#1a001a"; ctx.fillRect(rx, ry, drawW, drawH);
  ctx.strokeStyle = phase3 ? "#FF0000" : "#550055"; ctx.lineWidth = 3; ctx.strokeRect(rx + 1, ry + 1, drawW - 2, drawH - 2);
  // Inner shading
  ctx.fillStyle = "#2d002d"; ctx.fillRect(rx + 6, ry + 6, drawW - 12, drawH - 12);

  // Spiky crown (3 triangles on top)
  ctx.fillStyle = phase3 ? "#FF2200" : "#8B0000";
  const crownH = phase3 ? 30 : 18;
  const crownPts = [rx + Math.round(drawW * 0.15), rx + Math.round(drawW / 2) - 5, rx + Math.round(drawW * 0.72)];
  crownPts.forEach((cx) => {
    ctx.beginPath(); ctx.moveTo(cx, ry); ctx.lineTo(cx + 8, ry - crownH); ctx.lineTo(cx + 16, ry); ctx.fill();
  });

  // Glowing red eyes (scaled)
  const eyeGlow = Math.sin(tick * 0.12) > 0 ? "#FF0000" : "#CC0000";
  const eyeW = phase3 ? 22 : 14; const eyeH = phase3 ? 18 : 12;
  const eyePad = Math.round(drawW * 0.17);
  ctx.fillStyle = eyeGlow;
  ctx.fillRect(rx + eyePad, ry + Math.round(drawH * 0.22), eyeW, eyeH);
  ctx.fillRect(rx + drawW - eyePad - eyeW, ry + Math.round(drawH * 0.22), eyeW, eyeH);
  ctx.fillStyle = "#000";
  ctx.fillRect(rx + eyePad + 4, ry + Math.round(drawH * 0.22) + 3, 6, 6);
  ctx.fillRect(rx + drawW - eyePad - eyeW + 4, ry + Math.round(drawH * 0.22) + 3, 6, 6);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(rx + eyePad - 4, ry + Math.round(drawH * 0.22) - 4, eyeW + 8, eyeH + 8);
  ctx.fillRect(rx + drawW - eyePad - eyeW - 4, ry + Math.round(drawH * 0.22) - 4, eyeW + 8, eyeH + 8);
  ctx.globalAlpha = 1;

  // Menacing mouth
  const mouthY = ry + drawH - Math.round(drawH * 0.22);
  ctx.fillStyle = "#CC0000"; ctx.fillRect(rx + Math.round(drawW * 0.2), mouthY, Math.round(drawW * 0.6), 8);
  ctx.fillStyle = "#FFF";
  for (let i = 0; i < 5; i++) ctx.fillRect(rx + Math.round(drawW * 0.22) + i * Math.round(drawW * 0.12), mouthY, 5, 8);

  // HP bar above boss (shows 30 total)
  const barW = drawW + 20;
  const barX = rx - 10;
  ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(barX, ry - 20, barW, 12);
  const hpPct = Math.max(0, boss.hp / boss.maxHp);
  ctx.fillStyle = boss.hp > 20 ? "#00CC00" : boss.hp > 10 ? "#CCCC00" : "#CC0000";
  ctx.fillRect(barX, ry - 20, barW * hpPct, 12);
  // Phase markers at 2/3 and 1/3
  ctx.strokeStyle = "#FFFFFF88"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(barX + barW * (20/30), ry - 20); ctx.lineTo(barX + barW * (20/30), ry - 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(barX + barW * (10/30), ry - 20); ctx.lineTo(barX + barW * (10/30), ry - 8); ctx.stroke();
  ctx.strokeStyle = "#FFF"; ctx.lineWidth = 1; ctx.strokeRect(barX, ry - 20, barW, 12);
}

function drawBlock(ctx: CanvasRenderingContext2D, b: Block, tick: number, frames?: (HTMLImageElement | null)[]) {
  if (b.broken) return;
  const crack = (b.maxHp - b.hp) / b.maxHp;
  const frameIdx = Math.floor(tick / 8) % 6;
  const sprite = frames?.[frameIdx] ?? frames?.[0] ?? null;
  if (sprite) {
    ctx.globalAlpha = 1 - crack * 0.5;
    ctx.drawImage(sprite, Math.round(b.x), Math.round(b.y), b.w, b.h);
    ctx.globalAlpha = 1;
    if (crack > 0.3) {
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x + 8, b.y + 4); ctx.lineTo(b.x + 16, b.y + 20); ctx.stroke();
    }
    if (crack > 0.6) {
      ctx.beginPath(); ctx.moveTo(b.x + 20, b.y + 4); ctx.lineTo(b.x + 12, b.y + 28); ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = b.color; ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(b.x) + 1, Math.round(b.y) + 1, b.w - 2, b.h - 2);
  if (crack > 0.3) {
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(b.x + 8, b.y + 4); ctx.lineTo(b.x + 16, b.y + 20); ctx.stroke();
  }
  if (crack > 0.6) {
    ctx.beginPath(); ctx.moveTo(b.x + 20, b.y + 4); ctx.lineTo(b.x + 12, b.y + 28); ctx.stroke();
  }
}

function drawGoldenBox(ctx: CanvasRenderingContext2D, gb: GoldenBox, tick: number) {
  if (!gb.spawned || gb.collected) return;
  const bob = Math.sin(tick * 0.05) * 4;
  const bx = Math.round(gb.x); const by = Math.round(gb.y + bob);
  const grd = ctx.createRadialGradient(bx + gb.w / 2, by + gb.h / 2, 4, bx + gb.w / 2, by + gb.h / 2, 28);
  grd.addColorStop(0, "rgba(255,215,0,0.4)"); grd.addColorStop(1, "rgba(255,215,0,0)");
  ctx.fillStyle = grd; ctx.fillRect(bx - 10, by - 10, gb.w + 20, gb.h + 20);
  ctx.fillStyle = "#FFD700"; ctx.fillRect(bx, by, gb.w, gb.h);
  ctx.strokeStyle = "#FFA500"; ctx.lineWidth = 3; ctx.strokeRect(bx + 1, by + 1, gb.w - 2, gb.h - 2);
  ctx.strokeStyle = "#B8860B"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx + gb.w / 2, by); ctx.lineTo(bx + gb.w / 2, by + gb.h);
  ctx.moveTo(bx, by + gb.h / 2); ctx.lineTo(bx + gb.w, by + gb.h / 2);
  ctx.stroke();
  ctx.fillStyle = "#8B6914"; ctx.font = '9px "Press Start 2P", cursive'; ctx.textAlign = "center";
  ctx.fillText(gb.letter, bx + gb.w / 2, by + gb.h / 2 + 4);
}

function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform, level: number) {
  const pal = LEVEL_PALETTES[level - 1] ?? LEVEL_PALETTES[0];
  ctx.fillStyle = pal.ground; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.w, p.h);
  ctx.fillStyle = pal.accent; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.w, 4);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(Math.round(p.x), Math.round(p.y), p.w, p.h);
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet) {
  if (!b.active) return;
  if (b.big) {
    ctx.fillStyle = "#FF4400"; ctx.fillRect(Math.round(b.x), Math.round(b.y) - 3, 16, 10);
    ctx.fillStyle = "#FF8800"; ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) - 1, 10, 6);
  } else if (b.pierce) {
    ctx.fillStyle = "#FFD700"; ctx.fillRect(Math.round(b.x), Math.round(b.y), 14, 4);
    ctx.fillStyle = "#FFFACD"; ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) + 1, 8, 2);
  } else {
    ctx.fillStyle = "#FFD700"; ctx.fillRect(Math.round(b.x), Math.round(b.y), 10, 5);
    ctx.fillStyle = "#FF8C00"; ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) + 1, 6, 3);
  }
}

function drawGround(ctx: CanvasRenderingContext2D, level: number, scrollX: number, cliffX: number | null, tileImg?: HTMLImageElement | null) {
  const pal = LEVEL_PALETTES[level - 1] ?? LEVEL_PALETTES[0];
  const gapW = 640;
  const groundH = CANVAS_H - GROUND_Y;

  const segments: [number, number][] = cliffX !== null
    ? [[0, cliffX], [cliffX + gapW, CANVAS_W]]
    : [[0, CANVAS_W]];

  if (tileImg) {
    // Tile the ground image, scrolling with the level
    const tileW = tileImg.naturalWidth || 130;
    const tileH = tileImg.naturalHeight || 130;
    const offset = scrollX % tileW;
    ctx.save();
    // Clip to each ground segment individually
    segments.forEach(([x0, x1]) => {
      const w = x1 - x0;
      if (w <= 0) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, GROUND_Y, w, groundH); ctx.clip();
      for (let tx = x0 - offset - tileW; tx < x1 + tileW; tx += tileW) {
        for (let ty = GROUND_Y; ty < CANVAS_H; ty += tileH) {
          ctx.drawImage(tileImg, Math.round(tx), Math.round(ty), tileW, tileH);
        }
      }
      ctx.restore();
    });
    ctx.restore();
  } else {
    segments.forEach(([x0, x1]) => {
      const w = x1 - x0;
      if (w <= 0) return;
      ctx.fillStyle = pal.ground; ctx.fillRect(x0, GROUND_Y, w, groundH);
      ctx.fillStyle = pal.accent; ctx.fillRect(x0, GROUND_Y, w, 6);
    });
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    const tileW = 48; const offset = scrollX % tileW;
    for (let tx = -offset; tx < CANVAS_W; tx += tileW) {
      if (cliffX !== null && tx > cliffX && tx < cliffX + gapW) continue;
      ctx.fillRect(Math.round(tx), GROUND_Y + 6, 2, groundH - 6);
    }
  }

  // Cliff edges
  if (cliffX !== null) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(cliffX - 4, GROUND_Y, 4, groundH);
    ctx.fillRect(cliffX + gapW, GROUND_Y, 4, groundH);
  }
}

function drawSky(ctx: CanvasRenderingContext2D, level: number, stars: Star[], tick: number, bgParticles: Particle[]) {
  const gradColors: [string, string][] = [
    ["#1a1a2e", "#16213e"], ["#0d0d1a", "#1a1a3a"],
    ["#1a0000", "#4d0000"], ["#050505", "#1a1200"],
  ];
  const [c0, c1] = gradColors[level - 1] ?? gradColors[0];
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, c0); grad.addColorStop(1, c1);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);
  stars.forEach((s) => {
    const alpha = 0.5 + 0.5 * Math.sin(s.twinkle + tick * 0.03);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
  });
  if (level === 3) {
    bgParticles.forEach((p) => {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = `rgba(255,100,0,${alpha * 0.7})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    });
  }
  if (level === 4) {
    // Pedestal room gets a subtle gold tint
    ctx.fillStyle = "rgba(255,215,0,0.04)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

function drawPedestal(ctx: CanvasRenderingContext2D, slots: PedestalSlot[], tick: number) {
  ctx.fillStyle = "#4d3a00"; ctx.fillRect(CANVAS_W / 2 - 200, GROUND_Y - 30, 400, 30);
  ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 2; ctx.strokeRect(CANVAS_W / 2 - 200, GROUND_Y - 30, 400, 30);
  [CANVAS_W / 2 - 120, CANVAS_W / 2, CANVAS_W / 2 + 120].forEach((px) => {
    ctx.fillStyle = "#3d2d00"; ctx.fillRect(Math.round(px) - 20, GROUND_Y - 90, 40, 60);
    ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 1; ctx.strokeRect(Math.round(px) - 20, GROUND_Y - 90, 40, 60);
  });
  slots.forEach((s) => {
    if (s.filled) {
      const bob = Math.sin(tick * 0.04) * 3;
      const bx = Math.round(s.x) - 18; const by = Math.round(s.y) + bob;
      const grd = ctx.createRadialGradient(bx + 18, by + 18, 4, bx + 18, by + 18, 24);
      grd.addColorStop(0, "rgba(255,215,0,0.5)"); grd.addColorStop(1, "rgba(255,215,0,0)");
      ctx.fillStyle = grd; ctx.fillRect(bx - 8, by - 8, 52, 52);
      ctx.fillStyle = "#FFD700"; ctx.fillRect(bx, by, 36, 36);
      ctx.strokeStyle = "#FFA500"; ctx.lineWidth = 3; ctx.strokeRect(bx + 1, by + 1, 34, 34);
      ctx.strokeStyle = "#B8860B"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + 18, by); ctx.lineTo(bx + 18, by + 36);
      ctx.moveTo(bx, by + 18); ctx.lineTo(bx + 36, by + 18);
      ctx.stroke();
      ctx.fillStyle = "#8B6914"; ctx.font = '9px "Press Start 2P", cursive'; ctx.textAlign = "center";
      ctx.fillText(s.letter, bx + 18, by + 22);
    } else {
      ctx.strokeStyle = "rgba(255,215,0,0.3)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.strokeRect(Math.round(s.x) - 18, Math.round(s.y), 36, 36);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,215,0,0.1)"; ctx.fillRect(Math.round(s.x) - 18, Math.round(s.y), 36, 36);
    }
  });
}

function drawLetterReveal(ctx: CanvasRenderingContext2D, reveal: { letter: string; timer: number; maxTimer: number }, tick: number) {
  const t = reveal.timer / reveal.maxTimer;
  const fadeIn  = Math.min(1, (reveal.maxTimer - reveal.timer) / 20);
  const fadeOut = t < 0.25 ? t / 0.25 : 1;
  const alpha   = fadeIn * fadeOut;


  const drift  = (1 - t) * 60;
  const cx     = CANVAS_W / 2;
  const cy     = CANVAS_H / 2 - 20 - drift;

  for (let i = 0; i < 12; i++) {
    const angle   = (i / 12) * Math.PI * 2 + tick * 0.07;
    const radius  = 56 + Math.sin(tick * 0.1 + i * 0.8) * 10;
    const sx      = cx + Math.cos(angle) * radius;
    const sy      = cy + Math.sin(angle) * radius;
    const sparkAlpha = alpha * (0.6 + 0.4 * Math.sin(tick * 0.15 + i));
    ctx.globalAlpha = sparkAlpha;
    ctx.fillStyle   = i % 3 === 0 ? "#FFFACD" : "#FFD700";
    const sz = (i % 2 === 0 ? 5 : 3) * (0.8 + 0.2 * Math.sin(tick * 0.2 + i));
    ctx.fillRect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), Math.round(sz), Math.round(sz));
  }

  ctx.globalAlpha = alpha * 0.18;
  const halo = ctx.createRadialGradient(cx, cy, 20, cx, cy, 80);
  halo.addColorStop(0, "#FFD700");
  halo.addColorStop(1, "rgba(255,215,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, 80, 0, Math.PI * 2);
  ctx.fill();

  const pulse  = 1 + 0.06 * Math.sin(tick * 0.12);
  const boxSz  = Math.round(72 * pulse);
  const bx     = Math.round(cx - boxSz / 2);
  const by     = Math.round(cy - boxSz / 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = "#FFD700";
  ctx.fillRect(bx, by, boxSz, boxSz);
  ctx.strokeStyle = "#FFA500";
  ctx.lineWidth   = 4;
  ctx.strokeRect(bx + 2, by + 2, boxSz - 4, boxSz - 4);
  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, by); ctx.lineTo(cx, by + boxSz);
  ctx.moveTo(bx, cy); ctx.lineTo(bx + boxSz, cy);
  ctx.stroke();

  ctx.fillStyle    = "#8B6914";
  ctx.font         = `${Math.round(36 * pulse)}px "Press Start 2P", cursive`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(reveal.letter, cx, cy + 2);
  ctx.textBaseline = "alphabetic";

  ctx.globalAlpha = 1;
}

function drawNameBanner(ctx: CanvasRenderingContext2D, timer: number, tick: number) {
  const maxTimer = 240;
  const t = timer / maxTimer;
  // Slide in from top, hold, fade out at end
  const slideIn = Math.min(1, (maxTimer - timer) / 30);
  const fadeOut = t < 0.15 ? t / 0.15 : 1;
  const alpha = slideIn * fadeOut;
  const slideY = (1 - slideIn) * -80;

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2 + slideY;

  // Sparkle particles around banner
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2 + tick * 0.05;
    const r = 90 + Math.sin(tick * 0.1 + i * 1.3) * 14;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r * 0.35;
    ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(tick * 0.18 + i));
    ctx.fillStyle = i % 2 === 0 ? "#FFD700" : "#FFFFFF";
    const sz = i % 3 === 0 ? 5 : 3;
    ctx.fillRect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), sz, sz);
  }

  // Banner background
  ctx.globalAlpha = alpha * 0.88;
  ctx.fillStyle = "#1a0a00";
  ctx.fillRect(cx - 160, cy - 36, 320, 72);
  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - 160, cy - 36, 320, 72);
  ctx.strokeStyle = "#FFA500";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 155, cy - 31, 310, 62);

  // Name text
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.shadowColor = "#FFD700"; ctx.shadowBlur = 18;
  ctx.fillStyle = "#FFD700";
  ctx.font = '14px "Press Start 2P", cursive';
  ctx.fillText("LEOLA JANE", cx, cy - 6);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = '14px "Press Start 2P", cursive';
  ctx.fillText("SNAPP", cx, cy + 18);
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 1;
}

function drawHUDOverlay(ctx: CanvasRenderingContext2D, level: number, scrollX: number, levelLength: number) {
  const pct = Math.min(scrollX / levelLength, 1);
  const barW = 200; const barX = CANVAS_W / 2 - barW / 2;
  ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(barX, CANVAS_H - 18, barW, 8);
  const pal = LEVEL_PALETTES[level - 1] ?? LEVEL_PALETTES[0];
  ctx.fillStyle = pal.accent; ctx.fillRect(barX, CANVAS_H - 18, barW * pct, 8);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(barX, CANVAS_H - 18, barW, 8);
  ctx.fillStyle = "#FFD700"; ctx.fillRect(barX + barW - 4, CANVAS_H - 22, 8, 16);
}

// ─────────────────────────────────────────────
//  TOUCH CONTROLS OVERLAY — drawn ON the canvas (kept for non-HTML-overlay path)
// ─────────────────────────────────────────────
function drawTouchControls(ctx: CanvasRenderingContext2D, keys: Record<string, boolean>) {
  const buttons = [
    { key: "ArrowLeft",  label: "◄", zone: TC.LEFT  },
    { key: "ArrowRight", label: "►", zone: TC.RIGHT },
    { key: "ArrowUp",    label: "▲", zone: TC.JUMP  },
    { key: "Space",      label: "🔫", zone: TC.SHOOT },
  ];

  buttons.forEach(({ key, label, zone }) => {
    const pressed = !!keys[key];
    const isShoot = key === "Space";

    ctx.save();
    ctx.globalAlpha = pressed ? 0.85 : 0.45;

    if (isShoot) {
      const cx = zone.x + zone.w / 2;
      const cy = zone.y + zone.h / 2;
      const r  = zone.w / 2;
      ctx.fillStyle = pressed ? "#FF6600" : "#CC3300";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = pressed ? "#FFD700" : "#FF8800";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.stroke();
    } else {
      const r = 10;
      const { x, y, w, h } = zone;
      ctx.fillStyle = pressed ? "#4488FF" : "#224488";
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = pressed ? "#88AAFF" : "#4466AA";
      ctx.lineWidth = 2; ctx.stroke();
    }

    ctx.globalAlpha = pressed ? 1.0 : 0.7;
    ctx.fillStyle = "#ffffff";
    const isEmoji = label === "🔫";
    ctx.font = isEmoji
      ? `${zone.h * 0.5}px sans-serif`
      : `bold ${Math.min(zone.w, zone.h) * 0.45}px "Press Start 2P", cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, zone.x + zone.w / 2, zone.y + zone.h / 2);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  });
}

// ─────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────
export default function GameCanvas() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const stateRef    = useRef<GameState | null>(null);
  const audioRef    = useRef<ReturnType<typeof createAudio> | null>(null);
  const animFrameRef = useRef<number>(0);
  const tickRef     = useRef<number>(0);
  const isTouchRef  = useRef<boolean>(false);
  const winRevealIndexRef = useRef<number>(0);
  const titleImgRef = useRef<HTMLImageElement | null>(null);
  const runFrameRefs = useRef<(HTMLImageElement | null)[]>(Array(6).fill(null));
  const fireFrameRef = useRef<HTMLImageElement | null>(null);
  const bgImgRefs = useRef<(HTMLImageElement | null)[]>(Array(4).fill(null));
  const pedestalBgRef = useRef<HTMLImageElement | null>(null);
  const groundTileRefs = useRef<(HTMLImageElement | null)[]>(Array(4).fill(null));
  const enemyFrameRefs = useRef<Record<string, (HTMLImageElement | null)[]>>({
    walker: Array(6).fill(null),
    jumper: Array(6).fill(null),
    flyer:  Array(6).fill(null),
  });
  const itemFrameRefs = useRef<Record<string, (HTMLImageElement | null)[]>>({
    ammo:   Array(6).fill(null),
    bomb:   Array(6).fill(null),
    brick:  Array(6).fill(null),
    rapid:  Array(6).fill(null),
    pierce: Array(6).fill(null),
  });

  const [hudData, setHudData] = useState({
    score: 0, level: 1, lives: 3, collectedBoxes: [false, false, false], ammo: 30,
  });
  const [gamePhase, setGamePhase] = useState<"title" | "playing" | "dead" | "levelComplete" | "win">("title");
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const isIOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);

  // Load high score on mount
  useEffect(() => {
    const stored = localStorage.getItem("pixelrunner_highscore");
    if (stored) setHighScore(parseInt(stored, 10) || 0);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.src = "/LJS-title.png";
    img.onload = () => { titleImgRef.current = img; };
  }, []);

  useEffect(() => {
    for (let i = 0; i < 6; i++) {
      const img = new Image();
      img.src = `/run_frame${i + 1}.png`;
      const idx = i;
      img.onload = () => { runFrameRefs.current[idx] = img; };
    }
    const fire = new Image();
    fire.src = "/run-frame-fire.png";
    fire.onload = () => { fireFrameRef.current = fire; };
    for (let i = 0; i < 4; i++) {
      const img = new Image();
      img.src = `/lvl${i + 1}-background.webp`;
      const idx = i;
      img.onload = () => { bgImgRefs.current[idx] = img; };
    }
    const pedBg = new Image();
    pedBg.src = "/lvl4-pedestal-background.webp";
    pedBg.onload = () => { pedestalBgRef.current = pedBg; };

    const groundFiles = ["lvl1-tile_grass", "lvl2-tile_stone", "lvl3-tile_lava", "lvl4-tile_gold"];
    groundFiles.forEach((name, i) => {
      const img = new Image();
      img.src = `/${name}.webp`;
      img.onload = () => { groundTileRefs.current[i] = img; };
    });

    const enemyTypes: Array<[string, string]> = [
      ["walker", "green_idle"],
      ["jumper", "purple_idle"],
      ["flyer",  "bat_idle"],
    ];
    enemyTypes.forEach(([type, prefix]) => {
      for (let i = 0; i < 6; i++) {
        const img = new Image();
        img.src = `/${prefix}${i + 1}.png`;
        const idx = i;
        img.onload = () => { enemyFrameRefs.current[type][idx] = img; };
      }
    });

    const itemTypes: Array<[string, string]> = [
      ["ammo",   "ammo2_idle"],
      ["bomb",   "bomb_idle"],
      ["brick",  "brick_idle"],
      ["rapid",  "speed_idle"],
      ["pierce", "pierce_idle"],
    ];
    itemTypes.forEach(([key, prefix]) => {
      for (let i = 0; i < 6; i++) {
        const img = new Image();
        img.src = `/${prefix}${i + 1}.png`;
        const idx = i;
        img.onload = () => { itemFrameRefs.current[key][idx] = img; };
      }
    });
  }, []);

  function updateHighScore(score: number) {
    setHighScore((prev) => {
      if (score > prev) {
        localStorage.setItem("pixelrunner_highscore", String(score));
        return score;
      }
      return prev;
    });
  }

  function ensureAudio() {
    if (!audioRef.current) audioRef.current = createAudio();
  }

  function startGame(level = 1, prevState?: Partial<GameState>) {
    ensureAudio();
    const gs = initGameState(level, prevState);
    stateRef.current = gs;
    winRevealIndexRef.current = 0;
    setGamePhase("playing");
    setHudData({ score: gs.score, level: gs.level, lives: gs.lives, collectedBoxes: [...gs.collectedBoxes], ammo: gs.ammo });
  }

  function canvasCoords(clientX: number, clientY: number): { cx: number; cy: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { cx: 0, cy: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      cx: (clientX - rect.left) * scaleX,
      cy: (clientY - rect.top)  * scaleY,
    };
  }

  function hitZone(cx: number, cy: number, zone: typeof TC.LEFT): boolean {
    return cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
  }
  function hitCircle(cx: number, cy: number, zone: typeof TC.SHOOT): boolean {
    const dx = cx - (zone.x + zone.w / 2);
    const dy = cy - (zone.y + zone.h / 2);
    return Math.sqrt(dx * dx + dy * dy) <= zone.w / 2;
  }

  function syncTouchKeys(touches: TouchList) {
    const gs = stateRef.current;
    if (!gs) return;
    gs.keys["ArrowLeft"]  = false;
    gs.keys["ArrowRight"] = false;
    gs.keys["ArrowUp"]    = false;
    gs.keys["Space"]      = false;

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const { cx, cy } = canvasCoords(t.clientX, t.clientY);
      if (hitZone(cx, cy, TC.LEFT))          gs.keys["ArrowLeft"]  = true;
      if (hitZone(cx, cy, TC.RIGHT))         gs.keys["ArrowRight"] = true;
      if (hitZone(cx, cy, TC.JUMP))          gs.keys["ArrowUp"]    = true;
      if (hitCircle(cx, cy, TC.SHOOT))       gs.keys["Space"]      = true;
    }
  }

  // ── Keyboard handlers ──
  useEffect(() => {
    function onKey(e: KeyboardEvent, down: boolean) {
      if (!stateRef.current) return;
      stateRef.current.keys[e.code] = down;
      stateRef.current.keys[e.key]  = down;
      if (down && (e.code === "Space" || e.code === "Enter")) handleActionKey();
      if (["Space","ArrowUp","ArrowLeft","ArrowRight","ArrowDown"].includes(e.code)) e.preventDefault();
    }

    function handleActionKey() {
      const gs = stateRef.current!;
      if (gs.phase === "title") {
        startGame(1);
      } else if (gs.phase === "dead") {
        gs.lives > 0
          ? startGame(gs.level, { score: gs.score, lives: gs.lives, collectedBoxes: gs.collectedBoxes, collectedLetters: gs.collectedLetters })
          : startGame(1);
      } else if (gs.phase === "levelComplete") {
        startGame(gs.level + 1, { score: gs.score, lives: gs.lives, collectedBoxes: gs.collectedBoxes, collectedLetters: gs.collectedLetters });
      }
    }

    window.addEventListener("keydown", (e) => onKey(e, true));
    window.addEventListener("keyup",   (e) => onKey(e, false));
    return () => {
      window.removeEventListener("keydown", (e) => onKey(e, true));
      window.removeEventListener("keyup",   (e) => onKey(e, false));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Touch handlers on the canvas element ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      isTouchRef.current = true;
      setIsTouchDevice(true);
      ensureAudio();
      const gs = stateRef.current;
      if (!gs) { startGame(1); return; }

      if (gs.phase === "title") { startGame(1); return; }
      if (gs.phase === "dead") {
        gs.lives > 0
          ? startGame(gs.level, { score: gs.score, lives: gs.lives, collectedBoxes: gs.collectedBoxes, collectedLetters: gs.collectedLetters })
          : startGame(1);
        return;
      }
      if (gs.phase === "levelComplete") {
        startGame(gs.level + 1, { score: gs.score, lives: gs.lives, collectedBoxes: gs.collectedBoxes, collectedLetters: gs.collectedLetters });
        return;
      }
      if (gs.phase === "win") { startGame(1); return; }
      syncTouchKeys(e.touches);
    }

    let lastTouchMove = 0;
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastTouchMove < 16) return;
      lastTouchMove = now;
      if (stateRef.current?.phase === "playing") syncTouchKeys(e.touches);
    }

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      if (stateRef.current?.phase === "playing") syncTouchKeys(e.touches);
    }

    canvas.addEventListener("touchstart",  onTouchStart,  { passive: false });
    canvas.addEventListener("touchmove",   onTouchMove,   { passive: false });
    canvas.addEventListener("touchend",    onTouchEnd,    { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd,    { passive: false });

    return () => {
      canvas.removeEventListener("touchstart",  onTouchStart);
      canvas.removeEventListener("touchmove",   onTouchMove);
      canvas.removeEventListener("touchend",    onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mouse click (desktop) ──
  function handleCanvasClick() {
    if (isTouchRef.current) return;
    ensureAudio();
    const gs = stateRef.current;
    if (!gs || gs.phase === "title") { startGame(1); return; }
    if (gs.phase === "dead") {
      gs.lives > 0
        ? startGame(gs.level, { score: gs.score, lives: gs.lives, collectedBoxes: gs.collectedBoxes, collectedLetters: gs.collectedLetters })
        : startGame(1);
      return;
    }
    if (gs.phase === "levelComplete") {
      startGame(gs.level + 1, { score: gs.score, lives: gs.lives, collectedBoxes: gs.collectedBoxes, collectedLetters: gs.collectedLetters });
      return;
    }
    if (gs.phase === "win") { startGame(1); return; }
    gs.keys["shoot_click"] = true;
    setTimeout(() => { if (stateRef.current) stateRef.current.keys["shoot_click"] = false; }, 80);
  }

  // ── Game Loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    function gameLoop() {
      animFrameRef.current = requestAnimationFrame(gameLoop);
      tickRef.current++;
      const tick = tickRef.current;
      const gs   = stateRef.current;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      if (!gs || gs.phase === "title")     { drawTitleScreen(ctx, tick); return; }
      if (gs.phase === "win")              { drawWinScreen(ctx, tick); return; }
      if (gs.phase === "dead")             { drawDeadScreen(ctx, gs, tick); return; }
      if (gs.phase === "levelComplete")    { drawLevelCompleteScreen(ctx, gs, tick); return; }

      updateGame(gs, tick);
      renderGame(ctx, gs, tick);
    }

    animFrameRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────
  //  UPDATE
  // ─────────────────────────────────────────────
  function updateGame(gs: GameState, tick: number) {
    const audio = audioRef.current!;
    const keys  = gs.keys;

    const left  = keys["ArrowLeft"]  || keys["a"] || keys["A"];
    const right = keys["ArrowRight"] || keys["d"] || keys["D"];
    const jump  = keys["ArrowUp"]    || keys["w"] || keys["W"] || keys["z"] || keys["Z"];
    const shoot = keys["Space"]      || keys[" "] || keys["shoot_click"];

    if (left)       { gs.pvx = -PLAYER_SPEED; gs.pFacing = -1; }
    else if (right) { gs.pvx =  PLAYER_SPEED; gs.pFacing =  1; }
    else              gs.pvx *= 0.75;

    if (jump && gs.pOnGround) { gs.pvy = JUMP_FORCE; gs.pOnGround = false; audio.playJump(); }

    gs.pvy += GRAVITY;
    gs.px  += gs.pvx;
    gs.py  += gs.pvy;

    gs.pAnimTimer++;
    if (gs.pAnimTimer % 6 === 0) gs.pFrame = (gs.pFrame + 1) % 6;
    if (gs.pInvincible > 0) { gs.pInvincible--; gs.pFlash = !gs.pFlash; }

    gs.pOnGround = false;
    const overCliff = gs.cliffX !== null && gs.px + 16 > gs.cliffX && gs.px + 16 < gs.cliffX + 640;
    if (!overCliff && gs.py + 40 >= GROUND_Y) { gs.py = GROUND_Y - 40; gs.pvy = 0; gs.pOnGround = true; }

    // Level 4 boss phase: bound player in room, update camera
    if (gs.level === 4 && gs.l4Phase === "boss") {
      if (gs.px < 20) gs.px = 20;
      if (gs.px > BOSS_ROOM_W - 40) gs.px = BOSS_ROOM_W - 40;
      gs.cameraX = Math.max(0, Math.min(gs.px - CANVAS_W / 2, BOSS_ROOM_W - CANVAS_W));
    } else {
      if (gs.px < 20) gs.px = 20;
    }

    gs.platforms.forEach((p) => {
      const pRect:   Rect = { x: gs.px + 2, y: gs.py,    w: 28, h: 40 };
      const platRect:Rect = { x: p.x,       y: p.y,      w: p.w, h: p.h };
      if (rectsOverlap(pRect, platRect) && gs.pvy >= 0 && gs.py + 40 - gs.pvy <= p.y + 4) {
        gs.py = p.y - 40; gs.pvy = 0; gs.pOnGround = true;
      }
    });

    // Pedestal box collision — landing on top fills the box and reveals the letter
    if (gs.level === 4 && gs.l4Phase === "pedestal") {
      gs.pedestalSlots.forEach((slot) => {
        const boxTop = GROUND_Y - 90;
        const boxRect: Rect = { x: slot.x - 20, y: boxTop, w: 40, h: 60 };
        const pRect: Rect = { x: gs.px + 2, y: gs.py, w: 28, h: 40 };
        if (rectsOverlap(pRect, boxRect) && gs.pvy >= 0 && gs.py + 40 - gs.pvy <= boxTop + 4) {
          gs.py = boxTop - 40; gs.pvy = 0; gs.pOnGround = true;
          if (!slot.filled) {
            slot.filled = true;
            spawnParticles(gs.particles, slot.x, slot.y, "#FFD700", 30, 6);
            audio.playPlace();
            if (gs.pedestalSlots.every((s) => s.filled)) {
              gs.nameRevealTimer = 240; // 4 second banner
            }
          }
        }
      });
    }

    if (gs.shootCooldown > 0) gs.shootCooldown--;
    gs.isFiring = gs.shootCooldown > 8; // only show fire frame briefly after shot
    if (shoot && gs.shootCooldown === 0 && gs.ammo > 0) {
      gs.isFiring = true;
      const aw = gs.activeWeapon;
      const cooldown = aw?.type === "rapid" ? 5 : 12;
      const bx = gs.px + (gs.pFacing > 0 ? 30 : -10);
      const by = gs.py + 12;
      const bvx = BULLET_SPEED * gs.pFacing;
      // spawn bullets based on weapon type
      if (aw?.type === "double") {
        gs.bullets.push({ x: bx, y: by - 4, vx: bvx, active: true });
        gs.bullets.push({ x: bx, y: by + 4, vx: bvx, active: true });
      } else if (aw?.type === "big") {
        gs.bullets.push({ x: bx, y: by, vx: bvx, active: true, big: true } as Bullet & { big?: boolean });
      } else if (aw?.type === "pierce") {
        gs.bullets.push({ x: bx, y: by, vx: bvx, active: true, pierce: true } as Bullet & { pierce?: boolean });
      } else {
        gs.bullets.push({ x: bx, y: by, vx: bvx, active: true });
      }
      if (gs.ammo !== Infinity) gs.ammo--;
      if (aw) {
        aw.shotsLeft--;
        if (aw.shotsLeft <= 0) gs.activeWeapon = null;
      }
      gs.shootCooldown = cooldown;
      audio.playShoot();
    }

    // Combo timer countdown
    if (gs.comboTimer > 0) {
      gs.comboTimer--;
      if (gs.comboTimer <= 0) gs.comboCount = 0;
    }

    gs.bullets.forEach((b) => {
      if (!b.active) return;
      b.x += b.vx;
      const bulletMaxX = gs.level === 4 && gs.l4Phase === "boss" ? BOSS_ROOM_W + 20 : gs.scrollX + CANVAS_W + 20;
      if (b.x < -20 || b.x > bulletMaxX) { b.active = false; return; }
      const bRect = { x: b.x, y: b.y, w: b.big ? 16 : 10, h: b.big ? 10 : 5 };
      gs.blocks.forEach((bl) => {
        if (bl.broken || !b.active) return;
        if (rectsOverlap(bRect, { x: bl.x, y: bl.y, w: bl.w, h: bl.h })) {
          bl.hp -= b.big ? 2 : 1;
          if (!b.pierce) b.active = false;
          spawnParticles(gs.particles, b.x, b.y, bl.color, 6, 3); gs.score += 10;
          if (bl.hp <= 0) { bl.broken = true; spawnParticles(gs.particles, bl.x + bl.w / 2, bl.y + bl.h / 2, bl.color, 12, 5); gs.score += 50; audio.playHit(); }
        }
      });
      gs.enemies.forEach((en) => {
        if (!en.active || !b.active) return;
        if (Math.abs(b.x - en.x) > 60 || Math.abs(b.y - en.y) > 60) return;
        if (rectsOverlap(bRect, { x: en.x, y: en.y, w: en.w, h: en.h })) {
          en.hp -= b.big ? 2 : 1;
          if (!b.pierce) b.active = false;
          spawnParticles(gs.particles, b.x, b.y, "#6B8E23", 6, 3);
          gs.score += 30;
          if (en.hp <= 0) {
            en.active = false;
            const multiplier = Math.min(Math.max(gs.comboCount, 1), 4);
            spawnParticles(gs.particles, en.x + en.w / 2, en.y + en.h / 2, "#6B8E23", 14, 5);
            gs.score += 100 * multiplier;
            gs.comboCount++; gs.comboTimer = 120;
            audio.playEnemyDie();
          }
        }
      });
      // Boss bullet collision (level 4 only)
      if (gs.level === 4 && gs.l4Phase === "boss" && gs.boss && gs.boss.active && !gs.boss.defeated && b.active) {
        const bw = (b as Bullet & { big?: boolean }).big ? 16 : 10;
        const bh = (b as Bullet & { big?: boolean }).big ? 10 : 5;
        const dmg = (b as Bullet & { big?: boolean }).big ? 2 : 1;
        const phase3Hit = gs.boss.hp <= 10;
        const hitW = phase3Hit ? gs.boss.w * 2 : gs.boss.w;
        const hitH = phase3Hit ? gs.boss.h * 2 : gs.boss.h;
        const hitX = gs.boss.x - (phase3Hit ? gs.boss.w / 2 : 0);
        const hitY = gs.boss.y - (phase3Hit ? gs.boss.h : 0);
        if (rectsOverlap({ x: b.x, y: b.y, w: bw, h: bh }, { x: hitX, y: hitY, w: hitW, h: hitH })) {
          gs.boss.hp -= dmg;
          if (!(b as Bullet & { pierce?: boolean }).pierce) b.active = false;
          spawnParticles(gs.particles, b.x, b.y, "#CC0000", 6, 3);
          gs.score += 50;
          if (gs.boss.hp <= 0 && !gs.boss.defeated) {
            gs.boss.defeated = true;
            gs.boss.defeatedTimer = 0;
          }
        }
      }
    });
    gs.bullets = gs.bullets.filter((b) => b.active);

    gs.enemies.forEach((en) => {
      if (!en.active) return;

      if (en.type === "flyer") {
        // Flyers cruise at fixed sky height, randomly dive to ground and back up
        const CRUISE_Y = GROUND_Y - 160;
        const DIVE_Y = GROUND_Y - en.h - 4;
        en.x += en.vx;
        // jumpTimer: 0 = cruising (countdown to next dive), 1-40 = diving down, 41-80 = rising up
        if (en.jumpTimer <= 0) {
          // snap to cruise height
          en.y += (CRUISE_Y - en.y) * 0.15;
          en.jumpTimer--;
          if (en.jumpTimer <= -(100 + Math.floor(en.sinOffset * 80))) {
            en.jumpTimer = 1; // start dive
          }
        } else if (en.jumpTimer <= 40) {
          // diving down
          en.y += (DIVE_Y - en.y) * 0.12;
          en.jumpTimer++;
        } else if (en.jumpTimer <= 80) {
          // rising back up
          en.y += (CRUISE_Y - en.y) * 0.12;
          en.jumpTimer++;
        } else {
          // dive complete, reset to cruising countdown
          en.jumpTimer = 0;
        }
      } else {
        // Walkers and jumpers obey gravity
        en.vy += GRAVITY; en.x += en.vx; en.y += en.vy;
        en.onGround = false;
        if (en.y + en.h >= GROUND_Y) { en.y = GROUND_Y - en.h; en.vy = 0; en.onGround = true; }
        gs.platforms.forEach((p) => {
          if (rectsOverlap({ x: en.x, y: en.y, w: en.w, h: en.h }, { x: p.x, y: p.y, w: p.w, h: p.h }) && en.vy >= 0 && en.y + en.h - en.vy <= p.y + 4) {
            en.y = p.y - en.h; en.vy = 0; en.onGround = true;
          }
        });

        if (en.type === "jumper" && en.onGround) {
          en.jumpTimer++;
          if (en.jumpTimer >= 90) { en.vy = -10; en.onGround = false; en.jumpTimer = 0; }
        }
      }

      if (en.x < 0 || en.x > gs.scrollX + CANVAS_W) en.vx *= -1;

      // Stomp check: player falling and feet near enemy top
      const playerRect: Rect = { x: gs.px + 2, y: gs.py, w: 28, h: 40 };
      const enRect: Rect = { x: en.x, y: en.y, w: en.w, h: en.h };
      if (gs.pvy > 2 && gs.py + 38 <= en.y + 8 && rectsOverlap(playerRect, enRect)) {
        en.hp -= 2;
        gs.pvy = -9;
        spawnParticles(gs.particles, en.x + en.w / 2, en.y, "#6B8E23", 10, 4);
        const multiplier = Math.min(Math.max(gs.comboCount, 1), 4);
        gs.score += 150 * multiplier;
        gs.comboCount++; gs.comboTimer = 120;
        if (en.hp <= 0) {
          en.active = false;
          spawnParticles(gs.particles, en.x + en.w / 2, en.y + en.h / 2, "#6B8E23", 14, 5);
          audio.playEnemyDie();
        } else {
          audio.playHit();
        }
      } else if (gs.pInvincible === 0 && rectsOverlap(playerRect, enRect)) {
        const causeMap: Record<string, string> = { walker: "STOMPED BY A WALKER", jumper: "AMBUSHED BY A JUMPER", flyer: "SWOOPED BY A FLYER" };
        gs.lives--; gs.pInvincible = 90; gs.shakeTimer = 10; audio.playDeath();
        gs.deathCause = causeMap[en.type] ?? "KILLED BY AN ENEMY";
        spawnParticles(gs.particles, gs.px + 16, gs.py + 20, "#ff0000", 10, 4);
        if (gs.lives <= 0) {
          updateHighScore(gs.score);
          gs.phase = "dead"; gs.deathTimer = 0; setGamePhase("dead");
        }
      }
    });

    // Boss update (level 4 boss phase only)
    if (gs.level === 4 && gs.l4Phase === "boss" && gs.boss && gs.boss.active && !gs.boss.defeated) {
      const boss = gs.boss;
      boss.attackTimer++;

      if (boss.attackType === "idle") {
        // Patrol slowly
        boss.x += boss.vx;
        if (boss.x < 100) boss.vx = 1.2;
        if (boss.x > BOSS_ROOM_W - 180) boss.vx = -1.2;
        boss.attackCooldown--;
        if (boss.attackCooldown <= 0) {
          // Phase 1 (hp 21-30): spray only; Phase 2 (hp 11-20): bombs only; Phase 3 (hp 1-10): stomp only
          const nextAttack: "spray" | "bombs" | "stomp" =
            boss.hp > 20 ? "spray" : boss.hp > 10 ? "bombs" : "stomp";
          boss.attackType = nextAttack;
          boss.attackTimer = 0;
          boss.attackCooldown = 120 + Math.floor(Math.random() * 60);
          if (boss.attackType === "stomp") {
            boss.stompRising = true;
            boss.stompTargetX = gs.px;
            boss.stompPasses = 2;
            boss.stompY = boss.y;
          }
        }
      } else if (boss.attackType === "spray") {
        // Shoot spray particles toward player
        if (boss.attackTimer % 3 === 0 && boss.attackTimer < 120) {
          const count = 4 + Math.floor(Math.random() * 3);
          const dir = gs.px > boss.x ? 1 : -1;
          for (let i = 0; i < count; i++) {
            const speed = 3 + Math.random() * 3;
            const spreadVy = (Math.random() - 0.5) * 4;
            boss.sprayParticles.push({
              x: boss.x + boss.w / 2,
              y: boss.y + boss.h / 2,
              vx: dir * speed,
              vy: spreadVy,
              life: 80,
              maxLife: 80,
            });
          }
        }
        // Move spray particles — update, collide, and filter in one pass
        let spLen = boss.sprayParticles.length;
        for (let si = spLen - 1; si >= 0; si--) {
          const sp = boss.sprayParticles[si];
          sp.x += sp.vx; sp.y += sp.vy; sp.life--;
          if (gs.pInvincible === 0 && rectsOverlap({ x: sp.x - 3, y: sp.y - 3, w: 6, h: 6 }, { x: gs.px + 2, y: gs.py, w: 28, h: 40 })) {
            sp.life = 0;
            gs.lives--; gs.pInvincible = 90; gs.shakeTimer = 10; audio.playDeath();
            gs.deathCause = "HIT BY BOSS SPRAY";
            spawnParticles(gs.particles, gs.px + 16, gs.py + 20, "#ff0000", 10, 4);
            if (gs.lives <= 0) { updateHighScore(gs.score); gs.phase = "dead"; gs.deathTimer = 0; setGamePhase("dead"); }
          }
          if (sp.life <= 0) { boss.sprayParticles[si] = boss.sprayParticles[--spLen]; boss.sprayParticles.length = spLen; }
        }
        if (boss.attackTimer >= 120) {
          boss.sprayParticles = [];
          boss.attackType = "idle";
          boss.attackCooldown = 120 + Math.floor(Math.random() * 60);
        }
      } else if (boss.attackType === "bombs") {
        // Spawn 6 bombs at start
        if (boss.attackTimer === 1) {
          for (let i = 0; i < 6; i++) {
            boss.bombs.push({
              x: boss.x + boss.w / 2,
              y: boss.y,
              vx: (Math.random() - 0.5) * 16,
              vy: -18 + Math.random() * 6,
              landed: false,
              explodeTimer: 0,
              active: true,
            });
          }
        }
        // Update bombs
        boss.bombs.forEach((bomb) => {
          if (!bomb.active) return;
          if (!bomb.landed) {
            bomb.vy += GRAVITY;
            bomb.x += bomb.vx;
            bomb.y += bomb.vy;
            if (bomb.y >= GROUND_Y - 8) {
              bomb.y = GROUND_Y - 8;
              bomb.landed = true;
              bomb.explodeTimer = 45;
            }
          } else {
            bomb.explodeTimer--;
            if (bomb.explodeTimer <= 0) {
              bomb.active = false;
              spawnParticles(gs.particles, bomb.x, bomb.y, "#FF6600", 14, 5);
              spawnParticles(gs.particles, bomb.x, bomb.y, "#FF4400", 8, 3);
              const dist = Math.hypot(gs.px + 16 - bomb.x, gs.py + 20 - bomb.y);
              if (dist < 55 && gs.pInvincible === 0) {
                gs.lives--; gs.pInvincible = 90; gs.shakeTimer = 10; audio.playDeath();
                gs.deathCause = "CAUGHT IN AN EXPLOSION";
                spawnParticles(gs.particles, gs.px + 16, gs.py + 20, "#ff0000", 10, 4);
                if (gs.lives <= 0) { updateHighScore(gs.score); gs.phase = "dead"; gs.deathTimer = 0; setGamePhase("dead"); }
              }
            }
          }
        });
        const allDone = boss.bombs.every((b) => !b.active) && boss.attackTimer > 5;
        if (allDone || boss.attackTimer >= 300) {
          boss.bombs = [];
          boss.attackType = "idle";
          boss.attackCooldown = 120 + Math.floor(Math.random() * 60);
        }
      } else if (boss.attackType === "stomp") {
        if (boss.stompRising) {
          // Rise to GROUND_Y - 220
          const targetY = GROUND_Y - 220;
          boss.y -= 6;
          boss.stompY = boss.y;
          if (boss.y <= targetY) {
            boss.y = targetY;
            boss.stompRising = false;
          }
        } else if (boss.stompPasses > 0) {
          // Fly across room
          const dir = boss.vx > 0 ? 1 : -1;
          boss.x += dir * 7;
          // Loosely track player x
          boss.stompTargetX += (gs.px - boss.stompTargetX) * 0.02;
          if (boss.x < 20) { boss.vx = Math.abs(boss.vx); boss.stompPasses--; }
          if (boss.x > BOSS_ROOM_W - boss.w - 20) { boss.vx = -Math.abs(boss.vx); boss.stompPasses--; }
        } else {
          // Dive down
          boss.vy = Math.min(boss.vy + 2, 18);
          boss.y += boss.vy;
          if (boss.y >= GROUND_Y - boss.h) {
            boss.y = GROUND_Y - boss.h;
            boss.vy = 0;
            boss.onGround = true;
            gs.shakeTimer = 15;
            spawnParticles(gs.particles, boss.x + boss.w / 2, GROUND_Y, "#CC4400", 20, 6);
            // Check if player is within 70px
            if (Math.abs(gs.px + 16 - (boss.x + boss.w / 2)) < 70 && gs.pInvincible === 0) {
              gs.lives--; gs.pInvincible = 90; audio.playDeath();
              gs.deathCause = "CRUSHED BY THE BOSS";
              spawnParticles(gs.particles, gs.px + 16, gs.py + 20, "#ff0000", 10, 4);
              if (gs.lives <= 0) { updateHighScore(gs.score); gs.phase = "dead"; gs.deathTimer = 0; setGamePhase("dead"); }
            }
            boss.attackType = "idle";
            boss.attackCooldown = 150;
          }
        }
      }

      if (boss.x < 20) boss.x = 20;
      if (boss.x > BOSS_ROOM_W - boss.w - 20) boss.x = BOSS_ROOM_W - boss.w - 20;

      // Boss contact damage (only in idle/stomp)
      if (boss.attackType !== "spray") {
        const p3c = boss.hp <= 10;
        const bossRect: Rect = p3c
          ? { x: boss.x - boss.w / 2, y: boss.y - boss.h, w: boss.w * 2, h: boss.h * 2 }
          : { x: boss.x, y: boss.y, w: boss.w, h: boss.h };
        const playerRectB: Rect = { x: gs.px + 2, y: gs.py, w: 28, h: 40 };
        if (gs.pInvincible === 0 && rectsOverlap(playerRectB, bossRect)) {
          gs.lives--; gs.pInvincible = 90; gs.shakeTimer = 10; audio.playDeath();
          gs.deathCause = "TOUCHED BY THE BOSS";
          spawnParticles(gs.particles, gs.px + 16, gs.py + 20, "#ff0000", 10, 4);
          if (gs.lives <= 0) { updateHighScore(gs.score); gs.phase = "dead"; gs.deathTimer = 0; setGamePhase("dead"); }
        }
      }
    }

    // Boss defeat transition (level 4)
    if (gs.level === 4 && gs.l4Phase === "boss" && gs.boss && gs.boss.defeated) {
      gs.boss.defeatedTimer++;
      if (gs.boss.defeatedTimer === 1) {
        spawnParticles(gs.particles, gs.boss.x + gs.boss.w / 2, gs.boss.y + gs.boss.h / 2, "#FFD700", 40, 8);
        spawnParticles(gs.particles, gs.boss.x + gs.boss.w / 2, gs.boss.y + gs.boss.h / 2, "#FF4400", 30, 6);
        audio.playLevelUp();
      }
      if (gs.boss.defeatedTimer >= 90) {
        gs.l4Phase = "pedestal";
        gs.px = CANVAS_W / 2;
        gs.py = GROUND_Y - 60;
        gs.pvx = 0; gs.pvy = 0;
        gs.cameraX = 0;
      }
    }

    // Ammo crate collection
    gs.ammoCrates.forEach((c) => {
      if (c.collected) return;
      if (rectsOverlap({ x: gs.px + 2, y: gs.py, w: 28, h: 40 }, { x: c.x, y: c.y, w: c.w, h: c.h })) {
        c.collected = true;
        if (gs.ammo !== Infinity) gs.ammo += 10;
        spawnParticles(gs.particles, c.x + c.w / 2, c.y + c.h / 2, "#FF8C00", 8, 3);
        audio.playCollect();
      }
    });

    // Weapon pickup collection
    gs.weaponPickups.forEach((p) => {
      if (p.collected) return;
      if (rectsOverlap({ x: gs.px + 2, y: gs.py, w: 28, h: 40 }, { x: p.x, y: p.y, w: p.w, h: p.h })) {
        p.collected = true;
        gs.activeWeapon = { type: p.type, shotsLeft: WEAPON_SHOTS[p.type] };
        spawnParticles(gs.particles, p.x + p.w / 2, p.y + p.h / 2, WEAPON_COLORS[p.type], 12, 4);
        audio.playCollect();
      }
    });

    if (gs.goldenBox && gs.goldenBox.spawned && !gs.goldenBox.collected) {
      const gb = gs.goldenBox;
      if (rectsOverlap({ x: gs.px + 2, y: gs.py, w: 28, h: 40 }, { x: gb.x, y: gb.y, w: gb.w, h: gb.h })) {
        gb.collected = true;
        const idx = ["L","J","S"].indexOf(gb.letter);
        if (idx >= 0) {
          gs.collectedBoxes[idx] = true;
          if (!gs.collectedLetters.includes(gb.letter)) gs.collectedLetters.push(gb.letter);
        }
        spawnParticles(gs.particles, gb.x + gb.w / 2, gb.y + gb.h / 2, "#FFD700", 20, 6);
        gs.score += 500; audio.playCollect();
        gs.letterReveal = { letter: gb.letter, timer: 180, maxTimer: 180 };
        setHudData((prev) => ({ ...prev, collectedBoxes: [...gs.collectedBoxes] }));
      }
    }

    if (gs.level === 4 && gs.l4Phase === "pedestal" && gs.phase === "playing") {
      if (gs.nameRevealTimer > 0) {
        gs.nameRevealTimer--;
        if (gs.nameRevealTimer === 0) {
          updateHighScore(gs.score);
          gs.phase = "win"; setGamePhase("win"); audio.playWin();
        }
      }
    }

    if (gs.level !== 4) {
      // Difficulty ramp: scroll speed increases with level progress
      const progress = Math.min(gs.scrollX / gs.levelLength, 1);
      gs.scrollSpeed = (SCROLL_SPEEDS[gs.level - 1] ?? 3) + progress * 2.5;

      gs.scrollX += gs.scrollSpeed;
      gs.levelProgress = gs.scrollX;
      const drift = gs.scrollSpeed;
      gs.blocks.forEach((b)    => { b.x -= drift; });
      gs.platforms.forEach((p) => { p.x -= drift; });
      gs.enemies.forEach((e)   => { e.x -= drift; });
      gs.ammoCrates.forEach((c) => { c.x -= drift; });
      gs.weaponPickups.forEach((p) => { p.x -= drift; });
      if (gs.goldenBox) gs.goldenBox.x -= drift;
      if (gs.cliffX !== null) gs.cliffX -= drift;
      if (gs.boss) gs.boss.x -= drift;

      if (gs.px > CANVAS_W - 100) gs.px = CANVAS_W - 100;

      const lastPlat = gs.platforms.reduce((mx, p) => Math.max(mx, p.x), 0);
      if (lastPlat < CANVAS_W + 400) {
        const chunk = generateLevel(gs.level, CANVAS_W + 400);
        gs.blocks.push(...chunk.blocks);
        gs.platforms.push(...chunk.platforms);
        gs.enemies.push(...chunk.enemies);
        gs.ammoCrates.push(...chunk.ammoCrates);
        gs.weaponPickups.push(...chunk.weaponPickups);
      }

      if (gs.goldenBox && !gs.goldenBox.spawned && gs.scrollX > gs.levelLength - 800) {
        gs.goldenBox.spawned = true; gs.goldenBox.x = CANVAS_W + 200; gs.goldenBox.y = GROUND_Y - 80;
        if (gs.level !== 3) gs.cliffX = CANVAS_W + 400; // cliff starts 200px after the golden box
      }

      if (gs.scrollX >= gs.levelLength && gs.goldenBox?.collected) {
        gs.phase = "levelComplete"; gs.levelTransTimer = 0; setGamePhase("levelComplete"); audio.playLevelUp();
      }

      gs.blocks    = gs.blocks.filter((b) => b.x > -TILE);
      gs.platforms = gs.platforms.filter((p) => p.x > -200);
      gs.enemies   = gs.enemies.filter((e) => e.x > -100);
      gs.ammoCrates = gs.ammoCrates.filter((c) => c.x > -50);
      gs.weaponPickups = gs.weaponPickups.filter((p) => p.x > -50);
    }

    if (gs.level === 3) {
      gs.bgParticles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.life--;
        if (p.life <= 0) { p.x = Math.random() * CANVAS_W; p.y = GROUND_Y + Math.random() * 20; p.life = p.maxLife; }
      });
    }
    if (gs.level === 4 && gs.l4Phase === "boss") {
      gs.bgParticles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.life--;
        if (p.life <= 0) {
          p.x = Math.random() * BOSS_ROOM_W;
          p.y = Math.random() * GROUND_Y;
          p.life = p.maxLife;
          p.color = Math.random() > 0.5 ? "#cc2200" : "#ff4400";
        }
      });
    }

    if (gs.letterReveal) {
      gs.letterReveal.timer--;
      if (gs.letterReveal.timer <= 0) gs.letterReveal = null;
    }

    if (gs.shakeTimer > 0) gs.shakeTimer--;


    const MAX_PARTICLES = 200;
    // Update particles in-place, mark dead ones
    let pLen = gs.particles.length;
    for (let i = pLen - 1; i >= 0; i--) {
      const p = gs.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life--;
      if (p.life <= 0) { gs.particles[i] = gs.particles[--pLen]; gs.particles.length = pLen; }
    }
    // Cap particles
    if (gs.particles.length > MAX_PARTICLES) gs.particles.length = MAX_PARTICLES;

    if (gs.py > CANVAS_H + 100) {
      gs.lives--; gs.py = GROUND_Y - 60; gs.pvy = 0;
      gs.deathCause = "FELL INTO THE VOID";
      if (gs.lives <= 0) {
        updateHighScore(gs.score);
        gs.phase = "dead"; setGamePhase("dead"); audio.playDeath();
      }
      else { gs.pInvincible = 90; audio.playDeath(); }
    }

    if (tick % 6 === 0) {
      setHudData((prev) => {
        if (prev.score === gs.score && prev.level === gs.level && prev.lives === gs.lives && prev.ammo === gs.ammo) return prev;
        return { score: gs.score, level: gs.level, lives: gs.lives, collectedBoxes: [...gs.collectedBoxes], ammo: gs.ammo };
      });
    }
  }

  // ─────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────
  function renderGame(ctx: CanvasRenderingContext2D, gs: GameState, tick: number) {
    // Screen shake
    const shaking = gs.shakeTimer > 0;
    if (shaking) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }

    if (gs.level === 4 && gs.l4Phase === "boss") {
      // Draw boss room background (tiled, screen-space offset by camera)
      const bossBg = bgImgRefs.current[3];
      const bgTileW = 850; const bgH = 400;
      if (bossBg) {
        const startTile = Math.floor(gs.cameraX / bgTileW);
        for (let t = startTile; t <= startTile + 2; t++) {
          ctx.drawImage(bossBg, t * bgTileW - gs.cameraX, 0, bgTileW, bgH);
        }
      } else {
        const bossGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        bossGrad.addColorStop(0, "#1a0000"); bossGrad.addColorStop(1, "#3d0000");
        ctx.fillStyle = bossGrad; ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);
      }
      // Draw ember bg particles (screen-space: offset by camera)
      gs.bgParticles.forEach((p) => {
        const sx = p.x - gs.cameraX;
        if (sx < -10 || sx > CANVAS_W + 10) return;
        const alpha = (p.life / p.maxLife) * 0.6;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(sx), Math.round(p.y), p.size, p.size);
      });
      ctx.globalAlpha = 1;

      // Apply camera transform for world-space objects
      ctx.save();
      ctx.translate(-Math.round(gs.cameraX), 0);

      // Draw ground across full room width
      const l4Tile = groundTileRefs.current[3];
      if (l4Tile) {
        const tW = l4Tile.naturalWidth || 130; const tH = l4Tile.naturalHeight || 130;
        for (let tx = 0; tx < BOSS_ROOM_W; tx += tW)
          for (let ty = GROUND_Y; ty < CANVAS_H; ty += tH)
            ctx.drawImage(l4Tile, tx, ty, tW, tH);
      } else {
        const palL4 = LEVEL_PALETTES[3];
        ctx.fillStyle = palL4.ground; ctx.fillRect(0, GROUND_Y, BOSS_ROOM_W, CANVAS_H - GROUND_Y);
        ctx.fillStyle = palL4.accent; ctx.fillRect(0, GROUND_Y, BOSS_ROOM_W, 6);
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        for (let tx = 0; tx < BOSS_ROOM_W; tx += 48) ctx.fillRect(tx, GROUND_Y + 6, 2, CANVAS_H - GROUND_Y - 6);
      }

      // Platforms
      gs.platforms.forEach((p) => drawPlatform(ctx, p, 4));

      // Ammo crates and weapon pickups (world space)
      gs.ammoCrates.forEach((c) => drawAmmoCrate(ctx, c, tick, itemFrameRefs.current.ammo));
      gs.weaponPickups.forEach((p) => drawWeaponPickup(ctx, p, tick, itemFrameRefs.current));

      // Boss
      if (gs.boss) drawBoss(ctx, gs.boss, tick);

      // Spray particles
      if (gs.boss) {
        gs.boss.sprayParticles.forEach((sp) => {
          const alpha = sp.life / sp.maxLife;
          ctx.globalAlpha = alpha;
          const size = 4 + (1 - alpha) * 2;
          ctx.fillStyle = tick % 4 < 2 ? "#FFD700" : "#FF8800";
          ctx.fillRect(Math.round(sp.x - size / 2), Math.round(sp.y - size / 2), size, size);
        });
        ctx.globalAlpha = 1;

        // Bombs
        gs.boss.bombs.forEach((bomb) => {
          if (!bomb.active) return;
          const fuseOn = Math.floor(tick / 4) % 2 === 0;
          const bombFrameIdx = Math.floor(tick / 6) % 6;
          const bombSprite = itemFrameRefs.current.bomb?.[bombFrameIdx] ?? itemFrameRefs.current.bomb?.[0] ?? null;
          if (bombSprite) {
            ctx.drawImage(bombSprite, Math.round(bomb.x) - 8, Math.round(bomb.y) - 8, 16, 16);
          } else {
            ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(Math.round(bomb.x), Math.round(bomb.y), 6, 0, Math.PI * 2); ctx.fill();
          }
          if (!bomb.landed && fuseOn) {
            ctx.fillStyle = "#FFAA00"; ctx.fillRect(Math.round(bomb.x) - 1, Math.round(bomb.y) - 8, 2, 4);
          }
        });
      }

      // Enemies, bullets, player
      gs.enemies.forEach((e) => drawEnemy(ctx, e, tick, enemyFrameRefs.current));
      gs.bullets.forEach((b) => drawBullet(ctx, b));
      drawPlayer(ctx, gs.px, gs.py, gs.pFacing, gs.pFrame, gs.pInvincible, gs.isFiring, runFrameRefs.current, fireFrameRef.current);

      // Particles (world space)
      gs.particles.forEach((p) => {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      });
      ctx.globalAlpha = 1;

      ctx.restore();

      // HUD: Boss HP bar (screen-space)
      if (gs.boss && !gs.boss.defeated) {
        const barW = 300; const barX = CANVAS_W / 2 - barW / 2;
        ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(barX, 12, barW, 16);
        const hpPct = Math.max(0, gs.boss.hp / gs.boss.maxHp);
        ctx.fillStyle = hpPct > 0.5 ? "#00CC00" : hpPct > 0.25 ? "#CCCC00" : "#CC0000";
        ctx.fillRect(barX, 12, barW * hpPct, 16);
        ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 2; ctx.strokeRect(barX, 12, barW, 16);
        ctx.fillStyle = "#FFF"; ctx.font = '7px "Press Start 2P", cursive'; ctx.textAlign = "center";
        ctx.fillText("BOSS", CANVAS_W / 2, 24);

        // "DEFEAT THE BOSS!" text
        if (Math.floor(tick / 30) % 2 === 0) {
          ctx.fillStyle = "#FF4444"; ctx.font = '9px "Press Start 2P", cursive'; ctx.textAlign = "center";
          ctx.shadowColor = "#FF0000"; ctx.shadowBlur = 8;
          ctx.fillText("DEFEAT THE BOSS!", CANVAS_W / 2, CANVAS_H - 28);
          ctx.shadowBlur = 0;
        }
      } else if (gs.boss && gs.boss.defeated) {
        ctx.fillStyle = "#FFD700"; ctx.font = '12px "Press Start 2P", cursive'; ctx.textAlign = "center";
        ctx.shadowColor = "#FFD700"; ctx.shadowBlur = 15;
        ctx.fillText("BOSS DEFEATED!", CANVAS_W / 2, CANVAS_H / 2 - 30);
        ctx.shadowBlur = 0;
      }
    } else {
      // Normal rendering (levels 1-3 and level 4 pedestal)
      const bgTileW = 850; const bgH = 400;
      const activeBg = gs.level === 4 && gs.l4Phase === "pedestal"
        ? pedestalBgRef.current
        : bgImgRefs.current[gs.level - 1];
      if (activeBg) {
        const startTile = Math.floor(gs.scrollX / bgTileW);
        for (let t = startTile; t <= startTile + 2; t++) {
          ctx.drawImage(activeBg, t * bgTileW - gs.scrollX, 0, bgTileW, bgH);
        }
      } else {
        drawSky(ctx, gs.level, gs.stars, tick, gs.bgParticles);
      }

      if (gs.level === 4 && gs.l4Phase === "pedestal") {
        drawPedestal(ctx, gs.pedestalSlots, tick);
        const unplaced = gs.pedestalSlots.filter((s) => !s.filled);
        if (unplaced.length > 0 && gs.nameRevealTimer === 0) {
          ctx.fillStyle = "rgba(255,215,0,0.9)";
          ctx.font = '7px "Press Start 2P", cursive'; ctx.textAlign = "center";
          ctx.fillText("JUMP ON EACH BOX!", CANVAS_W / 2, CANVAS_H - 50);
        }
        if (gs.nameRevealTimer > 0) {
          drawNameBanner(ctx, gs.nameRevealTimer, tick);
        }
      }

      drawGround(ctx, gs.level, gs.scrollX, gs.cliffX, groundTileRefs.current[gs.level - 1]);
      gs.platforms.forEach((p)  => drawPlatform(ctx, p, gs.level));
      gs.blocks.forEach((b)     => drawBlock(ctx, b, tick, itemFrameRefs.current.brick));
      if (gs.goldenBox)            drawGoldenBox(ctx, gs.goldenBox, tick);
      gs.ammoCrates.forEach((c)  => drawAmmoCrate(ctx, c, tick, itemFrameRefs.current.ammo));
      gs.weaponPickups.forEach((p) => drawWeaponPickup(ctx, p, tick, itemFrameRefs.current));
      gs.enemies.forEach((e)    => drawEnemy(ctx, e, tick, enemyFrameRefs.current));
      gs.bullets.forEach((b)    => drawBullet(ctx, b));
      drawPlayer(ctx, gs.px, gs.py, gs.pFacing, gs.pFrame, gs.pInvincible, gs.isFiring, runFrameRefs.current, fireFrameRef.current);

      gs.particles.forEach((p) => {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      });
      ctx.globalAlpha = 1;
    }

    // Combo display
    if (gs.comboCount >= 2) {
      const flash = Math.floor(tick / 8) % 2 === 0;
      if (flash) {
        ctx.fillStyle = "#FFD700";
        ctx.font = '12px "Press Start 2P", cursive';
        ctx.textAlign = "center";
        ctx.shadowColor = "#FF8C00"; ctx.shadowBlur = 10;
        ctx.fillText(`COMBO x${gs.comboCount}!`, CANVAS_W / 2, 80);
        ctx.shadowBlur = 0;
      }
    }


    if (gs.letterReveal) drawLetterReveal(ctx, gs.letterReveal, tick);

    if (gs.level !== 4) drawHUDOverlay(ctx, gs.level, gs.scrollX, gs.levelLength);

    const lvlNames = ["FOREST ZONE", "DUNGEON ZONE", "LAVA ZONE", "FINAL CHAMBER"];
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = '7px "Press Start 2P", cursive';
    ctx.textAlign = "right"; ctx.fillText(lvlNames[gs.level - 1] ?? "", CANVAS_W - 10, CANVAS_H - 6);

    if (typeof gs.ammo === "number" && gs.ammo <= 5 && gs.ammo > 0 && Math.sin(tick * 0.2) > 0) {
      ctx.fillStyle = "#FF4444"; ctx.font = '8px "Press Start 2P", cursive';
      ctx.textAlign = "center"; ctx.fillText("LOW AMMO!", CANVAS_W / 2, 60);
    }
    if (typeof gs.ammo === "number" && gs.ammo === 0) {
      ctx.fillStyle = "#FF0000"; ctx.font = '8px "Press Start 2P", cursive';
      ctx.textAlign = "center"; ctx.fillText("NO AMMO!", CANVAS_W / 2, 60);
    }

    // Active weapon indicator
    if (gs.activeWeapon) {
      const aw = gs.activeWeapon;
      const col = WEAPON_COLORS[aw.type];
      const label = ({ rapid: "RAPID FIRE", double: "DOUBLE SHOT", big: "BIG SHOT", pierce: "PIERCE" })[aw.type];
      const maxShots = WEAPON_SHOTS[aw.type];
      const barW = 80;
      const barX = CANVAS_W / 2 - barW / 2;
      const barY = 32;
      // background pill
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(barX - 6, barY - 14, barW + 12, 26);
      // label
      ctx.fillStyle = col; ctx.font = '6px "Press Start 2P", cursive';
      ctx.textAlign = "center"; ctx.fillText(label, CANVAS_W / 2, barY - 2);
      // shots bar
      ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fillRect(barX, barY + 2, barW, 6);
      ctx.fillStyle = col; ctx.fillRect(barX, barY + 2, barW * (aw.shotsLeft / maxShots), 6);
      // shots count
      ctx.fillStyle = "#fff"; ctx.font = '5px "Press Start 2P", cursive';
      ctx.fillText(`${aw.shotsLeft} shots`, CANVAS_W / 2, barY + 18);
    }

    if (shaking) ctx.restore();
  }

  function drawTitleScreen(ctx: CanvasRenderingContext2D, tick: number) {
    const img = titleImgRef.current;
    if (img) {
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      // fallback while image loads
      ctx.fillStyle = "#0a0a1a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // High score overlay (top-left, subtle)
    if (highScore > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(8, 8, 140, 18);
      ctx.fillStyle = "#FFD700"; ctx.font = '7px "Press Start 2P", cursive';
      ctx.textAlign = "left";
      ctx.fillText(`HI: ${String(highScore).padStart(6, "0")}`, 14, 21);
    }

    // Blinking prompt that pulses over the image's "PRESS START" area
    if (Math.floor(tick / 35) % 2 === 0) {
      ctx.fillStyle = "rgba(255,220,0,0.92)";
      ctx.font = '11px "Press Start 2P", cursive';
      ctx.textAlign = "center";
      ctx.shadowColor = "#FF8C00"; ctx.shadowBlur = 12;
      ctx.fillText("▶  PRESS START  ◀", CANVAS_W / 2, CANVAS_H - 22);
      ctx.shadowBlur = 0;
    }
  }

  function drawDeadScreen(ctx: CanvasRenderingContext2D, gs: GameState, tick: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, "#1a0000"); grad.addColorStop(1, "#0a0000");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#FF0000"; ctx.font = '28px "Press Start 2P", cursive';
    ctx.textAlign = "center"; ctx.shadowColor = "#880000"; ctx.shadowBlur = 15;
    ctx.fillText("GAME OVER", CANVAS_W / 2, CANVAS_H / 2 - 60); ctx.shadowBlur = 0;
    if (gs.deathCause) {
      ctx.fillStyle = "#FF6644"; ctx.font = '8px "Press Start 2P", cursive';
      ctx.fillText(gs.deathCause, CANVAS_W / 2, CANVAS_H / 2 - 32);
    }
    ctx.fillStyle = "#FFD700"; ctx.font = '10px "Press Start 2P", cursive';
    ctx.fillText(`SCORE: ${String(gs.score).padStart(6, "0")}`, CANVAS_W / 2, CANVAS_H / 2 + 5);
    if (highScore > 0) {
      ctx.fillStyle = "#FFA500"; ctx.font = '8px "Press Start 2P", cursive';
      ctx.fillText(`HI: ${String(highScore).padStart(6, "0")}`, CANVAS_W / 2, CANVAS_H / 2 + 27);
    }
    ctx.fillStyle = gs.lives > 0 ? "#aaa" : "#888"; ctx.font = '8px "Press Start 2P", cursive';
    ctx.fillText(gs.lives > 0 ? `${gs.lives} ${gs.lives === 1 ? "LIFE" : "LIVES"} REMAINING` : "NO LIVES LEFT — RESTARTING", CANVAS_W / 2, CANVAS_H / 2 + 50);
    if (Math.floor(tick / 30) % 2 === 0) {
      ctx.fillStyle = "#FFD700"; ctx.font = '9px "Press Start 2P", cursive';
      ctx.fillText("TAP / SPACE / CLICK TO CONTINUE", CANVAS_W / 2, CANVAS_H - 60);
    }
  }

  function drawLevelCompleteScreen(ctx: CanvasRenderingContext2D, gs: GameState, tick: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, "#001a00"); grad.addColorStop(1, "#003300");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < 30; i++) {
      const colors = ["#FFD700","#FF8C00","#00FF00","#00FFFF","#FF69B4"];
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect((i * 137 * tick) % CANVAS_W, (i * 73 + tick * (i % 5 + 1)) % CANVAS_H, 4, 4);
    }
    ctx.fillStyle = "#FFD700"; ctx.font = '24px "Press Start 2P", cursive';
    ctx.textAlign = "center"; ctx.shadowColor = "#FF8C00"; ctx.shadowBlur = 15;
    ctx.fillText("LEVEL CLEAR!", CANVAS_W / 2, 120); ctx.shadowBlur = 0;
    const lvlNames = ["FOREST ZONE","DUNGEON ZONE","LAVA ZONE"];
    ctx.fillStyle = "#ffffff"; ctx.font = '9px "Press Start 2P", cursive';
    ctx.fillText(lvlNames[gs.level - 1] ?? "", CANVAS_W / 2, 155);
    ctx.fillStyle = "#FFD700"; ctx.font = '10px "Press Start 2P", cursive';
    ctx.fillText(`SCORE: ${String(gs.score).padStart(6, "0")}`, CANVAS_W / 2, 200);
    ctx.fillStyle = "#aaa"; ctx.font = '8px "Press Start 2P", cursive';
    ctx.fillText(`GOLDEN BOX [${["L","J","S"][gs.level - 1]}] COLLECTED!`, CANVAS_W / 2, 240);
    if (gs.collectedBoxes.every(Boolean)) {
      ctx.fillStyle = "#FFD700"; ctx.shadowColor = "#FFD700"; ctx.shadowBlur = 10;
      ctx.fillText("ALL BOXES FOUND! FINAL LEVEL UNLOCKED!", CANVAS_W / 2, 275); ctx.shadowBlur = 0;
    }
    if (Math.floor(tick / 30) % 2 === 0) {
      ctx.fillStyle = "#ffffff"; ctx.font = '9px "Press Start 2P", cursive';
      ctx.fillText("TAP / SPACE / CLICK TO CONTINUE", CANVAS_W / 2, CANVAS_H - 60);
    }
  }

  function drawWinScreen(ctx: CanvasRenderingContext2D, tick: number) {
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + tick * 0.005;
      const len = 300 + Math.sin(tick * 0.03 + i) * 30;
      const alpha = 0.04 + 0.03 * Math.sin(tick * 0.04 + i);
      ctx.fillStyle = `rgba(255,215,0,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(CANVAS_W / 2, CANVAS_H / 2 - 60);
      ctx.lineTo(CANVAS_W / 2 + Math.cos(angle) * len, CANVAS_H / 2 - 60 + Math.sin(angle) * len);
      ctx.lineTo(CANVAS_W / 2 + Math.cos(angle + 0.2) * len, CANVAS_H / 2 - 60 + Math.sin(angle + 0.2) * len);
      ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 40; i++) {
      const alpha = Math.sin(tick * 0.1 + i) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255,215,0,${alpha})`;
      ctx.fillRect((i * 179 + tick * (i % 3 + 1) * 2) % CANVAS_W, (i * 97 + tick * (i % 4 + 1)) % CANVAS_H, 3, 3);
    }
    for (let i = 0; i < 3; i++) {
      const bx = CANVAS_W / 2 - 80 + i * 80;
      const by = 40 + Math.sin(tick * 0.04 + i) * 6;
      ctx.fillStyle = "#FFD700"; ctx.fillRect(bx, by, 40, 40);
      ctx.strokeStyle = "#FFA500"; ctx.lineWidth = 3; ctx.strokeRect(bx + 1, by + 1, 38, 38);
      ctx.strokeStyle = "#B8860B"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx+20,by); ctx.lineTo(bx+20,by+40); ctx.moveTo(bx,by+20); ctx.lineTo(bx+40,by+20); ctx.stroke();
      ctx.fillStyle = "#8B6914"; ctx.font = '10px "Press Start 2P", cursive';
      ctx.textAlign = "center"; ctx.fillText(["L","J","S"][i], bx + 20, by + 26);
    }

    // Typewriter name reveal
    const fullName = "Leola Jane Snapp!";
    const charsToShow = Math.min(fullName.length, Math.floor(Math.max(0, tick - 60) / 6));
    const displayed = fullName.slice(0, charsToShow);
    const showCursor = charsToShow < fullName.length;

    // Play tick sound on each new character
    if (charsToShow > winRevealIndexRef.current) {
      winRevealIndexRef.current = charsToShow;
      if (audioRef.current) {
        audioRef.current.playTypeTick(440 + Math.random() * 200);
      }
    }

    const pulse = 1 + 0.04 * Math.sin(tick * 0.06);
    ctx.save();
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2 - 30);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "#FFD700"; ctx.font = '22px "Press Start 2P", cursive';
    ctx.textAlign = "center"; ctx.shadowColor = "#FFD700"; ctx.shadowBlur = 30;
    const cursorChar = showCursor ? (Math.floor(tick / 15) % 2 === 0 ? "|" : "") : "";
    ctx.fillText(displayed + cursorChar, 0, 0); ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = '9px "Press Start 2P", cursive';
    ctx.textAlign = "center";
    ctx.fillText("ALL GOLDEN BOXES PLACED!", CANVAS_W / 2, CANVAS_H / 2 + 30);
    ctx.fillText("THE MYSTERY IS REVEALED.", CANVAS_W / 2, CANVAS_H / 2 + 55);
    if (Math.floor(tick / 40) % 2 === 0) {
      ctx.fillStyle = "#ffffff"; ctx.font = '7px "Press Start 2P", cursive';
      ctx.fillText("TAP / CLICK TO PLAY AGAIN", CANVAS_W / 2, CANVAS_H - 30);
    }
  }

  return (
    <div
      className="relative w-full flex items-center justify-center bg-pixel-dark overflow-hidden"
      style={{
        height: "100svh",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Fullscreen button — hidden on iOS where requestFullscreen is unsupported */}
      {!isIOS && <button
        onClick={() => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
          } else {
            document.exitFullscreen?.().catch(() => {});
          }
        }}
        style={{
          position: "fixed",
          top: "8px",
          right: "8px",
          zIndex: 100,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: "6px",
          color: "#fff",
          fontSize: "16px",
          width: "36px",
          height: "36px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "none",
        }}
        title="Fullscreen"
      >⛶</button>}

      <div
        className="relative"
        style={{
          /* fit canvas within safe-area-aware viewport in both orientations */
          width: `min(calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right)), calc((100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom)) * ${CANVAS_W / CANVAS_H}))`,
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          boxShadow: "0 0 40px rgba(255,215,0,0.15), 0 0 80px rgba(0,0,0,0.8)",
          border: "3px solid #333",
        }}
      >
        {gamePhase === "playing" && (
          <HUD
            score={hudData.score}
            level={hudData.level}
            lives={hudData.lives}
            collectedBoxes={hudData.collectedBoxes}
            ammo={hudData.ammo}
          />
        )}

        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onClick={handleCanvasClick}
          className="block"
          style={{
            imageRendering: "pixelated",
            width: "100%",
            height: "auto",
            touchAction: "none",
            cursor: "pointer",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        />

        {/* HTML D-pad overlay for touch devices */}
        {isTouchDevice && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: "3%",
              left: 0,
              right: 0,
              height: "36%",
              pointerEvents: "none",
            }}
          >
            {/* Left cluster — D-pad */}
            <div style={{ position: "absolute", left: "16px", bottom: "18px", pointerEvents: "auto" }}>
              {/* JUMP */}
              <button
                style={{
                  position: "absolute",
                  left: "64px",
                  bottom: "0px",
                  width: "56px",
                  height: "56px",
                  background: "rgba(40,80,200,0.7)",
                  border: "2px solid rgba(100,150,255,0.8)",
                  borderRadius: "10px",
                  color: "#fff",
                  fontFamily: '"Press Start 2P", cursive',
                  fontSize: "9px",
                  cursor: "pointer",
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
                onPointerDown={() => { if (stateRef.current) stateRef.current.keys["ArrowUp"] = true; }}
                onPointerUp={() => { if (stateRef.current) stateRef.current.keys["ArrowUp"] = false; }}
                onPointerLeave={() => { if (stateRef.current) stateRef.current.keys["ArrowUp"] = false; }}
              >▲</button>
              {/* LEFT */}
              <button
                style={{
                  position: "absolute",
                  left: "0px",
                  bottom: "0px",
                  width: "56px",
                  height: "56px",
                  background: "rgba(40,80,200,0.7)",
                  border: "2px solid rgba(100,150,255,0.8)",
                  borderRadius: "10px",
                  color: "#fff",
                  fontFamily: '"Press Start 2P", cursive',
                  fontSize: "9px",
                  cursor: "pointer",
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
                onPointerDown={() => { if (stateRef.current) stateRef.current.keys["ArrowLeft"] = true; }}
                onPointerUp={() => { if (stateRef.current) stateRef.current.keys["ArrowLeft"] = false; }}
                onPointerLeave={() => { if (stateRef.current) stateRef.current.keys["ArrowLeft"] = false; }}
              >◄</button>
              {/* RIGHT */}
              <button
                style={{
                  position: "absolute",
                  left: "128px",
                  bottom: "0px",
                  width: "56px",
                  height: "56px",
                  background: "rgba(40,80,200,0.7)",
                  border: "2px solid rgba(100,150,255,0.8)",
                  borderRadius: "10px",
                  color: "#fff",
                  fontFamily: '"Press Start 2P", cursive',
                  fontSize: "9px",
                  cursor: "pointer",
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
                onPointerDown={() => { if (stateRef.current) stateRef.current.keys["ArrowRight"] = true; }}
                onPointerUp={() => { if (stateRef.current) stateRef.current.keys["ArrowRight"] = false; }}
                onPointerLeave={() => { if (stateRef.current) stateRef.current.keys["ArrowRight"] = false; }}
              >►</button>
            </div>

            {/* Right cluster — SHOOT */}
            <div style={{ position: "absolute", right: "24px", bottom: "18px", pointerEvents: "auto" }}>
              <button
                style={{
                  width: "80px",
                  height: "80px",
                  background: "rgba(180,30,0,0.75)",
                  border: "3px solid rgba(255,140,0,0.9)",
                  borderRadius: "50%",
                  color: "#fff",
                  fontFamily: '"Press Start 2P", cursive',
                  fontSize: "8px",
                  cursor: "pointer",
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
                onPointerDown={() => { if (stateRef.current) stateRef.current.keys["Space"] = true; }}
                onPointerUp={() => { if (stateRef.current) stateRef.current.keys["Space"] = false; }}
                onPointerLeave={() => { if (stateRef.current) stateRef.current.keys["Space"] = false; }}
              >SHOOT</button>
            </div>
          </div>
        )}
      </div>

      {gamePhase === "playing" && !isTouchDevice && (
        <div
          className="absolute bottom-2 left-0 w-full text-center pointer-events-none"
          style={{ fontFamily: '"Press Start 2P", cursive', fontSize: "7px", color: "rgba(255,255,255,0.3)" }}
        >
          ← → MOVE &nbsp;|&nbsp; ↑ / W JUMP &nbsp;|&nbsp; SPACE / CLICK SHOOT
        </div>
      )}
    </div>
  );
}
