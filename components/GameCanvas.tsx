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
const GROUND_Y = CANVAS_H - 80;
const TILE = 32;

const SCROLL_SPEEDS = [3, 4.5, 6, 2];

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
interface Bullet { x: number; y: number; vx: number; active: boolean; }
interface Block { x: number; y: number; w: number; h: number; hp: number; maxHp: number; color: string; broken: boolean; }
interface GoldenBox { x: number; y: number; w: number; h: number; collected: boolean; letter: string; spawned: boolean; }
interface Enemy { x: number; y: number; w: number; h: number; vx: number; vy: number; hp: number; onGround: boolean; active: boolean; }
interface Platform { x: number; y: number; w: number; h: number; }
interface Star { x: number; y: number; size: number; twinkle: number; }
interface PedestalSlot { x: number; y: number; filled: boolean; letter: string; }

interface GameState {
  phase: "title" | "playing" | "dead" | "levelComplete" | "win";
  level: number;
  score: number;
  lives: number;
  ammo: number;
  collectedBoxes: boolean[];
  collectedLetters: string[];

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
  stars: Star[];

  pedestalSlots: PedestalSlot[];
  boxesToPlace: string[];
  placingIndex: number;
  placeTimer: number;

  keys: Record<string, boolean>;
  shootCooldown: number;
  levelTransTimer: number;
  deathTimer: number;
  titleAnimTimer: number;
  bgParticles: Particle[];
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

  return { playJump, playShoot, playHit, playCollect, playDeath, playLevelUp, playWin, playPlace, playEnemyDie };
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

function generateLevel(level: number, scrollX: number): { blocks: Block[]; platforms: Platform[]; enemies: Enemy[] } {
  const blocks: Block[] = [];
  const platforms: Platform[] = [];
  const enemies: Enemy[] = [];
  const pal = LEVEL_PALETTES[level - 1] ?? LEVEL_PALETTES[0];
  const startX = scrollX + CANVAS_W + 100;

  if (level === 1) {
    for (let i = 0; i < 12; i++) {
      const x = startX + i * 180 + Math.random() * 60;
      const y = GROUND_Y - 60 - Math.random() * 80;
      platforms.push({ x, y, w: 80 + Math.random() * 60, h: 16 });
      if (Math.random() > 0.4) blocks.push({ x: x + 10, y: y - TILE, w: TILE, h: TILE, hp: 2, maxHp: 2, color: pal.block, broken: false });
      if (Math.random() > 0.6) enemies.push({ x: x + 20, y: y - 32, w: 28, h: 28, vx: -1.2, vy: 0, hp: 2, onGround: false, active: true });
    }
  } else if (level === 2) {
    for (let i = 0; i < 10; i++) {
      const x = startX + i * 200 + Math.random() * 40;
      const y = GROUND_Y - 80 - Math.random() * 60;
      platforms.push({ x, y, w: 60, h: 16 });
      for (let j = 0; j < 3; j++) blocks.push({ x: x + j * (TILE + 4), y: y - TILE - Math.random() * 32, w: TILE, h: TILE, hp: 3, maxHp: 3, color: pal.block, broken: false });
      enemies.push({ x: x + 10, y: y - 32, w: 28, h: 28, vx: -1.8, vy: 0, hp: 3, onGround: false, active: true });
    }
  } else if (level === 3) {
    for (let i = 0; i < 8; i++) {
      const x = startX + i * 240 + Math.random() * 80;
      const y = GROUND_Y - 50 - Math.random() * 100;
      platforms.push({ x, y, w: 100 + Math.random() * 60, h: 16 });
      blocks.push({ x: x + 5, y: y - TILE, w: TILE, h: TILE, hp: 4, maxHp: 4, color: pal.block, broken: false });
      blocks.push({ x: x + 45, y: y - TILE, w: TILE, h: TILE, hp: 4, maxHp: 4, color: pal.block, broken: false });
      enemies.push({ x: x, y: y - 32, w: 28, h: 28, vx: -2.5, vy: 0, hp: 4, onGround: false, active: true });
      if (Math.random() > 0.4) enemies.push({ x: x + 80, y: y - 32, w: 28, h: 28, vx: -2.5, vy: 0, hp: 2, onGround: false, active: true });
    }
  } else {
    platforms.push({ x: startX, y: GROUND_Y - 40, w: 600, h: 16 });
  }

  return { blocks, platforms, enemies };
}

function initGameState(level: number, prevState?: Partial<GameState>): GameState {
  const stars: Star[] = [];
  for (let i = 0; i < 80; i++) {
    stars.push({ x: Math.random() * CANVAS_W, y: Math.random() * (CANVAS_H / 2), size: Math.random() * 2 + 0.5, twinkle: Math.random() * Math.PI * 2 });
  }

  const { blocks, platforms, enemies } = generateLevel(level, 0);

  const bgParticles: Particle[] = [];
  if (level === 3) {
    for (let i = 0; i < 20; i++) {
      bgParticles.push({ x: Math.random() * CANVAS_W, y: GROUND_Y + Math.random() * 80, vx: (Math.random() - 0.5) * 0.5, vy: -0.5 - Math.random(), life: 60, maxLife: 80, color: "#ff6600", size: 4 + Math.random() * 4 });
    }
  }

  const goldenBox: GoldenBox = {
    x: 2800 + (level - 1) * 200,
    y: GROUND_Y - 60,
    w: 36, h: 36,
    collected: false,
    letter: ["A", "B", "C"][level - 1] ?? "?",
    spawned: level <= 3,
  };

  const pedestalSlots: PedestalSlot[] = level === 4
    ? [
        { x: CANVAS_W / 2 - 120, y: GROUND_Y - 80, filled: false, letter: "A" },
        { x: CANVAS_W / 2,       y: GROUND_Y - 80, filled: false, letter: "B" },
        { x: CANVAS_W / 2 + 120, y: GROUND_Y - 80, filled: false, letter: "C" },
      ]
    : [];

  return {
    phase: "playing",
    level,
    score: prevState?.score ?? 0,
    lives: prevState?.lives ?? 3,
    ammo: level === 4 ? Infinity : 30,
    collectedBoxes: prevState?.collectedBoxes ?? [false, false, false],
    collectedLetters: prevState?.collectedLetters ?? [],

    px: 80, py: GROUND_Y - 60,
    pvx: 0, pvy: 0,
    pOnGround: false, pFacing: 1,
    pFrame: 0, pAnimTimer: 0,
    pInvincible: 0, pFlash: false,

    scrollX: 0, scrollSpeed: SCROLL_SPEEDS[level - 1] ?? 3,
    levelProgress: 0, levelLength: level === 4 ? 800 : 3200,

    blocks, bullets: [], particles: [], enemies, platforms,
    goldenBox: level <= 3 ? goldenBox : null,
    stars,

    pedestalSlots,
    boxesToPlace: [...(prevState?.collectedLetters ?? [])],
    placingIndex: 0, placeTimer: 0,

    keys: {}, shootCooldown: 0,
    levelTransTimer: 0, deathTimer: 0, titleAnimTimer: 0,
    bgParticles,
  };
}

// ─────────────────────────────────────────────
//  DRAW HELPERS
// ─────────────────────────────────────────────
function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, frame: number, invincible: number) {
  if (invincible > 0 && Math.floor(invincible / 4) % 2 === 0) return;
  const flip = facing < 0;
  ctx.save();
  if (flip) { ctx.translate(Math.round(x) + 24, 0); ctx.scale(-1, 1); ctx.translate(-Math.round(x), 0); }
  const rx = Math.round(x); const ry = Math.round(y);
  ctx.fillStyle = "#4169E1"; ctx.fillRect(rx + 4, ry + 8, 20, 18);
  ctx.fillStyle = "#FFDAB9"; ctx.fillRect(rx + 6, ry, 16, 14);
  ctx.fillStyle = "#8B4513"; ctx.fillRect(rx + 6, ry, 16, 5);
  ctx.fillStyle = "#000"; ctx.fillRect(rx + 9, ry + 6, 3, 3); ctx.fillRect(rx + 16, ry + 6, 3, 3);
  ctx.fillStyle = "#FFDAB9"; ctx.fillRect(rx + 22, ry + 10, 10, 6);
  ctx.fillStyle = "#888"; ctx.fillRect(rx + 30, ry + 9, 6, 5);
  const legOff = frame % 2 === 0 ? 0 : 3;
  ctx.fillStyle = "#1a237e";
  ctx.fillRect(rx + 5, ry + 24, 9, 14 - legOff);
  ctx.fillRect(rx + 14, ry + 24, 9, 14 + legOff - 3);
  ctx.fillStyle = "#333";
  ctx.fillRect(rx + 4, ry + 36 - legOff, 10, 5);
  ctx.fillRect(rx + 13, ry + 34 + legOff - 3, 10, 5);
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy) {
  if (!e.active) return;
  const rx = Math.round(e.x); const ry = Math.round(e.y);
  ctx.fillStyle = "#6B8E23"; ctx.fillRect(rx, ry + 8, e.w, e.h - 8);
  ctx.fillStyle = "#556B2F";
  ctx.beginPath(); ctx.arc(rx + e.w / 2, ry + 10, e.w / 2 - 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#FF0000"; ctx.fillRect(rx + 7, ry + 6, 4, 4); ctx.fillRect(rx + 17, ry + 6, 4, 4);
  ctx.fillStyle = "#333"; ctx.fillRect(rx, ry - 6, e.w, 4);
  ctx.fillStyle = "#00FF00"; ctx.fillRect(rx, ry - 6, (e.w * e.hp) / 4, 4);
}

function drawBlock(ctx: CanvasRenderingContext2D, b: Block) {
  if (b.broken) return;
  const crack = (b.maxHp - b.hp) / b.maxHp;
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
  ctx.fillStyle = "#FFD700"; ctx.fillRect(Math.round(b.x), Math.round(b.y), 10, 5);
  ctx.fillStyle = "#FF8C00"; ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) + 1, 6, 3);
}

function drawGround(ctx: CanvasRenderingContext2D, level: number, scrollX: number) {
  const pal = LEVEL_PALETTES[level - 1] ?? LEVEL_PALETTES[0];
  ctx.fillStyle = pal.ground; ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  ctx.fillStyle = pal.accent; ctx.fillRect(0, GROUND_Y, CANVAS_W, 6);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  const tileW = 48; const offset = scrollX % tileW;
  for (let tx = -offset; tx < CANVAS_W; tx += tileW) ctx.fillRect(Math.round(tx), GROUND_Y + 6, 2, CANVAS_H - GROUND_Y - 6);
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
  if (level === 4) { ctx.fillStyle = "rgba(255,215,0,0.04)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
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
//  TOUCH CONTROLS OVERLAY — drawn ON the canvas
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

    // Outer circle for shoot, rounded rect for dpad
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

    // Label
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

  const [hudData, setHudData] = useState({
    score: 0, level: 1, lives: 3, collectedBoxes: [false, false, false], ammo: 30,
  });
  const [gamePhase, setGamePhase] = useState<"title" | "playing" | "dead" | "levelComplete" | "win">("title");

  function ensureAudio() {
    if (!audioRef.current) audioRef.current = createAudio();
  }

  function startGame(level = 1, prevState?: Partial<GameState>) {
    ensureAudio();
    const gs = initGameState(level, prevState);
    stateRef.current = gs;
    setGamePhase("playing");
    setHudData({ score: gs.score, level: gs.level, lives: gs.lives, collectedBoxes: [...gs.collectedBoxes], ammo: gs.ammo });
  }

  // ── Resolve canvas-space coords from a touch/mouse event ──
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

  // ── Hit-test a touch point against a control zone ──
  function hitZone(cx: number, cy: number, zone: typeof TC.LEFT): boolean {
    return cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
  }
  function hitCircle(cx: number, cy: number, zone: typeof TC.SHOOT): boolean {
    const dx = cx - (zone.x + zone.w / 2);
    const dy = cy - (zone.y + zone.h / 2);
    return Math.sqrt(dx * dx + dy * dy) <= zone.w / 2;
  }

  // ── Map active touches to virtual keys ──
  function syncTouchKeys(touches: TouchList) {
    const gs = stateRef.current;
    if (!gs) return;
    // Clear all virtual touch keys first
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

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
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
    if (isTouchRef.current) return; // let touch handler do it on mobile
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
    // shoot on click during play
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
    if (Math.abs(gs.pvx) > 0.5 && gs.pAnimTimer % 8 === 0) gs.pFrame = (gs.pFrame + 1) % 4;
    if (gs.pInvincible > 0) { gs.pInvincible--; gs.pFlash = !gs.pFlash; }

    gs.pOnGround = false;
    if (gs.py + 40 >= GROUND_Y) { gs.py = GROUND_Y - 40; gs.pvy = 0; gs.pOnGround = true; }
    if (gs.px < 20) gs.px = 20;

    gs.platforms.forEach((p) => {
      const pRect:   Rect = { x: gs.px + 2, y: gs.py,    w: 28, h: 40 };
      const platRect:Rect = { x: p.x,       y: p.y,      w: p.w, h: p.h };
      if (rectsOverlap(pRect, platRect) && gs.pvy >= 0 && gs.py + 40 - gs.pvy <= p.y + 4) {
        gs.py = p.y - 40; gs.pvy = 0; gs.pOnGround = true;
      }
    });

    if (gs.shootCooldown > 0) gs.shootCooldown--;
    if (shoot && gs.shootCooldown === 0 && gs.ammo > 0) {
      gs.bullets.push({ x: gs.px + (gs.pFacing > 0 ? 30 : -10), y: gs.py + 12, vx: BULLET_SPEED * gs.pFacing, active: true });
      if (gs.ammo !== Infinity) gs.ammo--;
      gs.shootCooldown = 12;
      audio.playShoot();
    }

    gs.bullets.forEach((b) => {
      if (!b.active) return;
      b.x += b.vx;
      if (b.x < -20 || b.x > gs.scrollX + CANVAS_W + 20) { b.active = false; return; }
      gs.blocks.forEach((bl) => {
        if (bl.broken || !b.active) return;
        if (rectsOverlap({ x: b.x, y: b.y, w: 10, h: 5 }, { x: bl.x, y: bl.y, w: bl.w, h: bl.h })) {
          bl.hp--; b.active = false;
          spawnParticles(gs.particles, b.x, b.y, bl.color, 6, 3); gs.score += 10;
          if (bl.hp <= 0) { bl.broken = true; spawnParticles(gs.particles, bl.x + bl.w / 2, bl.y + bl.h / 2, bl.color, 12, 5); gs.score += 50; audio.playHit(); }
        }
      });
      gs.enemies.forEach((en) => {
        if (!en.active || !b.active) return;
        if (rectsOverlap({ x: b.x, y: b.y, w: 10, h: 5 }, { x: en.x, y: en.y, w: en.w, h: en.h })) {
          en.hp--; b.active = false;
          spawnParticles(gs.particles, b.x, b.y, "#6B8E23", 6, 3); gs.score += 30;
          if (en.hp <= 0) { en.active = false; spawnParticles(gs.particles, en.x + en.w / 2, en.y + en.h / 2, "#6B8E23", 14, 5); gs.score += 100; audio.playEnemyDie(); }
        }
      });
    });
    gs.bullets = gs.bullets.filter((b) => b.active);

    gs.enemies.forEach((en) => {
      if (!en.active) return;
      en.vy += GRAVITY; en.x += en.vx; en.y += en.vy;
      if (en.y + en.h >= GROUND_Y) { en.y = GROUND_Y - en.h; en.vy = 0; en.onGround = true; }
      gs.platforms.forEach((p) => {
        if (rectsOverlap({ x: en.x, y: en.y, w: en.w, h: en.h }, { x: p.x, y: p.y, w: p.w, h: p.h }) && en.vy >= 0 && en.y + en.h - en.vy <= p.y + 4) {
          en.y = p.y - en.h; en.vy = 0; en.onGround = true;
        }
      });
      if (en.x < 0 || en.x > gs.scrollX + CANVAS_W) en.vx *= -1;
      if (gs.pInvincible === 0 && rectsOverlap({ x: gs.px + 2, y: gs.py, w: 28, h: 40 }, { x: en.x, y: en.y, w: en.w, h: en.h })) {
        gs.lives--; gs.pInvincible = 90; audio.playDeath();
        spawnParticles(gs.particles, gs.px + 16, gs.py + 20, "#ff0000", 10, 4);
        if (gs.lives <= 0) { gs.phase = "dead"; gs.deathTimer = 0; setGamePhase("dead"); }
      }
    });

    if (gs.goldenBox && gs.goldenBox.spawned && !gs.goldenBox.collected) {
      const gb = gs.goldenBox;
      if (rectsOverlap({ x: gs.px + 2, y: gs.py, w: 28, h: 40 }, { x: gb.x, y: gb.y, w: gb.w, h: gb.h })) {
        gb.collected = true;
        const idx = ["A","B","C"].indexOf(gb.letter);
        if (idx >= 0) {
          gs.collectedBoxes[idx] = true;
          if (!gs.collectedLetters.includes(gb.letter)) gs.collectedLetters.push(gb.letter);
        }
        spawnParticles(gs.particles, gb.x + gb.w / 2, gb.y + gb.h / 2, "#FFD700", 20, 6);
        gs.score += 500; audio.playCollect();
        setHudData((prev) => ({ ...prev, collectedBoxes: [...gs.collectedBoxes] }));
      }
    }

    if (gs.level === 4 && gs.phase === "playing") {
      const playerCenterX = gs.px + 16;
      const playerCenterY = gs.py + 20;
      gs.pedestalSlots.forEach((slot) => {
        if (!slot.filled && gs.boxesToPlace.includes(slot.letter)) {
          const dist = Math.hypot(playerCenterX - slot.x, playerCenterY - (slot.y + 18));
          if (dist < 60 && gs.pOnGround) {
            gs.placeTimer++;
            if (gs.placeTimer > 60) {
              slot.filled = true;
              gs.boxesToPlace = gs.boxesToPlace.filter((l) => l !== slot.letter);
              gs.placeTimer = 0;
              spawnParticles(gs.particles, slot.x, slot.y, "#FFD700", 20, 5);
              audio.playPlace();
              if (gs.pedestalSlots.every((s) => s.filled)) {
                setTimeout(() => {
                  if (stateRef.current) { stateRef.current.phase = "win"; setGamePhase("win"); audio.playWin(); }
                }, 600);
              }
            }
          } else { gs.placeTimer = 0; }
        }
      });
    }

    if (gs.level !== 4) {
      gs.scrollX += gs.scrollSpeed;
      gs.levelProgress = gs.scrollX;
      const drift = gs.scrollSpeed;
      gs.blocks.forEach((b)   => { b.x -= drift; });
      gs.platforms.forEach((p) => { p.x -= drift; });
      gs.enemies.forEach((e)   => { e.x -= drift; });
      if (gs.goldenBox) gs.goldenBox.x -= drift;

      if (gs.px > CANVAS_W - 100) gs.px = CANVAS_W - 100;

      const lastPlat = gs.platforms.reduce((mx, p) => Math.max(mx, p.x), 0);
      if (lastPlat < CANVAS_W + 400) {
        const chunk = generateLevel(gs.level, CANVAS_W + 400);
        gs.blocks.push(...chunk.blocks);
        gs.platforms.push(...chunk.platforms);
        gs.enemies.push(...chunk.enemies);
      }

      if (gs.goldenBox && !gs.goldenBox.spawned && gs.scrollX > gs.levelLength - 800) {
        gs.goldenBox.spawned = true; gs.goldenBox.x = CANVAS_W + 200; gs.goldenBox.y = GROUND_Y - 80;
      }

      if (gs.scrollX >= gs.levelLength && gs.goldenBox?.collected) {
        gs.phase = "levelComplete"; gs.levelTransTimer = 0; setGamePhase("levelComplete"); audio.playLevelUp();
      }

      gs.blocks    = gs.blocks.filter((b) => b.x > -TILE);
      gs.platforms = gs.platforms.filter((p) => p.x > -200);
      gs.enemies   = gs.enemies.filter((e) => e.x > -100);
    }

    if (gs.level === 3) {
      gs.bgParticles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.life--;
        if (p.life <= 0) { p.x = Math.random() * CANVAS_W; p.y = GROUND_Y + Math.random() * 20; p.life = p.maxLife; }
      });
    }

    gs.particles.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life--; });
    gs.particles = gs.particles.filter((p) => p.life > 0);

    if (gs.py > CANVAS_H + 100) {
      gs.lives--; gs.py = GROUND_Y - 60; gs.pvy = 0;
      if (gs.lives <= 0) { gs.phase = "dead"; setGamePhase("dead"); audio.playDeath(); }
      else { gs.pInvincible = 90; audio.playDeath(); }
    }

    if (tick % 6 === 0) {
      setHudData({ score: gs.score, level: gs.level, lives: gs.lives, collectedBoxes: [...gs.collectedBoxes], ammo: gs.ammo });
    }
  }

  // ─────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────
  function renderGame(ctx: CanvasRenderingContext2D, gs: GameState, tick: number) {
    ctx.imageSmoothingEnabled = false;
    drawSky(ctx, gs.level, gs.stars, tick, gs.bgParticles);

    if (gs.level === 4) {
      drawPedestal(ctx, gs.pedestalSlots, tick);
      const unplaced = gs.pedestalSlots.filter((s) => !s.filled);
      if (unplaced.length > 0 && gs.boxesToPlace.length > 0) {
        ctx.fillStyle = "rgba(255,215,0,0.9)";
        ctx.font = '7px "Press Start 2P", cursive'; ctx.textAlign = "center";
        ctx.fillText("WALK TO PEDESTAL TO PLACE BOX", CANVAS_W / 2, CANVAS_H - 50);
        if (gs.placeTimer > 0) {
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(CANVAS_W / 2 - 60, CANVAS_H - 38, 120, 8);
          ctx.fillStyle = "#FFD700"; ctx.fillRect(CANVAS_W / 2 - 60, CANVAS_H - 38, 120 * (gs.placeTimer / 60), 8);
        }
      }
    }

    drawGround(ctx, gs.level, gs.scrollX);
    gs.platforms.forEach((p)  => drawPlatform(ctx, p, gs.level));
    gs.blocks.forEach((b)     => drawBlock(ctx, b));
    if (gs.goldenBox)            drawGoldenBox(ctx, gs.goldenBox, tick);
    gs.enemies.forEach((e)    => drawEnemy(ctx, e));
    gs.bullets.forEach((b)    => drawBullet(ctx, b));
    drawPlayer(ctx, gs.px, gs.py, gs.pFacing, gs.pFrame, gs.pInvincible);

    gs.particles.forEach((p) => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    });
    ctx.globalAlpha = 1;

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

    // Draw on-canvas touch controls (always drawn so they show on mobile)
    if (isTouchRef.current) drawTouchControls(ctx, gs.keys);
  }

  function drawTitleScreen(ctx: CanvasRenderingContext2D, tick: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, "#0a0a1a"); grad.addColorStop(1, "#1a0a2e");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137 + 50) % CANVAS_W;
      const sy = (i * 73 + 20) % (CANVAS_H / 2);
      const alpha = 0.4 + 0.6 * Math.sin(i + tick * 0.02);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillRect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
    }
    ctx.fillStyle = "#FFD700"; ctx.font = '28px "Press Start 2P", cursive';
    ctx.textAlign = "center"; ctx.shadowColor = "#FF8C00"; ctx.shadowBlur = 20;
    ctx.fillText("PIXEL RUNNER", CANVAS_W / 2, 130); ctx.shadowBlur = 0;
    ctx.fillStyle = "#FF8C00"; ctx.font = '11px "Press Start 2P", cursive';
    ctx.fillText("BLAST & COLLECT", CANVAS_W / 2, 168);
    drawPlayer(ctx, CANVAS_W / 2 - 16, CANVAS_H / 2 - 10 + Math.sin(tick * 0.05) * 5, 1, Math.floor(tick / 10) % 4, 0);
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = '7px "Press Start 2P", cursive';
    ctx.fillText("ARROW KEYS / WASD — MOVE & JUMP", CANVAS_W / 2, CANVAS_H / 2 + 70);
    ctx.fillText("SPACE / CLICK / TOUCH — SHOOT", CANVAS_W / 2, CANVAS_H / 2 + 92);
    if (Math.floor(tick / 30) % 2 === 0) {
      ctx.fillStyle = "#FFD700"; ctx.font = '10px "Press Start 2P", cursive';
      ctx.fillText("TAP / CLICK / SPACE TO START", CANVAS_W / 2, CANVAS_H - 60);
    }
    ctx.fillStyle = "rgba(255,215,0,0.5)"; ctx.font = '7px "Press Start 2P", cursive';
    ctx.fillText("FIND 3 GOLDEN BOXES — UNCOVER THE SECRET!", CANVAS_W / 2, CANVAS_H - 30);
  }

  function drawDeadScreen(ctx: CanvasRenderingContext2D, gs: GameState, tick: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, "#1a0000"); grad.addColorStop(1, "#0a0000");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#FF0000"; ctx.font = '28px "Press Start 2P", cursive';
    ctx.textAlign = "center"; ctx.shadowColor = "#880000"; ctx.shadowBlur = 15;
    ctx.fillText("GAME OVER", CANVAS_W / 2, CANVAS_H / 2 - 50); ctx.shadowBlur = 0;
    ctx.fillStyle = "#FFD700"; ctx.font = '10px "Press Start 2P", cursive';
    ctx.fillText(`SCORE: ${String(gs.score).padStart(6, "0")}`, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = gs.lives > 0 ? "#aaa" : "#888"; ctx.font = '8px "Press Start 2P", cursive';
    ctx.fillText(gs.lives > 0 ? `${gs.lives} ${gs.lives === 1 ? "LIFE" : "LIVES"} REMAINING` : "NO LIVES LEFT — RESTARTING", CANVAS_W / 2, CANVAS_H / 2 + 35);
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
    ctx.fillText(`GOLDEN BOX [${["A","B","C"][gs.level - 1]}] COLLECTED!`, CANVAS_W / 2, 240);
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
      ctx.textAlign = "center"; ctx.fillText(["A","B","C"][i], bx + 20, by + 26);
    }
    const pulse = 1 + 0.04 * Math.sin(tick * 0.06);
    ctx.save();
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2 - 30);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "#FFD700"; ctx.font = '22px "Press Start 2P", cursive';
    ctx.textAlign = "center"; ctx.shadowColor = "#FFD700"; ctx.shadowBlur = 30;
    ctx.fillText("Leola Jane Snapp!", 0, 0); ctx.shadowBlur = 0;
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
    <div className="relative w-full h-screen flex items-center justify-center bg-pixel-dark overflow-hidden">
      <div
        className="relative"
        style={{
          width: `${CANVAS_W}px`,
          maxWidth: "100vw",
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
            touchAction: "none",   /* prevents browser scroll/zoom on touch */
            cursor: "pointer",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        />
      </div>

      {gamePhase === "playing" && !isTouchRef.current && (
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
