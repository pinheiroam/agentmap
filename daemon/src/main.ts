import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClaudeCollector, claudeAgentId, summarizeTool } from './collectors/claude.ts';
import { CodexCollector } from './collectors/codex.ts';
import { CursorCollector } from './collectors/cursor.ts';
import { config, loadToken } from './config.ts';
import { Ledger } from './ledger.ts';
import { Store } from './store.ts';
import type { Approval, ClientMessage, Decision, ServerMessage } from './types.ts';

const store = new Store();
const token = loadToken();
const claude = new ClaudeCollector(store);
const codex = new CodexCollector(store);
const cursor = new CursorCollector(store);
const ledger = new Ledger();

// ---------- coleta ----------

let busy = false;
let cycle = 0;
async function poll() {
  if (busy) return;
  busy = true;
  try {
    if (cycle % 2 === 0) await claude.readRegistry();
    if (cycle % 5 === 0) await Promise.all([claude.scan(), codex.scan(), cursor.scan()]);
    await Promise.all([claude.read(), codex.read(), cursor.read()]);
    store.tick();
  } catch (err) {
    console.error('[agentmap] erro na coleta:', err);
  } finally {
    cycle++;
    busy = false;
  }
}

// ---------- HTTP ----------

const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Bloqueia DNS rebinding e requisições de outros sites: só aceita localhost. */
function isLocal(req: IncomingMessage) {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (host !== 'localhost' && host !== '127.0.0.1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('corpo grande demais');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  if (!isLocal(req)) return json(res, 403, { error: 'forbidden' });
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/hooks/claude/permission') {
    if (req.headers['x-agentmap-token'] !== token) return json(res, 401, { error: 'token inválido' });
    return handleClaudePermission(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/agents') return json(res, 200, store.list());
  if (req.method === 'GET' && url.pathname === '/api/save') {
    const day = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="agentmap-save-${day}.json"`,
    });
    return res.end(JSON.stringify(ledger.exportSave(), null, 1));
  }
  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      return json(res, 200, await ledger.importSave(await readBody(req, 200 * 1024 * 1024)));
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, clients: wss.clients.size });

  // Arquivos estáticos da UI (web/dist).
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || !extname(path)) path = '/index.html';
  try {
    const body = await readFile(join(webDist, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('UI não encontrada. Rode `npm run build` (ou use `npm run dev`).');
  }
});

/**
 * Chamado pelo hook PermissionRequest do Claude Code. Segura a resposta até
 * alguém decidir na UI. Sem UI aberta, devolve "ask" na hora para o terminal
 * mostrar o prompt normal.
 */
async function handleClaudePermission(req: IncomingMessage, res: ServerResponse) {
  const input = await readBody(req).catch(() => ({}));
  if (wss.clients.size === 0) return json(res, 200, { decision: 'ask' });

  const sessionId = String(input.session_id ?? '');
  const subId = input.agent_id ? `${claudeAgentId(sessionId)}/${input.agent_id}` : undefined;
  const approval: Approval = {
    id: randomUUID(),
    provider: 'claude',
    agentId: subId && store.has(subId) ? subId : claudeAgentId(sessionId),
    tool: String(input.tool_name ?? '?'),
    summary: summarizeTool(input.tool_name, input.tool_input),
    input: input.tool_input,
    cwd: input.cwd,
    createdAt: Date.now(),
    canAlwaysAllow: Array.isArray(input.permission_suggestions) && input.permission_suggestions.length > 0,
  };
  // Se o hook desistir (timeout ou usuário respondeu no terminal), retira o pedido.
  res.on('close', () => {
    if (!res.writableFinished) store.resolveApproval(approval.id, 'ask');
  });
  const { decision, message } = await store.requestApproval(approval);
  if (!res.writableEnded) {
    json(res, 200, {
      decision,
      message,
      updatedPermissions: decision === 'allow_always' ? input.permission_suggestions : undefined,
    });
  }
}

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true });
const subscriptions = new Map<WebSocket, string | null>();

server.on('upgrade', (req, socket, head) => {
  if (!isLocal(req) || new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMessage) {
  for (const ws of wss.clients) send(ws, msg);
}

const DECISIONS: Decision[] = ['allow', 'allow_always', 'deny', 'ask'];

wss.on('connection', (ws) => {
  subscriptions.set(ws, null);
  send(ws, { type: 'snapshot', agents: store.list(), approvals: store.listApprovals() });
  send(ws, { type: 'progress', progress: progress() });
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'subscribe') {
      subscriptions.set(ws, msg.agentId);
      if (msg.agentId) send(ws, { type: 'events', agentId: msg.agentId, events: store.events(msg.agentId), reset: true });
    } else if (msg.type === 'decide' && DECISIONS.includes(msg.decision)) {
      store.resolveApproval(msg.id, msg.decision, msg.message?.slice(0, 2000));
    }
  });
  ws.on('close', () => subscriptions.delete(ws));
});

store.on('agents', (agents, removed) => broadcast({ type: 'agents', agents, removed }));
store.on('events', (agentId: string, events) => {
  for (const [ws, sub] of subscriptions) if (sub === agentId) send(ws, { type: 'events', agentId, events, reset: false });
});
store.on('approval', (approval: Approval) => {
  broadcast({ type: 'approval', approval });
  store.tick();
});
store.on('approvalResolved', (id: string) => {
  // Atualiza o status do agente antes de avisar a UI, para ela nunca ver "waiting" sem aprovação.
  store.tick();
  broadcast({ type: 'approvalResolved', id });
});

// ---------- progressão (tokens) ----------

function progress() {
  return ledger.summary(new Set(store.list().map((a) => a.id)));
}
let progressTimer: ReturnType<typeof setTimeout> | undefined;
function broadcastProgress() {
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => broadcast({ type: 'progress', progress: progress() }), 300);
}
ledger.on('change', broadcastProgress);
ledger.on('progress', broadcastProgress);

async function scanLedger() {
  try {
    await ledger.scan();
  } catch (err) {
    console.error('[agentmap] erro no livro-razão de tokens:', err);
  }
}

// ---------- start ----------

await poll();
setInterval(poll, 1000);
await ledger.load();
const t0 = Date.now();
scanLedger().then(() => {
  console.log(`[agentmap] histórico de tokens pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  ledger.backup().catch((err) => console.error('[agentmap] backup falhou:', err));
});
setInterval(scanLedger, 5000);
setInterval(() => ledger.backup().catch(() => {}), 6 * 3600_000);
server.listen(config.port, config.host, () => {
  console.log(`agentmap rodando em http://localhost:${config.port}  (${store.list().length} agentes carregados)`);
});
