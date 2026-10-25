import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const gamesDir = path.resolve(process.cwd(), 'src/os/arcade/games');

function startsWithRootClass(value: ts.Expression | undefined, rootClass: string): boolean {
  let text: string | undefined;
  if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
    text = value.text;
  } else if (value && ts.isJsxExpression(value) && value.expression) {
    const expression = value.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) text = expression.text;
    else if (ts.isTemplateExpression(expression)) text = expression.head.text;
  }
  return text === rootClass || text?.startsWith(`${rootClass} `) === true;
}

test('game root classes stay on GameShell and arcade overlays keep their defaults', () => {
  const files = readdirSync(gamesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(gamesDir, entry.name, 'index.tsx'))
    .filter((file) => {
      try {
        return readFileSync(file, 'utf8') !== undefined;
      } catch {
        return false;
      }
    });

  const collisions: string[] = [];
  for (const file of files) {
    const id = path.basename(path.dirname(file));
    const rootClass = `g-${id}`;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const isGameShell = ts.isIdentifier(opening.tagName) && opening.tagName.text === 'GameShell';
        if (!isGameShell) {
          const className = opening.attributes.properties.find(
            (attribute) => ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'className',
          );
          if (className && ts.isJsxAttribute(className) && startsWithRootClass(className.initializer, rootClass)) {
            const { line } = source.getLineAndCharacterOfPosition(className.getStart(source));
            collisions.push(`${path.relative(process.cwd(), file)}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(collisions, [], `root classes also appear on inner elements:\n${collisions.join('\n')}`);

  const css = readFileSync(path.resolve(process.cwd(), 'src/os/arcade/kit/kit.css'), 'utf8');
  const overlay = css.match(/\.arcade-ov\s*\{([^}]*)\}/);
  const players = css.match(/\.arcade-online-players\s*\{([^}]*)\}/);
  assert.ok(overlay, 'missing .arcade-ov rule');
  assert.ok(players, 'missing .arcade-online-players rule');
  assert.match(overlay[1], /\bcolor\s*:/, '.arcade-ov must declare color');
  assert.match(players[1], /\bflex\s*:\s*none\s*;/, '.arcade-online-players must not shrink');
});
