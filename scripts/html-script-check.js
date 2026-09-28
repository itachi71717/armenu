#!/usr/bin/env node
// Parse (not execute) every inline classic <script> block in every .html file
// so a typo in page JS fails CI instead of silently breaking a page in prod.
// JSON-LD blocks are JSON.parse'd; module scripts are checked as modules.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import vm from 'node:vm';

const IGNORE = new Set(['node_modules', '.git', 'backend', '.vercel']);
const failures = [];
let checked = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (extname(full) === '.html') checkFile(full);
  }
}

function checkFile(path) {
  const html = readFileSync(path, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
    const line = html.slice(0, m.index).split('\n').length;
    checked++;
    try {
      if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) JSON.parse(body);
      else if (/type\s*=\s*["']module["']/i.test(attrs)) new vm.SourceTextModule(body, { identifier: path });
      else new vm.Script(body, { filename: path });
    } catch (e) {
      failures.push(`${path}:${line}  ${e.message}`);
    }
  }
}

walk('.');
if (failures.length) {
  console.error(`✗ ${failures.length} inline script error(s):\n  ` + failures.join('\n  '));
  process.exit(1);
}
console.log(`✓ ${checked} inline <script> blocks parse cleanly`);
