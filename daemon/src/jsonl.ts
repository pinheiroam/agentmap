import { open, stat } from 'node:fs/promises';
import { config } from './config.ts';

/**
 * Lê um arquivo JSONL de forma incremental: cada chamada a `read()` devolve só
 * as linhas novas desde a última leitura. Arquivos muito grandes começam a ser
 * lidos perto do final, mas a primeira linha (cabeçalho) é sempre entregue.
 */
export class JsonlTail {
  readonly path: string;
  private offset = -1;
  private partial = '';
  mtimeMs = 0;
  size = 0;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<unknown[]> {
    let st;
    try {
      st = await stat(this.path);
    } catch {
      return [];
    }
    this.mtimeMs = st.mtimeMs;
    if (st.size === this.size && this.offset >= 0) return [];
    if (st.size < this.size) {
      // Arquivo truncado ou reescrito: recomeça.
      this.offset = -1;
      this.partial = '';
    }
    this.size = st.size;

    const fh = await open(this.path, 'r');
    try {
      const out: unknown[] = [];
      if (this.offset < 0) {
        this.offset = 0;
        if (st.size > config.maxInitialRead) {
          const head = await readChunk(fh, 0, 256 * 1024);
          const firstLine = head.split('\n', 1)[0];
          pushLine(out, firstLine);
          this.offset = st.size - config.maxInitialRead;
          this.partial = '';
          const tail = await readChunk(fh, this.offset, st.size - this.offset);
          // Descarta a linha cortada no início do trecho.
          return out.concat(this.consume(tail.slice(tail.indexOf('\n') + 1), st.size));
        }
      }
      const text = await readChunk(fh, this.offset, st.size - this.offset);
      return out.concat(this.consume(text, st.size));
    } finally {
      await fh.close();
    }
  }

  private consume(text: string, end: number): unknown[] {
    this.offset = end;
    const lines = (this.partial + text).split('\n');
    this.partial = lines.pop() ?? '';
    const out: unknown[] = [];
    for (const line of lines) pushLine(out, line);
    return out;
  }
}

async function readChunk(fh: import('node:fs/promises').FileHandle, position: number, length: number) {
  if (length <= 0) return '';
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead).toString('utf8');
}

function pushLine(out: unknown[], line: string) {
  if (!line.trim()) return;
  try {
    out.push(JSON.parse(line));
  } catch {
    // Linha corrompida ou incompleta: ignora.
  }
}
