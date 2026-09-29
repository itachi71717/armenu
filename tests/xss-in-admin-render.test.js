import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Static guard for the master-admin console: every user-controlled value that
// reaches innerHTML must go through escapeHTML(). This is a heuristic scan of
// the inline <script> blocks in admin/index.html. If it fails you either
// forgot to escape (fix the page) or added a genuinely safe expression (add it
// to the allowlists below with a reason).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'admin', 'index.html'), 'utf8');
const js = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ${...} interpolations that are safe without escapeHTML (numbers, dates,
// already-escaped fragments, or values that never reach innerHTML).
const SAFE_TEMPLATE_EXPRS = new Set([
  "v === 'client' ? 'clients' : v",              // view-name selector, not HTML
  'when',                                        // toLocaleString() output
  'actorColor',                                  // hard-coded colour literals
  "e.target ? '<b>' + escapeHTML(e.target) + '</b>' : ''",
  'c.dishes',                                    // integer count
  'c.scans_30d.toLocaleString()',
  'rows',                                        // pre-built rows (escaped where built)
  'link.dataset.qrDownload',                     // a.download filename, not HTML
  'r.slug',                                      // textContent only
  'url.replace(/"/g, \'%22\')',                  // style.backgroundImage, not HTML
  'upRes.status', 'txt.slice(0, 200)',           // toast() -> textContent
  'before', 'after', 'comp.saved_pct', 'comp.sizeWarning', // toast()/confirm()
  'name',                                        // textContent / placeholder property
]);
// Template expressions starting with these are considered safe or are
// structural (nested templates that themselves get scanned recursively).
const SAFE_PREFIX = /^(escapeHTML\(|encodeURIComponent\(|new Date\(|c\.dishes\.map\(|c\.requests\.map\(|list\.map\(|e\.metadata && )/;

const interpolations = [...js.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(m => norm(m[1]));

describe('admin/index.html escapes user-controlled strings', () => {
  it('finds the inline script and escapeHTML helpers', () => {
    expect(js.length).toBeGreaterThan(1000);
    // Two scopes exist: the migration IIFE has its own copy.
    expect((js.match(/function escapeHTML\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('escapeHTML helper neutralises the five HTML-significant characters', () => {
    const m = js.match(/function escapeHTML\(s\)[^\n]*\n/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-new-func
    const fn = new Function(m[0] + '; return escapeHTML;')();
    expect(fn('<img src=x onerror=alert(1)>"\'&')).toBe('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
    expect(fn(null)).toBe('');
    expect(fn(undefined)).toBe('');
    expect(fn(0)).toBe('0');
  });

  it('every ${} interpolation is escaped or on the reviewed-safe list', () => {
    const offenders = interpolations.filter(e => !SAFE_PREFIX.test(e) && !SAFE_TEMPLATE_EXPRS.has(e));
    expect(offenders).toEqual([]);
  });

  it('known user-controlled fields are always wrapped in escapeHTML', () => {
    // Restaurant name/slug, pending-signup fields, audit fields, dish fields.
    const userFields = ['c.name', 'c.slug', 'p.email', 'p.phone', 'p.restaurant_name', 'p.message', 'p.id',
      'e.actor', 'e.action', 'e.ip', 'd.name', 'd.price', 'd.slug', 'd.thumb_url', 'req.message', 'req.status'];
    for (const f of userFields) {
      const bare = interpolations.filter(e => e === f);
      expect(bare, `bare \${${f}} found`).toEqual([]);
    }
  });

  it('innerHTML string concatenation never splices raw variables', () => {
    const SAFE_CONCAT = new Set([
      'j.missing.length',   // integer
      'rowsHtml', 'moreBtn', 'html', // built from escaped parts above
    ]);
    const offenders = [];
    for (const st of js.matchAll(/\.innerHTML\s*=\s*([\s\S]*?);\s*\n/g)) {
      const src = st[1];
      // pull out `+ expr +` fragments that sit between string literals / at the ends
      const parts = src.split(/\s\+\s/).map(norm);
      for (const p of parts) {
        if (/^(['"`]).*\1$/.test(p)) continue;               // pure string literal
        if (/^(['"`])/.test(p) && /(['"`])$/.test(p)) continue;
        if (/^(['"`])/.test(p) || /(['"`])$/.test(p)) continue; // literal with an operator inside, e.g. ternary
        if (/^escapeHTML\(/.test(p)) continue;
        if (SAFE_CONCAT.has(p)) continue;
        if (p === 'origHTML') continue;                       // restores prior markup
        if (/^(actions|c\.dishes|c\.requests|list|j\.missing|o\.clients)\.(map|join)\(/.test(p) || /^j\.missing\.map\(/.test(p)) continue;
        if (/^\)/.test(p)) continue;
        offenders.push(p.slice(0, 80));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never uses document.write / eval / outerHTML on the admin page', () => {
    expect(js).not.toMatch(/document\.write\s*\(/);
    expect(js).not.toMatch(/\beval\s*\(/);
    expect(js).not.toMatch(/\.outerHTML\s*=/);
  });
});
