#!/usr/bin/env node
// Instala/remove o hook de aprovação do agentmap em ~/.claude/settings.json.
// Uso: node scripts/claude-hook.mjs install | uninstall
// Antes de alterar, salva uma cópia em ~/.claude/settings.json.agentmap-bak.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const settingsPath = join(homedir(), '.claude', 'settings.json');
const hookScript = fileURLToPath(new URL('../hooks/claude-permission.mjs', import.meta.url));
const command = `"${process.execPath}" "${hookScript}"`;
const MARK = 'claude-permission.mjs';

const action = process.argv[2];
if (action !== 'install' && action !== 'uninstall') {
  console.error('uso: claude-hook.mjs install | uninstall');
  process.exit(1);
}

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8') || '{}') : {};
settings.hooks ??= {};
const groups = (settings.hooks.PermissionRequest ?? [])
  .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARK)) }))
  .filter((g) => g.hooks.length > 0);

if (action === 'install') {
  // O timeout do hook (segundos) precisa ser maior que o AGENTMAP_APPROVAL_TIMEOUT do script.
  groups.push({ matcher: '*', hooks: [{ type: 'command', command, timeout: 330 }] });
}

if (groups.length) settings.hooks.PermissionRequest = groups;
else delete settings.hooks.PermissionRequest;
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

if (existsSync(settingsPath)) copyFileSync(settingsPath, settingsPath + '.agentmap-bak');
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(action === 'install' ? `Hook instalado em ${settingsPath}` : `Hook removido de ${settingsPath}`);
console.log('Sessões do Claude Code já abertas precisam ser reiniciadas para carregar a mudança.');
