import type { Provider, TokenTotals } from '../../daemon/src/types.ts';
import { CLASSES, classOfCharacter } from './classes.ts';

/**
 * Curva de níveis: XP acumulado para chegar ao nível N = BASE × (N−1)^EXP.
 * Cada nível exige mais que o anterior (Nv 10 ≈ 2,4 mi de tokens, Nv 30 ≈ 45 mi, Nv 50 ≈ 168 mi).
 */
const XP_BASE = 10_000;
const XP_EXP = 2.5;

/** XP = tokens novos (entrada + saída + cache gravado). Igual ao daemon (ledger.ts). */
export function xpOf(t: TokenTotals) {
  return t.input + t.output + t.cacheWrite;
}

export function xpForLevel(level: number) {
  return level <= 1 ? 0 : Math.round(XP_BASE * Math.pow(level - 1, XP_EXP));
}

export function levelInfo(xp: number) {
  let level = Math.floor(Math.pow(Math.max(0, xp) / XP_BASE, 1 / XP_EXP)) + 1;
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, xp, from, to, pct: (xp - from) / (to - from), rank: rankFor(level) };
}

const RANKS: [number, string][] = [
  [50, 'Lenda'],
  [40, 'Campeão'],
  [30, 'Herói'],
  [20, 'Veterano'],
  [10, 'Aventureiro'],
  [5, 'Escudeiro'],
  [1, 'Aprendiz'],
];
export function rankFor(level: number) {
  return RANKS.find(([min]) => level >= min)![1];
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('pt-BR');
export function fmtTokens(n: number) {
  return compact.format(n);
}
export function fmtFull(n: number) {
  return full.format(n);
}

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };

/** "claude:main" -> "Mago do Claude"; "codex:code_reviewer" -> "Code reviewer" */
export function characterName(key: string) {
  const [provider, role] = key.split(':') as [Provider, string];
  if (role === 'main') return `${CLASSES[classOfCharacter(key)].name} do ${PROVIDER_LABEL[provider]}`;
  const human = role.replace(/[_-]+/g, ' ').trim();
  return human.charAt(0).toUpperCase() + human.slice(1);
}

export function characterIcon(key: string) {
  return CLASSES[classOfCharacter(key)].icon;
}

export function characterClassName(key: string) {
  return CLASSES[classOfCharacter(key)].name;
}
