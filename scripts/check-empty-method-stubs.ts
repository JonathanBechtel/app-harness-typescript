/**
 * Disallow empty method bodies in concrete classes (EMPTY001).
 *
 * An empty override silently swallows the behaviour it replaced. `abstract`
 * members, overload signatures, and constructors whose only job is parameter
 * properties (`constructor(private readonly x: T) {}`) are exempt; so is a body
 * that holds a comment (that is documented intent, not a stub).
 */

import path from 'node:path';

import ts from 'typescript';

import { lineOf, parseSource, walk } from './_ast.js';
import {
  displayPath,
  gitTrackedFiles,
  isFile,
  isMain,
  readText,
  REPO,
  runCli,
} from './_check-runner.js';

type Member =
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isMember(node: ts.ClassElement): node is Member {
  return (
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isAbstract(member: Member): boolean {
  // ModifierFlags is a bit set.
  return (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Abstract) !== 0;
}

function hasParameterProperties(member: Member): boolean {
  return (
    ts.isConstructorDeclaration(member) &&
    member.parameters.some((p) => p.modifiers !== undefined && p.modifiers.length > 0)
  );
}

function bodyHasComment(source: ts.SourceFile, body: ts.Block): boolean {
  const inner = source.text.slice(body.getStart(source) + 1, body.getEnd() - 1);
  return inner.includes('//') || inner.includes('/*');
}

function isStub(source: ts.SourceFile, member: Member): boolean {
  if (member.body === undefined || member.body.statements.length > 0) {
    return false;
  }
  return (
    !isAbstract(member) && !hasParameterProperties(member) && !bodyHasComment(source, member.body)
  );
}

function memberName(member: Member): string {
  if (ts.isConstructorDeclaration(member)) {
    return 'constructor';
  }
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
    ? member.name.text
    : member.name.getText();
}

/** Violations in one file. */
export function checkFile(file: string): string[] {
  const source = parseSource(file, readText(file));
  const display = displayPath(file);
  const out: string[] = [];
  for (const node of walk(source)) {
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) {
      continue;
    }
    const className = node.name?.text ?? '<anonymous>';
    for (const member of node.members) {
      if (isMember(member) && isStub(source, member)) {
        out.push(
          `${display}:${lineOf(source, member)}: EMPTY001 ${className}.${memberName(member)} has an empty body`,
        );
      }
    }
  }
  return out;
}

/** Violations for the given paths. */
export function checkPaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of paths) {
    if (file.endsWith('.ts') && isFile(file)) {
      out.push(...checkFile(file));
    }
  }
  return out;
}

/** Violations across app/ and tests/. */
export function checkAll(): string[] {
  const files = gitTrackedFiles(/^(app|tests)\//);
  if (files.length === 0) {
    throw new Error('no files matched app|tests -- guard would pass vacuously');
  }
  return checkPaths(files.map((f) => path.join(REPO, f)));
}

export function main(argv: readonly string[]): number {
  return runCli(argv, {
    checkAll,
    checkPaths,
    label: 'Empty method stubs',
    scriptPath: import.meta.filename,
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(1));
}
