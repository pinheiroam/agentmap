import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** Modelos KayKit (CC0, Kay Lousberg) servidos de web/public/models/kaykit. */
const BASE = '/models/kaykit/';

export const CHARACTERS = [
  'Knight',
  'Barbarian',
  'Mage',
  'Rogue',
  'Rogue_Hooded',
  'Skeleton_Mage',
  'Skeleton_Warrior',
  'Skeleton_Rogue',
  'Skeleton_Minion',
] as const;
export type CharacterModel = (typeof CHARACTERS)[number];

export const WEAPONS = ['Skeleton_Axe', 'Skeleton_Blade', 'Skeleton_Staff', 'Skeleton_Shield_Large_A', 'Skeleton_Crossbow'] as const;
export type WeaponModel = (typeof WEAPONS)[number];

interface Loaded {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
}

const cache = new Map<string, Loaded>();
let loading: Promise<void> | null = null;

/** Carrega tudo uma vez (≈36 MB, local). onProgress recebe 0..1. */
export function loadAssets(onProgress: (p: number) => void) {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const files = [...CHARACTERS.map((n) => `${n}.glb`), ...WEAPONS.map((n) => `${n}.gltf`)];
  let done = 0;
  loading = Promise.all(
    files.map(async (file) => {
      const gltf = await loader.loadAsync(BASE + file);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      cache.set(file.replace(/\.(glb|gltf)$/, ''), { scene: gltf.scene, clips: gltf.animations, height: box.max.y - box.min.y });
      onProgress(++done / files.length);
    }),
  ).then(() => undefined);
  return loading;
}

export function isLoaded() {
  return cache.size === CHARACTERS.length + WEAPONS.length;
}

/** Cópia independente de um personagem (com esqueleto próprio) e seus clipes de animação. */
export function instantiate(name: CharacterModel) {
  const src = cache.get(name)!;
  const root = SkeletonUtils.clone(src.scene) as THREE.Group;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.frustumCulled = false; // a caixa do bind pose não acompanha a animação
      mesh.material = (mesh.material as THREE.Material).clone();
    }
  });
  return { root, clips: src.clips, height: src.height };
}

export function weapon(name: WeaponModel) {
  const w = cache.get(name)!.scene.clone(true);
  w.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
  return w;
}

/** Prende uma arma num osso ("handslot.r", "handslot.l"). */
export function attach(root: THREE.Object3D, bone: string, obj: THREE.Object3D) {
  const slot = root.getObjectByName(bone);
  if (slot) slot.add(obj);
}

export function hideMeshes(root: THREE.Object3D, names: string[]) {
  root.traverse((o) => {
    if (names.includes(o.name)) o.visible = false;
  });
}
