/**
 * Generates stub exports for lib/actions symbols not implemented in demo-actions-handmade.ts
 * Run from repo root: node record-demo-web/scripts/gen-demo-action-stubs.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actionsPath = path.resolve(__dirname, '../../lib/actions.ts');
const handmadePath = path.resolve(__dirname, '../lib/demo-actions-handmade.ts');

const handmadeSrc = fs.existsSync(handmadePath) ? fs.readFileSync(handmadePath, 'utf8') : '';
const handmadeExports = new Set();
for (const m of handmadeSrc.matchAll(/^\s*export\s+async\s+function\s+([a-zA-Z0-9_]+)/gm)) {
  handmadeExports.add(m[1]);
}

const actionsSrc = fs.readFileSync(actionsPath, 'utf8');
const names = new Set();
for (const m of actionsSrc.matchAll(/^export\s+async\s+function\s+([a-zA-Z0-9_]+)/gm)) {
  names.add(m[1]);
}

let out = `'use server';\n\n/** Auto-generated — do not edit by hand (regen with scripts/gen-demo-action-stubs.mjs) */\n\n`;

for (const name of [...names].sort()) {
  if (handmadeExports.has(name)) continue;
  out += `export async function ${name}(..._args: unknown[]): Promise<any> {\n`;
  out += `  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {\n`;
  out += `    console.warn('[record-demo] stub server action:', '${name}');\n`;
  out += `  }\n`;
  out += `  return undefined;\n`;
  out += `}\n\n`;
}

fs.writeFileSync(path.resolve(__dirname, '../lib/demo-actions-stubs.generated.ts'), out);
console.log(`Wrote stubs for ${names.size - handmadeExports.size} symbols (${handmadeExports.size} skipped).`);
