#!/usr/bin/env node
// Zero-dep syntax check: parse every .js file under api/ + vendor/ using the
// Node CommonJS + ES-module parser. Faster than eslint, catches typos and
// missing brackets. Non-zero exit on any failure.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import vm from 'node:vm';

const ROOTS = ['api', 'scripts', 'tests', 'vendor'];
const IGNORE = new Set(['node_modules', 'models']);
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (extname(full) === '.js' || extname(full) === '.mjs') check(full);
  }
}

function check(path) {
  const src = readFileSync(path, 'utf8');
  try {
    // Wrap as an ES module and let V8 parse (not execute) it.
    new vm.SourceTextModule(src, { identifier: path });
  } catch (e) {
    failures.push({ path, message: e.message });
  }
}

for (const r of ROOTS) {
  try { walk(r); } catch (e) { /* directory may not exist in this checkout */ }
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} syntax error(s):\n`);
  for (const f of failures) console.error(`  ${f.path}\n    ${f.message}\n`);
  process.exit(1);
}
console.log(`✓ syntax OK across api/, scripts/, tests/, vendor/`);
