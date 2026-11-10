import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { AgentStatus, Provider } from '../../../daemon/src/types.ts';
import type { HeroClass } from '../classes.ts';
import { fmtTokens, levelInfo } from '../levels.ts';
import { Actor, HERO_RIGS, type HeroRig } from './actor.ts';
import { Fx, Particles, floatText } from './effects.ts';
import { ELEMENTS, biomeFor, rng, seedOf, type Biome } from './realms.ts';

export interface ArenaHero {
  id: string;
  provider: Provider;
  title: string;
  role?: string;
  status: AgentStatus;
  tools: number;
  errors: number;
  lastTool?: string;
  isLeader: boolean;
  cls: HeroClass;
  /** Nível do personagem (fornecedor + papel), calculado pelos tokens de todo o histórico. */
  level: number;
  /** XP (tokens novos) desta sessão: cada aumento vira dano no boss. */
  xp: number;
  /** Mana = fração livre da janela de contexto (1 = vazia, 0 = cheia). null quando não se sabe. */
  mana: number | null;
}

export interface ArenaData {
  realmKey: string;
  realmLabel: string;
  /** XP de todo o histórico do projeto: define nível e vida do boss. null enquanto o histórico carrega. */
  realmXp: number | null;
  heroes: ArenaHero[];
  selectedId: string | null;
}

export interface ArenaBridge {
  onSelect: (id: string | null) => void;
}

const PROVIDER_RING: Record<Provider, number> = { claude: 0xe8845c, codex: 0x7aa2f7, cursor: 0xc084fc };
const ROLE_TINTS = [0x4fbf8f, 0xe0b84a, 0xe86a8c, 0x5fc6e8, 0xb7d36a, 0xf08a4b, 0xa58cf0, 0x7fd1c1];
const BOSS_POS = new THREE.Vector3(5.6, 0, -0.8);
const CAMP = new THREE.Vector3(-6.4, 0, 0.9);
const BOSS_SCALE = 2.3;
const RUN_SPEED = 4.2;

type Pose = 'standing' | 'sitting' | 'lying';

/** Efeitos de status deixados pelos ataques elementais dos bosses. */
type Ailment = 'burn' | 'poison' | 'freeze' | 'root' | 'blind' | 'curse' | 'stun';

interface Hero {
  data: ArenaHero;
  rig: HeroRig;
  actor: Actor;
  scale: number;
  hit: THREE.Mesh;
  ring: THREE.Mesh;
  tag: CSS2DObject;
  tagEl: HTMLDivElement;
  nameEl: HTMLSpanElement;
  levelEl: HTMLSpanElement;
  manaEl: HTMLElement;
  bubble?: CSS2DObject;
  target: THREE.Vector3;
  facing: number;
  pose: Pose;
  moving: boolean;
  /** Enquanto now < lockUntil o herói está ocupado (animação de transição ou ataque). */
  lockUntil: number;
  stunUntil: number;
  nextAttack: number;
  pending: number;
  dmgQueue: number[];
  nextGasp: number;
  nextZ: number;
  hovered: boolean;
  ailment?: { kind: Ailment; until: number; fx?: THREE.Object3D };
}

export class ArenaWorld {
  private bridge: ArenaBridge;
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 250);
  private cameraBase = new THREE.Vector3(0, 7.2, 15.5);
  private clock = new THREE.Clock();
  private now = 0;
  private timers: { at: number; fn: () => void }[] = [];
  private fx: Fx;
  private weather: Particles;
  private stage = new THREE.Group();
  private stageLights: THREE.PointLight[] = [];
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private campLight = new THREE.PointLight(0xff9a4a, 25, 9, 1.5);
  private heroes = new Map<string, Hero>();
  private boss?: Actor;
  private bossEyes = new THREE.PointLight(0xffffff, 0, 6);
  private bossHitCooldown = 0;
  private bossNextAttack = 0;
  private bossDown = false;
  private biome!: Biome;
  private data_?: ArenaData;
  private realmKey = '';
  private realmXp: number | null = null;
  private progressSeen = false;
  private hud: { root: HTMLDivElement; boss: HTMLDivElement; bar: HTMLElement; name: HTMLElement; element: HTMLElement; hp: HTMLElement; title: HTMLElement; banner: HTMLDivElement; fade: HTMLDivElement };
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private resizeObserver: ResizeObserver;
  private barPct = 1;

  constructor(host: HTMLElement, bridge: ArenaBridge) {
    this.host = host;
    this.bridge = bridge;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'a3-labels';
    host.appendChild(this.labels.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.add(this.hemi, this.sun, this.sun.target, this.campLight, this.stage, this.bossEyes);
    this.sun.position.set(-8, 16, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -10, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.campLight.position.set(CAMP.x, 1.1, CAMP.z);

    this.fx = new Fx(this.scene);
    this.weather = new Particles(1500, true);
    this.scene.add(this.weather.points);

    this.hud = this.buildHud();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- API usada pelo React ----------------

  setData(data: ArenaData) {
    this.data_ = data;
    this.apply();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    for (const h of this.heroes.values()) h.actor.dispose();
    this.boss?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
    this.hud.root.remove();
  }

  // ---------------- laço principal ----------------

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.now += dt;
    const due = this.timers.filter((t) => t.at <= this.now);
    this.timers = this.timers.filter((t) => t.at > this.now);
    for (const t of due) t.fn();

    for (const h of this.heroes.values()) this.updateHero(h, dt);
    this.boss?.update(dt);
    this.updateBoss();
    this.biome?.weather(this.weather, dt, this.now);
    this.weather.update(dt);
    this.fx.update(dt, this.camera, this.cameraBase);
    this.animateStage(dt);

    // fogueira: chama, brasas e luz tremulando
    this.campLight.intensity = 22 + Math.sin(this.now * 17) * 3 + Math.random() * 4;
    if (Math.random() < dt * 60) this.fx.sparks.emit(new THREE.Vector3(CAMP.x, 0.35, CAMP.z), { color: [0xffe066, 0xff9a3c, 0xff5a1f], count: 2, speed: 0.6, dir: new THREE.Vector3(0, 2.2, 0), spread: 0.25, life: 0.7, size: 0.45, area: new THREE.Vector3(0.18, 0, 0.18) });

    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  private after(seconds: number, fn: () => void) {
    this.timers.push({ at: this.now + seconds, fn });
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    // Enquadra a arena inteira (da taverna, à esquerda, até o boss) em qualquer proporção de tela.
    const halfWidth = 11.5;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dist = Math.max(17, halfWidth / (Math.tan(halfFov) * this.camera.aspect));
    this.cameraBase.set(-1.2, dist * 0.46, dist * 0.92);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(-1.2, 1.1, -0.8);
    this.camera.updateProjectionMatrix();
  }

  // ---------------- dados ----------------

  private apply() {
    const d = this.data_;
    if (!d) return;
    if (d.realmKey !== this.realmKey) {
      this.realmKey = d.realmKey;
      this.realmXp = d.realmXp;
      this.buildStage(false);
    } else if (d.realmXp !== null && d.realmXp !== this.realmXp) {
      const before = this.realmXp;
      this.realmXp = d.realmXp;
      // O projeto subiu de nível: o boss atual foi derrotado.
      const up = before !== null && levelInfo(d.realmXp).level > levelInfo(before).level;
      if (up && !this.bossDown) this.defeatBoss();
      else if (before === null && this.currentBiome() !== this.biome) this.buildStage(true);
      else if (!this.bossDown) this.drawBoss();
    }
    this.syncHeroes(d);
    this.progressSeen = d.realmXp !== null;
  }

  private currentBiome() {
    return biomeFor(this.realmKey, this.bossInfo().level || undefined);
  }

  /** Nível e vida do boss: vida = XP que falta para o projeto subir de nível. */
  bossInfo() {
    if (this.realmXp === null) return { level: 0, pct: 1, remaining: 0, max: 0 };
    const li = levelInfo(this.realmXp);
    const max = li.to - li.from;
    const remaining = li.to - this.realmXp;
    return { level: li.level, pct: remaining / max, remaining, max };
  }

  // ---------------- cenário ----------------

  private buildStage(keepHeroes: boolean, rise = false) {
    this.stage.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    });
    this.stage.clear();
    for (const l of this.stageLights) l.dispose();
    this.stageLights = [];
    if (!keepHeroes) {
      for (const h of this.heroes.values()) this.removeHero(h);
      this.heroes.clear();
    }
    this.biome = this.currentBiome();
    const b = this.biome;

    this.scene.background = skyTexture(b.sky[0], b.sky[1]);
    this.scene.fog = new THREE.Fog(b.fog, 24, 70);
    this.hemi.color.set(b.hemi[0]);
    this.hemi.groundColor.set(b.hemi[1]);
    this.hemi.intensity = Math.max(1, b.hemi[2] * 1.4);
    this.sun.color.set(b.sun[0]);
    this.sun.intensity = b.sun[1];

    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: b.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(10.5, 40),
      new THREE.MeshStandardMaterial({ color: b.arena, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.01;
    arena.receiveShadow = true;
    this.stage.add(ground, arena);
    b.build(this.stage, rng(seedOf(this.realmKey + b.id)), this.stageLights);

    // fogueira
    const logMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, flatShading: true });
    for (const a of [0.4, -0.4, 1.6]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6), logMat);
      log.rotation.set(Math.PI / 2, 0, a);
      log.position.set(CAMP.x, 0.1, CAMP.z);
      log.castShadow = true;
      this.stage.add(log);
    }
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7d7f86, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneMat);
      s.position.set(CAMP.x + Math.cos(a) * 0.6, 0.08, CAMP.z + Math.sin(a) * 0.6);
      this.stage.add(s);
    }

    this.buildBoss(rise);
    this.hud.title.textContent = `${b.icon}  ${b.name}  ·  ${this.data_?.realmLabel ?? ''}`;
    this.bossNextAttack = this.now + 4;
    if (keepHeroes) this.layout();
  }

  private animateStage(dt: number) {
    for (const o of this.stage.children) {
      if (o.userData.float !== undefined) {
        o.position.y += Math.sin(this.now * 1.4 + o.userData.float) * dt * 0.4;
        o.rotation.y += dt * 0.6;
      }
    }
    for (const l of this.stageLights) l.intensity *= 0.98 + Math.random() * 0.04;
  }

  // ---------------- boss ----------------

  private buildBoss(rise = false) {
    this.boss?.dispose();
    const rig = this.biome.boss;
    const boss = new Actor(rig.model, { attach: rig.weapons });
    boss.tint(rig.tint, 0.35);
    boss.model.traverse((o) => {
      if (/Eyes/.test(o.name) && (o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: rig.eyes, toneMapped: false });
      }
    });
    boss.root.scale.setScalar(BOSS_SCALE);
    boss.root.position.copy(BOSS_POS);
    boss.root.rotation.y = -Math.PI / 2 + 0.35; // olha para os heróis (e um pouco para a câmera)
    this.scene.add(boss.root);
    this.boss = boss;
    this.bossEyes.color.set(rig.eyes);
    this.bossEyes.position.set(BOSS_POS.x - 0.4, boss.height * BOSS_SCALE * 0.85, BOSS_POS.z);
    this.bossEyes.intensity = 8;
    this.bossDown = false;
    if (rise && boss.has('Skeletons_Awaken_Floor')) {
      boss.play('Skeletons_Awaken_Floor', { once: true, then: 'Idle_Combat', fade: 0 });
      this.fx.shockwave(BOSS_POS, rig.eyes, 6, 1.2);
    } else boss.play('Idle_Combat');
    this.barPct = this.bossInfo().pct;
    this.drawBoss();
  }

  private bossChest() {
    const h = (this.boss?.height ?? 2) * BOSS_SCALE;
    return new THREE.Vector3(BOSS_POS.x - 0.3, h * 0.6, BOSS_POS.z);
  }

  private drawBoss() {
    const info = this.bossInfo();
    this.barPct += (info.pct - this.barPct) * 1; // a transição fica por conta do CSS
    const el = ELEMENTS[this.biome.boss.element];
    this.hud.name.textContent = `${this.biome.boss.name}  ·  Nv ${info.level || '?'}`;
    this.hud.element.textContent = `${el.icon} ${el.label}`;
    this.hud.element.className = `a3-boss__el el-${this.biome.boss.element}`;
    this.hud.bar.style.width = `${Math.max(0, Math.min(1, info.pct)) * 100}%`;
    this.hud.bar.dataset.low = info.pct < 0.25 ? '1' : info.pct < 0.5 ? '2' : '';
    this.hud.hp.textContent = info.max ? `${fmtTokens(info.remaining)} / ${fmtTokens(info.max)} tokens` : 'lendo histórico…';
  }

  private updateBoss() {
    if (!this.boss || this.bossDown) return;
    this.bossEyes.intensity += (8 - this.bossEyes.intensity) * 0.05;
    if (this.now < this.bossNextAttack) return;
    const level = this.bossInfo().level || 1;
    this.bossNextAttack = this.now + Math.min(9, Math.max(3, 9 - level * 0.09)) + Math.random() * 2.5;
    const targets = [...this.heroes.values()].filter((h) => h.data.status !== 'done' && !h.moving);
    if (!targets.some((h) => h.data.status === 'working')) {
      if (Math.random() < 0.4) this.boss.play('Taunt', { once: true, then: 'Idle_Combat' });
      return;
    }
    this.bossAttack(targets);
  }

  private bossAttack(targets: Hero[]) {
    const boss = this.boss!;
    const rig = this.biome.boss;
    // aviso: olhos brilham forte antes do golpe
    this.bossEyes.intensity = 40;
    boss.flash(0x551111, 0.35);
    const skill = Math.random() < 0.5 ? 0 : 1;
    const el = ELEMENTS[rig.element];
    floatText(this.scene, this.bossChest().add(new THREE.Vector3(-0.5, 2.6, 0)), `${el.icon} ${el.skills[skill]}!`, `is-skill el-${rig.element}`);
    this.bossSkill(rig.element, skill, targets, el.color);
  }

  /** Os dois ataques de cada elemento. */
  private bossSkill(element: string, skill: number, targets: Hero[], color: number) {
    const boss = this.boss!;
    const alive = () => boss === this.boss && !this.bossDown;
    const some = (n: number) => [...targets].sort(() => Math.random() - 0.5).slice(0, n);
    const play = (anim: string) => boss.play(anim, { once: true, then: 'Idle_Combat' });
    const center = () => {
      const c = new THREE.Vector3();
      for (const h of targets) c.add(h.actor.root.position);
      return c.multiplyScalar(1 / Math.max(1, targets.length));
    };

    switch (`${element}:${skill}`) {
      case 'nature:0': // Raízes Espinhosas: brotam sob até 3 heróis e prendem
        play('Spellcast_Summon');
        some(3).forEach((h, i) =>
          this.after(0.6 + i * 0.2, () => {
            if (!alive()) return;
            this.fx.spikes(h.actor.root.position, 0x4a7a2a, { count: 8, radius: 0.7, height: 1.7, seconds: 2.4 });
            this.heroHit(h, 'enraizado!', color, ['root', 2.4]);
          }),
        );
        break;
      case 'nature:1': {
        // Esporos Venenosos: nuvem sobre o grupo
        play('Spellcast_Long');
        const c = center();
        this.after(0.7, () => {
          if (!alive()) return;
          this.fx.cloud(c, 0x7dff6a, 2.4, 3);
          for (const h of targets) if (h.actor.root.position.distanceTo(c) < 3.2) this.heroHit(h, 'envenenado!', color, ['poison', 4]);
        });
        break;
      }
      case 'shadow:0': // Rajada Sombria: virotes em sequência
        play('1H_Ranged_Shooting');
        for (let i = 0; i < 4; i++) {
          const h = targets[Math.floor(Math.random() * targets.length)];
          this.after(0.3 + i * 0.28, () => {
            if (!alive()) return;
            this.fx.bolt(this.bossChest(), () => this.heroChest(h), color).then(() => this.heroHit(h, 'amaldiçoado!', color, ['curse', 3]));
          });
        }
        break;
      case 'shadow:1': // Véu das Trevas: a arena escurece e tentáculos sombrios atacam
        play('Spellcast_Raise');
        this.darken(2.6);
        some(4).forEach((h, i) =>
          this.after(0.8 + i * 0.25, () => {
            if (!alive()) return;
            this.fx.spikes(h.actor.root.position, color, { count: 5, radius: 0.5, height: 2.2, seconds: 1.2, glow: true });
            this.heroHit(h, 'amaldiçoado!', color, ['curse', 3]);
          }),
        );
        break;
      case 'earth:0': {
        // Tempestade de Areia: um tornado atravessa a arena até a fogueira
        play('2H_Melee_Attack_Spinning');
        const hit = new Set<string>();
        this.after(0.4, () => {
          if (!alive()) return;
          const from = BOSS_POS.clone().add(new THREE.Vector3(-1.5, 0, 0.5));
          const to = new THREE.Vector3(CAMP.x - 2, 0, (Math.random() - 0.5) * 3);
          this.fx.vortex(from, to, 0xd9a25a, 2.8, (p) => {
            for (const h of targets) {
              if (hit.has(h.data.id) || h.actor.root.position.distanceTo(p) > 1.8) continue;
              hit.add(h.data.id);
              this.heroHit(h, 'cegado!', color, ['blind', 2.5]);
            }
          });
        });
        break;
      }
      case 'earth:1': // Terremoto: salto, onda de choque e anéis de estacas de pedra
        play('1H_Melee_Attack_Jump_Chop');
        this.after(boss.duration('1H_Melee_Attack_Jump_Chop') * 0.55, () => {
          if (!alive()) return;
          this.fx.shockwave(BOSS_POS, color, 14);
          this.fx.quake(0.5);
          for (const r of [3, 5.5, 8]) {
            this.after(r / 12, () => {
              for (let k = -2; k <= 2; k++) {
                const a = Math.PI + k * 0.45;
                this.fx.spikes(new THREE.Vector3(BOSS_POS.x + Math.cos(a) * r, 0, BOSS_POS.z + Math.sin(a) * r), 0x8a6a4a, { count: 4, radius: 0.5, height: 1.3, seconds: 1.4 });
              }
            });
          }
          for (const h of targets) this.after(h.actor.root.position.distanceTo(BOSS_POS) / 12, () => this.heroHit(h, 'atordoado!', color, ['stun', 1.6]));
        });
        break;
      case 'ice:0': // Chuva de Estalactites: caem sobre os heróis e em volta
        play('Spellcast_Summon');
        some(5).forEach((h, i) =>
          this.after(0.5 + i * 0.22, () => {
            if (!alive()) return;
            const at = h.actor.root.position.clone();
            this.fx.falling(at, color, 'icicle').then(() => {
              if (h.actor.root.position.distanceTo(at) < 1.4) this.heroHit(h, 'congelado!', color, ['freeze', 2]);
            });
          }),
        );
        for (let i = 0; i < 4; i++) this.after(0.6 + i * 0.3, () => alive() && this.fx.falling(new THREE.Vector3((Math.random() - 0.6) * 12, 0, (Math.random() - 0.5) * 6), color, 'icicle'));
        break;
      case 'ice:1': // Nova Congelante: explosão de gelo ao redor do boss
        play('2H_Melee_Attack_Spin');
        this.after(0.5, () => {
          if (!alive()) return;
          this.fx.shockwave(BOSS_POS, color, 9, 0.7);
          this.fx.spikes(BOSS_POS, 0xbfe9ff, { count: 16, radius: 3.4, height: 1.5, seconds: 2 });
          this.fx.burst(BOSS_POS.clone().setY(1), [0xffffff, color], 80, 7);
          for (const h of targets) if (h.actor.root.position.distanceTo(BOSS_POS) < 7.5) this.heroHit(h, 'congelado!', color, ['freeze', 2.2]);
        });
        break;
      case 'fire:0': // Chuva de Meteoros
        play('Spellcast_Summon');
        some(5).forEach((h, i) =>
          this.after(0.5 + i * 0.25, () => {
            if (!alive()) return;
            const at = h.actor.root.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6));
            this.fx.falling(at, color, 'meteor').then(() => {
              if (h.actor.root.position.distanceTo(at) < 1.8) this.heroHit(h, 'queimado!', color, ['burn', 3.5]);
            });
          }),
        );
        break;
      case 'fire:1': // Erupção: colunas de lava sob os heróis
        play('Spellcast_Raise');
        some(4).forEach((h, i) => {
          const at = h.actor.root.position.clone();
          // aviso no chão antes de explodir
          this.fx.sparks.emit(at.clone().setY(0.1), { color: [color, 0xffe066], count: 30, speed: 0.6, dir: new THREE.Vector3(0, 0.5, 0), life: 0.8, size: 0.3, area: new THREE.Vector3(0.6, 0, 0.6) });
          this.after(0.8 + i * 0.15, () => {
            if (!alive()) return;
            this.fx.spikes(at, color, { count: 5, radius: 0.4, height: 2.8, seconds: 1, glow: true });
            this.fx.sparks.emit(at.clone().setY(0.3), { color: [color, 0xffe066], count: 50, speed: 5, dir: new THREE.Vector3(0, 1.4, 0), spread: 0.3, life: 0.9, size: 0.45, gravity: 6 });
            if (h.actor.root.position.distanceTo(at) < 1.4) this.heroHit(h, 'queimado!', color, ['burn', 3]);
          });
        });
        break;
      case 'arcane:0': {
        // Corrente Arcana: raio que salta de herói em herói
        play('Spellcast_Shoot');
        const chain = some(4);
        let from = this.bossChest();
        chain.forEach((h, i) => {
          const start = from.clone();
          this.after(0.35 + i * 0.3, () => {
            if (!alive()) return;
            this.fx.beam(start, () => this.heroChest(h), color, 0.35).then(() => this.heroHit(h, 'corrompido!', color, ['curse', 2.5]));
          });
          from = this.heroChest(h);
        });
        break;
      }
      default: {
        // Singularidade: buraco negro puxa os heróis e explode
        play('Spellcast_Long');
        const c = center().setY(1.4);
        const pulled = targets.filter((h) => h.pose === 'standing' && !h.moving && h.actor.root.position.distanceTo(c) < 6);
        for (const h of pulled) {
          const start = h.actor.root.position.clone();
          const end = start.clone().lerp(c.clone().setY(0), 0.45);
          h.lockUntil = this.now + 2;
          this.tween(1.6, (t) => h.actor.root.position.lerpVectors(start, end, t));
        }
        this.fx.singularity(c, color, 1.8).then(() => {
          for (const h of pulled) this.heroHit(h, 'corrompido!', color, ['stun', 1.5]);
        });
      }
    }
  }

  /** Escurece a arena por alguns segundos (Véu das Trevas). */
  private darken(seconds: number) {
    const hemi = this.hemi.intensity;
    const sun = this.sun.intensity;
    this.tween(0.4, (t) => {
      this.hemi.intensity = hemi * (1 - 0.75 * t);
      this.sun.intensity = sun * (1 - 0.85 * t);
    });
    this.after(seconds, () =>
      this.tween(0.8, (t) => {
        this.hemi.intensity = hemi * (0.25 + 0.75 * t);
        this.sun.intensity = sun * (0.15 + 0.85 * t);
      }),
    );
  }

  hitBoss(dmg: number | undefined, label: string | undefined, cls = '') {
    if (!this.boss || this.bossDown) return;
    this.boss.flash(0xffffff, 0.08);
    if (this.now > this.bossHitCooldown && this.boss.currentName === 'Idle_Combat') {
      this.bossHitCooldown = this.now + 1.2;
      this.boss.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { once: true, then: 'Idle_Combat', fade: 0.1 });
    }
    const text = dmg ? `${label ? label + '  ' : ''}-${fmtTokens(dmg)}` : label;
    if (text) {
      const at = this.bossChest().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 1 + Math.random(), 0.5));
      floatText(this.scene, at, text, `${dmg ? 'is-dmg' : 'is-tool'} ${cls}`);
    }
    if (dmg && dmg > 20_000) this.fx.quake(0.15);
  }

  defeatBoss() {
    const boss = this.boss;
    if (!boss) return;
    this.bossDown = true;
    boss.play(boss.has('Death_C_Skeletons') ? 'Death_C_Skeletons' : 'Death_A', { once: true, fade: 0.1 });
    this.fx.burst(this.bossChest(), [0xffffff, 0xffe066, this.biome.boss.eyes], 120, 7);
    this.fx.quake(0.5);
    this.bossEyes.intensity = 0;
    this.banner('VITÓRIA!', 'is-win');
    for (const h of this.heroes.values()) {
      if (h.data.status !== 'done' && h.pose === 'standing' && !h.moving) {
        h.lockUntil = this.now + 2.4;
        h.actor.play('Cheer', { once: true, then: h.rig.combatIdle });
      }
    }
    // Boss derrotado: os heróis viajam para um cenário novo, com outro boss.
    this.after(3, () => {
      if (boss !== this.boss) return;
      this.hud.fade.classList.add('is-on');
      this.after(0.6, () => {
        if (boss !== this.boss) return;
        this.buildStage(true, true);
        this.hud.fade.classList.remove('is-on');
        this.banner(`${this.biome.icon} ${this.biome.name}`, 'is-realm', `${this.biome.boss.name} se ergue!`);
      });
    });
  }

  private banner(text: string, cls: string, sub?: string) {
    const b = this.hud.banner;
    b.className = `a3-banner ${cls}`;
    b.innerHTML = '';
    const main = document.createElement('div');
    main.textContent = text;
    b.appendChild(main);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      b.appendChild(s);
    }
    void b.offsetWidth; // reinicia a animação CSS
    b.classList.add('is-on');
    this.after(2.6, () => b.classList.remove('is-on'));
  }

  // ---------------- heróis ----------------

  private makeHero(d: ArenaHero): Hero {
    const rig = HERO_RIGS[d.cls];
    const actor = new Actor(rig.model, { hide: rig.hide, attach: rig.attach });
    const scale = d.isLeader ? 1 : 0.8;
    // Subagentes da mesma classe variam um pouco de cor, para dar para distinguir.
    if (!d.isLeader) actor.tint(ROLE_TINTS[seedOf(d.role ?? d.id) % ROLE_TINTS.length], 0.25);
    actor.root.scale.setScalar(scale);
    actor.root.position.set(CAMP.x - 2 + Math.random(), 0, CAMP.z + 3);
    this.scene.add(actor.root);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32),
      new THREE.MeshBasicMaterial({ color: PROVIDER_RING[d.provider], transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    actor.root.add(ring);

    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, actor.height, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = actor.height / 2;
    hit.userData.heroId = d.id;
    actor.root.add(hit);

    const tagEl = document.createElement('div');
    tagEl.className = `a3-tag${d.isLeader ? ' is-leader' : ''}`;
    const levelEl = document.createElement('span');
    levelEl.className = 'a3-tag__lv';
    const nameEl = document.createElement('span');
    nameEl.className = 'a3-tag__nm';
    const mana = document.createElement('div');
    mana.className = 'a3-mana';
    const manaEl = document.createElement('i');
    mana.appendChild(manaEl);
    tagEl.append(levelEl, nameEl, mana);
    const tag = new CSS2DObject(tagEl);
    tag.position.set(0, actor.height + 0.35, 0);
    actor.root.add(tag);

    const h: Hero = {
      data: d,
      rig,
      actor,
      scale,
      hit,
      ring,
      tag,
      tagEl,
      nameEl,
      levelEl,
      manaEl,
      target: actor.root.position.clone(),
      facing: 0,
      pose: 'standing',
      moving: false,
      lockUntil: 0,
      stunUntil: 0,
      nextAttack: this.now + 1 + Math.random() * 2,
      pending: 0,
      dmgQueue: [],
      nextGasp: 0,
      nextZ: 0,
      hovered: false,
    };
    actor.play('Idle');
    return h;
  }

  private removeHero(h: Hero) {
    this.clearAilment(h);
    h.tagEl.remove();
    h.bubble?.element.remove();
    h.actor.dispose();
  }

  private syncHeroes(d: ArenaData) {
    const seen = new Set<string>();
    for (const hd of d.heroes) {
      seen.add(hd.id);
      let h = this.heroes.get(hd.id);
      if (!h) {
        h = this.makeHero(hd);
        this.heroes.set(hd.id, h);
      } else {
        const prev = h.data;
        if (hd.tools > prev.tools && hd.status === 'working') h.pending = Math.min(3, h.pending + hd.tools - prev.tools);
        if (hd.errors > prev.errors) this.bossCounter(h);
        // Tokens novos desta sessão viram dano de verdade (só depois que o histórico já carregou).
        if (this.progressSeen && hd.xp > prev.xp) queueDamage(h, hd.xp - prev.xp);
        // Saltos grandes são a carga inicial do histórico, não um level up de verdade.
        if (hd.level > prev.level && prev.level > 1 && hd.level - prev.level <= 2) this.levelUp(h, hd.level);
        // A mana voltou de repente: a sessão foi compactada.
        if (prev.mana !== null && hd.mana !== null && hd.mana - prev.mana > 0.25) this.meditate(h);
      }
      h.data = hd;
      this.decorate(h, d.selectedId);
    }
    for (const [id, h] of this.heroes) {
      if (seen.has(id)) continue;
      this.heroes.delete(id);
      this.removeHero(h);
    }
    this.layout();
  }

  private decorate(h: Hero, selectedId: string | null) {
    const d = h.data;
    h.levelEl.textContent = `Nv ${d.level}`;
    h.nameEl.textContent = short(d.isLeader ? d.title : (d.role ?? d.title), 26);
    const selected = d.id === selectedId;
    h.tagEl.classList.toggle('is-selected', selected);
    h.tagEl.classList.toggle('show-name', d.isLeader || selected || h.hovered || d.status === 'waiting');
    h.tagEl.classList.toggle('is-done', d.status === 'done');
    const mana = d.mana;
    h.manaEl.parentElement!.style.display = mana === null ? 'none' : '';
    if (mana !== null) {
      h.manaEl.style.width = `${Math.max(0, Math.min(1, mana)) * 100}%`;
      h.manaEl.parentElement!.classList.toggle('is-low', mana < 0.2);
    }
    const waiting = d.status === 'waiting';
    if (waiting && !h.bubble) {
      // A animação fica no filho: o `transform` do wrapper é do CSS2DRenderer.
      const el = document.createElement('div');
      const inner = document.createElement('div');
      inner.className = 'a3-bubble';
      inner.textContent = '!';
      el.appendChild(inner);
      h.bubble = new CSS2DObject(el);
      h.bubble.position.set(0, h.actor.height + 1.05, 0);
      h.actor.root.add(h.bubble);
    } else if (!waiting && h.bubble) {
      h.bubble.removeFromParent();
      h.bubble.element.remove();
      h.bubble = undefined;
    }
    (h.ring.material as THREE.MeshBasicMaterial).color.set(waiting ? 0xffd23f : PROVIDER_RING[d.provider]);
  }

  /** Posição de cada herói conforme o status. */
  private layout() {
    const order = [...this.heroes.values()].sort((a, b) => Number(b.data.isLeader) - Number(a.data.isLeader) || a.data.id.localeCompare(b.data.id));
    const working = order.filter((h) => h.data.status === 'working');
    const waiting = order.filter((h) => h.data.status === 'waiting');
    const idle = order.filter((h) => h.data.status === 'idle');
    const done = order.filter((h) => h.data.status === 'done');

    // Combate em três arcos ao redor do boss: corpo a corpo na frente, assassinos no meio,
    // magia e tiro mais atrás. Cada arco espalha seus heróis para não ficarem enfileirados.
    const arcOf = (h: Hero) => (h.rig.style === 'melee' ? 2.8 : h.rig.style === 'dash' ? 4.4 : 6.4);
    const arcs = new Map<number, Hero[]>();
    for (const h of working) arcs.set(arcOf(h), [...(arcs.get(arcOf(h)) ?? []), h]);
    for (const [radius, list] of arcs) {
      const perRow = Math.max(3, Math.round(radius * 1.4));
      list.forEach((h, i) => {
        const row = Math.floor(i / perRow);
        const n = Math.min(perRow, list.length - row * perRow);
        const k = i % perRow;
        const step = 1.15 / radius; // ~1,15 unidade entre vizinhos
        const a = Math.PI + (k - (n - 1) / 2) * step * 1.6 + (row % 2) * step * 0.8;
        const r = radius + row * 1.3;
        h.target.set(BOSS_POS.x + Math.cos(a) * r, 0, BOSS_POS.z + Math.sin(a) * r);
      });
    }
    waiting.forEach((h, i) => h.target.set(-2.4 - Math.floor(i / 5) * 1.2, 0, -2.2 + (i % 5) * 1.25));
    idle.forEach((h, i) => {
      const ringN = Math.floor(i / 8);
      const inRing = Math.min(8, idle.length - ringN * 8);
      const a = ((i % 8) / inRing) * Math.PI * 2 + ringN * 0.4 + 0.3;
      const r = 1.6 + ringN * 1;
      h.target.set(CAMP.x + Math.cos(a) * r, 0, CAMP.z + Math.sin(a) * r);
    });
    done.forEach((h, i) => h.target.set(-11 + (i % 6) * 1.5, 0, -4.2 + Math.floor(i / 6) * 1.3));
  }

  private desiredPose(h: Hero): Pose {
    return h.data.status === 'idle' ? 'sitting' : h.data.status === 'done' ? 'lying' : 'standing';
  }

  private updateHero(h: Hero, dt: number) {
    const a = h.actor;
    a.update(dt);
    this.ailmentTick(h, dt);
    const pos = a.root.position;
    const toTarget = h.target.clone().sub(pos).setY(0);
    const dist = toTarget.length();
    const locked = this.now < h.lockUntil;

    if (dist > 0.15 && !locked) {
      // Para andar, primeiro levanta.
      if (h.pose !== 'standing') {
        const anim = h.pose === 'sitting' ? 'Sit_Floor_StandUp' : 'Lie_StandUp';
        h.pose = 'standing';
        h.lockUntil = this.now + a.duration(anim) * 0.85;
        a.play(anim, { once: true, then: 'Idle' });
        return;
      }
      h.moving = true;
      const step = Math.min(dist, RUN_SPEED * dt);
      pos.add(toTarget.normalize().multiplyScalar(step));
      h.facing = Math.atan2(toTarget.x, toTarget.z);
      a.play(dist > 2 ? 'Running_A' : 'Walking_A', { fade: 0.15 });
    } else if (h.moving && !locked) {
      h.moving = false;
      this.arrive(h);
    }
    // gira suavemente para a direção desejada
    const turn = ((h.facing - a.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    a.root.rotation.y += turn * Math.min(1, dt * 8);

    if (h.moving || locked) return;
    const s = h.data.status;
    if (s === 'working' && this.now > h.stunUntil && !this.bossDown) {
      if (h.dmgQueue.length && this.now > h.nextAttack - 2.4) this.attack(h, h.data.lastTool, h.dmgQueue.shift());
      else if (h.pending > 0 && this.now > h.nextAttack - 2.2) {
        h.pending--;
        this.attack(h, h.data.lastTool);
      } else if (this.now > h.nextAttack) this.attack(h, Math.random() < 0.5 ? h.data.lastTool : undefined);
    } else if (s !== 'done' && h.dmgQueue.length && h.pose === 'standing' && this.now > h.nextAttack) {
      // dano chegou com o herói fora de combate (ex.: esperando você): ataca de onde está
      this.attack(h, h.data.lastTool, h.dmgQueue.shift());
    }
    if (h.data.mana !== null && h.data.mana < 0.15 && s !== 'done' && this.now > h.nextGasp) {
      h.nextGasp = this.now + 4 + Math.random() * 2;
      floatText(this.scene, this.heroHead(h), 'ufa…', 'is-gasp');
    }
    if (s === 'done' && this.now > h.nextZ) {
      h.nextZ = this.now + 2.4 + Math.random() * 1.5;
      floatText(this.scene, this.heroHead(h).add(new THREE.Vector3(0.3, -0.8, 0)), 'z', 'is-z');
    }
  }

  /** Chegou ao destino: vira para o foco e assume a postura do status. */
  private arrive(h: Hero) {
    const pos = h.actor.root.position;
    const s = h.data.status;
    const focus = s === 'idle' ? CAMP : s === 'done' ? pos.clone().add(new THREE.Vector3(0, 0, 1)) : BOSS_POS;
    h.facing = Math.atan2(focus.x - pos.x, focus.z - pos.z);
    const pose = this.desiredPose(h);
    if (pose === 'sitting') {
      h.pose = 'sitting';
      h.lockUntil = this.now + h.actor.duration('Sit_Floor_Down');
      h.actor.play('Sit_Floor_Down', { once: true, then: 'Sit_Floor_Idle' });
    } else if (pose === 'lying') {
      h.pose = 'lying';
      h.lockUntil = this.now + h.actor.duration('Lie_Down');
      h.actor.play('Lie_Down', { once: true, then: 'Lie_Idle' });
    } else {
      h.actor.play(s === 'working' ? h.rig.combatIdle : 'Idle');
      h.nextAttack = Math.max(h.nextAttack, this.now + 0.4 + Math.random() * 0.8);
    }
  }

  private heroChest(h: Hero) {
    return h.actor.root.position.clone().add(new THREE.Vector3(0, h.actor.height * h.scale * 0.6, 0));
  }

  private heroHead(h: Hero) {
    return h.actor.root.position.clone().add(new THREE.Vector3(0, h.actor.height * h.scale + 0.9, 0));
  }

  // ---------------- combate dos heróis ----------------

  /** dmg = tokens reais; sem dmg o golpe é só ambiente (mostra a ferramenta, sem número). */
  attack(h: Hero, label?: string, dmg?: number) {
    const rig = h.rig;
    const anim = rig.attacks[Math.floor(Math.random() * rig.attacks.length)];
    const speed = 1.15;
    const dur = h.actor.duration(anim) / speed;
    h.nextAttack = this.now + dur + 1.6 + Math.random() * 2.4;
    h.facing = Math.atan2(BOSS_POS.x - h.actor.root.position.x, BOSS_POS.z - h.actor.root.position.z);

    if (rig.style === 'dash') return this.assassinate(h, label, dmg);

    h.lockUntil = this.now + dur;
    h.actor.play(anim, { once: true, speed, then: rig.combatIdle, fade: 0.12 });
    const impact = rig.style === 'melee' ? 0.45 : rig.style === 'ranged' ? 0.3 : 0.5;
    this.after(dur * impact, () => {
      if (!this.heroes.has(h.data.id)) return;
      if (rig.style === 'melee') {
        const at = this.bossChest().add(new THREE.Vector3(-0.6, -0.3, 0.3));
        this.fx.slash(at, rig.fx, h.facing);
        this.hitBoss(dmg, label);
      } else if (rig.style === 'ranged') {
        this.fx.bolt(this.heroChest(h), () => this.bossChest(), rig.fx).then(() => this.hitBoss(dmg, label));
      } else if (anim === 'Spellcast_Summon') {
        this.fx.pillar(BOSS_POS, rig.fx, 7, 1);
        this.after(0.5, () => this.hitBoss(dmg, label, 'is-necro'));
      } else {
        this.fx.projectile(this.heroChest(h).add(new THREE.Vector3(0, 0.4, 0)), () => this.bossChest(), rig.fx, { size: anim === 'Spellcast_Long' ? 0.38 : 0.24 }).then(() =>
          this.hitBoss(dmg, label),
        );
      }
    });
  }

  /** Assassino: avança correndo, dois golpes com as facas (às vezes crítico) e recua com uma esquiva. */
  private assassinate(h: Hero, label: string | undefined, dmg: number | undefined) {
    const a = h.actor;
    const home = a.root.position.clone();
    const strike = BOSS_POS.clone().add(new THREE.Vector3(-1.9, 0, 0.6 + (Math.random() - 0.5)));
    const crit = Math.random() < 0.3;
    const total = 0.35 + a.duration('Dualwield_Melee_Attack_Slice') * 0.9 + 0.5 + 0.4;
    h.lockUntil = this.now + total;
    a.play('Running_B', { speed: 1.6 });
    this.tween(0.35, (t) => a.root.position.lerpVectors(home, strike, t), () => {
      a.play('Dualwield_Melee_Attack_Slice', { once: true, speed: 1.3 });
      this.after(0.25, () => this.fx.slash(this.bossChest().add(new THREE.Vector3(-0.5, -0.4, 0.4)), 0xff4d6d, h.facing));
      this.after(0.5, () => {
        this.fx.slash(this.bossChest().add(new THREE.Vector3(-0.5, 0, 0.4)), 0xff4d6d, h.facing + 1);
        this.hitBoss(dmg, crit ? 'CRÍTICO!' : label, crit ? 'is-crit' : '');
      });
      this.after(0.85, () => {
        a.play('Dodge_Backward', { once: true, speed: 1.4 });
        this.tween(0.5, (t) => a.root.position.lerpVectors(strike, home, t), () => a.play(h.rig.combatIdle));
      });
    });
  }

  private tween(seconds: number, step: (t: number) => void, done?: () => void) {
    let t = 0;
    this.fx.add((dt) => {
      t = Math.min(1, t + dt / seconds);
      step(1 - (1 - t) * (1 - t));
      if (t < 1) return true;
      done?.();
      return false;
    });
  }

  /** Reação a um golpe do boss: paladino pode bloquear, assassino pode esquivar, os demais cambaleiam. */
  private heroHit(h: Hero, effect: string, color: number, ailment?: [Ailment, number]) {
    if (!this.heroes.has(h.data.id) || h.data.status === 'done' || h.moving) return;
    const head = this.heroHead(h);
    const a = h.actor;
    if (h.pose !== 'standing') {
      a.flash(color, 0.2);
      if (ailment) this.applyAilment(h, ailment[0], ailment[1]);
      return floatText(this.scene, head, effect, 'is-hurt');
    }
    if (h.data.cls === 'paladin' && Math.random() < 0.4) {
      a.play('Block_Hit', { once: true, then: h.rig.combatIdle, fade: 0.08 });
      h.lockUntil = this.now + 0.6;
      this.fx.burst(this.heroChest(h).add(new THREE.Vector3(0.3, 0, 0)), [0xffe680, 0xffffff], 24, 3);
      return floatText(this.scene, head, 'bloqueou!', 'is-block');
    }
    if (h.data.cls === 'assassin' && Math.random() < 0.4) {
      a.play(Math.random() < 0.5 ? 'Dodge_Left' : 'Dodge_Right', { once: true, then: h.rig.combatIdle, fade: 0.08 });
      h.lockUntil = this.now + 0.7;
      return floatText(this.scene, head, 'esquivou!', 'is-dodge');
    }
    if (ailment?.[0] !== 'freeze') a.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { once: true, then: h.data.status === 'working' ? h.rig.combatIdle : 'Idle', fade: 0.08 });
    a.flash(color, 0.25);
    h.lockUntil = this.now + 0.7;
    h.stunUntil = this.now + 1.4;
    h.nextAttack = Math.max(h.nextAttack, h.stunUntil + 0.4);
    if (ailment) this.applyAilment(h, ailment[0], ailment[1]);
    floatText(this.scene, head, effect, 'is-hurt');
  }

  /** Aplica um efeito de status: segura o herói e mostra o efeito enquanto durar. */
  private applyAilment(h: Hero, kind: Ailment, seconds: number) {
    this.clearAilment(h);
    const until = this.now + seconds;
    let fx: THREE.Object3D | undefined;
    if (kind === 'freeze') {
      // bloco de gelo e animação parada
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, h.actor.height * 1.05, 1.1),
        new THREE.MeshStandardMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.45, roughness: 0.1, emissive: 0x2a6a9a, emissiveIntensity: 0.4 }),
      );
      block.position.y = (h.actor.height * 1.05) / 2;
      h.actor.root.add(block);
      h.actor.setSpeed(0);
      fx = block;
    } else if (kind === 'root') {
      // espinhos presos aos pés
      const roots = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x3f6a2a, flatShading: true });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.7, 4), mat);
        thorn.position.set(Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35);
        thorn.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        roots.add(thorn);
      }
      h.actor.root.add(roots);
      fx = roots;
    }
    h.ailment = { kind, until, fx };
    h.stunUntil = Math.max(h.stunUntil, until);
    h.lockUntil = Math.max(h.lockUntil, kind === 'freeze' || kind === 'root' ? until : this.now + 0.7);
    h.nextAttack = Math.max(h.nextAttack, until + 0.3);
  }

  private clearAilment(h: Hero) {
    if (!h.ailment) return;
    if (h.ailment.fx) {
      h.ailment.fx.removeFromParent();
      h.ailment.fx.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    }
    if (h.ailment.kind === 'freeze') {
      h.actor.setSpeed(1);
      this.fx.burst(this.heroChest(h), [0xffffff, 0xbfeaff], 30, 4); // o gelo estilhaça
    }
    h.ailment = undefined;
  }

  /** Partículas do efeito de status, a cada quadro. */
  private ailmentTick(h: Hero, dt: number) {
    const ail = h.ailment;
    if (!ail) return;
    if (this.now > ail.until) return this.clearAilment(h);
    if (Math.random() > dt * 30) return;
    const chest = this.heroChest(h);
    const head = this.heroHead(h).add(new THREE.Vector3(0, -0.7, 0));
    switch (ail.kind) {
      case 'burn':
        this.fx.sparks.emit(chest, { color: [0xff6a1a, 0xffe066], count: 2, speed: 0.7, dir: new THREE.Vector3(0, 2, 0), spread: 0.3, life: 0.5, size: 0.35, area: new THREE.Vector3(0.25, 0.4, 0.25) });
        break;
      case 'poison':
        this.fx.sparks.emit(chest, { color: [0x7dff6a, 0xc8ff9a], count: 1, speed: 0.5, dir: new THREE.Vector3(0, 1.5, 0), spread: 0.2, life: 0.9, size: 0.2, area: new THREE.Vector3(0.3, 0.4, 0.3) });
        break;
      case 'curse':
        this.fx.smoke.emit(chest, { color: [0x5a2a8a, 0x2a1040], count: 1, speed: 0.4, dir: new THREE.Vector3(0, 1, 0), spread: 0.3, life: 1, size: 0.6, shrink: false });
        break;
      case 'blind':
        this.fx.smoke.emit(head, { color: 0xd9a25a, count: 1, speed: 0.6, spread: 0.6, life: 0.6, size: 0.35, shrink: false });
        break;
      case 'stun': {
        // estrelinhas girando sobre a cabeça
        const a = this.now * 6;
        this.fx.sparks.emit(head.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4)), { color: 0xffe066, count: 1, speed: 0.05, life: 0.3, size: 0.25 });
        break;
      }
      case 'freeze':
        this.fx.sparks.emit(chest, { color: 0xffffff, count: 1, speed: 0.2, life: 0.5, size: 0.15, area: new THREE.Vector3(0.5, 0.8, 0.5) });
        break;
    }
  }

  /** Erro numa ferramenta: o boss lança um orbe sombrio no herói. */
  private bossCounter(h: Hero) {
    if (!this.boss || this.bossDown) return;
    this.boss.play('Spellcast_Shoot', { once: true, then: 'Idle_Combat' });
    this.fx.projectile(this.bossChest(), () => this.heroChest(h), 0xb05cff, { speed: 9 }).then(() => this.heroHit(h, 'erro!', 0xb05cff));
  }

  private levelUp(h: Hero, level: number) {
    this.fx.pillar(h.actor.root.position, 0xffd23f, 6, 1.6);
    floatText(this.scene, this.heroHead(h).add(new THREE.Vector3(0, 0.4, 0)), `LEVEL UP!  Nv ${level}`, 'is-levelup');
    if (h.pose === 'standing' && !h.moving) {
      h.lockUntil = this.now + 2;
      h.actor.play('Cheer', { once: true, then: h.data.status === 'working' ? h.rig.combatIdle : 'Idle' });
    }
  }

  /** Sessão compactada: luz azul e a mana volta. */
  private meditate(h: Hero) {
    this.fx.pillar(h.actor.root.position, 0x4aa8ff, 5, 1.6);
    floatText(this.scene, this.heroHead(h), 'meditou! +mana', 'is-mana');
    if (h.pose === 'standing' && !h.moving && h.actor.has('Spellcast_Raise')) {
      h.lockUntil = this.now + 1.4;
      h.actor.play('Spellcast_Raise', { once: true, then: h.data.status === 'working' ? h.rig.combatIdle : 'Idle' });
    }
  }

  // ---------------- interação ----------------

  private pick(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.heroes.values()].map((h) => h.hit), false);
    return hits[0]?.object.userData.heroId as string | undefined;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.bridge.onSelect(this.pick(e) ?? null);
  };

  private onPointerMove = (e: PointerEvent) => {
    const id = this.pick(e);
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    for (const h of this.heroes.values()) {
      const hovered = h.data.id === id;
      if (hovered !== h.hovered) {
        h.hovered = hovered;
        this.decorate(h, this.data_?.selectedId ?? null);
      }
    }
  };

  // ---------------- HUD ----------------

  private buildHud() {
    const root = document.createElement('div');
    root.className = 'a3-hud';
    root.innerHTML = `
      <div class="a3-title"></div>
      <div class="a3-boss"><div class="a3-boss__el"></div><div class="a3-boss__name"></div><div class="a3-boss__track"><i></i></div><div class="a3-boss__hp"></div></div>
      <div class="a3-banner"></div>
      <div class="a3-fade"></div>`;
    this.host.appendChild(root);
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    return {
      root,
      boss: q('.a3-boss') as HTMLDivElement,
      bar: q('.a3-boss__track i'),
      name: q('.a3-boss__name'),
      element: q('.a3-boss__el'),
      hp: q('.a3-boss__hp'),
      title: q('.a3-title'),
      banner: q('.a3-banner') as HTMLDivElement,
      fade: q('.a3-fade') as HTMLDivElement,
    };
  }
}

/** Divide um ganho de tokens em até 3 golpes. */
function queueDamage(h: Hero, delta: number) {
  const parts = delta > 50_000 ? 3 : delta > 5_000 ? 2 : 1;
  for (let i = 0; i < parts; i++) h.dmgQueue.push(Math.round(delta / parts));
  // Fila longa demais (sessão muito ativa): junta o excedente no último golpe.
  while (h.dmgQueue.length > 6) {
    const extra = h.dmgQueue.shift()!;
    h.dmgQueue[0] += extra;
  }
}

function skyTexture(top: string, bottom: string) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function short(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
