import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ---------------- partículas ----------------

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = alpha;
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * (0.6 + soft), vAlpha * soft);
  }
`;

export interface EmitOpts {
  color: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  count?: number;
  speed?: number;
  /** Direção base (será somada a um espalhamento aleatório). */
  dir?: THREE.Vector3;
  spread?: number;
  life?: number;
  size?: number;
  gravity?: number;
  /** Área de nascimento (raio em torno do ponto). */
  area?: THREE.Vector3;
  shrink?: boolean;
}

/** Pool de partículas num único Points com shader (tamanho e transparência por partícula). */
export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private base: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private shrink: Uint8Array;
  private cursor = 0;

  constructor(max: number, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.base = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.shrink = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, o: EmitOpts) {
    const colors = (Array.isArray(o.color) ? o.color : [o.color]).map((c) => new THREE.Color(c));
    const n = o.count ?? 10;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = o.area;
      this.pos[i * 3] = at.x + (a ? (Math.random() - 0.5) * 2 * a.x : 0);
      this.pos[i * 3 + 1] = at.y + (a ? (Math.random() - 0.5) * 2 * a.y : 0);
      this.pos[i * 3 + 2] = at.z + (a ? (Math.random() - 0.5) * 2 * a.z : 0);
      const s = o.speed ?? 2;
      const sp = o.spread ?? 1;
      const d = o.dir ?? new THREE.Vector3();
      this.vel[i * 3] = d.x * s + (Math.random() - 0.5) * 2 * s * sp;
      this.vel[i * 3 + 1] = d.y * s + (Math.random() - 0.5) * 2 * s * sp;
      this.vel[i * 3 + 2] = d.z * s + (Math.random() - 0.5) * 2 * s * sp;
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      const life = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.base[i] = (o.size ?? 0.25) * (0.7 + Math.random() * 0.6);
      this.grav[i] = o.gravity ?? 0;
      this.shrink[i] = o.shrink === false ? 0 : 1;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      // entra e sai suavemente
      this.alpha[i] = Math.min(1, (1 - t) * 6) * t;
      this.size[i] = this.base[i] * (this.shrink[i] ? 0.4 + 0.6 * t : 1);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.removeFromParent();
  }
}

// ---------------- efeitos de cena ----------------

type Tick = (dt: number) => boolean;

/** Gerencia efeitos temporários (projéteis, ondas, colunas de luz) que se atualizam por quadro. */
export class Fx {
  private ticks: Tick[] = [];
  readonly sparks: Particles;
  readonly smoke: Particles;
  private shake = 0;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparks = new Particles(2500, true);
    this.smoke = new Particles(800, false);
    scene.add(this.sparks.points, this.smoke.points);
  }

  update(dt: number, camera: THREE.Camera, cameraBase: THREE.Vector3) {
    this.ticks = this.ticks.filter((t) => t(dt));
    this.sparks.update(dt);
    this.smoke.update(dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      camera.position.set(
        cameraBase.x + (Math.random() - 0.5) * this.shake,
        cameraBase.y + (Math.random() - 0.5) * this.shake,
        cameraBase.z,
      );
    }
  }

  add(tick: Tick) {
    this.ticks.push(tick);
  }

  quake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  burst(at: THREE.Vector3, color: THREE.ColorRepresentation | THREE.ColorRepresentation[], count = 30, speed = 4) {
    this.sparks.emit(at, { color, count, speed, spread: 1, life: 0.6, size: 0.35, gravity: 6 });
  }

  /** Bola de energia com luz própria e rastro, de A até B. */
  projectile(from: THREE.Vector3, to: () => THREE.Vector3, color: number, opts: { speed?: number; size?: number; arc?: number } = {}) {
    return new Promise<void>((resolve) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(opts.size ?? 0.22, 16, 12),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      );
      const light = new THREE.PointLight(color, 6, 6);
      orb.add(light);
      orb.position.copy(from);
      this.scene.add(orb);
      const start = from.clone();
      const speed = opts.speed ?? 11;
      let t = 0;
      const dur = Math.max(0.25, start.distanceTo(to()) / speed);
      this.add((dt) => {
        t += dt / dur;
        const end = to();
        const p = start.clone().lerp(end, Math.min(1, t));
        p.y += Math.sin(Math.min(1, t) * Math.PI) * (opts.arc ?? 0.8);
        orb.position.copy(p);
        this.sparks.emit(p, { color: [color, 0xffffff], count: 3, speed: 0.6, life: 0.35, size: 0.3 });
        if (t < 1) return true;
        orb.removeFromParent();
        orb.geometry.dispose();
        this.burst(end, [color, 0xffffff], 36, 5);
        resolve();
        return false;
      });
    });
  }

  /** Flecha / virote: um bastão que segue a curva e aponta para onde vai. */
  bolt(from: THREE.Vector3, to: () => THREE.Vector3, color: number) {
    return new Promise<void>((resolve) => {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0xe8e2d0 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      tip.position.y = 0.48;
      bolt.add(tip);
      this.scene.add(bolt);
      const start = from.clone();
      let t = 0;
      const dur = Math.max(0.2, start.distanceTo(to()) / 18);
      let prev = start.clone();
      this.add((dt) => {
        t += dt / dur;
        const end = to();
        const p = start.clone().lerp(end, Math.min(1, t));
        p.y += Math.sin(Math.min(1, t) * Math.PI) * 1.2;
        const dir = p.clone().sub(prev).normalize();
        if (dir.lengthSq() > 0) bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        bolt.position.copy(p);
        prev = p;
        if (t < 1) return true;
        bolt.removeFromParent();
        this.burst(end, [color, 0xffffff], 16, 3);
        resolve();
        return false;
      });
    });
  }

  /** Arco de corte (golpe corpo a corpo). */
  slash(at: THREE.Vector3, color: number, facing: number) {
    const geo = new THREE.TorusGeometry(0.9, 0.06, 6, 24, Math.PI * 0.9);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const arc = new THREE.Mesh(geo, mat);
    arc.position.copy(at);
    arc.rotation.set(Math.random() * 0.8 - 0.4, facing, Math.random() * Math.PI);
    this.scene.add(arc);
    let t = 0;
    this.add((dt) => {
      t += dt / 0.28;
      arc.scale.setScalar(0.7 + t * 0.6);
      mat.opacity = 1 - t;
      if (t < 1) return true;
      arc.removeFromParent();
      geo.dispose();
      mat.dispose();
      return false;
    });
    this.sparks.emit(at, { color: [color, 0xffffff], count: 18, speed: 3, life: 0.35, size: 0.25, gravity: 4 });
  }

  /** Onda de choque no chão, crescendo a partir de um ponto. */
  shockwave(at: THREE.Vector3, color: number, maxRadius = 12, seconds = 0.9) {
    const geo = new THREE.RingGeometry(0.8, 1, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.05, at.z);
    this.scene.add(ring);
    let t = 0;
    this.add((dt) => {
      t += dt / seconds;
      ring.scale.setScalar(1 + t * maxRadius);
      mat.opacity = 1 - t;
      if (t < 1) return true;
      ring.removeFromParent();
      geo.dispose();
      mat.dispose();
      return false;
    });
    this.smoke.emit(new THREE.Vector3(at.x, 0.3, at.z), { color: 0x8a7a6a, count: 40, speed: 3, dir: new THREE.Vector3(0, 0.3, 0), spread: 1, life: 1, size: 0.8, gravity: -0.5, shrink: false });
  }

  /** Coluna de luz (level up, meditação, invocação). */
  pillar(at: THREE.Vector3, color: number, height = 6, seconds = 1.4) {
    const geo = new THREE.CylinderGeometry(0.6, 0.9, height, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const col = new THREE.Mesh(geo, mat);
    col.position.set(at.x, height / 2, at.z);
    this.scene.add(col);
    let t = 0;
    this.add((dt) => {
      t += dt / seconds;
      mat.opacity = Math.sin(Math.min(1, t) * Math.PI) * 0.8;
      col.scale.set(1 + t * 0.6, 1, 1 + t * 0.6);
      col.rotation.y += dt * 2;
      if (Math.random() < 0.6) this.sparks.emit(new THREE.Vector3(at.x, 0.2, at.z), { color: [color, 0xffffff], count: 2, speed: 0.5, dir: new THREE.Vector3(0, 6, 0), spread: 0.3, life: 0.9, size: 0.3, area: new THREE.Vector3(0.6, 0, 0.6) });
      if (t < 1) return true;
      col.removeFromParent();
      geo.dispose();
      mat.dispose();
      return false;
    });
  }

  /** Estacas que brotam do chão e afundam de novo (raízes, gelo, pedra, lava). */
  spikes(at: THREE.Vector3, color: number, opts: { count?: number; radius?: number; height?: number; seconds?: number; glow?: boolean } = {}) {
    const count = opts.count ?? 6;
    const radius = opts.radius ?? 0.7;
    const height = opts.height ?? 1.4;
    const seconds = opts.seconds ?? 1.2;
    const mat = opts.glow
      ? new THREE.MeshBasicMaterial({ color, toneMapped: false })
      : new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6 });
    const group = new THREE.Group();
    group.position.set(at.x, 0, at.z);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const r = radius * (0.4 + Math.random() * 0.6);
      const h = height * (0.6 + Math.random() * 0.6);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13 + Math.random() * 0.1, h, 5), mat);
      spike.position.set(Math.cos(a) * r, -h / 2, Math.sin(a) * r);
      spike.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
      spike.castShadow = true;
      spike.userData.h = h;
      group.add(spike);
    }
    this.scene.add(group);
    this.smoke.emit(new THREE.Vector3(at.x, 0.2, at.z), { color: 0x7a6a5a, count: 14, speed: 1.5, dir: new THREE.Vector3(0, 0.5, 0), life: 0.8, size: 0.6, shrink: false });
    let t = 0;
    this.add((dt) => {
      t += dt / seconds;
      // sobe rápido (15% do tempo), fica e afunda no fim
      const k = t < 0.15 ? t / 0.15 : t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      for (const sp of group.children) sp.position.y = -sp.userData.h / 2 + sp.userData.h * 0.75 * k;
      if (t < 1) return true;
      group.removeFromParent();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      mat.dispose();
      return false;
    });
  }

  /** Algo cai do céu e explode no chão (meteoro, estalactite). */
  falling(at: THREE.Vector3, color: number, kind: 'meteor' | 'icicle', height = 12) {
    return new Promise<void>((resolve) => {
      const obj =
        kind === 'meteor'
          ? new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0x3a1a10, emissive: color, emissiveIntensity: 1.6, flatShading: true }))
          : new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 6), new THREE.MeshStandardMaterial({ color: 0xcff4ff, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.9, flatShading: true }));
      if (kind === 'icicle') obj.rotation.x = Math.PI; // ponta para baixo
      const light = new THREE.PointLight(color, 8, 6);
      obj.add(light);
      const start = new THREE.Vector3(at.x - 3, height, at.z - 2);
      obj.position.copy(start);
      this.scene.add(obj);
      let t = 0;
      const dur = kind === 'meteor' ? 0.9 : 0.6;
      this.add((dt) => {
        t += dt / dur;
        const p = start.clone().lerp(at, Math.min(1, t * t));
        obj.position.copy(p);
        obj.rotation.y += dt * 6;
        if (kind === 'meteor') this.sparks.emit(p, { color: [color, 0xffe066], count: 5, speed: 0.8, life: 0.5, size: 0.6 });
        else this.sparks.emit(p, { color: 0xffffff, count: 1, speed: 0.3, life: 0.4, size: 0.2 });
        if (t < 1) return true;
        obj.removeFromParent();
        obj.geometry.dispose();
        this.burst(at.clone().setY(0.3), kind === 'meteor' ? [color, 0xffe066, 0x3a1a10] : [0xffffff, color], 40, 5);
        this.shockwave(at, color, 3, 0.5);
        this.quake(kind === 'meteor' ? 0.25 : 0.1);
        resolve();
        return false;
      });
    });
  }

  /** Tornado de partículas que atravessa a arena de A até B. */
  vortex(from: THREE.Vector3, to: THREE.Vector3, color: number, seconds = 2.4, onMove?: (p: THREE.Vector3) => void) {
    let t = 0;
    this.add((dt) => {
      t += dt / seconds;
      const c = from.clone().lerp(to, Math.min(1, t));
      onMove?.(c);
      for (let i = 0; i < 6; i++) {
        const y = Math.random() * 3.2;
        const a = Math.random() * Math.PI * 2 + t * 30;
        const r = 0.3 + y * 0.35;
        this.smoke.emit(new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r), {
          color: [color, 0xffe8c0],
          count: 1,
          speed: 0.8,
          dir: new THREE.Vector3(-Math.sin(a), 0.4, Math.cos(a)),
          spread: 0.2,
          life: 0.6,
          size: 0.5,
          shrink: false,
        });
      }
      return t < 1;
    });
  }

  /** Nuvem que fica parada um tempo (esporos, fumaça). */
  cloud(at: THREE.Vector3, color: number, radius = 2, seconds = 2.5) {
    let t = 0;
    this.add((dt) => {
      t += dt / seconds;
      this.smoke.emit(new THREE.Vector3(at.x, 0.6, at.z), { color: [color, 0xd8ffd0], count: 3, speed: 0.4, spread: 1, life: 1.4, size: 1.1, area: new THREE.Vector3(radius, 0.4, radius), shrink: false });
      if (Math.random() < 0.5) this.sparks.emit(new THREE.Vector3(at.x, 0.4, at.z), { color, count: 1, speed: 0.6, dir: new THREE.Vector3(0, 1, 0), spread: 0.3, life: 1, size: 0.15, area: new THREE.Vector3(radius, 0, radius) });
      return t < 1;
    });
  }

  /** Buraco negro: cresce puxando partículas, depois explode. */
  singularity(at: THREE.Vector3, color: number, seconds = 1.8) {
    return new Promise<void>((resolve) => {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0x05000a }));
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.08, 8, 48),
        new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      const group = new THREE.Group();
      group.add(core, halo);
      group.position.copy(at);
      this.scene.add(group);
      let t = 0;
      this.add((dt) => {
        t += dt / seconds;
        const s = 0.2 + Math.min(1, t) * 1.3;
        core.scale.setScalar(s);
        halo.scale.setScalar(s * 1.2);
        halo.rotation.x += dt * 3;
        halo.rotation.y += dt * 5;
        // partículas sugadas para o centro
        for (let i = 0; i < 4; i++) {
          const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
          this.sparks.emit(at.clone().add(dir.clone().multiplyScalar(4)), { color: [color, 0xffffff], count: 1, speed: 6, dir: dir.negate(), spread: 0.05, life: 0.6, size: 0.25 });
        }
        if (t < 1) return true;
        group.removeFromParent();
        core.geometry.dispose();
        halo.geometry.dispose();
        this.burst(at, [color, 0xffffff, 0x7a3aff], 90, 8);
        this.shockwave(at.clone().setY(0), color, 8, 0.8);
        this.quake(0.4);
        resolve();
        return false;
      });
    });
  }

  /** Raio contínuo de A até B que pisca algumas vezes. */
  beam(from: THREE.Vector3, to: () => THREE.Vector3, color: number, seconds = 0.6) {
    return new Promise<void>((resolve) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
      const geo = new THREE.CylinderGeometry(0.08, 0.08, 1, 8, 1, true);
      const beam = new THREE.Mesh(geo, mat);
      this.scene.add(beam);
      let t = 0;
      this.add((dt) => {
        t += dt / seconds;
        const end = to();
        const mid = from.clone().add(end).multiplyScalar(0.5);
        const len = from.distanceTo(end);
        beam.position.copy(mid);
        beam.scale.set(1 + Math.sin(t * 40) * 0.6, len, 1 + Math.sin(t * 40) * 0.6);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(from).normalize());
        mat.opacity = 0.9 * (1 - t * 0.5);
        this.sparks.emit(end, { color: [color, 0xffffff], count: 3, speed: 2, life: 0.3, size: 0.3 });
        if (t < 1) return true;
        beam.removeFromParent();
        geo.dispose();
        mat.dispose();
        resolve();
        return false;
      });
    });
  }
}

// ---------------- textos e rótulos (DOM) ----------------

/** Texto que sobe e some (dano, "bloqueou!", "LEVEL UP!"). */
export function floatText(parent: THREE.Object3D, at: THREE.Vector3, text: string, cls: string) {
  // O CSS2DRenderer posiciona o elemento pelo `transform`; a animação (que também usa
  // `transform`) fica num filho, senão o texto vai parar no canto da tela.
  const el = document.createElement('div');
  const inner = document.createElement('div');
  inner.className = `a3-float ${cls}`;
  inner.textContent = text;
  el.appendChild(inner);
  const obj = new CSS2DObject(el);
  obj.position.copy(at);
  parent.add(obj);
  setTimeout(() => {
    obj.removeFromParent();
    el.remove();
  }, 1600);
}
