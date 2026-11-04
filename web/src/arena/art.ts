import type { HeroClass } from '../classes.ts';
import type { Palette } from './pixel.ts';

// Todos os sprites são originais, desenhados aqui em pixel art.
// K = contorno; demais letras são trocadas por paleta (classe, papel, bioma).

const OUTLINE = '#15111d';

// ---------------- heróis (12 x 17) ----------------

const MAGE = [
  '......KK....',
  '.....KAAK...',
  '....KAAAK...',
  '...KAAAAAK..',
  '..KBBBBBBBK.',
  '...KSSSSSK..',
  '...KSESESK..',
  '...KGSSSGK..',
  '...KGGGGGK..',
  '..KAKGGGKAK.',
  '.KSAAKGKAASK',
  '.KKAAABAAAKK',
  '..KAAABAAAK.',
  '..KAAABAAAK.',
  '..KAAAAAAAK.',
];

const PALADIN = [
  '.....PP.....',
  '....PPK.....',
  '...KKKKKK...',
  '..KAAAAAAK..',
  '..KABBBBAK..',
  '..KAKKKKAK..',
  '..KAKEKEAK..',
  '..KAAAAAAK..',
  '...KAAAAK...',
  '..KBAAAABK..',
  '.KAAABBAAAK.',
  '.KSAABBAASK.',
  '.KKAAAAAAKK.',
  '..KLLKKLLK..',
  '..KLLK.KLLK.',
];

const ARCHER = [
  '............',
  '....KKKK....',
  '...KAAAAK...',
  '..KAAAAAAK..',
  '..KAKSSKAK..',
  '..KASESEAK..',
  '..KASSSSAK..',
  '...KAAAAK...',
  '..KABBBBAK..',
  '.KSAAABAAASK',
  '.KKAAABAAAKK',
  '..KAAABAAAK.',
  '..KBBBBBBBK.',
  '..KLLK.KLLK.',
  '..KLLK.KLLK.',
];

const WARRIOR = [
  '.K........K.',
  '.KH......HK.',
  '..KHKKKKHK..',
  '..KMMMMMMK..',
  '..KMMMMMMK..',
  '..KSESSESK..',
  '..KSSSSSSK..',
  '...KGGGGK...',
  '..KAAGGAAK..',
  '.KSAAAAAASK.',
  '.KKABBBBAKK.',
  '..KAAAAAAK..',
  '..KLLKKLLK..',
  '..KLLK.KLLK.',
  '..KLLK.KLLK.',
];

const NECROMANCER = [
  '....KKKK....',
  '...KAAAAK...',
  '..KAAAAAAK..',
  '..KAKKKKAK..',
  '..KKSSSSKK..',
  '..KKEKKEKK..',
  '..KASSSSAK..',
  '...KSKSKK...',
  '..KAAAAAAK..',
  '.KSAABBAASK.',
  '.KKAAABAAKK.',
  '..KAAAAAAAK.',
  '..KAAAAAAAK.',
  '..KAAAAAAAK.',
  '..KAAAAAAAK.',
];

const ASSASSIN = [
  '....KKKK....',
  '...KAAAAK...',
  '..KAAAAAAK..',
  '..KAKSSKAK..',
  '..KASESEAK..',
  '..KABBBBAK..',
  '...KBBBBK...',
  '..KAAAAAAK..',
  '.KSAAAAAASK.',
  '.KKABBBBAKK.',
  '..KAAAAAAK..',
  '..KAAAAAAK..',
  '..KLLK.KLLK.',
  '..KLLK.KLLK.',
  '..KLLK.KLLK.',
];

const FEET_A = ['..KWWK.KWWK.', '..KKKK.KKKK.'];
const FEET_B = ['.KWWK...KWWK', '.KKKK...KKKK'];

export type { HeroClass };

export const HERO_BODY: Record<HeroClass, string[]> = {
  mage: MAGE,
  paladin: PALADIN,
  archer: ARCHER,
  warrior: WARRIOR,
  necromancer: NECROMANCER,
  assassin: ASSASSIN,
};

/** Dois quadros: pés juntos e passo. */
export function heroFrames(cls: HeroClass) {
  const body = HERO_BODY[cls];
  return [body.concat(FEET_A), body.concat(FEET_B)];
}

const SKIN = '#f2c9a0';

export const HERO_BASE: Record<HeroClass, Palette> = {
  mage: { K: OUTLINE, A: '#4a5fd0', B: '#f6d06b', S: SKIN, E: '#2a1b12', G: '#eef0f5', W: '#5b3a24', L: '#5b3a24' },
  paladin: { K: OUTLINE, A: '#dfe5ef', B: '#f2c14e', P: '#3b6fd8', S: '#cfd8ea', E: '#9ff3ff', L: '#7d8aa6', W: '#4b5675' },
  archer: { K: OUTLINE, A: '#3f8a4a', B: '#7a4b2a', S: '#f0c49b', E: '#1d1a2a', L: '#3f3550', W: '#5a3a22' },
  warrior: { K: OUTLINE, A: '#b5482f', B: '#6b4226', M: '#aeb7c6', H: '#efe6d0', S: SKIN, E: '#1d1a2a', G: '#c0622a', L: '#5b3a24', W: '#3a2414' },
  necromancer: { K: OUTLINE, A: '#3b2550', B: '#d9d2bf', S: '#d9d2bf', E: '#7dff6a', L: '#2a1a3a', W: '#1d1428' },
  assassin: { K: OUTLINE, A: '#2b2f3a', B: '#c0303a', S: '#e0b48f', E: '#f2f2f2', L: '#1d2028', W: '#111318' },
};

/** Cores de roupa para subagentes de mesma classe, escolhidas pelo papel (variação, não identidade). */
export const ROLE_TINTS = ['#4fbf8f', '#e0b84a', '#e86a8c', '#5fc6e8', '#b7d36a', '#f08a4b', '#a58cf0', '#7fd1c1'];

// ---------------- armas ----------------

export const STAFF = [
  '.KKK.',
  'KOOOK',
  'KOWOK',
  'KOOOK',
  '.KKK.',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..K..',
];
export const SKULL_STAFF = [
  '.KKK.',
  'KQQQK',
  'KVKVK',
  'KQQQK',
  '.KQK.',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..T..',
  '..K..',
];
export const SWORD = [
  '..K..',
  '.KMK.',
  '.KMK.',
  '.KMK.',
  '.KMK.',
  '.KMK.',
  '.KMK.',
  '.KMK.',
  'KGGGK',
  '.KBK.',
  '.KBK.',
  '..K..',
];
export const AXE = [
  '..KKK..',
  '.KMMMK.',
  'KMMTMMK',
  'KMMTMMK',
  '.KMTMK.',
  '..KTK..',
  '...T...',
  '...T...',
  '...T...',
  '...T...',
  '...T...',
  '...T...',
  '...K...',
];
export const DAGGER = ['.K.', 'KMK', 'KMK', 'KMK', 'KMK', 'GGG', '.B.', '.K.'];
export const SHIELD = ['KKKKKKK', 'KGUUUGK', 'KUUGUUK', 'KUGGGUK', 'KUUGUUK', '.KUUUK.', '..KUK..', '...K...'];
export const BOW = [
  '...KK.',
  '..KTTK',
  '.Q.KTK',
  '.Q..KT',
  '.Q..KT',
  '.Q..KT',
  '.Q..KT',
  '.Q..KT',
  '.Q.KTK',
  '..KTTK',
  '...KK.',
];
export const ARROW = ['.....K..', 'QTTTTTMK', '.....K..'];

export const WEAPON_PALETTE: Palette = {
  K: OUTLINE,
  O: '#8fe3ff',
  W: '#ffffff',
  T: '#8a5a2b',
  M: '#e6edf7',
  G: '#f2c14e',
  B: '#6b4226',
  Q: '#e8e2d0',
  U: '#2f5fbf',
  V: '#7dff6a',
};

// ---------------- objetos ----------------

export const BUBBLE = [
  '.KKKKK.',
  'KYYYYYK',
  'KYYKYYK',
  'KYYKYYK',
  'KYYKYYK',
  'KYYYYYK',
  'KYYKYYK',
  'KYYYYYK',
  '.KKKKK.',
  '..KYK..',
  '...K...',
];
export const ARROW_DOWN = ['KKKKKKK', '.KWWWK.', '..KWK..', '...K...'];
export const LOGS = ['..KKKKKKKK..', '.KBBKBBBBBK.', 'KBBBBKBBBBBK', 'KKKKKKKKKKKK'];
export const OBJECT_PALETTE: Palette = { K: OUTLINE, Y: '#ffd23f', W: '#ffffff', B: '#7a4b2a' };

// ---------------- bosses ----------------

export const SLIME = [
  '......R...R...R.....',
  '......RR.RRR.RR.....',
  '......RRRRRRRRR.....',
  '.....KKKKKKKKKKK....',
  '...KKAAAAAAAAAAAKK..',
  '..KAAACCAAAAAAAAAK..',
  '.KAACCCAAAAAAAAAAAK.',
  '.KAACCAAEEAAAEEAAAK.',
  'KAAAAAAETEAAAETEAAAK',
  'KAAAAAAEEEAAAEEEAAAK',
  'KAAAAAAAAAAAAAAAAAAK',
  'KAAAAAKTKTKTKTAAAAAK',
  'KAAAAAAKKKKKKAAAAAAK',
  'KBAAAAAAAAAAAAAAAABK',
  '.KBBBBAAAAAAAABBBBK.',
  '..KKKKKKKKKKKKKKKK..',
];

export const DRAGON = [
  '....KK..................',
  '...KRRK......KK.........',
  '..KAAAAK....KBBK........',
  '.KAAEAAAK..KBBBBK.......',
  'KAAAAAAAAKKBBBBBBK......',
  'KTKTAAAAAAKBBBBBBBK.....',
  '.KKKKAAAAAAKBBBBBBBK....',
  '....KAAAAAAAKBBBBBBK....',
  '.....KAAAAAAAKKBBBBK....',
  '....KCAAAAAAAAAKKBBK....',
  '....KCCAAAAAAAAAAKK.....',
  '...KCCCAAAAAAAAAAAKK....',
  '...KCCCAAAAAAAAAAAAAKK..',
  '...KCCAAAAAAAAAAAAAAAAK.',
  '....KAAAAKKKAAAAAKKKAAK.',
  '....KAAK...KAAAK..KKAAK.',
  '...KAAK....KAAK.....KK..',
  '...KKKK....KKKK.........',
];

export const GOLEM = [
  '......KKKKKKK.......',
  '.....KBAAAAABK......',
  '.....KAEAAAEAK......',
  '.....KAAAAAAAK......',
  '......KBTTTBK.......',
  '..KKKKKKAAAKKKKKK...',
  '.KBAAAKAAAAAKAAABK..',
  'KBAAAAKACRCAKAAAABK.',
  'KAAAAKAACRCAAKAAAAK.',
  'KAAAKBAAACAAABKAAAK.',
  'KAAK.KAAAAAAAK.KAAK.',
  'KBAK.KBAAAAABK.KABK.',
  'KAAK.KAAAAAAAK.KAAK.',
  'KAAAK.KKAAAKK.KAAAK.',
  '.KKK..KAAKAAK..KKK..',
  '......KAAKAAK.......',
  '.....KAAK.KAAK......',
  '.....KBAK.KABK......',
  '....KAAAK.KAAAK.....',
  '....KKKKK.KKKKK.....',
];

export const EYE = [
  '..KK....KK....KK....',
  '.KEEK..KEEK..KEEK...',
  '..KK....KK....KK....',
  '...K.....K....K.....',
  '....K....K...K......',
  '.....KKKKKKKKK......',
  '...KKAAAAAAAAAKK....',
  '..KAAAAAAAAAAAAAK...',
  '.KAAAKKKKKKKKKAAAK..',
  '.KAAKCCCCCCCCCKAAK..',
  'KAAAKCCCKKKCCCKAAAK.',
  'KAAAKCCKRRRKCCKAAAK.',
  'KAAAKCCKRRRKCCKAAAK.',
  'KAAAKCCCKKKCCCKAAAK.',
  '.KAAKCCCCCCCCCKAAK..',
  '.KAAAKKKKKKKKKAAAK..',
  '..KAAATKTKTKTAAAK...',
  '...KKAAAAAAAAAKK....',
  '.....KKKKKKKKK......',
];

export type BossKind = 'slime' | 'dragon' | 'golem' | 'eye';
export const BOSS_ART: Record<BossKind, string[]> = { slime: SLIME, dragon: DRAGON, golem: GOLEM, eye: EYE };
export { OUTLINE };
