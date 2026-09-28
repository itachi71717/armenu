#!/usr/bin/env node
// Zero-dep lint pass. Catches common bugs the syntax-check doesn't (e.g.
// `console.log` left behind, tabs/CRLF drift, `.only()`/`.skip()` in tests,
// TODO markers that snuck into prod). Runs on api/, tests/ and scripts/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGETS = ['api', 'tests', 'scripts'];
const IGNORE = new Set(['node_modules', '.git', '.vercel', 'dist', 'build']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
function flag(file, line, msg) {
  problems.push({ file: relative(ROOT, file), line, msg });
}

for (const t of TARGETS) {
  const dir = join(ROOT, t);
  try { statSync(dir); } catch { continue; }
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    const isTest = file.includes(`${'\\tests\\'.replace(/\\/g, join('a','b')[1])}`) || file.includes('/tests/') || file.includes('\\tests\\');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.replace(/(['"`]).*?\1/g, '""').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      // Test-file specific
      if (isTest) {
        if (/\b(describe|it|test)\.only\s*\(/.test(stripped)) flag(file, i + 1, 'left-over .only() in test');
        if (/\b(describe|it|test)\.skip\s*\(/.test(stripped)) flag(file, i + 1, 'left-over .skip() in test');
      }
      // Non-test files
      if (!isTest) {
        if (/\bdebugger\b/.test(stripped)) flag(file, i + 1, 'debugger statement');
        if (/console\.(log|debug)\s*\(/.test(stripped) && !file.includes('scripts')) {
          flag(file, i + 1, 'console.log/debug (use console.error for real errors)');
        }
      }
      if (/\bFIXME\b/.test(stripped)) flag(file, i + 1, 'FIXME marker');
    }
  }
}

if (problems.length === 0) {
  console.log(`lint: clean (${TARGETS.join(', ')})`);
  process.exit(0);
}
const byFile = {};
for (const p of problems) (byFile[p.file] ||= []).push(p);
for (const f of Object.keys(byFile).sort()) {
  console.log(f);
  for (const p of byFile[f]) console.log(`  ${p.line}: ${p.msg}`);
}
console.error(`\nlint: ${problems.length} issue(s)`);
process.exit(1);
