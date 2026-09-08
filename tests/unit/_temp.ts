/** Scratch files for guard meta-tests: seed a violation, run the guard, clean up. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export class Scratch {
  readonly dir: string;

  constructor(prefix: string) {
    this.dir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  }

  /** Write `content` (dedented, leading newline dropped) to `rel` under the scratch dir; returns its path. */
  write(rel: string, content: string): string {
    const file = path.join(this.dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, dedent(content));
    return file;
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Strip the common leading indentation and the first blank line of a template literal. */
export function dedent(text: string): string {
  const lines = text.replace(/^\n/, '').split('\n');
  const indents = lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length);
  const cut = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((l) => l.slice(cut)).join('\n');
}

/** Every line number of `text`, for line-scoped finders. */
export function allLines(text: string): Set<number> {
  return new Set(Array.from({ length: text.split('\n').length }, (_, i) => i + 1));
}
