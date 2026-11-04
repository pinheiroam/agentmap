import * as Phaser from 'phaser';
import type { AgentStatus, Provider } from '../../../daemon/src/types.ts';
import type { HeroClass } from '../classes.ts';
import {
  ARROW,
  ARROW_DOWN,
  AXE,
  BOSS_ART,
  BOW,
  BUBBLE,
  DAGGER,
  HERO_BASE,
  LOGS,
  OBJECT_PALETTE,
  ROLE_TINTS,
  SHIELD,
  SKULL_STAFF,
  STAFF,
  SWORD,
  WEAPON_PALETTE,
  heroFrames,
} from './art.ts';
import { biomeFor, paintBackground, type Biome } from './biomes.ts';
import { fmtTokens, levelInfo } from '../levels.ts';
import { dotTexture, glowTexture, hash, pixelTexture } from './pixel.ts';

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

/** Arma principal, ponto de pega e ângulo de descanso de cada classe. */
const WEAPONS: Record<HeroClass, { key: string; originY: number; angle: number; offhand?: string }> = {
  mage: { key: 'w-staff', originY: 0.85, angle: 18 },
  paladin: { key: 'w-sword', originY: 0.85, angle: 18, offhand: 'w-shield' },
  archer: { key: 'w-bow', originY: 0.5, angle: 0 },
  warrior: { key: 'w-axe', originY: 0.85, angle: 24 },
  necromancer: { key: 'w-skull', originY: 0.85, angle: 14 },
  assassin: { key: 'w-dagger', originY: 0.8, angle: 30, offhand: 'w-dagger' },
};
const FONT = 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace';

interface Hero {
  data: ArenaHero;
  cls: HeroClass;
  frames: [string, string];
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  weapon: Phaser.GameObjects.Image;
  offhand?: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  manaBar: Phaser.GameObjects.Graphics;
  nextGasp: number;
  bubble?: Phaser.GameObjects.Image;
  ring?: Phaser.GameObjects.Ellipse;
  marker?: Phaser.GameObjects.Image;
  scale: number;
  target: { x: number; y: number };
  walking: boolean;
  busy: boolean;
  pending: number;
  /** Dano real (tokens novos) esperando para virar ataque. */
  dmgQueue: number[];
  stunUntil: number;
  nextAttack: number;
  nextZ: number;
  idleTween?: Phaser.Tweens.Tween;
}

export class ArenaScene extends Phaser.Scene {
  private bridge: ArenaBridge;
  private data_?: ArenaData;
  private ready = false;
  private realmKey = '';
  private biome!: Biome;
  private stage: Phaser.GameObjects.GameObject[] = [];
  private heroes = new Map<string, Hero>();
  private realmXp: number | null = null;
  private progressSeen = false;
  private boss!: Phaser.GameObjects.Image;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private bossHp!: Phaser.GameObjects.Text;
  /** Fração de vida desenhada (anima até a real). */
  private barPct = 1;
  private bossNextAttack = 0;
  private bossHome = { x: 0, y: 0 };
  private bossDown = false;
  private groundY = 0;
  private camp = { x: 0, y: 0 };

  constructor(bridge: ArenaBridge) {
    super('arena');
    this.bridge = bridge;
  }

  /** Chamado pelo React a cada mudança de estado. */
  setData(data: ArenaData) {
    this.data_ = data;
    if (this.ready) this.apply();
  }

  create() {
    this.ready = true;
    for (const t of ['spark', 'pixel']) dotTexture(this, t, t === 'spark' ? 4 : 2, '#ffffff');
    glowTexture(this, 'fx-fire', 32, 'rgba(255,150,60,1)');
    glowTexture(this, 'fx-magic', 32, 'rgba(140,220,255,1)');
    glowTexture(this, 'fx-dark', 32, 'rgba(170,60,220,1)');
    glowTexture(this, 'fx-camp', 128, 'rgba(255,170,80,0.5)');
    pixelTexture(this, 'w-staff', STAFF, WEAPON_PALETTE);
    pixelTexture(this, 'w-sword', SWORD, WEAPON_PALETTE);
    pixelTexture(this, 'w-bow', BOW, WEAPON_PALETTE);
    pixelTexture(this, 'w-axe', AXE, WEAPON_PALETTE);
    pixelTexture(this, 'w-dagger', DAGGER, WEAPON_PALETTE);
    pixelTexture(this, 'w-shield', SHIELD, WEAPON_PALETTE);
    pixelTexture(this, 'w-skull', SKULL_STAFF, WEAPON_PALETTE);
    glowTexture(this, 'fx-necro', 32, 'rgba(125,255,106,1)');
    glowTexture(this, 'fx-holy', 64, 'rgba(255,230,140,1)');
    glowTexture(this, 'fx-rock', 24, 'rgba(150,120,90,1)');
    dotTexture(this, 'p-rock', 9, '#7a6650');
    pixelTexture(this, 'fx-arrow', ARROW, WEAPON_PALETTE);
    pixelTexture(this, 'o-bubble', BUBBLE, OBJECT_PALETTE);
    pixelTexture(this, 'o-marker', ARROW_DOWN, OBJECT_PALETTE);
    pixelTexture(this, 'o-logs', LOGS, OBJECT_PALETTE);

    this.scale.on('resize', () => this.time.delayedCall(60, () => this.buildStage(true)));
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0) this.bridge.onSelect(null);
    });
    if (this.data_) this.apply();
  }

  private apply() {
    const d = this.data_!;
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
      else if (!this.bossDown) this.animateBar();
    }
    this.syncHeroes(d);
    this.progressSeen = d.realmXp !== null;
  }

  // ---------------- cenário ----------------

  private buildStage(keepHeroes: boolean) {
    if (!this.data_) return;
    const { width: w, height: h } = this.scale;
    for (const o of this.stage) o.destroy();
    this.stage = [];
    if (this.boss) this.tweens.killTweensOf(this.boss);
    this.boss?.destroy();
    this.bossBar?.destroy();
    this.bossName?.destroy();
    this.bossHp?.destroy();
    if (!keepHeroes) {
      for (const hero of this.heroes.values()) this.destroyHero(hero);
      this.heroes.clear();
    }

    this.biome = this.currentBiome();
    this.groundY = Math.round(h * 0.5);
    this.stage.push(paintBackground(this, this.biome, w, h, this.groundY, this.realmKey));
    for (const o of this.biome.ambient(this, w, h, this.groundY)) {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(-900);
      this.stage.push(o);
    }

    // título do reino
    const banner = this.add
      .text(w / 2, 18, `${this.biome.icon}  ${this.biome.name}  ·  ${this.data_.realmLabel}`, {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(5000);
    this.stage.push(banner);

    // acampamento
    this.camp = { x: Math.max(110, w * 0.14), y: this.groundY + (h - this.groundY) * 0.42 };
    const glow = this.add.image(this.camp.x, this.camp.y - 8, 'fx-camp').setScale(2.6).setBlendMode('ADD').setDepth(this.camp.y - 2);
    this.tweens.add({ targets: glow, alpha: { from: 0.75, to: 1 }, scale: 2.8, duration: 220, yoyo: true, repeat: -1 });
    const logs = this.add.image(this.camp.x, this.camp.y, 'o-logs').setScale(3).setOrigin(0.5, 1).setDepth(this.camp.y);
    const fire = this.add.particles(this.camp.x, this.camp.y - 10, 'spark', {
      lifespan: 650,
      speedY: { min: -90, max: -40 },
      speedX: { min: -14, max: 14 },
      scale: { start: 2.2, end: 0.2 },
      tint: [0xffe066, 0xff9a3c, 0xff5a1f],
      alpha: { start: 1, end: 0 },
      frequency: 28,
    });
    fire.setDepth(this.camp.y + 1);
    this.stage.push(glow, logs, fire);

    // boss
    const kind = this.biome.boss.kind;
    const key = pixelTexture(this, `boss-${this.biome.id}`, BOSS_ART[kind], this.biome.boss.palette);
    const art = BOSS_ART[kind];
    const targetH = Phaser.Math.Clamp((h - this.groundY) * 0.85, 120, 300);
    const scale = Math.max(3, Math.floor(targetH / art.length));
    this.bossHome = { x: w * 0.8, y: this.groundY + (h - this.groundY) * 0.62 };
    this.boss = this.add.image(this.bossHome.x, this.bossHome.y, key).setOrigin(0.5, 1).setScale(scale).setDepth(this.bossHome.y);
    const shadow = this.add.ellipse(this.bossHome.x, this.bossHome.y, this.boss.displayWidth * 0.8, 18, 0x000000, 0.28).setDepth(this.bossHome.y - 1);
    this.stage.push(shadow);
    const floaty = kind === 'eye';
    if (floaty) this.boss.y -= 30;
    this.tweens.add({
      targets: this.boss,
      ...(floaty ? { y: this.boss.y - 14 } : { scaleY: scale * 1.04, scaleX: scale * 0.98 }),
      duration: floaty ? 1400 : 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.bossBar = this.add.graphics().setDepth(5000);
    this.bossName = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setDepth(5000);
    this.bossHp = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#ffe9e9', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5, 0)
      .setDepth(5000);
    this.bossDown = false;
    this.barPct = this.bossInfo().pct;
    this.bossNextAttack = this.time.now + 4000;
    this.drawBossBar();

    if (keepHeroes) this.layout();
  }

  private currentBiome() {
    return biomeFor(this.realmKey, this.bossInfo().level || undefined);
  }

  /** Nível e vida do boss: vida = XP que falta para o projeto subir de nível. */
  private bossInfo() {
    if (this.realmXp === null) return { level: 0, pct: 1, remaining: 0, max: 0 };
    const li = levelInfo(this.realmXp);
    const max = li.to - li.from;
    const remaining = li.to - this.realmXp;
    return { level: li.level, pct: remaining / max, remaining, max };
  }

  private animateBar() {
    const holder = { v: this.barPct };
    this.tweens.add({
      targets: holder,
      v: this.bossInfo().pct,
      duration: 900,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        this.barPct = holder.v;
        this.drawBossBar();
      },
    });
  }

  private drawBossBar() {
    if (!this.boss?.active) return;
    const info = this.bossInfo();
    const w = 220;
    const x = this.bossHome.x - w / 2;
    const y = this.boss.y - this.boss.displayHeight - 30;
    const g = this.bossBar;
    g.clear();
    g.fillStyle(0x000000, 0.65).fillRoundedRect(x - 3, y - 3, w + 6, 16, 4);
    g.fillStyle(0x3a1414).fillRect(x, y, w, 10);
    const pct = Phaser.Math.Clamp(this.barPct, 0, 1);
    g.fillStyle(pct > 0.5 ? 0xe5484d : pct > 0.25 ? 0xf59e0b : 0xfde047).fillRect(x, y, w * pct, 10);
    g.fillStyle(0xffffff, 0.25).fillRect(x, y, w * pct, 3);
    this.bossName.setPosition(this.bossHome.x, y - 6).setText(`${this.biome.boss.name}  ·  Nv ${info.level || '?'}`);
    this.bossHp
      .setPosition(this.bossHome.x, y + 13)
      .setText(info.max ? `${fmtTokens(info.remaining)} / ${fmtTokens(info.max)} tokens` : 'lendo histórico…');
  }

  // ---------------- heróis ----------------

  private makeHero(d: ArenaHero): Hero {
    const cls = d.cls;
    const palette = { ...HERO_BASE[cls] };
    // Subagentes da mesma classe variam no detalhe da roupa, para dar para distinguir.
    const tintable = cls !== 'necromancer' && cls !== 'assassin';
    if (!d.isLeader && tintable) palette.B = ROLE_TINTS[hash(d.role ?? d.id) % ROLE_TINTS.length];
    const variant = d.isLeader || !tintable ? 'lead' : palette.B.slice(1);
    const [f0, f1] = heroFrames(cls);
    const frames: [string, string] = [
      pixelTexture(this, `h-${cls}-${variant}-0`, f0, palette),
      pixelTexture(this, `h-${cls}-${variant}-1`, f1, palette),
    ];
    const scale = d.isLeader ? 3.5 : 2.6;
    const root = this.add.container(this.camp.x, this.camp.y + 30);
    const shadow = this.add.ellipse(0, 0, 11 * scale, 3 * scale, 0x000000, 0.3);
    // anel na cor da ferramenta (Claude, Codex, Cursor)
    const ring = this.add.ellipse(0, 0, 13 * scale, 4 * scale).setStrokeStyle(2, PROVIDER_RING[d.provider], 0.9);
    const body = this.add.image(0, 0, frames[0]).setOrigin(0.5, 1).setScale(scale);
    const w = WEAPONS[cls];
    const weapon = this.add
      .image(4.5 * scale, -6 * scale, w.key)
      .setOrigin(0.5, w.originY)
      .setScale(scale * 0.9)
      .setAngle(w.angle);
    const offhand = w.offhand
      ? this.add
          .image(-4.5 * scale, -5.5 * scale, w.offhand)
          .setOrigin(0.5, w.offhand === 'w-shield' ? 0.5 : 0.8)
          .setScale(scale * (w.offhand === 'w-shield' ? 0.8 : 0.9))
          .setAngle(w.offhand === 'w-shield' ? 0 : -30)
      : undefined;
    const label = this.add
      .text(0, 8, heroLabel(d), {
        fontFamily: FONT,
        fontSize: d.isLeader ? '12px' : '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setVisible(d.isLeader);
    const manaBar = this.add.graphics();
    root.add([shadow, ring, ...(offhand ? [offhand] : []), body, weapon, manaBar, label]);
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 400 });

    body.setInteractive({ useHandCursor: true, pixelPerfect: false });
    body.on('pointerdown', () => this.bridge.onSelect(d.id));
    body.on('pointerover', () => label.setVisible(true));
    body.on('pointerout', () => label.setVisible(this.labelVisible(hero)));

    const hero: Hero = {
      data: d,
      cls,
      frames,
      root,
      body,
      weapon,
      offhand,
      shadow,
      label,
      manaBar,
      nextGasp: 0,
      scale,
      target: { x: root.x, y: root.y },
      walking: false,
      busy: false,
      pending: 0,
      dmgQueue: [],
      stunUntil: 0,
      nextAttack: this.time.now + 600 + Math.random() * 1500,
      nextZ: 0,
    };
    this.startIdle(hero);
    return hero;
  }

  private destroyHero(h: Hero) {
    h.idleTween?.stop();
    this.tweens.killTweensOf([h.root, ...h.root.list]);
    h.root.destroy();
  }

  private labelVisible(h: Hero) {
    return h.data.isLeader || h.data.status === 'waiting' || h.data.id === this.data_?.selectedId;
  }

  private syncHeroes(d: ArenaData) {
    const seen = new Set<string>();
    for (const hd of d.heroes) {
      seen.add(hd.id);
      let hero = this.heroes.get(hd.id);
      if (!hero) {
        hero = this.makeHero(hd);
        this.heroes.set(hd.id, hero);
      } else {
        const prev = hero.data;
        if (hd.tools > prev.tools && hd.status === 'working') hero.pending = Math.min(3, hero.pending + hd.tools - prev.tools);
        if (hd.errors > prev.errors) this.bossCounter(hero);
        // Tokens novos desta sessão viram dano de verdade (só depois que o histórico já carregou).
        if (this.progressSeen && hd.xp > prev.xp) queueDamage(hero, hd.xp - prev.xp);
        // Saltos grandes são a carga inicial do histórico, não um level up de verdade.
        if (hd.level > prev.level && prev.level > 1 && hd.level - prev.level <= 2) this.levelUp(hero, hd.level);
        if (heroLabel(hd) !== heroLabel(prev)) hero.label.setText(heroLabel(hd));
        // A mana voltou de repente: a sessão foi compactada.
        if (prev.mana !== null && hd.mana !== null && hd.mana - prev.mana > 0.25) this.meditate(hero);
      }
      hero.data = hd;
      this.drawMana(hero);
      this.decorate(hero, d.selectedId);
    }
    for (const [id, hero] of this.heroes) {
      if (seen.has(id)) continue;
      this.heroes.delete(id);
      this.tweens.killTweensOf(hero.root);
      this.tweens.add({ targets: hero.root, alpha: 0, duration: 400, onComplete: () => this.destroyHero(hero) });
    }
    this.layout();
  }

  /** Balão de "!", marcador de seleção, transparência de encerrado. */
  private decorate(h: Hero, selectedId: string | null) {
    const waiting = h.data.status === 'waiting';
    if (waiting && !h.bubble) {
      h.ring = this.add.ellipse(0, 0, 16 * h.scale, 5 * h.scale).setStrokeStyle(3, 0xffd23f);
      h.bubble = this.add.image(0, -19 * h.scale, 'o-bubble').setScale(Math.max(2.4, h.scale * 0.8)).setOrigin(0.5, 1);
      h.root.addAt(h.ring, 0);
      h.root.add(h.bubble);
      this.tweens.add({ targets: h.bubble, y: h.bubble.y - 8, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: h.ring, scaleX: 1.25, scaleY: 1.25, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
    } else if (!waiting && h.bubble) {
      h.bubble.destroy();
      h.ring?.destroy();
      h.bubble = h.ring = undefined;
    }

    const selected = h.data.id === selectedId;
    if (selected && !h.marker) {
      h.marker = this.add.image(0, -19 * h.scale - (h.bubble ? 34 : 4), 'o-marker').setScale(3).setOrigin(0.5, 1);
      h.root.add(h.marker);
      this.tweens.add({ targets: h.marker, y: h.marker.y - 6, duration: 300, yoyo: true, repeat: -1 });
    } else if (!selected && h.marker) {
      h.marker.destroy();
      h.marker = undefined;
    }

    h.label.setVisible(this.labelVisible(h));
    h.root.setAlpha(h.data.status === 'done' ? 0.45 : 1);
  }

  /** Distribui os heróis pelo campo de acordo com o status. */
  private layout() {
    const { width: w, height: h } = this.scale;
    const gy = this.groundY;
    const groups: Record<AgentStatus, Hero[]> = { working: [], waiting: [], idle: [], done: [] };
    const order = [...this.heroes.values()].sort(
      (a, b) => Number(b.data.isLeader) - Number(a.data.isLeader) || a.data.id.localeCompare(b.data.id),
    );
    for (const hero of order) groups[hero.data.status].push(hero);

    const top = gy + 40;
    const bottom = h - 34;
    place(groups.working, { x0: w * 0.4, x1: Math.min(w * 0.66, this.bossHome.x - 150), y0: top + 10, y1: bottom }, 'right');
    place(groups.waiting, { x0: w * 0.28, x1: w * 0.36, y0: top + 10, y1: bottom }, 'right');
    place(groups.done, { x0: 28, x1: Math.max(140, w * 0.24), y0: bottom - 70, y1: bottom }, 'left');
    // ociosos em volta da fogueira
    groups.idle.forEach((hero, i) => {
      const n = groups.idle.length;
      const ring = Math.floor(i / 8);
      const inRing = Math.min(8, n - ring * 8);
      const a = ((i % 8) / inRing) * Math.PI * 2 + ring * 0.4 - Math.PI / 2;
      const rx = 70 + ring * 46;
      const ry = 30 + ring * 20;
      hero.target = { x: this.camp.x + Math.cos(a) * rx, y: this.camp.y + 6 + Math.sin(a) * ry };
    });

    for (const hero of this.heroes.values()) this.walkTo(hero);

    function place(list: Hero[], area: { x0: number; y0: number; x1: number; y1: number }, from: 'left' | 'right') {
      if (!list.length) return;
      const stepY = 52;
      const rows = Math.max(1, Math.min(list.length, Math.floor((area.y1 - area.y0) / stepY) + 1));
      const cols = Math.ceil(list.length / rows);
      const stepX = cols > 1 ? Math.min(70, (area.x1 - area.x0) / (cols - 1)) : 0;
      list.forEach((hero, i) => {
        const col = Math.floor(i / rows);
        const row = i % rows;
        const y = rows > 1 ? area.y0 + ((area.y1 - area.y0) * row) / (rows - 1) : (area.y0 + area.y1) / 2;
        const x = from === 'right' ? area.x1 - col * stepX - (row % 2) * 14 : area.x0 + col * stepX + (row % 2) * 14;
        hero.target = { x, y };
      });
    }
  }

  private walkTo(h: Hero) {
    const { x, y } = h.target;
    const dist = Phaser.Math.Distance.Between(h.root.x, h.root.y, x, y);
    if (dist < 4) return;
    this.tweens.killTweensOf(h.root);
    h.walking = true;
    h.body.setFlipX(x < h.root.x);
    h.idleTween?.stop();
    h.body.y = 0;
    this.tweens.add({
      targets: h.root,
      x,
      y,
      alpha: h.data.status === 'done' ? 0.45 : 1,
      duration: Math.max(300, (dist / 170) * 1000),
      ease: 'Linear',
      onComplete: () => {
        if (!h.root.active) return;
        h.walking = false;
        h.body.setFlipX(false).setTexture(h.frames[0]);
        this.startIdle(h);
        h.nextAttack = this.time.now + 300 + Math.random() * 900;
      },
    });
  }

  private startIdle(h: Hero) {
    h.idleTween?.stop();
    h.body.y = 0;
    const calm = h.data.status !== 'working';
    h.idleTween = this.tweens.add({
      targets: h.body,
      y: -h.scale * (calm ? 0.5 : 1),
      duration: calm ? 900 : 380,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // ---------------- combate ----------------

  update(time: number) {
    for (const h of this.heroes.values()) {
      h.root.setDepth(h.root.y);
      if (h.walking) {
        h.body.setTexture(h.frames[Math.floor(time / 140) % 2]);
        h.body.y = -Math.abs(Math.sin(time / 70)) * h.scale;
        continue;
      }
      if (!h.busy && !this.bossDown && h.data.status !== 'done' && time > h.stunUntil) {
        const working = h.data.status === 'working';
        if (h.dmgQueue.length && time > h.nextAttack - 2600) {
          this.attack(h, h.data.lastTool, h.dmgQueue.shift());
        } else if (working && h.pending > 0 && time > h.nextAttack - 2500) {
          h.pending--;
          this.attack(h, h.data.lastTool);
        } else if (working && time > h.nextAttack) {
          this.attack(h, Math.random() < 0.5 ? h.data.lastTool : undefined);
        }
      }
      // Contexto quase cheio: o herói ofega.
      if (h.data.mana !== null && h.data.mana < 0.15 && h.data.status !== 'done' && time > h.nextGasp) {
        h.nextGasp = time + 3500 + Math.random() * 2000;
        this.floatText(h.root.x - 12, h.root.y - 17 * h.scale, 'ufa…', '#9fd0ff', 12);
      }
      if (h.data.status === 'done' && time > h.nextZ) {
        h.nextZ = time + 2200 + Math.random() * 1500;
        this.floatText(h.root.x + 10, h.root.y - 17 * h.scale, 'z', '#c9d4ff', 14);
      }
    }
    if (!this.bossDown && this.boss?.active && time > this.bossNextAttack) {
      // Quanto maior o nível do projeto, mais rápido o boss ataca.
      const level = this.bossInfo().level || 1;
      this.bossNextAttack = time + Phaser.Math.Clamp(9000 - level * 90, 3000, 9000) + Math.random() * 2500;
      const fighting = [...this.heroes.values()].some((h) => h.data.status === 'working');
      if (fighting) this.bossAttack();
    }
  }

  /** dmg = tokens reais; sem dmg o golpe é só ambiente (mostra a ferramenta, sem número). */
  private attack(h: Hero, label?: string, dmg?: number) {
    h.busy = true;
    h.nextAttack = this.time.now + 2400 + Math.random() * 2600;
    const done = () => {
      h.busy = false;
    };
    const target = {
      x: this.boss.x - this.boss.displayWidth * 0.25 + Math.random() * this.boss.displayWidth * 0.3,
      y: this.boss.y - this.boss.displayHeight * (0.35 + Math.random() * 0.3),
    };
    const from = { x: h.root.x + 6 * h.scale, y: h.root.y - 10 * h.scale };

    const w = WEAPONS[h.cls];
    const swing = (onHit: () => void, from = -40, to = 120, duration = 180) =>
      this.tweens.add({
        targets: h.weapon,
        angle: { from, to },
        duration,
        yoyo: true,
        ease: 'Quad.easeOut',
        onYoyo: onHit,
        onComplete: () => {
          if (h.root.active) h.weapon.setAngle(w.angle);
          done();
        },
      });

    switch (h.cls) {
      case 'warrior':
        // investida pesada com o machado
        this.tweens.add({ targets: h.root, x: h.root.x + 46, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
        swing(() => {
          this.slash(target, 0xffd0a0);
          this.cameras.main.shake(90, 0.003);
          this.hitBoss(dmg, label, '#ffb36b');
        }, -70, 140, 220);
        break;
      case 'paladin':
        this.tweens.add({ targets: h.root, x: h.root.x + 30, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
        swing(() => {
          this.slash(target, 0xfff0b0);
          const holy = this.add.image(target.x, target.y, 'fx-holy').setBlendMode('ADD').setDepth(9000).setScale(0.4);
          this.tweens.add({ targets: holy, scale: 2.2, alpha: 0, duration: 420, onComplete: () => holy.destroy() });
          this.hitBoss(dmg, label, '#ffe680');
        });
        break;
      case 'mage':
        this.tweens.add({ targets: h.weapon, angle: -25, duration: 160, yoyo: true, onComplete: done });
        this.projectile('fx-fire', [0xffe066, 0xff7a2a], from, target, 520, () => this.hitBoss(dmg, label, '#ffb36b'));
        break;
      case 'necromancer':
        this.tweens.add({ targets: h.weapon, angle: -30, duration: 200, yoyo: true, onComplete: done });
        this.projectile('fx-necro', [0x7dff6a, 0x6b2fa0], from, target, 700, () => {
          this.burst(target.x, target.y, [0x7dff6a, 0x3b2550], 26);
          this.hitBoss(dmg, label, '#9dff8a');
        });
        break;
      case 'assassin':
        this.assassinate(h, target, dmg, label, done);
        break;
      default:
        this.shootArrow(h, from, target, dmg, label, done);
    }
  }

  /** Assassino: some, reaparece colado no boss, dois golpes rápidos (às vezes crítico) e volta. */
  private assassinate(h: Hero, target: { x: number; y: number }, dmg: number | undefined, label: string | undefined, done: () => void) {
    const home = { x: h.root.x, y: h.root.y };
    const strikeX = this.boss.x - this.boss.displayWidth * 0.42;
    const crit = Math.random() < 0.3;
    this.tweens.add({
      targets: h.root,
      alpha: 0.15,
      duration: 90,
      onComplete: () => {
        if (!h.root.active) return done();
        h.root.setPosition(strikeX, Math.min(home.y, this.bossHome.y - 4));
        this.tweens.add({ targets: h.root, alpha: 1, duration: 80 });
        const hit = (n: number) =>
          this.time.delayedCall(120 + n * 150, () => {
            if (!h.root.active) return;
            this.tweens.add({ targets: [h.weapon, h.offhand].filter(Boolean), angle: '+=90', duration: 70, yoyo: true });
            this.slash(target, 0xff5a6a);
            if (n === 1) this.hitBoss(dmg, crit ? 'CRÍTICO!' : label, crit ? '#ff4d6d' : '#ffb3c1');
          });
        hit(0);
        hit(1);
        this.time.delayedCall(560, () => {
          if (!h.root.active) return done();
          this.tweens.add({ targets: h.root, alpha: 0.15, duration: 80, onComplete: () => {
            if (!h.root.active) return done();
            h.root.setPosition(home.x, home.y);
            this.tweens.add({ targets: h.root, alpha: 1, duration: 120, onComplete: done });
          } });
        });
      },
    });
  }

  private shootArrow(h: Hero, from: { x: number; y: number }, target: { x: number; y: number }, dmg: number | undefined, label: string | undefined, done: () => void) {
      this.tweens.add({ targets: h.weapon, scaleX: h.weapon.scaleX * 0.8, duration: 160, yoyo: true, onComplete: done });
      const arrow = this.add.image(from.x, from.y, 'fx-arrow').setScale(3).setDepth(9000);
      const peak = Math.min(from.y, target.y) - 70;
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(from.x, from.y),
        new Phaser.Math.Vector2((from.x + target.x) / 2, peak),
        new Phaser.Math.Vector2(target.x, target.y),
      );
      const t = { v: 0 };
      this.tweens.add({
        targets: t,
        v: 1,
        duration: 560,
        onUpdate: () => {
          const p = curve.getPoint(t.v);
          const tan = curve.getTangent(t.v);
          arrow.setPosition(p.x, p.y).setRotation(Math.atan2(tan.y, tan.x));
        },
        onComplete: () => {
          arrow.destroy();
          this.hitBoss(dmg, label, '#e2c8ff');
        },
      });
  }

  private slash(at: { x: number; y: number }, color = 0x9fd0ff) {
    const g = this.add.graphics().setDepth(9000);
    g.lineStyle(6, 0xffffff, 0.95);
    g.beginPath();
    g.arc(at.x - 20, at.y, 46, -1.1, 1.1);
    g.strokePath();
    g.lineStyle(3, color, 0.9);
    g.beginPath();
    g.arc(at.x - 26, at.y, 40, -1.0, 1.0);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private projectile(
    key: string,
    tint: number[],
    from: { x: number; y: number },
    to: { x: number; y: number },
    duration: number,
    onHit: () => void,
  ) {
    const orb = this.add.image(from.x, from.y, key).setScale(1.3).setBlendMode('ADD').setDepth(9000);
    const trail = this.add.particles(0, 0, 'spark', {
      follow: orb,
      lifespan: 320,
      scale: { start: 1.6, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint,
      frequency: 16,
      blendMode: 'ADD',
    });
    trail.setDepth(8999);
    this.tweens.add({
      targets: orb,
      x: to.x,
      y: to.y,
      duration,
      ease: 'Quad.easeIn',
      onComplete: () => {
        orb.destroy();
        trail.stop();
        this.time.delayedCall(400, () => trail.destroy());
        this.burst(to.x, to.y, tint, 18);
        onHit();
      },
    });
  }

  private burst(x: number, y: number, tint: number[], count: number) {
    const e = this.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 220 },
      lifespan: 500,
      scale: { start: 1.8, end: 0 },
      tint,
      blendMode: 'ADD',
      emitting: false,
    });
    e.setDepth(9001);
    e.explode(count);
    this.time.delayedCall(700, () => e.destroy());
  }

  private hitBoss(dmg: number | undefined, label: string | undefined, color: string) {
    if (this.bossDown || !this.boss.active) return;
    const boss = this.boss;
    boss.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(70, () => boss.active && boss.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));
    this.tweens.add({ targets: boss, x: this.bossHome.x + 7, duration: 40, yoyo: true, repeat: 1, onComplete: () => (boss.x = this.bossHome.x) });
    const text = dmg ? `${label ? label + '  ' : ''}-${fmtTokens(dmg)}` : label;
    if (text) this.floatText(boss.x - 30 + Math.random() * 60, boss.y - boss.displayHeight * 0.7, text, color, dmg ? 16 : 13);
  }

  private defeatBoss() {
    this.bossDown = true;
    this.burst(this.boss.x, this.boss.y - this.boss.displayHeight / 2, [0xffffff, 0xffe066, 0xff7a2a], 60);
    this.tweens.add({ targets: this.boss, alpha: 0, scaleY: this.boss.scaleY * 0.2, duration: 700, ease: 'Quad.easeIn' });
    const { width: w } = this.scale;
    const win = this.add
      .text(w / 2, this.groundY - 60, 'VITÓRIA!', {
        fontFamily: FONT,
        fontSize: '42px',
        fontStyle: 'bold',
        color: '#ffd23f',
        stroke: '#3a1d00',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(10000)
      .setScale(0.2);
    this.stage.push(win);
    this.tweens.add({ targets: win, scale: 1, duration: 420, ease: 'Back.easeOut' });
    for (const h of this.heroes.values()) {
      if (h.data.status === 'working') this.tweens.add({ targets: h.body, y: -22, duration: 220, yoyo: true, repeat: 2 });
    }
    const boss = this.boss;
    this.time.delayedCall(2600, () => {
      win.destroy();
      if (boss !== this.boss || !boss.active) return;
      // Boss derrotado: os heróis viajam para um cenário novo, com outro boss.
      const cam = this.cameras.main;
      cam.fadeOut(450, 0, 0, 0);
      cam.once('camerafadeoutcomplete', () => {
        if (boss !== this.boss) return;
        this.buildStage(true);
        cam.fadeIn(600, 0, 0, 0);
        this.announceRealm();
      });
    });
  }

  /** Faixa com o nome do cenário novo, depois de uma viagem. */
  private announceRealm() {
    const { width: w } = this.scale;
    const t = this.add
      .text(w / 2, this.groundY - 70, `${this.biome.icon}  ${this.biome.name}\n${this.biome.boss.name} surge!`, {
        fontFamily: FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10000)
      .setAlpha(0);
    this.stage.push(t);
    this.tweens.add({ targets: t, alpha: 1, y: t.y - 10, duration: 500, hold: 1600, yoyo: true, onComplete: () => t.destroy() });
  }

  /** Erro numa ferramenta: o boss contra-ataca o herói. */
  private bossCounter(h: Hero) {
    if (!this.boss || this.bossDown) return;
    this.tweens.add({ targets: this.boss, x: this.bossHome.x - 24, duration: 140, yoyo: true });
    const from = { x: this.boss.x - this.boss.displayWidth * 0.3, y: this.boss.y - this.boss.displayHeight * 0.6 };
    const to = { x: h.root.x, y: h.root.y - 8 * h.scale };
    this.projectile('fx-dark', [0xb05cff, 0x5a1a8a], from, to, 600, () => {
      if (!h.root.active) return;
      h.body.setTint(0xff4d4d).setTintMode(Phaser.TintModes.FILL);
      this.time.delayedCall(120, () => h.root.active && h.body.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));
      this.tweens.add({ targets: h.root, x: h.root.x - 16, duration: 90, yoyo: true });
      this.floatText(h.root.x, h.root.y - 18 * h.scale, 'erro!', '#ff6b6b', 14);
    });
  }

  // ---------------- ataques do boss ----------------

  private bossAttack() {
    const targets = [...this.heroes.values()].filter((h) => h.data.status !== 'done' && !h.walking);
    if (!targets.length) return;
    const boss = this.boss;
    // aviso: o boss fica vermelho e cresce um pouco antes de atacar
    boss.setTint(0xff7070);
    this.tweens.add({ targets: boss, scaleX: boss.scaleX * 1.06, duration: 220, yoyo: true });
    this.time.delayedCall(380, () => {
      if (!boss.active || boss !== this.boss || this.bossDown) return;
      boss.clearTint();
      const kind = this.biome.boss.kind;
      if (kind === 'slime') this.slimeSlam(targets);
      else if (kind === 'dragon') this.dragonBreath(targets);
      else if (kind === 'golem') this.golemRock(Phaser.Utils.Array.GetRandom(targets));
      else this.eyeLaser(Phaser.Utils.Array.GetRandom(targets));
    });
  }

  /** Slime: pula e cai, soltando uma onda de choque pelo chão. */
  private slimeSlam(targets: Hero[]) {
    const boss = this.boss;
    this.tweens.add({
      targets: boss,
      y: boss.y - 70,
      duration: 260,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!boss.active) return;
        this.cameras.main.shake(160, 0.006);
        const wave = this.add.ellipse(this.bossHome.x, this.bossHome.y, 60, 16).setStrokeStyle(5, 0x9df07a, 0.9).setDepth(this.bossHome.y);
        this.tweens.add({ targets: wave, scaleX: 22, scaleY: 3, alpha: 0, duration: 900, onComplete: () => wave.destroy() });
        for (const h of targets) {
          const delay = (Math.abs(this.bossHome.x - h.root.x) / 900) * 900;
          this.time.delayedCall(delay, () => this.heroHit(h, 'grudento!', '#9df07a', 0x9df07a));
        }
      },
    });
  }

  /** Dragão: sopro de fogo (ou gelo) varrendo a linha de frente. */
  private dragonBreath(targets: Hero[]) {
    const ice = this.biome.id === 'ice';
    const tint = ice ? [0xffffff, 0xbfe9ff, 0x7fc4e8] : [0xffe066, 0xff9a3c, 0xff4a1a];
    const mouth = { x: this.boss.x - this.boss.displayWidth * 0.45, y: this.boss.y - this.boss.displayHeight * 0.78 };
    const breath = this.add.particles(mouth.x, mouth.y, 'spark', {
      speedX: { min: -620, max: -380 },
      speedY: { min: -30, max: 140 },
      lifespan: 1000,
      scale: { start: 2.6, end: 0.4 },
      alpha: { start: 1, end: 0 },
      tint,
      frequency: 8,
      blendMode: ice ? 'NORMAL' : 'ADD',
    });
    breath.setDepth(9002);
    this.tweens.add({ targets: this.boss, x: this.bossHome.x + 10, duration: 450, yoyo: true });
    this.time.delayedCall(900, () => {
      breath.stop();
      this.time.delayedCall(1100, () => breath.destroy());
    });
    // Só quem está na linha de frente (perto do boss) é atingido.
    const front = targets.filter((h) => h.root.x > this.scale.width * 0.3);
    for (const h of front) {
      const delay = 250 + (Math.abs(mouth.x - h.root.x) / 600) * 1000;
      this.time.delayedCall(delay, () => this.heroHit(h, ice ? 'congelado!' : 'queimado!', ice ? '#bfe9ff' : '#ffb36b', ice ? 0x8fd0ff : 0xff7a3a));
    }
  }

  /** Golem: arremessa uma pedra num herói. */
  private golemRock(h: Hero) {
    const from = { x: this.boss.x - this.boss.displayWidth * 0.3, y: this.boss.y - this.boss.displayHeight * 0.85 };
    const to = { x: h.root.x, y: h.root.y - 8 * h.scale };
    this.tweens.add({ targets: this.boss, angle: -6, duration: 160, yoyo: true });
    const rock = this.add.image(from.x, from.y, 'p-rock').setScale(3.5).setDepth(9002);
    const curve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(from.x, from.y),
      new Phaser.Math.Vector2((from.x + to.x) / 2, Math.min(from.y, to.y) - 140),
      new Phaser.Math.Vector2(to.x, to.y),
    );
    const t = { v: 0 };
    this.tweens.add({
      targets: t,
      v: 1,
      duration: 750,
      onUpdate: () => {
        const p = curve.getPoint(t.v);
        rock.setPosition(p.x, p.y).setRotation(t.v * 8);
      },
      onComplete: () => {
        rock.destroy();
        this.burst(to.x, to.y, [0xc49a5a, 0x8a6533, 0xe8d3a8], 22);
        this.cameras.main.shake(100, 0.004);
        this.heroHit(h, 'atordoado!', '#ffe9a8', 0xffe066);
      },
    });
  }

  /** Olho: raio que pisca três vezes até acertar o herói. */
  private eyeLaser(h: Hero) {
    const color = Phaser.Display.Color.HexStringToColor(this.biome.boss.palette.R).color;
    const from = { x: this.boss.x - this.boss.displayWidth * 0.05, y: this.boss.y - this.boss.displayHeight * 0.48 };
    const g = this.add.graphics().setDepth(9002).setBlendMode('ADD');
    let n = 0;
    const flash = () => {
      if (!h.root.active) return g.destroy();
      const to = { x: h.root.x, y: h.root.y - 9 * h.scale };
      g.clear();
      g.lineStyle(10, color, 0.35).lineBetween(from.x, from.y, to.x, to.y);
      g.lineStyle(4, 0xffffff, 0.95).lineBetween(from.x, from.y, to.x, to.y);
      this.time.delayedCall(90, () => g.clear());
      if (++n < 3) this.time.delayedCall(150, flash);
      else {
        this.time.delayedCall(100, () => g.destroy());
        this.burst(to.x, to.y, [color, 0xffffff], 16);
        this.heroHit(h, 'corrompido!', '#ff9df0', color);
      }
    };
    flash();
  }

  /** Reação do herói: paladino pode bloquear, assassino pode esquivar, os demais ficam atordoados. */
  private heroHit(h: Hero, effect: string, color: string, tint: number) {
    if (!h.root.active || h.data.status === 'done') return;
    const head = { x: h.root.x, y: h.root.y - 18 * h.scale };
    if (h.cls === 'paladin' && h.offhand && Math.random() < 0.4) {
      h.offhand.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      this.time.delayedCall(120, () => h.root.active && h.offhand?.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));
      this.burst(h.root.x + 10, h.root.y - 8 * h.scale, [0xffe680, 0xffffff], 12);
      return this.floatText(head.x, head.y, 'bloqueou!', '#ffe680', 13);
    }
    if (h.cls === 'assassin' && Math.random() < 0.4) {
      this.tweens.add({ targets: h.body, y: -30, duration: 160, yoyo: true, ease: 'Quad.easeOut' });
      return this.floatText(head.x, head.y, 'esquivou!', '#ffffff', 13);
    }
    h.body.setTint(tint);
    this.time.delayedCall(1100, () => h.root.active && h.body.clearTint());
    this.tweens.add({ targets: h.root, x: h.root.x - 14, duration: 90, yoyo: true });
    this.tweens.add({ targets: h.body, angle: { from: -8, to: 8 }, duration: 80, yoyo: true, repeat: 3, onComplete: () => h.body.setAngle(0) });
    h.stunUntil = this.time.now + 1200;
    h.nextAttack = Math.max(h.nextAttack, h.stunUntil + 400);
    this.floatText(head.x, head.y, effect, color, 13);
  }

  /** Barra de mana sob os pés: azul conforme o contexto livre, vermelha e piscando perto do limite. */
  private drawMana(h: Hero) {
    const g = h.manaBar;
    g.clear();
    const mana = h.data.mana;
    h.label.setY(mana === null ? 8 : 12);
    if (mana === null) return;
    const w = 11 * h.scale;
    const x = -w / 2;
    const y = 4;
    const pct = Phaser.Math.Clamp(mana, 0, 1);
    const low = pct < 0.2;
    g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 6);
    g.fillStyle(0x1a2140).fillRect(x, y, w, 4);
    g.fillStyle(low ? 0xff5a5a : 0x4aa8ff).fillRect(x, y, w * pct, 4);
    g.fillStyle(0xffffff, 0.35).fillRect(x, y, w * pct, 1);
    this.tweens.killTweensOf(g);
    g.setAlpha(1);
    if (low) this.tweens.add({ targets: g, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
  }

  /** Sessão compactada: o herói medita e a mana volta. */
  private meditate(h: Hero) {
    const glow = this.add.image(h.root.x, h.root.y, 'fx-magic').setOrigin(0.5, 1).setScale(1.2, 5).setBlendMode('ADD').setDepth(h.root.y + 1);
    this.tweens.add({ targets: glow, alpha: 0, scaleX: 2.4, duration: 1400, onComplete: () => glow.destroy() });
    this.burst(h.root.x, h.root.y - 10 * h.scale, [0x8fe3ff, 0xffffff, 0x4aa8ff], 30);
    h.body.setTint(0x9fdcff);
    this.time.delayedCall(900, () => h.root.active && h.body.clearTint());
    this.floatText(h.root.x, h.root.y - 20 * h.scale, 'meditou! +mana', '#8fe3ff', 14);
  }

  /** Subiu de nível: luz dourada, pulo e o texto LEVEL UP! */
  private levelUp(h: Hero, level: number) {
    const x = h.root.x;
    const y = h.root.y - 10 * h.scale;
    this.burst(x, y, [0xffd23f, 0xffffff, 0xfff1a8], 40);
    const beam = this.add.image(x, h.root.y, 'fx-holy').setOrigin(0.5, 1).setScale(0.8, 4).setBlendMode('ADD').setDepth(h.root.y + 1);
    this.tweens.add({ targets: beam, alpha: 0, scaleX: 1.6, duration: 1100, onComplete: () => beam.destroy() });
    this.tweens.add({ targets: h.body, y: -26, duration: 240, yoyo: true, repeat: 1 });
    const t = this.add
      .text(x, y - 30, `LEVEL UP!  Nv ${level}`, {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffd23f',
        stroke: '#3a1d00',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(10000)
      .setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 70, alpha: 0, delay: 1400, duration: 700, onComplete: () => t.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: string, size: number) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(9500);
    this.tweens.add({ targets: t, y: y - 46, alpha: { from: 1, to: 0 }, duration: 1100, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
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

function heroLabel(d: ArenaHero) {
  return `Nv ${d.level} · ${short(d.isLeader ? d.title : (d.role ?? d.title), 22)}`;
}

function short(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
