/**
 * Bundle the app into a single self-contained HTML file.
 * Run:  node build.js
 * Output: dist/seed-simulator.html  (double-click to open, no server needed)
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT  = path.join(ROOT, 'dist', 'seed-simulator.html');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// Strip import/export statements and collect the source in dependency order
function stripModule(src) {
  return src
    .replace(/^\s*import\s+.*?;\s*$/gm, '')
    .replace(/^\s*export\s+(default\s+)?/gm, '');
}

const css = read('css/style.css');

const jsParts = [
  read('js/shared/prng.js'),
  read('js/shared/renderer.js'),
  read('js/shared/scanner.js'),
  read('js/shared/ui.js'),
  read('js/games/aviamasters/simulation.js'),
  read('js/games/fifa-masters/simulation.js'),
  read('js/games/registry.js'),
  read('js/app.js'),
];

// Each module uses named exports/imports. We need to namespace them
// so they don't collide once concatenated into a single scope.
// Strategy: wrap each in an IIFE that attaches to a global namespace.

const NS = {
  'js/shared/prng.js':                    'SharedPrng',
  'js/shared/renderer.js':                'SharedRenderer',
  'js/shared/scanner.js':                 'SharedScanner',
  'js/shared/ui.js':                      'SharedUI',
  'js/games/aviamasters/simulation.js':   'GameAviamasters',
  'js/games/fifa-masters/simulation.js':  'GameFifaMasters',
  'js/games/registry.js':                 'GameRegistry',
  'js/app.js':                            'App',
};

const files = Object.keys(NS);

function resolveImports(src, filePath) {
  // Replace: import { Foo, Bar } from './path.js';
  // With:    const { Foo, Bar } = Namespace;
  return src.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;/g, (_, names, fromPath) => {
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(filePath.replace(/\\/g, '/')), fromPath)
    );
    // Find the namespace for this resolved path
    for (const [fp, ns] of Object.entries(NS)) {
      if (resolved === fp || resolved === './' + fp) {
        return `const {${names}} = ${ns};`;
      }
    }
    return `/* unresolved import: ${fromPath} */`;
  }).replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;/g, (_, alias, fromPath) => {
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(filePath.replace(/\\/g, '/')), fromPath)
    );
    for (const [fp, ns] of Object.entries(NS)) {
      if (resolved === fp || resolved === './' + fp) {
        return `const ${alias} = ${ns};`;
      }
    }
    return `/* unresolved import: ${fromPath} */`;
  });
}

function wrapModule(src, filePath) {
  const ns = NS[filePath];
  let processed = resolveImports(src, filePath);
  // Convert exports to assignments on the namespace object
  // export function foo() → function foo()   (then assigned below)
  // export const foo = ... → const foo = ...
  // export { foo }; → (handled by collecting)
  const exportedNames = [];

  // Collect `export { Name }` and `export { Name };`
  processed = processed.replace(/export\s*\{([^}]+)\}\s*;?/g, (_, names) => {
    names.split(',').forEach(n => exportedNames.push(n.trim()));
    return '';
  });

  // export function / export async function
  processed = processed.replace(/export\s+(async\s+)?function\s+(\w+)/g, (_, async_, name) => {
    exportedNames.push(name);
    return `${async_ || ''}function ${name}`;
  });

  // export const / export let
  processed = processed.replace(/export\s+(const|let)\s+(\w+)/g, (_, kind, name) => {
    exportedNames.push(name);
    return `${kind} ${name}`;
  });

  // export class
  processed = processed.replace(/export\s+class\s+(\w+)/g, (_, name) => {
    exportedNames.push(name);
    return `class ${name}`;
  });

  const assignments = exportedNames
    .map(n => `  ${ns}.${n} = ${n};`)
    .join('\n');

  return `// ── ${filePath} ──\nconst ${ns} = {};\n(function() {\n${processed}\n${assignments}\n})();\n`;
}

let bundledJs = '';
for (const fp of files) {
  const src = read(fp);
  if (fp === 'js/app.js') {
    // App is special — it runs immediately, not wrapped for export
    bundledJs += `// ── ${fp} ──\n(function() {\n${resolveImports(src, fp).replace(/export\s+/g, '')}\n})();\n`;
  } else {
    bundledJs += wrapModule(src, fp) + '\n';
  }
}

const html = read('index.html');
const bundledHtml = html
  .replace(/<link\s+rel="stylesheet"\s+href="css\/style\.css"\s*>/, `<style>\n${css}\n</style>`)
  .replace(/<script\s+type="module"\s+src="js\/app\.js"\s*><\/script>/, `<script>\n${bundledJs}\n</script>`);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(OUT, bundledHtml, 'utf-8');

console.log(`Bundled → ${OUT} (${(Buffer.byteLength(bundledHtml) / 1024).toFixed(1)} KB)`);
