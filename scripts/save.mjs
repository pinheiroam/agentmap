#!/usr/bin/env node
// Exporta/importa o save de XP do agentmap (o daemon precisa estar rodando).
// Uso:
//   node scripts/save.mjs export [arquivo.json]
//   node scripts/save.mjs import arquivo.json

import { readFileSync, writeFileSync } from 'node:fs';

const base = `http://127.0.0.1:${process.env.AGENTMAP_PORT ?? 4317}/api/save`;
const [action, file] = process.argv.slice(2);

try {
  if (action === 'export') {
    const res = await fetch(base);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const save = await res.json();
    const out = file ?? `agentmap-save-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(out, JSON.stringify(save, null, 1));
    console.log(`Save exportado: ${out} (${save.sessions.length} sessões)`);
  } else if (action === 'import' && file) {
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: readFileSync(file) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    console.log(`Save importado: ${body.added} sessões novas, ${body.updated} atualizadas (de ${body.total}).`);
  } else {
    console.error('uso: save.mjs export [arquivo] | import <arquivo>');
    process.exit(1);
  }
} catch (err) {
  console.error(`Falhou: ${err.message}. O agentmap está rodando (npm start)?`);
  process.exit(1);
}
