#!/usr/bin/env node
// Hook PermissionRequest do Claude Code: encaminha o pedido de permissão ao
// agentmap e devolve a decisão tomada na UI. Se o agentmap não estiver rodando,
// não houver UI aberta ou o tempo acabar, sai sem saída e o Claude mostra o
// prompt normal no terminal.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = process.env.AGENTMAP_PORT ?? '4317';
const timeoutMs = Number(process.env.AGENTMAP_APPROVAL_TIMEOUT ?? 300) * 1000;

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let token;
  try {
    token = readFileSync(join(homedir(), '.config', 'agentmap', 'token'), 'utf8').trim();
  } catch {
    return; // agentmap nunca rodou nesta máquina
  }

  const res = await fetch(`http://127.0.0.1:${port}/api/hooks/claude/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agentmap-token': token },
    body: raw,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return;
  const { decision, message, updatedPermissions } = await res.json();

  let out;
  if (decision === 'allow' || decision === 'allow_always') {
    out = { behavior: 'allow', ...(updatedPermissions ? { updatedPermissions } : {}) };
  } else if (decision === 'deny') {
    out = { behavior: 'deny', message: message || 'Negado pelo usuário no agentmap.' };
  } else {
    return; // "ask": deixa o terminal perguntar
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: out } }));
}

main().catch(() => {});
