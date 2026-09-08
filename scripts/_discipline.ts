/**
 * The `// discipline: <rule> <reason>` waiver convention, defined once.
 *
 * Every homegrown guard ships with an escape hatch, because a rule with no way out
 * gets bypassed wholesale the first time it is wrong. The reason is MANDATORY: a
 * bare marker is not a waiver. Exceptions are visible and argued in review rather
 * than silently accumulated. Third-party tools keep their own native ratchets
 * (eslint overrides, dependency-cruiser exceptions). SQL files use `-- discipline:`.
 */

const patterns = new Map<string, RegExp>();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiled pattern for `// discipline: <rule> <reason>` (also `--`, `#`, `/*`). */
export function waiverPattern(rule: string): RegExp {
  let pattern = patterns.get(rule);
  if (pattern === undefined) {
    pattern = new RegExp(
      `(?://|--|#|/\\*)\\s*discipline:\\s*${escapeRegExp(rule)}\\b(?<reason>[^*]*)`,
    );
    patterns.set(rule, pattern);
  }
  return pattern;
}

/** True if `line` carries a waiver for `rule` with a non-empty reason. */
export function lineHasReasonedWaiver(line: string, rule: string): boolean {
  const match = waiverPattern(rule).exec(line);
  return match?.groups?.reason !== undefined && match.groups.reason.trim() !== '';
}

/** True if any line of `text` carries a justified waiver for `rule`. */
export function textHasReasonedWaiver(text: string, rule: string): boolean {
  return text.split('\n').some((line) => lineHasReasonedWaiver(line, rule));
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('--') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

/** Waiver on the statement's own lines or the contiguous comment block above it (1-indexed). */
export function statementHasReasonedWaiver(
  lines: readonly string[],
  first: number,
  last: number,
  rule: string,
): boolean {
  for (let i = first; i <= last; i += 1) {
    const line = lines[i - 1];
    if (line !== undefined && lineHasReasonedWaiver(line, rule)) {
      return true;
    }
  }
  let i = first - 1;
  while (i >= 1) {
    const line = lines[i - 1];
    if (line === undefined || !isCommentLine(line)) {
      break;
    }
    if (lineHasReasonedWaiver(line, rule)) {
      return true;
    }
    i -= 1;
  }
  return false;
}
