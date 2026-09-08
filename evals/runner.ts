/**
 * Run an eval suite and write a report.
 *
 *     npx tsx evals/runner.ts --suite core [--repetitions N] [--responder module:attr]
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { accuracy, consistency } from './analyzers/index.js';
import type { Dataset } from './datasets/index.js';
import type { Suite } from './suites/index.js';

export type Responder = (question: string) => Promise<string>;
const RESULTS = path.join(import.meta.dirname, 'results');

/** Import `evals/<kind>/<name>` whether it is on disk as .ts (tsx, vitest) or .js. */
async function importEval<T>(kind: 'datasets' | 'suites', name: string): Promise<T> {
  const base = path.join(import.meta.dirname, kind, name);
  const file = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.js`;
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as T;
}

/** Credential-free responder using the app's FakeModelClient (echo). */
export async function defaultResponder(question: string): Promise<string> {
  const { FakeModelClient } = await import('../app/ai/client.js');
  const result = await new FakeModelClient().complete({
    role: 'eval',
    system: '',
    prompt: question,
  });
  return result.text;
}

export async function loadResponder(spec: string | undefined): Promise<Responder> {
  if (spec === undefined || spec === '') {
    return defaultResponder;
  }
  const [moduleName, attr] = spec.split(':', 2);
  const target =
    moduleName === undefined
      ? ''
      : moduleName.startsWith('.') || path.isAbsolute(moduleName)
        ? pathToFileURL(path.resolve(moduleName)).href
        : moduleName;
  const mod = (await import(target)) as Record<string, Responder>;
  const fn = mod[attr ?? 'default'];
  if (fn === undefined) {
    throw new Error(`responder ${spec} not found`);
  }
  return fn;
}

export interface DatasetResult {
  readonly dataset: string;
  readonly accuracy: number;
  readonly consistency: number;
  readonly questions: readonly { id: string; accuracy: number; consistency: number }[];
}

export async function runDataset(
  name: string,
  responder: Responder,
  repetitions: number,
): Promise<DatasetResult> {
  const ds = await importEval<Dataset>('datasets', name);
  const questions = [];
  for (const q of ds.QUESTIONS) {
    const scores: number[] = [];
    for (let i = 0; i < repetitions; i += 1) {
      scores.push(ds.score(await responder(q.question), q.expected));
    }
    questions.push({ id: q.id, accuracy: accuracy(scores), consistency: consistency(scores) });
  }
  return {
    dataset: name,
    accuracy: accuracy(questions.map((q) => q.accuracy)),
    consistency: accuracy(questions.map((q) => q.consistency)),
    questions,
  };
}

export interface SuiteReport {
  readonly suite: string;
  readonly ranAt: string;
  readonly repetitions: number;
  readonly score: number;
  readonly passed: boolean;
  readonly failedDatasets: readonly string[];
  readonly datasets: readonly DatasetResult[];
}

export async function runSuite(
  suiteName: string,
  repetitions: number | undefined,
  responder: Responder,
): Promise<SuiteReport> {
  const { SUITE: suite } = await importEval<{ SUITE: Suite }>('suites', suiteName);
  const reps = repetitions ?? suite.repetitions;
  const results: DatasetResult[] = [];
  for (const name of Object.keys(suite.datasets)) {
    results.push(await runDataset(name, responder, reps));
  }
  const totalWeight = Object.values(suite.datasets).reduce((a, b) => a + b, 0);
  const score =
    results.reduce((sum, r) => sum + r.accuracy * (suite.datasets[r.dataset] ?? 0), 0) /
    totalWeight;
  const failed = results.filter((r) => r.accuracy < suite.minDatasetAccuracy).map((r) => r.dataset);
  return {
    suite: suite.name,
    ranAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    repetitions: reps,
    score: Math.round(score * 10_000) / 10_000,
    passed: score >= suite.minScore && failed.length === 0,
    failedDatasets: failed,
    datasets: results,
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      suite: { type: 'string', default: 'core' },
      repetitions: { type: 'string' },
      responder: { type: 'string' },
    },
  });
  const report = await runSuite(
    values.suite,
    values.repetitions === undefined ? undefined : Number(values.repetitions),
    await loadResponder(values.responder),
  );
  mkdirSync(RESULTS, { recursive: true });
  const out = path.join(RESULTS, `${report.suite}-${report.ranAt.replaceAll(':', '')}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`suite=${report.suite} score=${report.score} passed=${report.passed} -> ${out}`);
  return report.passed ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
