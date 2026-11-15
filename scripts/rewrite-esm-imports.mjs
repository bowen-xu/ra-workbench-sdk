import fs from 'node:fs/promises';
import path from 'node:path';

/** Emit portable ESM specifiers while retaining the original source syntax. */
export async function rewriteEsmImports(directory, ts) {
  async function visit(file) {
    const source = await fs.readFile(file, 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const literals = [];
    function collect(node) {
      if (ts.isStringLiteralLike(node) && node.text.startsWith('.')) {
        const parent = node.parent;
        if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
          || ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)
          || ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) literals.push(node);
      }
      ts.forEachChild(node, collect);
    }
    collect(parsed);
    const replacements = [];
    for (const literal of literals) {
      const [specifier, query] = literal.text.split('?');
      const target = path.resolve(path.dirname(file), specifier);
      let suffix;
      if (await fs.stat(target + '.js').then(info => info.isFile(), () => false)) suffix = '.js';
      else if (await fs.stat(path.join(target, 'index.js')).then(info => info.isFile(), () => false)) suffix = '/index.js';
      if (suffix) replacements.push({start: literal.getStart(parsed) + 1, end: literal.end - 1,
        value: specifier + suffix + (query === undefined ? '' : '?' + query)});
    }
    let output = source;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
    }
    if (output !== source) await fs.writeFile(file, output);
  }
  async function walk(current) {
    for (const entry of await fs.readdir(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /(?:\.js|\.d\.ts)$/u.test(entry.name)) await visit(file);
    }
  }
  await walk(directory);
}
