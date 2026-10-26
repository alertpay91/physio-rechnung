import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DICT } from '../js/i18n.js';

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.js') ? [join(dir, d.name)] : []));
const src = files('js').map((f) => readFileSync(f, 'utf8')).join('\n');

test('svi ključevi iz koda postoje na oba jezika', () => {
  const used = new Set([...src.matchAll(/\bt\('([a-z0-9_]+)'/g)].map((m) => m[1]));
  // ključevi provera iz model.js (E('v_...') / W('v_...'))
  for (const m of src.matchAll(/\b[EW]\('(v_[a-z_]+)'/g)) used.add(m[1]);
  for (const k of ['pw_short', 'pw_simple', 'pw_common', 'gh_token_invalid', 'gh_repo_notfound', 'gh_repo_public', 'gh_no_write', 'msg_pw_changed']) used.add(k);
  for (const s of ['draft', 'final', 'sent', 'paid', 'cancelled', 'storno']) used.add('st_' + s);
  for (const s of ['selbstzahler', 'pkv', 'beihilfe', 'gkv']) used.add('ins_' + s);
  for (const s of ['idle', 'busy', 'ok', 'error', 'pending']) used.add('sync_' + s);
  for (const s of ['new', 'pending', 'saving', 'saved', 'error']) used.add('ds_' + s);
  const prefixes = new Set(['ds_', 'err_', 'ins_', 'snap_', 'st_', 'sync_']);
  for (const k of used) {
    if (prefixes.has(k)) continue;
    assert.ok(k in DICT.de, 'DE nedostaje: ' + k);
    assert.ok(k in DICT.sr, 'SR nedostaje: ' + k);
  }
});

test('DE i SR imaju iste ključeve i iste {parametre}', () => {
  assert.deepEqual(Object.keys(DICT.sr).sort(), Object.keys(DICT.de).sort());
  for (const k of Object.keys(DICT.de)) {
    if (typeof DICT.de[k] !== 'string') continue;
    const p = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(p(DICT.sr[k]), p(DICT.de[k]), 'parametri: ' + k);
  }
});
