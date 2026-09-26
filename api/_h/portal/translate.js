// POST /api/portal/translate  { name, description?, target_langs: ['af','zu','xh'] }
// Manager-only. Uses Claude to translate a dish's name+description into the
// requested SA languages. Cheap (~$0.001 per translation) — counted against
// the AI-menu-reader monthly quota so it can't run away.

import { supabase } from '../../_db.js';
import { requireManager } from '../../_auth.js';
import { enforceQuota, logUsage } from '../_quota.js';

const CODE_TO_NAME = { af: 'Afrikaans', zu: 'isiZulu', xh: 'isiXhosa', st: 'Sesotho', tn: 'Setswana', fr: 'French', de: 'German', pt: 'Portuguese', es: 'Spanish', it: 'Italian' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Translation not configured', message: 'ANTHROPIC_API_KEY not set — contact ARMenu support.' });

  const { data: rest } = await supabase.from('restaurants').select('id, name').eq('email', String(auth.email).toLowerCase()).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'no_restaurant_linked' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { name, description, target_langs } = body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const langs = (Array.isArray(target_langs) && target_langs.length ? target_langs : ['af','zu','xh']).filter(l => CODE_TO_NAME[l]);
  if (!langs.length) return res.status(400).json({ error: 'no valid target_langs' });

  // Rate-limit via the AI-menu-reader monthly quota (shares the cheap-Claude budget)
  const gate = await enforceQuota(rest.id, 'ai_menu_reader');
  if (!gate.ok) return res.status(429).json({ error: gate.reason, message: gate.message });

  const prompt = `Translate this South African restaurant dish into the following languages: ${langs.map(l => CODE_TO_NAME[l]).join(', ')}.

Rules:
- Translate the NAME and DESCRIPTION separately.
- Keep proper nouns (Ocean Basket, Karoo, etc.) unchanged.
- Use natural, local phrasing (not literal). Zulu/Xhosa should be Standard, no click marks stripped.
- Keep the same tone (playful vs formal) as the English.
- Output ONLY strict JSON, no prose, no code fences. Shape:
  { "${langs[0]}": { "name": "...", "description": "..." }${langs.length > 1 ? ', ...' : ''} }

DISH NAME: ${name}
DISH DESCRIPTION: ${description || '(no description)'}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Translate service error');
    const text = (data.content?.[0]?.text || '').trim();
    // Strip code fences if the model added them anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { throw new Error('Could not parse translation output'); }

    await logUsage(rest.id, 'ai_menu_reader', 1, { kind: 'translate', langs, name });
    return res.status(200).json({ translations: parsed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
