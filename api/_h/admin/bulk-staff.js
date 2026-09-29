// POST /api/admin/bulk-staff
//   { slug, csv_text, preview?:true }
// Columns (case-insensitive): Name, Role (waiter|manager|kitchen), PIN (optional, 4-6 digits).
// An empty PIN cell gets a random unused 4-digit PIN. Max 50 data rows per import.
// Bad rows are SKIPPED with a message; good rows still go through.
// preview:true -> { parsed:[{row,name,role,pin,pin_generated,warnings}], errors:[] } (no writes; generated PINs are
//                 not shown because the real ones are drawn again at commit time)
// otherwise    -> { count, created:[{name,role,pin,pin_generated}], errors:[] }. This is the ONLY time PINs are
//                 readable: they are stored hashed and never written to the audit log.
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';
import { parseCsv } from './bulk-import.js';

export const MAX_ROWS = 50;
const MAX_CSV_CHARS = 100000;
const ROLES = new Set(['waiter', 'manager', 'kitchen']);
// Same scheme as admin/staff.js and staff/login.js: sha256(pin + ':' + restaurant_id).
const hashPin = (pin, rid) => crypto.createHash('sha256').update(String(pin) + ':' + rid).digest('hex');
const WEAK = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321']);

// Pure parse/validate step (exported for tests).
//   ctx.names:   Set of lowercased staff names already in the restaurant
//   ctx.pinTaken(pin) -> boolean, true when an existing staff member already uses it
export function analyse(csv_text, ctx = {}) {
  const errors = [], parsed = [];
  const names = new Set(ctx.names || []);
  const pinTaken = ctx.pinTaken || (() => false);
  const table = parseCsv(String(csv_text || '').replace(/^﻿/, ''));
  if (!table.length) { errors.push('CSV is empty'); return { parsed, errors }; }
  const header = table[0].map(h => String(h).replace(/^﻿/, '').trim().toLowerCase());
  const col = { name: header.indexOf('name'), role: header.indexOf('role'), pin: header.indexOf('pin') };
  if (col.name < 0) errors.push('Missing required column: Name');
  if (col.role < 0) errors.push('Missing required column: Role');
  if (errors.length) return { parsed, errors };
  let body = table.slice(1);
  if (!body.length) { errors.push('No data rows under the header'); return { parsed, errors }; }
  if (body.length > MAX_ROWS) {
    errors.push(`Too many rows (${body.length}); max ${MAX_ROWS} per import. Only the first ${MAX_ROWS} are used.`);
    body = body.slice(0, MAX_ROWS);
  }
  const usedPins = new Set();
  const seenNames = new Set();
  const genPin = () => {
    for (let tries = 0; tries < 400; tries++) {
      const p = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      if (WEAK.has(p) || usedPins.has(p) || pinTaken(p)) continue;
      return p;
    }
    return null;
  };
  body.forEach((r, i) => {
    const row = i + 2;
    const get = k => col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).replace(/[\u0000-\u001f]/g, ' ').trim() : '';
    const warnings = [];
    const name = get('name').replace(/\s+/g, ' ').slice(0, 60);
    if (!name) { errors.push(`Row ${row}: name is empty, skipped`); return; }
    const key = name.toLowerCase();
    if (seenNames.has(key)) { errors.push(`Row ${row} (${name}): name appears twice in the file, skipped`); return; }
    if (names.has(key)) { errors.push(`Row ${row} (${name}): a staff member with this name already exists, skipped`); return; }

    let role = get('role').toLowerCase();
    if (!role) { role = 'waiter'; warnings.push('No role given, using waiter'); }
    else if (!ROLES.has(role)) { errors.push(`Row ${row} (${name}): role "${get('role')}" must be waiter, manager or kitchen, skipped`); return; }

    // Spreadsheets sometimes wrap PINs as ="1234" or '1234
    let pin = get('pin').replace(/^=?["']+|["']+$/g, '').replace(/\s/g, '');
    let generated = false;
    if (pin === '') {
      pin = genPin();
      if (!pin) { errors.push(`Row ${row} (${name}): could not find a free PIN, skipped`); return; }
      generated = true;
    } else {
      if (!/^\d{4,6}$/.test(pin)) {
        errors.push(`Row ${row} (${name}): PIN "${pin}" must be 4-6 digits (spreadsheets drop leading zeros: format the column as text), skipped`);
        return;
      }
      if (usedPins.has(pin)) { errors.push(`Row ${row} (${name}): PIN clashes with another row in the file, skipped`); return; }
      if (pinTaken(pin)) { errors.push(`Row ${row} (${name}): that PIN is already used by another staff member, skipped`); return; }
    }
    usedPins.add(pin);
    seenNames.add(key);
    parsed.push({ row, name, role, pin, pin_generated: generated, warnings });
  });
  return { parsed, errors };
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  body = body || {};
  const slug = body.slug || req.query.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (typeof body.csv_text !== 'string' || !body.csv_text.trim()) return res.status(400).json({ error: 'csv_text required' });
  if (body.csv_text.length > MAX_CSV_CHARS) return res.status(400).json({ error: 'CSV too large' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const { data: existing = [], error: exErr } = await supabase.from('staff').select('name, pin_hash').eq('restaurant_id', r.id);
  if (exErr) return res.status(502).json({ error: 'Could not read current staff, try again' });
  const pinHashes = new Set((existing || []).map(x => x.pin_hash));
  const names = new Set((existing || []).map(x => String(x.name || '').trim().toLowerCase()));
  const ctx = { names, pinTaken: pin => pinHashes.has(hashPin(pin, r.id)) };
  const { parsed, errors } = analyse(body.csv_text, ctx);

  if (body.preview) {
    return res.status(200).json({
      parsed: parsed.map(p => ({ row: p.row, name: p.name, role: p.role, pin: p.pin_generated ? null : p.pin, pin_generated: p.pin_generated, warnings: p.warnings })),
      errors
    });
  }
  if (!parsed.length) return res.status(400).json({ error: 'No valid rows to import', errors });

  const created = [], failed = [...errors];
  for (const p of parsed) {
    const { error } = await supabaseAdmin.from('staff').insert({
      restaurant_id: r.id, name: p.name, pin_hash: hashPin(p.pin, r.id), role: p.role
    }).select('id').single();
    if (error) {
      failed.push(`Row ${p.row} (${p.name}): ${/duplicate|unique/i.test(error.message || '') ? 'name or PIN already exists' : error.message}, skipped`);
      continue;
    }
    created.push({ name: p.name, role: p.role, pin: p.pin, pin_generated: p.pin_generated });
  }
  // PINs are deliberately absent from the audit trail.
  auditLog(req, r.id, 'bulk_staff', {
    target: slug,
    metadata: { created: created.length, skipped: failed.length, names: created.map(c => c.name).slice(0, 50) }
  }).catch(() => {});
  if (!created.length) return res.status(400).json({ error: 'No staff were created', errors: failed });
  return res.status(200).json({ count: created.length, created, errors: failed });
}
