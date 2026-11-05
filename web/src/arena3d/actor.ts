import * as THREE from 'three';
import type { HeroClass } from '../classes.ts';
import { attach, hideMeshes, instantiate, weapon, type CharacterModel, type WeaponModel } from './assets.ts';

/** Como cada classe se monta e luta. Animações são nomes de clipes dos modelos KayKit. */
export interface HeroRig {
  model: CharacterModel;
  hide: string[];
  attach?: { weapon: WeaponModel; bone: string }[];
  combatIdle: string;
  attacks: string[];
  style: 'melee' | 'ranged' | 'spell' | 'dash';
  /** Distância do boss na formação de combate. */
  range: number;
  /** Cor do projétil / efeito de golpe. */
  fx: number;
}

export const HERO_RIGS: Record<HeroClass, HeroRig> = {
  paladin: {
    model: 'Knight',
    hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'],
    combatIdle: 'Idle',
    attacks: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab'],
    style: 'melee',
    range: 2.6,
    fx: 0xffe680,
  },
  warrior: {
    model: 'Barbarian',
    hide: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', 'Mug'],
    combatIdle: '2H_Melee_Idle',
    attacks: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin'],
    style: 'melee',
    range: 2.7,
    fx: 0xffb36b,
  },
  mage: {
    model: 'Mage',
    hide: ['Spellbook', 'Spellbook_open', '1H_Wand'],
    combatIdle: 'Idle',
    attacks: ['Spellcast_Shoot', 'Spellcast_Long'],
    style: 'spell',
    range: 6.2,
    fx: 0xff7a2a,
  },
  archer: {
    model: 'Rogue',
    hide: ['Knife_Offhand', '1H_Crossbow', 'Knife', 'Throwable'],
    combatIdle: '2H_Ranged_Aiming',
    attacks: ['2H_Ranged_Shoot'],
    style: 'ranged',
    range: 6.8,
    fx: 0xe2c8ff,
  },
  assassin: {
    model: 'Rogue_Hooded',
    hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable'],
    combatIdle: 'Idle',
    attacks: ['Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Chop'],
    style: 'dash',
    range: 4.6,
    fx: 0xff4d6d,
  },
  necromancer: {
    model: 'Skeleton_Mage',
    hide: [],
    attach: [{ weapon: 'Skeleton_Staff', bone: 'handslot.r' }],
    combatIdle: 'Idle_Combat',
    attacks: ['Spellcast_Shoot', 'Spellcast_Summon'],
    style: 'spell',
    range: 6.4,
    fx: 0x7dff6a,
  },
};

interface PlayOpts {
  once?: boolean;
  fade?: number;
  speed?: number;
  /** Animação que entra quando esta (once) termina. */
  then?: string;
}

/**
 * Um personagem animado: modelo KayKit + AnimationMixer com transições suaves
 * (crossfade) entre clipes.
 */
export class Actor {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly height: number;
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[];
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private next = new Map<THREE.AnimationAction, string>();
  currentName = '';
  private flashUntil = 0;

  constructor(model: CharacterModel, opts: { hide?: string[]; attach?: { weapon: WeaponModel; bone: string }[] } = {}) {
    const { root, clips, height } = instantiate(model);
    this.model = root;
    this.height = height;
    this.clips = clips;
    hideMeshes(root, opts.hide ?? []);
    for (const a of opts.attach ?? []) attach(root, a.bone, weapon(a.weapon));
    this.root.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    this.mixer.addEventListener('finished', (e) => {
      const then = this.next.get(e.action as THREE.AnimationAction);
      if (then) this.play(then);
    });
  }

  has(name: string) {
    return !!THREE.AnimationClip.findByName(this.clips, name);
  }

  duration(name: string) {
    return THREE.AnimationClip.findByName(this.clips, name)?.duration ?? 1;
  }

  play(name: string, opts: PlayOpts = {}) {
    if (!this.has(name)) return;
    if (!opts.once && this.currentName === name) return;
    let action = this.actions.get(name);
    if (!action) {
      action = this.mixer.clipAction(THREE.AnimationClip.findByName(this.clips, name)!);
      this.actions.set(name, action);
    }
    action.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, opts.once ? 1 : Infinity);
    action.clampWhenFinished = !!opts.once;
    action.timeScale = opts.speed ?? 1;
    action.reset().setEffectiveWeight(1).fadeIn(opts.fade ?? 0.2).play();
    if (this.current && this.current !== action) this.current.fadeOut(opts.fade ?? 0.2);
    if (opts.then) this.next.set(action, opts.then);
    else this.next.delete(action);
    this.current = action;
    this.currentName = name;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }

  /** 0 congela a pose atual (ex.: herói preso no gelo). */
  setSpeed(speed: number) {
    this.mixer.timeScale = speed;
  }

  /** Multiplica a cor dos materiais (variação de subagentes, bosses por reino). */
  tint(color: THREE.ColorRepresentation, amount = 0.45) {
    const c = new THREE.Color(color);
    this.model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.color) m.color.lerp(c, amount);
    });
  }

  /** Brilho rápido (golpe recebido). Volta sempre à cor original, mesmo com golpes sobrepostos. */
  flash(color: THREE.ColorRepresentation, seconds = 0.12) {
    const c = new THREE.Color(color);
    const until = performance.now() + seconds * 1000;
    this.flashUntil = Math.max(this.flashUntil, until);
    this.model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m?.emissive) return;
      m.userData.baseEmissive ??= m.emissive.clone();
      m.emissive.copy(c);
    });
    setTimeout(() => {
      if (performance.now() < this.flashUntil - 5) return; // outro brilho ainda em curso
      this.model.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive);
      });
    }, seconds * 1000);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
