import type Phaser from 'phaser';

export type Palette = Record<string, string>;

/**
 * Converte um mapa de caracteres em textura. Cada caractere é um pixel; a cor
 * vem da paleta e caracteres sem cor ('.') ficam transparentes. O jogo roda com
 * pixelArt: true, então as texturas são ampliadas sem borrar.
 */
export function pixelTexture(scene: Phaser.Scene, key: string, rows: string[], palette: Palette) {
  if (scene.textures.exists(key)) return key;
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = rows.length;
  const ctx = canvas.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** Textura de um quadrado/círculo sólido, usada por partículas e projéteis. */
export function dotTexture(scene: Phaser.Scene, key: string, size: number, color: string, round = false) {
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  if (round) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** Brilho radial suave (fogo, magia, luz de tocha). */
export function glowTexture(scene: Phaser.Scene, key: string, size: number, color: string) {
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(key, canvas);
  return key;
}

export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Gerador pseudoaleatório determinístico: o mesmo projeto sempre gera o mesmo cenário. */
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

export function hex(color: string) {
  return parseInt(color.replace('#', ''), 16);
}
