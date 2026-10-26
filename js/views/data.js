// Podaci i sigurnost: stanje sinhronizacije, istorija verzija, lokalne kopije, izvoz/uvoz, šifra, token.

import * as V from '../vault.js';
import * as M from '../model.js';
import { t, locale } from '../i18n.js';
import { $, on, toast, dialog, confirmBox, busy, download, readFile, icon } from '../ui.js';
import { esc, todayISO } from '../util.js';
import { passwordProblems, WrongPassword } from '../crypto.js';
import { showErr } from './invoices.js';
import { go } from '../app.js';

const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '–');

export async function dataView(view) {
  const st = await V.getState();
  const s = V.status;
  const acc = V.accessInfo();
  const sum = M.summary(V.db());
  const cloud = s.mode === 'cloud';

  view.innerHTML = `<h1>${t('nav_data')}</h1>
    <div class="card"><h2>${icon('cloud')} ${t('sync_title')}</h2>
      ${cloud ? `<p>${t('sync_cloud_info', { r: esc(acc?.repo || '') })}</p>
        <div class="grid-info">
          <div><span>${t('sync_state')}</span><b class="sync-${s.sync}">${t('sync_' + s.sync)}</b></div>
          <div><span>${t('last_sync')}</span>${fmtTs(s.lastSyncAt)}</div>
          <div><span>${t('content')}</span>${t('summary_line', sum)}</div>
        </div>
        ${s.error ? `<p class="hint danger">${t('err_' + s.error) !== 'err_' + s.error ? t('err_' + s.error) : esc(s.error)}</p>` : ''}
        <div class="actions"><button class="btn primary" id="syncNow">${t('sync_now')}</button></div>`
      : `<p class="hint warn">${t('local_only_info')}</p>
        <div class="grid-info"><div><span>${t('content')}</span>${t('summary_line', sum)}</div><div><span>${t('last_export')}</span>${fmtTs(st.lastExportAt)}</div></div>
        <details class="connect"><summary class="btn primary">${t('connect_cloud')}</summary>${connectForm()}</details>`}
    </div>

    ${cloud ? `<div class="card"><h2>${t('versions')}</h2><p class="small muted">${t('versions_hint')}</p><div id="hist"><button class="btn" id="loadHist">${t('show_versions')}</button></div></div>` : ''}

    <div class="card"><h2>${t('local_copies')}</h2><p class="small muted">${t('local_copies_hint')}</p><div id="snaps"><button class="btn" id="loadSnaps">${t('show_local_copies')}</button></div></div>

    <div class="card"><h2>${t('export_title')}</h2><p class="small muted">${t('export_hint')}</p>
      <div class="actions">
        <button class="btn primary" id="expEnc">${icon('download')} ${t('export_enc')}</button>
        <button class="btn" id="expPlain">${t('export_plain')}</button>
        <button class="btn" id="imp">${t('import')}</button>
      </div></div>

    <div class="card"><h2>${icon('lock')} ${t('security')}</h2>
      <div class="actions">
        <button class="btn" id="chPw">${t('change_pw')}</button>
        ${cloud ? `<button class="btn" id="chTok">${t('change_token')}</button>` : ''}
        <button class="btn" id="lockNow">${t('lock_now')}</button>
        <button class="btn danger" id="forget">${t('forget_device')}</button>
      </div>
      ${cloud && acc ? `<p class="small muted">${t('token_set_at', { d: fmtTs(acc.createdAt) })}</p>` : ''}
      <p class="small muted">${t('retention_hint')}</p>
    </div>`;

  $('#syncNow', view) && ($('#syncNow', view).onclick = () => busy(t('syncing'), () => V.syncNow()).then(() => { toast(t('sync_ok')); dataView(view); }).catch((e) => { showErr(e); dataView(view); }));
  if (!cloud) bindConnect(view);

  $('#loadHist', view) && ($('#loadHist', view).onclick = () => loadHistory($('#hist', view), 1));
  $('#loadSnaps', view).onclick = () => loadSnaps($('#snaps', view));

  $('#expEnc', view).onclick = async () => {
    const env = await V.exportEncrypted();
    download(new Blob([JSON.stringify(env)], { type: 'application/json' }), `Physio-Sicherung_${todayISO()}.physio.json`);
    await V.markExported();
    toast(t('export_done'));
  };
  $('#expPlain', view).onclick = async () => {
    if (!(await dialog({ title: t('export_plain'), body: `<p class="hint danger">${t('export_plain_warn')}</p>`, ok: t('export_plain'), danger: true }))) return;
    download(new Blob([JSON.stringify({ format: 'physio-plain', v: 1, exportedAt: new Date().toISOString(), db: V.db() }, null, 1)], { type: 'application/json' }), `Physio-Daten-UNVERSCHLUESSELT_${todayISO()}.json`);
  };
  $('#imp', view).onclick = async () => {
    const file = await readFile('.json,application/json');
    if (!file) return;
    let env;
    try { env = JSON.parse(await file.text()); } catch { toast(t('import_bad'), 'error'); return; }
    await restoreFlow(env, t('import_from', { f: esc(file.name) }), true);
    dataView(view);
  };

  $('#chPw', view).onclick = () => changePw();
  $('#chTok', view) && ($('#chTok', view).onclick = async () => {
    const tok = await dialog({ title: t('change_token'), body: `<p>${t('token_help')}</p>`, input: { label: t('gh_token'), type: 'password' } });
    if (!tok) return;
    await busy(t('checking'), () => V.changeToken(tok)).then(() => toast(t('token_saved'))).catch(showErr);
    dataView(view);
  });
  $('#lockNow', view).onclick = () => V.lock();
  $('#forget', view).onclick = async () => {
    if (cloud && V.status.dirty) { toast(t('forget_unsynced'), 'error'); return; }
    if (!(await dialog({ title: t('forget_device'), body: `<p>${t(cloud ? 'forget_info_cloud' : 'forget_info_local')}</p>`, ok: t('forget_device'), danger: true }))) return;
    if (!cloud && !(await confirmBox(t('forget_local_sure'), { danger: true }))) return;
    const store = await import('../store.js');
    V.lock();
    await store.wipe();
    location.reload();
  };
}

function connectForm() {
  return `<form id="cf" class="stack" autocomplete="off">
    <p class="small">${t('token_help')}</p>
    <label class="field"><span>${t('gh_token')}</span><input type="password" id="cTok" required></label>
    <div class="row"><label class="field grow"><span>${t('data_repo')}</span><input type="text" id="cData" value="${esc(defaultDataRepo())}" required></label>
    <label class="field grow"><span>${t('code_repo')}</span><input type="text" id="cCode" value="${esc(V.codeRepoGuess())}" required></label></div>
    <label class="field"><span>${t('current_pw')}</span><input type="password" id="cPw" autocomplete="current-password" required></label>
    <button class="btn primary" type="submit">${t('connect')}</button></form>`;
}

export function defaultDataRepo() {
  const c = V.codeRepoGuess();
  return c ? c.split('/')[0] + '/physio-rechnung-daten' : '';
}

function bindConnect(view) {
  const f = $('#cf', view);
  if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#cPw', view).value;
    if (!(await V.verifyPassword(pw))) { toast(t('wrong_pw'), 'error'); return; }
    try {
      await busy(t('connecting'), () => V.setupCloud({ password: pw, token: $('#cTok', view).value, dataRepo: $('#cData', view).value.trim(), codeRepo: $('#cCode', view).value.trim() }));
      toast(t('connected'));
      dataView(view);
    } catch (err) { showSetupErr(err); }
  };
}

export function showSetupErr(err) {
  const m = String(err?.message || err);
  const [k, arg] = m.split(':');
  if (err instanceof WrongPassword) toast(t('wrong_pw_remote'), 'error');
  else if (k.startsWith('gh_')) toast(t(k, { r: arg || '' }), 'error');
  else showErr(err);
}

async function loadHistory(el, page) {
  try {
    const list = await busy(t('loading'), () => V.history(page));
    el.innerHTML = `<div class="versions">${list.map((c) => `<div class="li"><div class="a"><b>${fmtTs(c.date)}</b><span class="small muted">${esc(c.message.split('\n')[0])}</span></div><div class="b"><button class="btn sm" data-sha="${c.sha}">${t('view_restore')}</button></div></div>`).join('') || `<div class="empty">${t('no_versions')}</div>`}</div>
      ${list.length === 50 ? `<button class="btn sm" id="more">${t('older')}</button>` : ''}`;
    on(el, '[data-sha]', 'click', async (e, b) => {
      const env = await busy(t('loading'), () => V.loadVersion(b.dataset.sha));
      const c = list.find((x) => x.sha === b.dataset.sha);
      await restoreFlow(env, t('version_of', { d: fmtTs(c.date) }), false);
    });
    $('#more', el) && ($('#more', el).onclick = () => loadHistory(el, page + 1));
  } catch (e) { showErr(e); }
}

async function loadSnaps(el) {
  const list = await V.snapshots();
  el.innerHTML = list.length ? `<div class="versions">${list.map((s, i) => `<div class="li"><div class="a"><b>${fmtTs(s.at)}</b><span class="small muted">${t('snap_' + s.reason) !== 'snap_' + s.reason ? t('snap_' + s.reason) : esc(s.reason)}</span></div><div class="b"><button class="btn sm" data-i="${i}">${t('view_restore')}</button></div></div>`).join('')}</div>` : `<div class="empty">${t('no_versions')}</div>`;
  on(el, '[data-i]', 'click', async (e, b) => {
    const s = list[+b.dataset.i];
    await restoreFlow(s.env, t('local_copy_of', { d: fmtTs(s.at) }), false);
  });
}

// Otvori verziju (možda sa starom šifrom), prikaži sadržaj, pa zameni ili spoji.
async function restoreFlow(env, label, allowMerge) {
  let opened;
  try {
    opened = await busy(t('decrypting'), () => V.openEnvelope(env));
  } catch (e) {
    if (!(e instanceof WrongPassword)) { showErr(e); return; }
    const pw = await dialog({ title: label, body: `<p>${t('old_pw_needed')}</p>`, input: { label: t('password'), type: 'password' } });
    if (!pw) return;
    try { opened = await busy(t('decrypting'), () => V.openEnvelope(env, pw)); } catch { toast(t('wrong_pw'), 'error'); return; }
  }
  const sm = opened.summary;
  const cur = M.summary(V.db());
  const r = await dialog({
    title: label, wide: true,
    body: `<table class="cmp"><tr><th></th><th>${t('this_version')}</th><th>${t('current')}</th></tr>
      <tr><td>${t('patients')}</td><td>${sm.patients}</td><td>${cur.patients}</td></tr>
      <tr><td>${t('nav_invoices')}</td><td>${sm.invoices}</td><td>${cur.invoices}</td></tr>
      <tr><td>${t('drafts')}</td><td>${sm.drafts}</td><td>${cur.drafts}</td></tr>
      <tr><td>${t('last_invoice')}</td><td>${esc(sm.last)}</td><td>${esc(cur.last)}</td></tr></table>
      <p class="hint">${t('restore_info')}</p>
      ${allowMerge ? `<label class="check"><input type="radio" name="how" value="merge" checked> ${t('restore_merge')}</label><label class="check"><input type="radio" name="how" value="replace"> ${t('restore_replace')}</label>` : ''}`,
    ok: t('restore'), danger: !allowMerge,
    collect: (m) => m.querySelector('input[name=how]:checked')?.value || 'replace',
  });
  if (!r) return;
  try {
    await busy(t('restoring'), () => V.replaceAll(opened.data, r));
    toast(t('restored'));
    go('#/', true);
  } catch (e) { showErr(e); }
}

async function changePw() {
  const r = await dialog({
    title: t('change_pw'),
    body: `<label class="field"><span>${t('current_pw')}</span><input type="password" id="o" autocomplete="current-password"></label>
      <label class="field"><span>${t('new_pw')}</span><input type="password" id="n1" autocomplete="new-password"></label>
      <label class="field"><span>${t('new_pw2')}</span><input type="password" id="n2" autocomplete="new-password"></label>
      <p class="small muted">${t('pw_rules')}</p><p class="hint warn small">${t('pw_change_info')}</p>`,
    ok: t('change_pw'),
    collect: (m) => ['o', 'n1', 'n2'].map((id) => m.querySelector('#' + id).value),
  });
  if (!r) return;
  const [o, n1, n2] = r;
  if (n1 !== n2) { toast(t('pw_mismatch'), 'error'); return; }
  const probs = passwordProblems(n1);
  if (probs.length) { toast(probs.map((p) => t(p)).join(' '), 'error'); return; }
  try {
    await busy(t('pw_changing'), () => V.changePassword(o, n1));
    toast(t('pw_changed'));
  } catch (e) {
    if (e instanceof WrongPassword) toast(t('wrong_pw'), 'error'); else showErr(e);
  }
}
