import type Phaser from 'phaser';
import { OUTLINE, type BossKind } from './art.ts';
import { dotTexture, glowTexture, hash, hex, rng, type Palette } from './pixel.ts';

export type BiomeId = 'forest' | 'dungeon' | 'desert' | 'ice' | 'volcano' | 'astral';

export interface Biome {
  id: BiomeId;
  name: string;
  icon: string;
  boss: { kind: BossKind; name: string; palette: Palette };
  sky: [string, string];
  ground: string;
  groundTop: string;
  /** Desenha montanhas, árvores etc. no fundo. */
  paint: (g: Phaser.GameObjects.Graphics, w: number, h: number, groundY: number, r: () => number) => void;
  /** Clima/ambiente: partículas que ficam no cenário. */
  ambient: (scene: Phaser.Scene, w: number, h: number, groundY: number) => Phaser.GameObjects.GameObject[];
}

const K = OUTLINE;

// ---------- helpers de desenho ----------

function ridge(g: Phaser.GameObjects.Graphics, color: string, w: number, baseY: number, amp: number, step: number, r: () => number) {
  g.fillStyle(hex(color));
  g.beginPath();
  g.moveTo(0, baseY);
  for (let x = 0; x <= w + step; x += step) g.lineTo(x, baseY - amp * (0.35 + r() * 0.65));
  g.lineTo(w, baseY + 400);
  g.lineTo(0, baseY + 400);
  g.closePath();
  g.fillPath();
}

function pine(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, color: string, snow?: string) {
  g.fillStyle(hex('#4a2f1c'));
  g.fillRect(x - s * 0.12, y - s * 0.4, s * 0.24, s * 0.4);
  for (let i = 0; i < 3; i++) {
    const ty = y - s * 0.3 - i * s * 0.38;
    const tw = s * (0.75 - i * 0.18);
    g.fillStyle(hex(color));
    g.fillTriangle(x - tw, ty, x + tw, ty, x, ty - s * 0.6);
    if (snow) {
      g.fillStyle(hex(snow));
      g.fillTriangle(x - tw * 0.35, ty - s * 0.4, x + tw * 0.35, ty - s * 0.4, x, ty - s * 0.6);
    }
  }
}

function emitter(
  scene: Phaser.Scene,
  texture: string,
  config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
): Phaser.GameObjects.Particles.ParticleEmitter {
  return scene.add.particles(0, 0, texture, config);
}

// ---------- biomas ----------

export const BIOMES: Biome[] = [
  {
    id: 'forest',
    name: 'Floresta Esmeralda',
    icon: '🌲',
    boss: {
      kind: 'slime',
      name: 'Rei Slime',
      palette: { K, A: '#5fbf4a', B: '#2f7a2a', C: '#b4f09a', E: '#1a1a1a', T: '#ffffff', R: '#f2c14e' },
    },
    sky: ['#64b8f0', '#d4f1ff'],
    ground: '#4f9a3c',
    groundTop: '#74c655',
    paint(g, w, _h, gy, r) {
      ridge(g, '#8fc7a6', w, gy - 90, 110, 70, r);
      ridge(g, '#5e9e6c', w, gy - 30, 70, 46, r);
      for (let x = 10; x < w; x += 34 + r() * 40) pine(g, x, gy + 4, 46 + r() * 34, r() > 0.5 ? '#2e6b3a' : '#3d834a');
    },
    ambient(scene, w, _h, gy) {
      dotTexture(scene, 'p-firefly', 3, '#fff6a0');
      return [
        emitter(scene, 'p-firefly', {
          x: { min: 0, max: w },
          y: { min: gy - 120, max: gy + 60 },
          lifespan: 4000,
          speedX: { min: -12, max: 12 },
          speedY: { min: -14, max: 4 },
          alpha: { onUpdate: (_p: unknown, _k: string, t: number) => Math.min(1, Math.sin(t * Math.PI) * 1.6) },
          frequency: 260,
          blendMode: 'ADD',
        }),
      ];
    },
  },
  {
    id: 'dungeon',
    name: 'Masmorra Sombria',
    icon: '🕯️',
    boss: {
      kind: 'eye',
      name: 'Olho Abissal',
      palette: { K, A: '#7b3fa0', B: '#4a2366', C: '#f3efe6', R: '#d43a3a', T: '#ffffff', E: '#ffcf40' },
    },
    sky: ['#120f1c', '#2a2238'],
    ground: '#3a3448',
    groundTop: '#544a66',
    paint(g, w, _h, gy, r) {
      for (let y = 0; y < gy; y += 22) {
        const off = (y / 22) % 2 ? 0 : 24;
        for (let x = -off; x < w; x += 48) {
          g.fillStyle(hex(r() > 0.85 ? '#2a2436' : '#241f30'));
          g.fillRect(x + 1, y + 1, 46, 20);
        }
      }
      for (let x = 80; x < w; x += 260) {
        g.fillStyle(hex('#5a4a3a'));
        g.fillRect(x - 3, gy - 150, 6, 26);
      }
    },
    ambient(scene, w, _h, gy) {
      dotTexture(scene, 'p-ember', 3, '#ffb347');
      glowTexture(scene, 'g-torch', 64, 'rgba(255,170,70,0.55)');
      const objs: Phaser.GameObjects.GameObject[] = [];
      for (let x = 80; x < w; x += 260) {
        const glow = scene.add.image(x, gy - 158, 'g-torch').setScale(2.2).setBlendMode('ADD');
        scene.tweens.add({ targets: glow, alpha: { from: 0.7, to: 1 }, scale: 2.4, duration: 180, yoyo: true, repeat: -1 });
        objs.push(
          glow,
          emitter(scene, 'p-ember', {
            x,
            y: gy - 156,
            lifespan: 700,
            speedY: { min: -60, max: -30 },
            speedX: { min: -8, max: 8 },
            scale: { start: 1.6, end: 0 },
            frequency: 70,
            blendMode: 'ADD',
          }),
        );
      }
      return objs;
    },
  },
  {
    id: 'desert',
    name: 'Dunas de Âmbar',
    icon: '🏜️',
    boss: {
      kind: 'golem',
      name: 'Golem das Areias',
      palette: { K, A: '#c49a5a', B: '#8a6533', C: '#5ad1e8', R: '#ff7b3d', E: '#ffef7a', T: '#3a2a14' },
    },
    sky: ['#ff9d5c', '#ffe3a8'],
    ground: '#e3b96f',
    groundTop: '#f0cf8a',
    paint(g, w, _h, gy, r) {
      g.fillStyle(hex('#fff2c4'));
      g.fillCircle(w * 0.62, gy - 170, 46);
      ridge(g, '#e8a865', w, gy - 50, 80, 120, r);
      ridge(g, '#d99350', w, gy - 10, 46, 90, r);
      for (let x = 40; x < w; x += 140 + r() * 160) {
        const hgt = 34 + r() * 26;
        g.fillStyle(hex('#3f8a4a'));
        g.fillRect(x - 5, gy - hgt, 10, hgt);
        g.fillRect(x - 16, gy - hgt * 0.7, 6, 16);
        g.fillRect(x - 16, gy - hgt * 0.7 + 10, 12, 6);
        g.fillRect(x + 10, gy - hgt * 0.8, 6, 18);
        g.fillRect(x + 4, gy - hgt * 0.8 + 12, 12, 6);
      }
    },
    ambient(scene, w, _h, gy) {
      dotTexture(scene, 'p-sand', 2, '#fff1cf');
      return [
        emitter(scene, 'p-sand', {
          x: -10,
          y: { min: gy - 140, max: gy + 120 },
          lifespan: 5000,
          speedX: { min: w / 6, max: w / 4 },
          speedY: { min: -6, max: 6 },
          alpha: { start: 0.8, end: 0 },
          frequency: 60,
        }),
      ];
    },
  },
  {
    id: 'ice',
    name: 'Picos Congelados',
    icon: '❄️',
    boss: {
      kind: 'dragon',
      name: 'Dragão de Gelo',
      palette: { K, A: '#7fc4e8', B: '#3f7fb0', C: '#e6f6ff', E: '#ff4d6d', R: '#ffffff', T: '#ffffff' },
    },
    sky: ['#8ccbf0', '#eaf7ff'],
    ground: '#e8f2fb',
    groundTop: '#ffffff',
    paint(g, w, _h, gy, r) {
      ridge(g, '#c4dcef', w, gy - 70, 170, 110, r);
      ridge(g, '#a6c6e2', w, gy - 20, 80, 60, r);
      for (let x = 20; x < w; x += 50 + r() * 60) pine(g, x, gy + 4, 44 + r() * 26, '#2f5d55', '#f4fbff');
    },
    ambient(scene, w, _h) {
      dotTexture(scene, 'p-snow', 3, '#ffffff', true);
      return [
        emitter(scene, 'p-snow', {
          x: { min: -50, max: w },
          y: -10,
          lifespan: 9000,
          speedY: { min: 30, max: 70 },
          speedX: { min: 5, max: 25 },
          scale: { min: 0.6, max: 1.6 },
          frequency: 45,
        }),
      ];
    },
  },
  {
    id: 'volcano',
    name: 'Caldeira Ardente',
    icon: '🌋',
    boss: {
      kind: 'dragon',
      name: 'Dragão de Brasa',
      palette: { K, A: '#c8382a', B: '#6a1a14', C: '#f5b14a', E: '#ffe14a', R: '#2b2b2b', T: '#ffffff' },
    },
    sky: ['#1e0a0a', '#7a2a12'],
    ground: '#3a2420',
    groundTop: '#5a3328',
    paint(g, w, _h, gy, r) {
      g.fillStyle(hex('#2a1210'));
      g.fillTriangle(w * 0.35, gy, w * 0.75, gy, w * 0.55, gy - 240);
      g.fillStyle(hex('#ff6a1a'));
      g.fillTriangle(w * 0.52, gy - 220, w * 0.58, gy - 220, w * 0.55, gy - 120);
      ridge(g, '#2f1714', w, gy - 10, 60, 50, r);
      g.lineStyle(3, hex('#ff6a1a'));
      for (let i = 0; i < 9; i++) {
        const x = r() * w;
        const y = gy + 20 + r() * 160;
        g.lineBetween(x, y, x + 20 + r() * 40, y + (r() - 0.5) * 18);
      }
    },
    ambient(scene, w, h, gy) {
      dotTexture(scene, 'p-ember2', 3, '#ff8a3d');
      return [
        emitter(scene, 'p-ember2', {
          x: { min: 0, max: w },
          y: h,
          lifespan: 4000,
          speedY: { min: -90, max: -40 },
          speedX: { min: -15, max: 15 },
          scale: { start: 1.4, end: 0 },
          frequency: 50,
          blendMode: 'ADD',
        }),
        emitter(scene, 'p-ember2', {
          x: { min: w * 0.53, max: w * 0.57 },
          y: gy - 225,
          lifespan: 1800,
          speedY: { min: -120, max: -60 },
          speedX: { min: -30, max: 30 },
          scale: { start: 2, end: 0 },
          frequency: 40,
          blendMode: 'ADD',
        }),
      ];
    },
  },
  {
    id: 'astral',
    name: 'Planície Astral',
    icon: '✨',
    boss: {
      kind: 'eye',
      name: 'Observador Astral',
      palette: { K, A: '#3a4fb0', B: '#1f2a66', C: '#e8f0ff', R: '#ff3df0', E: '#7af0ff', T: '#ffffff' },
    },
    sky: ['#070722', '#2b1a5a'],
    ground: '#2a2350',
    groundTop: '#4a3c86',
    paint(g, w, _h, gy, r) {
      for (let i = 0; i < 140; i++) {
        g.fillStyle(0xffffff, 0.3 + r() * 0.7);
        const s = r() > 0.92 ? 3 : 2;
        g.fillRect(r() * w, r() * (gy - 20), s, s);
      }
      g.fillStyle(hex('#e9e3ff'));
      g.fillCircle(w * 0.2, 90, 34);
      g.fillStyle(hex('#070722'));
      g.fillCircle(w * 0.2 + 14, 82, 30);
      for (let x = 60; x < w; x += 180 + r() * 120) {
        const s = 18 + r() * 22;
        const y = gy - 60 - r() * 80;
        g.fillStyle(hex('#7af0ff'), 0.85);
        g.fillTriangle(x, y - s, x - s * 0.45, y, x + s * 0.45, y);
        g.fillStyle(hex('#3aa8d8'), 0.85);
        g.fillTriangle(x, y + s * 0.8, x - s * 0.45, y, x + s * 0.45, y);
      }
    },
    ambient(scene, w, _h, gy) {
      dotTexture(scene, 'p-star', 3, '#c9b8ff');
      return [
        emitter(scene, 'p-star', {
          x: { min: 0, max: w },
          y: { min: 0, max: gy + 80 },
          lifespan: 2400,
          speedY: { min: -10, max: 10 },
          scale: { onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 1.8 },
          frequency: 90,
          blendMode: 'ADD',
        }),
      ];
    },
  },
];

/**
 * Cenário de um reino num nível do boss. A cada boss derrotado (nível novo) o
 * cenário é sorteado de novo, nunca igual ao anterior. O sorteio é derivado do
 * projeto + nível, então é o mesmo depois de recarregar ou em outra máquina.
 */
export function biomeFor(realmKey: string, level?: number): Biome {
  let idx = hash(realmKey) % BIOMES.length;
  for (let l = 2; l <= (level ?? 1); l++) {
    let next = hash(`${realmKey}#${l}`) % BIOMES.length;
    if (next === idx) next = (next + 1) % BIOMES.length;
    idx = next;
  }
  return BIOMES[idx];
}

export function paintBackground(scene: Phaser.Scene, biome: Biome, w: number, h: number, groundY: number, seed: string) {
  const r = rng(hash(seed));
  const g = scene.add.graphics();
  g.fillGradientStyle(hex(biome.sky[0]), hex(biome.sky[0]), hex(biome.sky[1]), hex(biome.sky[1]), 1);
  g.fillRect(0, 0, w, groundY + 2);
  biome.paint(g, w, h, groundY, r);
  g.fillStyle(hex(biome.ground));
  g.fillRect(0, groundY, w, h - groundY);
  g.fillStyle(hex(biome.groundTop));
  g.fillRect(0, groundY, w, 6);
  // textura do chão
  for (let i = 0; i < (w * (h - groundY)) / 900; i++) {
    g.fillStyle(0x000000, 0.06 + r() * 0.08);
    g.fillRect(Math.round(r() * w), Math.round(groundY + 10 + r() * (h - groundY)), 4 + Math.round(r() * 6), 3);
  }
  g.setDepth(-1000);
  return g;
}
