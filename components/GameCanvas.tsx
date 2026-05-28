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
    const 
