import type { Provider } from '../../daemon/src/types.ts';

export type HeroClass = 'warrior' | 'paladin' | 'archer' | 'mage' | 'necromancer' | 'assassin';

export const CLASSES: Record<HeroClass, { name: string; icon: string; role: string }> = {
  paladin: { name: 'Paladino', icon: '🛡️', role: 'orquestra e lidera' },
  warrior: { name: 'Guerreiro', icon: '⚔️', role: 'implementa' },
  archer: { name: 'Arqueiro', icon: '🏹', role: 'pesquisa e explora' },
  mage: { name: 'Mago', icon: '🧙', role: 'planeja e projeta' },
  necromancer: { name: 'Necromante', icon: '💀', role: 'testa e caça bugs' },
  assassin: { name: 'Assassino', icon: '🗡️', role: 'revisa e audita' },
};

/** Sessões principais (sem papel): uma classe por ferramenta. */
const MAIN: Record<Provider, HeroClass> = { claude: 'mage', codex: 'paladin', cursor: 'archer' };

/** A ordem importa: a primeira regra que casar com o papel decide a classe. */
const RULES: [RegExp, HeroClass][] = [
  [/review|security|audit|guardian/, 'assassin'],
  [/qa|test|debug|harness/, 'necromancer'],
  [/orchestr|lead|manager|delivery|project/, 'paladin'],
  [/research|explor|discover|context|search|scout/, 'archer'],
  [/plan|architect|design|refactor/, 'mage'],
];

export function classOf(provider: Provider, role?: string): HeroClass {
  if (!role || role === 'main') return MAIN[provider];
  const r = role.toLowerCase();
  return RULES.find(([re]) => re.test(r))?.[1] ?? 'warrior';
}

/** Classe a partir da chave de personagem ("codex:code_reviewer"). */
export function classOfCharacter(key: string): HeroClass {
  const [provider, role] = key.split(':') as [Provider, string];
  return classOf(provider, role);
}
