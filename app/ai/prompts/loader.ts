/**
 * Discover and load versioned prompt modules.
 *
 * Each prompt family is a directory `app/ai/prompts/<family>/` holding `v1.ts`,
 * `v2.ts`... modules exposing `VERSION`, `TEMPLATE` and `render(args) -> string`.
 * Adding a version requires no registration: the module is found by name. The
 * active version defaults to the highest; set `PROMPT_<FAMILY>_VERSION=vN` to
 * pin. Bump the version (rather than editing in place) whenever a change alters
 * the tools mentioned, the output format, or the response contract; small
 * wording fixes edit in place.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROMPTS_DIR = import.meta.dirname;
const VERSION_FILE = /^(v\d+)\.(?:ts|js)$/;
const REQUIRED = ['VERSION', 'TEMPLATE', 'render'] as const;

/** What a prompt module must export. */
export interface PromptModule {
  readonly VERSION: string;
  readonly TEMPLATE: string;
  render(args: Record<string, unknown>): string;
}

export class PromptNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptNotFoundError';
  }
}

const cache = new Map<string, Promise<PromptModule>>();

function versionFiles(family: string, dir: string): Map<string, string> {
  const familyDir = path.join(dir, family);
  let entries: string[];
  try {
    if (!statSync(familyDir).isDirectory()) {
      throw new PromptNotFoundError(`no prompt family '${family}'`);
    }
    entries = readdirSync(familyDir);
  } catch (error) {
    if (error instanceof PromptNotFoundError) {
      throw error;
    }
    throw new PromptNotFoundError(`no prompt family '${family}'`);
  }
  const files = new Map<string, string>();
  for (const entry of entries) {
    const match = VERSION_FILE.exec(entry);
    if (match?.[1] !== undefined && !files.has(match[1])) {
      files.set(match[1], path.join(familyDir, entry));
    }
  }
  return files;
}

/** Return the `vN` module names under `app/ai/prompts/<family>`, ascending. */
export function availableVersions(family: string, dir: string = PROMPTS_DIR): string[] {
  return [...versionFiles(family, dir).keys()].sort(
    (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
  );
}

async function importPrompt(family: string, version: string, file: string): Promise<PromptModule> {
  const mod = (await import(pathToFileURL(file).href)) as Partial<PromptModule>;
  for (const attr of REQUIRED) {
    if (mod[attr] === undefined) {
      throw new PromptNotFoundError(`prompt '${family}/${version}' lacks required export ${attr}`);
    }
  }
  return mod as PromptModule;
}

function chooseVersion(family: string, requested: string | undefined, versions: string[]): string {
  const pinned = process.env[`PROMPT_${family.toUpperCase()}_VERSION`]?.trim();
  const chosen =
    requested ?? (pinned === undefined || pinned === '' ? undefined : pinned) ?? versions.at(-1);
  if (chosen === undefined || !versions.includes(chosen)) {
    throw new PromptNotFoundError(
      `prompt '${family}/${chosen ?? '?'}' not found; have ${versions.join(', ')}`,
    );
  }
  return chosen;
}

/** Import the prompt module for `family` at `version` (default: env or latest). */
export function load(
  family: string,
  version?: string,
  dir: string = PROMPTS_DIR,
): Promise<PromptModule> {
  const versions = availableVersions(family, dir);
  if (versions.length === 0) {
    throw new PromptNotFoundError(`prompt family '${family}' has no v<N> modules`);
  }
  const chosen = chooseVersion(family, version, versions);
  const key = `${dir}::${family}/${chosen}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    const file = versionFiles(family, dir).get(chosen);
    if (file === undefined) {
      throw new PromptNotFoundError(`prompt '${family}/${chosen}' not found`);
    }
    pending = importPrompt(family, chosen, file);
    cache.set(key, pending);
  }
  return pending;
}

/** Forget loaded prompts (test isolation). */
export function clearCache(): void {
  cache.clear();
}
