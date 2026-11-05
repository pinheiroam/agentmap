import * as THREE from 'three';
import type { CharacterModel, WeaponModel } from './assets.ts';
import type { Particles } from './effects.ts';

export type BiomeId = 'forest' | 'dungeon' | 'desert' | 'ice' | 'volcano' | 'astral';

export type Element = 'nature' | 'shadow' | 'earth' | 'ice' | 'fire' | 'arcane';

/** Cada elemento tem dois ataques próprios (ver ArenaWorld.bossSkill). */
export const ELEMENTS: Record<Element, { label: string; icon: string; color: number; skills: [string, string] }> = {
  nature: { label: 'Natureza', icon: '🌿', color: 0x7dff6a, skills: ['Raízes Espinhosas', 'Esporos Venenosos'] },
  shadow: { label: 'Sombra', icon: '🌑', color: 0xb05cff, skills: ['Rajada Sombria', 'Véu das Trevas'] },
  earth: { label: 'Terra', icon: '🪨', color: 0xe0b46a, skills: ['Tempestade de Areia', 'Terremoto'] },
  ice: { label: 'Gelo', icon: '❄️', color: 0x9fe8ff, skills: ['Chuva de Estalactites', 'Nova Congelante'] },
  fire: { label: 'Fogo', icon: '🔥', color: 0xff6a1a, skills: ['Chuva de Meteoros', 'Erupção'] },
  arcane: { label: 'Arcano', icon: '✨', color: 0xff3df0, skills: ['Corrente Arcana', 'Singularidade'] },
};

export interface BossRig {
  name: string;
  model: CharacterModel;
  weapons: { weapon: WeaponModel; bone: string }[];
  tint: number;
  eyes: number;
  element: Element;
}

export interface Biome {
  id: BiomeId;
  name: string;
  icon: string;
  boss: BossRig;
  sky: [string, string];
  fog: number;
  ground: number;
  arena: number;
  hemi: [number, number, number];
  sun: [number, number];
  /** Monta o cenário. r() é determinístico por reino. */
  build: (g: THREE.Group, r: () => number, lights: THREE.PointLight[]) => void;
  /** Clima, chamado a cada quadro. */
  weather: (p: Particles, dt: number, t: number) => void;
}

// ---------------- primitivas low-poly ----------------

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function pine(g: THREE.Group, x: number, z: number, s: number, leaf: number, snow?: number) {
  g.add(mesh(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 1 * s, 6), std(0x5a3a22), x, 0.5 * s, z));
  for (let i = 0; i < 3; i++) {
    const r = (1.3 - i * 0.32) * s;
    const y = (1.1 + i * 0.75) * s;
    g.add(mesh(new THREE.ConeGeometry(r, 1.3 * s, 7), std(leaf), x, y, z));
    if (snow) g.add(mesh(new THREE.ConeGeometry(r * 0.55, 0.6 * s, 7), std(snow), x, y + 0.42 * s, z));
  }
}

function roundTree(g: THREE.Group, x: number, z: number, s: number, leaf: number) {
  g.add(mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1.6 * s, 6), std(0x6b4226), x, 0.8 * s, z));
  g.add(mesh(new THREE.IcosahedronGeometry(1.1 * s, 0), std(leaf), x, 2.2 * s, z));
  g.add(mesh(new THREE.IcosahedronGeometry(0.75 * s, 0), std(leaf), x + 0.6 * s, 1.8 * s, z + 0.3 * s));
}

function rock(g: THREE.Group, x: number, z: number, s: number, color: number) {
  const m = mesh(new THREE.DodecahedronGeometry(s, 0), std(color), x, s * 0.4, z);
  m.rotation.set(Math.random(), Math.random() * 6, Math.random());
  m.scale.y = 0.7;
  g.add(m);
}

/** Posição aleatória fora da arena, de preferência ao fundo e nas laterais. */
function around(r: () => number, min = 11, max = 26) {
  const a = Math.PI * (0.05 + r() * 0.9) + Math.PI; // atrás da arena (z negativo)
  const d = min + r() * (max - min);
  const side = r() < 0.35;
  const x = side ? (r() < 0.5 ? -1 : 1) * (14 + r() * 10) : Math.cos(a) * d;
  const z = side ? -4 + r() * 12 : Math.sin(a) * d * 0.8;
  return [x, z] as const;
}

const up = new THREE.Vector3(0, 1, 0);

// ---------------- biomas ----------------

export const BIOMES: Biome[] = [
  {
    id: 'forest',
    name: 'Floresta Esmeralda',
    icon: '🌲',
    boss: {
      name: 'Rei Esqueleto do Bosque',
      model: 'Skeleton_Minion',
      weapons: [{ weapon: 'Skeleton_Blade', bone: 'handslot.r' }],
      tint: 0x7fb069,
      eyes: 0x9dff6a,
      element: 'nature',
    },
    sky: ['#6db8ef', '#dff3ff'],
    fog: 0xcfe9f5,
    ground: 0x5f9a45,
    arena: 0x7aa85a,
    hemi: [0xcfeaff, 0x3f6a2a, 1.1],
    sun: [0xfff1d0, 2.6],
    build(g, r) {
      for (let i = 0; i < 38; i++) {
        const [x, z] = around(r);
        r() < 0.6 ? pine(g, x, z, 1 + r() * 0.8, r() < 0.5 ? 0x2e6b3a : 0x3d834a) : roundTree(g, x, z, 0.9 + r() * 0.6, 0x4f9a4a);
      }
      for (let i = 0; i < 14; i++) {
        const [x, z] = around(r, 9, 20);
        rock(g, x, z, 0.4 + r() * 0.5, 0x8a8f86);
      }
      for (let i = 0; i < 60; i++) {
        const f = mesh(new THREE.ConeGeometry(0.08, 0.25, 4), std(r() < 0.5 ? 0xffe066 : 0xff8ab0), (r() - 0.5) * 30, 0.12, -r() * 14 + 6, false);
        g.add(f);
      }
    },
    weather(p, dt) {
      if (Math.random() < dt * 14) p.emit(new THREE.Vector3((Math.random() - 0.5) * 24, 0.6 + Math.random() * 2.5, (Math.random() - 0.5) * 12), { color: [0xfff6a0, 0xd8ff8a], count: 1, speed: 0.25, life: 3.5, size: 0.18, shrink: false });
    },
  },
  {
    id: 'dungeon',
    name: 'Masmorra Sombria',
    icon: '🕯️',
    boss: {
      name: 'Sombra da Masmorra',
      model: 'Skeleton_Rogue',
      weapons: [{ weapon: 'Skeleton_Crossbow', bone: 'handslot.r' }],
      tint: 0x8a5fb0,
      eyes: 0xd070ff,
      element: 'shadow',
    },
    sky: ['#0d0a16', '#2a2238'],
    fog: 0x1a1526,
    ground: 0x3a3448,
    arena: 0x4a4258,
    hemi: [0x6a5a8a, 0x1a1420, 0.5],
    sun: [0x9a8ac8, 0.6],
    build(g, r, lights) {
      // pilares e muro ao fundo
      for (let i = -6; i <= 6; i++) {
        const x = i * 3.4;
        g.add(mesh(new THREE.BoxGeometry(3.3, 5 + r() * 1.5, 0.9), std(0x2e2838), x, 2.5, -13));
      }
      for (const x of [-10, -3.5, 3.5, 10]) {
        g.add(mesh(new THREE.CylinderGeometry(0.6, 0.7, 6, 8), std(0x4a4258), x, 3, -8));
        const torch = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), std(0x5a3a22), x, 3.4, -7.3, false);
        g.add(torch);
        const light = new THREE.PointLight(0xffa046, 18, 12, 1.6);
        light.position.set(x, 3.9, -7.1);
        g.add(light);
        lights.push(light);
      }
      for (let i = 0; i < 18; i++) {
        const [x, z] = around(r, 9, 16);
        rock(g, x, z, 0.3 + r() * 0.4, 0x4a4258);
      }
      // grades de piso
      for (let i = 0; i < 30; i++) {
        const t = mesh(new THREE.BoxGeometry(1.8, 0.04, 1.8), std(r() < 0.5 ? 0x433c52 : 0x3a3448), (r() - 0.5) * 24, 0.02, (r() - 0.5) * 14, false);
        g.add(t);
      }
    },
    weather(p, dt) {
      for (const x of [-10, -3.5, 3.5, 10]) if (Math.random() < dt * 30) p.emit(new THREE.Vector3(x, 3.9, -7.1), { color: [0xffd27a, 0xff7a2a], count: 1, speed: 0.6, dir: up, spread: 0.3, life: 0.6, size: 0.35 });
      if (Math.random() < dt * 6) p.emit(new THREE.Vector3((Math.random() - 0.5) * 20, 0.5 + Math.random() * 3, (Math.random() - 0.5) * 10), { color: 0x9a8ac8, count: 1, speed: 0.1, life: 4, size: 0.1, shrink: false });
    },
  },
  {
    id: 'desert',
    name: 'Dunas de Âmbar',
    icon: '🏜️',
    boss: {
      name: 'Faraó Esquecido',
      model: 'Skeleton_Warrior',
      weapons: [
        { weapon: 'Skeleton_Axe', bone: 'handslot.r' },
        { weapon: 'Skeleton_Shield_Large_A', bone: 'handslot.l' },
      ],
      tint: 0xe0b46a,
      eyes: 0xffcc33,
      element: 'earth',
    },
    sky: ['#ff9a5a', '#ffe7b0'],
    fog: 0xf7d8a6,
    ground: 0xe3b96f,
    arena: 0xeac586,
    hemi: [0xffe2b0, 0xb07a3a, 1.1],
    sun: [0xffd9a0, 3],
    build(g, r) {
      for (let i = 0; i < 12; i++) {
        const [x, z] = around(r, 14, 30);
        const d = mesh(new THREE.SphereGeometry(4 + r() * 4, 10, 6), std(0xe8a865), x, -1.5, z);
        d.scale.y = 0.35;
        g.add(d);
      }
      for (let i = 0; i < 16; i++) {
        const [x, z] = around(r, 10, 22);
        const h = 1.5 + r() * 1.5;
        const c = std(0x3f8a4a);
        g.add(mesh(new THREE.CylinderGeometry(0.25, 0.28, h, 7), c, x, h / 2, z));
        g.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.8, 6), c, x - 0.45, h * 0.6, z));
        g.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 6), c, x + 0.45, h * 0.7, z));
      }
      // pirâmide ao fundo
      g.add(mesh(new THREE.ConeGeometry(9, 8, 4), std(0xd9a25a), 6, 4, -26));
    },
    weather(p, dt) {
      if (Math.random() < dt * 40) p.emit(new THREE.Vector3(-16, 0.2 + Math.random() * 3, (Math.random() - 0.5) * 14), { color: 0xfff1cf, count: 1, speed: 6, dir: new THREE.Vector3(1, 0.05, 0), spread: 0.1, life: 4, size: 0.08, shrink: false });
    },
  },
  {
    id: 'ice',
    name: 'Picos Congelados',
    icon: '❄️',
    boss: {
      name: 'Rei do Inverno',
      model: 'Skeleton_Warrior',
      weapons: [{ weapon: 'Skeleton_Blade', bone: 'handslot.r' }],
      tint: 0x9fd8ff,
      eyes: 0x7fe6ff,
      element: 'ice',
    },
    sky: ['#86c4ee', '#eef8ff'],
    fog: 0xe4f2fb,
    ground: 0xeaf3fb,
    arena: 0xdbe9f5,
    hemi: [0xe6f6ff, 0x8aa6c0, 1.2],
    sun: [0xffffff, 2.4],
    build(g, r) {
      for (let i = 0; i < 7; i++) {
        const [x, z] = around(r, 22, 32);
        const m = mesh(new THREE.ConeGeometry(5 + r() * 4, 9 + r() * 6, 6), std(0xc4dcef), x, 4, z);
        g.add(m);
        g.add(mesh(new THREE.ConeGeometry(2.4, 3, 6), std(0xffffff), x, m.position.y + 4, z));
      }
      for (let i = 0; i < 34; i++) {
        const [x, z] = around(r);
        pine(g, x, z, 0.9 + r() * 0.7, 0x2f5d55, 0xf4fbff);
      }
      for (let i = 0; i < 10; i++) {
        const [x, z] = around(r, 9, 18);
        const ice = mesh(new THREE.OctahedronGeometry(0.5 + r() * 0.5, 0), std(0xbfe9ff, { transparent: true, opacity: 0.85, roughness: 0.2 }), x, 0.5, z);
        ice.scale.y = 1.8;
        g.add(ice);
      }
    },
    weather(p, dt) {
      if (Math.random() < dt * 60) p.emit(new THREE.Vector3((Math.random() - 0.5) * 34, 9, (Math.random() - 0.5) * 20), { color: 0xffffff, count: 1, speed: 1.5, dir: new THREE.Vector3(0.3, -1, 0), spread: 0.15, life: 7, size: 0.14, shrink: false });
    },
  },
  {
    id: 'volcano',
    name: 'Caldeira Ardente',
    icon: '🌋',
    boss: {
      name: 'Senhor das Brasas',
      model: 'Skeleton_Warrior',
      weapons: [{ weapon: 'Skeleton_Axe', bone: 'handslot.r' }],
      tint: 0xd0503a,
      eyes: 0xff5a1f,
      element: 'fire',
    },
    sky: ['#1a0707', '#7a2a12'],
    fog: 0x3a1410,
    ground: 0x3a2420,
    arena: 0x4a2c24,
    hemi: [0xff9a6a, 0x2a0a06, 0.7],
    sun: [0xff8a50, 1.8],
    build(g, r, lights) {
      const v = mesh(new THREE.ConeGeometry(12, 14, 9, 1, true), std(0x2a1210), 4, 6, -30);
      g.add(v);
      g.add(mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.5, 9), new THREE.MeshBasicMaterial({ color: 0xff6a1a, toneMapped: false }), 4, 12.9, -30, false));
      for (let i = 0; i < 9; i++) {
        const lava = mesh(new THREE.CircleGeometry(0.8 + r() * 1.4, 10), new THREE.MeshBasicMaterial({ color: 0xff5a1a, toneMapped: false }), (r() - 0.5) * 30, 0.03, -3 - r() * 12, false);
        lava.rotation.x = -Math.PI / 2;
        g.add(lava);
      }
      for (let i = 0; i < 22; i++) {
        const [x, z] = around(r, 9, 22);
        rock(g, x, z, 0.5 + r() * 0.9, 0x2a1a18);
      }
      const glow = new THREE.PointLight(0xff5a1a, 30, 30, 1.4);
      glow.position.set(0, 2, -8);
      g.add(glow);
      lights.push(glow);
    },
    weather(p, dt) {
      if (Math.random() < dt * 45) p.emit(new THREE.Vector3((Math.random() - 0.5) * 30, 0.1, (Math.random() - 0.5) * 16), { color: [0xff8a3d, 0xffd060], count: 1, speed: 1.4, dir: up, spread: 0.3, life: 3, size: 0.12 });
      if (Math.random() < dt * 25) p.emit(new THREE.Vector3(4, 13, -30), { color: [0xff8a3d, 0xffe066], count: 1, speed: 3, dir: up, spread: 0.5, life: 2.5, size: 0.6 });
    },
  },
  {
    id: 'astral',
    name: 'Planície Astral',
    icon: '✨',
    boss: {
      name: 'Lich Astral',
      model: 'Skeleton_Mage',
      weapons: [{ weapon: 'Skeleton_Staff', bone: 'handslot.r' }],
      tint: 0x7f7fe0,
      eyes: 0xff3df0,
      element: 'arcane',
    },
    sky: ['#05051c', '#2b1a5a'],
    fog: 0x1a1240,
    ground: 0x2a2350,
    arena: 0x3a3070,
    hemi: [0x9a8aff, 0x1a1030, 0.7],
    sun: [0xc9b8ff, 1.4],
    build(g, r, lights) {
      const stars = new THREE.BufferGeometry();
      const pos: number[] = [];
      for (let i = 0; i < 700; i++) {
        const a = r() * Math.PI * 2;
        const e = 0.1 + r() * 1.2;
        pos.push(Math.cos(a) * 70 * Math.cos(e), 8 + Math.sin(e) * 50, Math.sin(a) * 70 * Math.cos(e) - 20);
      }
      stars.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true, fog: false })));
      g.add(mesh(new THREE.SphereGeometry(3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe9e3ff, fog: false, toneMapped: false }), -18, 18, -40, false));
      for (let i = 0; i < 16; i++) {
        const [x, z] = around(r, 9, 22);
        const color = r() < 0.5 ? 0x7af0ff : 0xd06bff;
        const c = mesh(new THREE.OctahedronGeometry(0.4 + r() * 0.6, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, flatShading: true }), x, 1.5 + r() * 2.5, z, false);
        c.scale.y = 1.8;
        c.userData.float = r() * 6;
        g.add(c);
        if (i % 4 === 0) {
          const l = new THREE.PointLight(color, 6, 8);
          l.position.copy(c.position);
          g.add(l);
          lights.push(l);
        }
      }
    },
    weather(p, dt) {
      if (Math.random() < dt * 20) p.emit(new THREE.Vector3((Math.random() - 0.5) * 30, Math.random() * 5, (Math.random() - 0.5) * 16), { color: [0xc9b8ff, 0x7af0ff, 0xff9df0], count: 1, speed: 0.2, life: 2.5, size: 0.2 });
    },
  },
];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(text: string) {
  return hash(text);
}

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
