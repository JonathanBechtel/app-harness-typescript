/**
 * Shared AST vocabulary: local-name resolution so an `import { x as y }` cannot switch a guard off.
 *
 * Every AST checker decides whether a call matters by comparing its trailing name
 * against a set of interesting names. TypeScript lets any of those be rebound
 * (`import { delete as sqlDelete }`, `const del = db.delete`), and a guard that an
 * alias can disable is a guard whose coverage depends on import style. Resolve first.
 * Uses the TypeScript compiler API directly: no extra dependency, exact syntax.
 */

import ts from 'typescript';

/** Parse a TypeScript module (no type information; syntax only). */
export function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Pre-order traversal of every node under `root`.
 * @yields {ts.Node} each node, parents before children
 */
export function* walk(root: ts.Node): Generator<ts.Node> {
  const stack: ts.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    const children: ts.Node[] = [];
    node.forEachChild((child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }
}

/** `os.path.join` -> "join"; `Path` -> "Path"; else undefined. */
export function trailingName(node: ts.Node | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  return undefined;
}

/** The identifier at the root of a member chain: `a.b.c()` -> "a". */
export function rootName(node: ts.Node): string | undefined {
  let current: ts.Node = node;
  for (;;) {
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
    } else if (
      ts.isCallExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
    } else if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else {
      return ts.isIdentifier(current) || ts.isThisTypeNode(current) ? current.getText() : undefined;
    }
  }
}

function record(aliases: Map<string, string>, local: string, original: string | undefined): void {
  if (original !== undefined && original !== local) {
    aliases.set(local, original);
  }
}

/** Map each renaming binding in a module to the trailing name it refers to. */
export function moduleAliases(source: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const node of walk(source)) {
    if (ts.isImportSpecifier(node)) {
      record(aliases, node.name.text, node.propertyName?.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      record(aliases, node.name.text, trailingName(node.initializer));
    }
  }
  return aliases;
}

/** Follow `name` through `aliases` (cycle-safe). */
export function resolve(
  name: string | undefined,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  let current = name;
  const seen = new Set<string>();
  while (current !== undefined && aliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = aliases.get(current);
  }
  return current;
}

/** A call's trailing callee name, resolved. */
export function resolvedCallName(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  return resolve(trailingName(call.expression), aliases);
}

/** 1-based line of a node's first token. */
export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** 1-based line of a node's last token. */
export function endLineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

/** Nearest enclosing statement of `node` (or undefined at module level). */
export function statementOf(node: ts.Node): ts.Statement | undefined {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isStatement(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/** Static text of a string-ish expression: literals, templates (static parts), `sql\`...\``, `text(...)`. */
export function stringValue(node: ts.Node | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return stringValue(node.template);
  }
  if (ts.isParenthesizedExpression(node)) {
    return stringValue(node.expression);
  }
  return undefined;
}

/** The module specifier of every import/re-export in `source`. */
export function importedModules(
  source: ts.SourceFile,
): { readonly module: string; readonly node: ts.Node }[] {
  const out: { module: string; node: ts.Node }[] = [];
  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined
    ) {
      const value = stringValue(statement.moduleSpecifier);
      if (value !== undefined) {
        out.push({ module: value, node: statement });
      }
    }
  }
  return out;
}

/** Property of an object literal by key name, if written as a literal. */
export function objectProperty(
  literal: ts.ObjectLiteralExpression,
  key: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  for (const property of literal.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name) === key
    ) {
      return property;
    }
  }
  return undefined;
}

/** Text of a property name node (identifier, string, or numeric literal). */
export function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}
