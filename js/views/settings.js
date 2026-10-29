// Podešavanja: podaci prakse (idu na svaki račun) i cenovnik usluga.

import * as V from '../vault.js';
import * as M from '../model.js';
import { t } from '../i18n.js';
import { $, $$, on, toast, confirmBox, dialog, busy, icon } from '../ui.js';
import { esc, clone, norm, uid, nowStamp, parseMoney, moneyInput, ibanValid, ibanFormat, stableStringify, todayISO, addDays } from '../util.js';
import { setGuard, go } from '../app.js';
import { pdfActions, showErr } from './invoices.js';
import { invoiceDoc } from '../pdf.js';

export function settings(view, tab) {
  tab = ['leistungen', 'auswahl'].includes(tab) ? tab : 'praxis';
  view.innerHTML = `<h1>${t('nav_settings')}</h1>
    <div class="tabs" role="tablist"><a role="tab" href="#/einstellungen" class="${tab === 'praxis' ? 'on' : ''}">${t('praxis_title')}</a><a role="tab" href="#/einstellungen/leistungen" class="${tab === 'leistungen' ? 'on' : ''}">${t('svc_title')}</a><a role="tab" href="#/einstellungen/auswahl" class="${tab === 'auswahl' ? 'on' : ''}">${t('picks_title')}</a></div>
    <div id="tab"></div>`;
  ({ praxis, leistungen: servicesTab, auswahl: picksTab })[tab]($('#tab', view));
}

// Brzi izbor: liste dijagnoza i lekara (jedna stavka po redu); redosled je redosled dugmića
function picksTab(el) {
  const pr = V.db().praxis;
  const lists = { diagnoses: [...(pr.diagnoses || [])], doctors: [...(pr.doctors || [])] };
  const orig = stableStringify(lists);
  setGuard(() => stableStringify(lists) !== orig);
  const block = (k) => `<div class="card"><h2>${t(k === 'diagnoses' ? 'picks_diagnoses' : 'picks_doctors')}</h2>
      <div class="picklist">${lists[k].map((v, i) => `<div class="row keep pickrow" data-k="${k}" data-i="${i}">
        <input type="text" value="${esc(v)}" aria-label="${t(k === 'diagnoses' ? 'picks_diagnoses' : 'picks_doctors')} ${i + 1}">
        <button type="button" class="btn sm icon-only" data-up aria-label="↑" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" class="btn sm icon-only" data-del aria-label="${t('delete')}">${icon('trash')}</button></div>`).join('') || `<p class="small muted">${t('picks_empty')}</p>`}</div>
      <div class="row keep"><input type="text" data-new="${k}" placeholder="${t(k === 'diagnoses' ? 'diag_ph' : 'doctor_ph')}"><button type="button" class="btn" data-add="${k}">${icon('plus')} ${t('add_item')}</button></div>
    </div>`;
  const render = () => {
    el.innerHTML = `<p class="muted">${t('picks_sub')}</p>${block('diagnoses')}${block('doctors')}
      <div class="actions sticky-actions"><button type="button" class="btn primary" id="save">${t('save')}</button></div>`;
    on(el, '.pickrow input', 'change', (e, inp) => { const r = inp.closest('.pickrow'); lists[r.dataset.k][+r.dataset.i] = norm(inp.value); });
    on(el, '.pickrow [data-del]', 'click', (e, b) => { const r = b.closest('.pickrow'); lists[r.dataset.k].splice(+r.dataset.i, 1); render(); });
    on(el, '.pickrow [data-up]', 'click', (e, b) => { const r = b.closest('.pickrow'), l = lists[r.dataset.k], i = +r.dataset.i; [l[i - 1], l[i]] = [l[i], l[i - 1]]; render(); });
    const add = (k) => {
      const inp = $(`[data-new="${k}"]`, el), v = norm(inp.value);
      if (!v) { inp.focus(); return; }
      if (lists[k].some((x) => x.toLowerCase() === v.toLowerCase())) { toast(t('picks_dup'), 'error'); return; }
      lists[k].push(v); render(); $(`[data-new="${k}"]`, el).focus();
    };
    on(el, '[data-add]', 'click', (e, b) => add(b.dataset.add));
    on(el, '[data-new]', 'keydown', (e, inp) => { if (e.key === 'Enter') { e.preventDefault(); add(inp.dataset.new); } });
    $('#save', el).onclick = async () => {
      for (const k of M.PICK_KINDS) lists[k] = [...new Map(lists[k].map(norm).filter(Boolean).map((v) => [v.toLowerCase(), v])).values()];
      await V.commit((d) => { for (const k of M.PICK_KINDS) d.praxis[k] = [...lists[k]]; M.touch(d.praxis); });
      setGuard(null);
      toast(t('saved'));
      go('#/einstellungen/auswahl', true);
    };
  };
  render();
}

function praxis(el) {
  const pr = clone(V.db().praxis);
  const orig = stableStringify(pr);
  setGuard(() => stableStringify(pr) !== orig);
  const f = (k, label, extra = '', type = 'text') => `<label class="field ${extra}"><span>${label}</span><input type="${type}" data-k="${k}" value="${esc(pr[k] ?? '')}"></label>`;
  const ta = (k, label, hint = '') => `<label class="field"><span>${label}</span><textarea data-k="${k}">${esc(pr[k] || '')}</textarea>${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
  el.innerHTML = `<p class="muted">${t('praxis_sub')}</p>
    <form id="prf" autocomplete="off">
    <div class="card"><h2>${t('praxis_title')}</h2>
      <div class="row">${f('name', t('pname') + ' *', 'grow')}${f('title', t('ptitle'), 'grow')}</div>
      <div class="row">${f('street', t('pstreet') + ' *', 'grow2')}${f('plz', t('plz') + ' *', 'narrow')}${f('city', t('city') + ' *', 'grow')}</div>
      <div class="row">${f('phone', t('phone'), '', 'tel')}${f('email', t('email'), '', 'email')}</div>
    </div>
    <div class="card"><h2>${t('bank_tax')}</h2>
      <div class="row">${f('iban', t('iban') + ' *', 'grow2')}${f('bic', t('bic'))}</div>
      <div id="ibanState" class="small"></div>
      <div class="row">${f('bank', t('bank'), 'grow')}${f('bankHolder', t('holder'), 'grow')}</div>
      <div class="row">${f('steuernummer', t('taxno') + ' *', 'grow')}${f('paymentDays', t('pay_days'), 'narrow', 'number')}${f('reminderDays', t('reminder_days'), 'narrow', 'number')}</div>
    </div>
    <div class="card"><h2>${t('texts')}</h2>
      ${ta('introText', t('intro_text'), t('intro_hint'))}
      ${ta('introNoPresc', t('intro_nopresc'))}
      ${ta('taxNote', t('tax_note'), t('tax_hint'))}
      ${ta('closing', t('closing'))}
    </div>
    <div class="actions sticky-actions"><button class="btn primary" type="submit">${t('save')}</button><button class="btn" type="button" id="sample">${icon('pdf')} ${t('sample_pdf')}</button></div>
    </form>
    <div class="card danger-zone"><h2>${icon('warn')} ${t('reset_title')}</h2>
      <p class="small">${t('reset_info')}</p>
      <div class="actions"><button class="btn danger" type="button" id="reset">${icon('trash')} ${t('reset_btn')}</button></div>
    </div>`;
  $('#reset', el).onclick = () => factoryReset().catch(showErr);
  const ibanState = () => {
    const ok = ibanValid(pr.iban);
    $('#ibanState', el).innerHTML = pr.iban ? (ok ? `<span class="ok">${icon('check')} ${t('iban_ok')}</span>` : `<span class="bad-text">${icon('warn')} ${t('iban_bad')}</span>`) : '';
  };
  ibanState();
  on(el, '[data-k]', 'input', (e, i) => { pr[i.dataset.k] = i.type === 'number' ? Number(i.value) : i.value; if (i.dataset.k === 'iban') ibanState(); });
  $('#sample', el).onclick = () => {
    const today = todayISO();
    const s = {
      kind: 'invoice', number: M.nextNumber(V.db(), today), invoiceDate: today, serviceDate: addDays(today, -3), firstDate: addDays(today, -20), dueDate: addDays(today, Number(pr.paymentDays) || 14),
      prescriptionDate: addDays(today, -30), praxis: pr, recipient: ['An Herrn Max Mustermann', 'Pflegeheim Beispiel', 'Musterstraße 1', '12345 Berlin'], patientLine: '', patientName: 'Max Mustermann',
      intro: pr.introText.replace('{verordnung}', addDays(today, -30).split('-').reverse().join('.')), diagnosis: '',
      items: [{ desc: 'Krankengymnastik', qty: 2, priceCents: 2970, totalCents: 5940 }, { desc: 'Hausbesuch', qty: 2, priceCents: 2760, totalCents: 5520 }],
      dates: [addDays(today, -20), addDays(today, -3)], datesText: `${addDays(today, -20).slice(8)}.${addDays(today, -20).slice(5, 7)}. • ${addDays(today, -3).split('-').reverse().join('.')}`, totalCents: 11460,
    };
    pdfActions(invoiceDoc(s, { draft: true }), 'Musterrechnung.pdf', t('sample_pdf')).catch(showErr);
  };
  $('#prf', el).onsubmit = async (e) => {
    e.preventDefault();
    for (const k of Object.keys(pr)) if (typeof pr[k] === 'string' && !['introText', 'introNoPresc', 'taxNote', 'closing'].includes(k)) pr[k] = norm(pr[k]);
    if (pr.iban) pr.iban = ibanFormat(pr.iban);
    if (pr.iban && !ibanValid(pr.iban) && !(await confirmBox(t('iban_bad_save')))) return;
    if (!pr.introText.includes('{verordnung}') && !(await confirmBox(t('intro_no_placeholder')))) return;
    pr.paymentDays = Math.max(0, Math.round(Number(pr.paymentDays) || 14));
    pr.reminderDays = Math.max(1, Math.round(Number(pr.reminderDays) || 10));
    pr.updatedAt = nowStamp();
    await V.commit((d) => { d.praxis = { ...clone(pr), diagnoses: d.praxis.diagnoses, doctors: d.praxis.doctors }; });
    setGuard(null);
    toast(t('saved'));
    go('#/einstellungen', true);
  };
}

function servicesTab(el) {
  const list = clone(V.db().services).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const orig = stableStringify(list);
  setGuard(() => stableStringify(list) !== orig);
  const render = () => {
    el.innerHTML = `<p class="muted">${t('svc_sub')}</p>
      <div class="card">
      <div class="svc head small muted"><span>${t('code')}</span><span>${t('name')}</span><span>${t('ziffer')}</span><span>${t('price')}</span><span>${t('duration')}</span><span>${t('active')}</span><span></span></div>
      ${list.map((s, i) => `<div class="svc" data-i="${i}">
        <label class="sf"><span class="m-only">${t('code')}</span><input type="text" data-k="code" value="${esc(s.code)}" aria-label="${t('code')}" placeholder="${t('code')}"></label>
        <label class="sf sname"><span class="m-only">${t('name')}</span><input type="text" data-k="name" value="${esc(s.name)}" aria-label="${t('name')}" placeholder="${t('name')}"></label>
        <label class="sf"><span class="m-only">${t('ziffer')}</span><input type="text" data-k="ziffer" value="${esc(s.ziffer || '')}" aria-label="${t('ziffer')}" placeholder="${t('ziffer')}"></label>
        <label class="sf"><span class="m-only">${t('price')}</span><input type="text" inputmode="decimal" data-k="price" value="${moneyInput(s.priceCents)}" class="${s.priceCents > 0 ? '' : 'bad'}" aria-label="${t('price')}" placeholder="0,00 €"></label>
        <label class="sf"><span class="m-only">${t('duration')} (Min.)</span><input type="number" min="0" data-k="minutes" value="${s.minutes ?? ''}" aria-label="${t('duration')}" placeholder="Min."></label>
        <label class="check"><input type="checkbox" data-k="active" ${s.active ? 'checked' : ''}><span class="m-only">${t('active')}</span></label>
        <span class="svc-btns"><button type="button" class="btn sm icon-only" data-up="${i}" aria-label="↑" ${i ? '' : 'disabled'}>↑</button>${M.canDeleteService(V.db(), s.id) ? `<button type="button" class="btn sm icon-only" data-del="${i}" aria-label="${t('delete')}">${icon('trash')}</button>` : ''}</span>
      </div>`).join('')}
      <div class="actions"><button type="button" class="btn" id="add">${icon('plus')} ${t('add_svc')}</button></div>
      </div>
      <p class="small muted">${t('svc_price_note')}</p>
      <div class="actions sticky-actions"><button type="button" class="btn primary" id="save">${t('save')}</button></div>`;
    on(el, '[data-k]', 'change', (e, inp) => {
      const s = list[+inp.closest('.svc').dataset.i];
      const k = inp.dataset.k;
      if (k === 'price') {
        const c = parseMoney(inp.value || '0');
        if (Number.isNaN(c) || c < 0) { toast(t('bad_price'), 'error'); inp.value = moneyInput(s.priceCents); return; }
        s.priceCents = c; inp.value = moneyInput(c); inp.classList.toggle('bad', c <= 0);
      } else if (k === 'active') s.active = inp.checked;
      else if (k === 'minutes') s.minutes = inp.value ? Number(inp.value) : null;
      else s[k] = inp.value;
      s.updatedAt = nowStamp();
    });
    on(el, '[data-del]', 'click', (e, b) => { list.splice(+b.dataset.del, 1); render(); });
    on(el, '[data-up]', 'click', (e, b) => { const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); });
    $('#add', el).onclick = () => { list.push({ id: uid(), code: '', name: '', ziffer: '', priceCents: 0, minutes: null, active: true, createdAt: nowStamp(), updatedAt: nowStamp() }); render(); $$('.svc:last-of-type input', el)[0]?.focus(); };
    $('#save', el).onclick = async () => {
      for (const s of list) { s.code = norm(s.code).toUpperCase(); s.name = norm(s.name); }
      if (list.some((s) => !s.code || !s.name)) { toast(t('svc_incomplete'), 'error'); return; }
      const codes = list.map((s) => s.code);
      if (new Set(codes).size !== codes.length) { toast(t('svc_dup_code'), 'error'); return; }
      list.forEach((s, i) => { if (s.sort !== i) { s.sort = i; s.updatedAt = nowStamp(); } });
      await V.commit((d) => {
        const keep = new Set(list.map((s) => s.id));
        for (const old of d.services) if (!keep.has(old.id)) M.deleteRecord(d, 'services', old.id);
        d.services = clone(list);
      });
      setGuard(null);
      toast(t('prices_saved'));
      go('#/einstellungen/leistungen', true);
    };
  };
  render();
}

// Fabričko resetovanje: briše sve pacijente i račune (posle testiranja), uz dvostruku potvrdu i šifru.
// Stare verzije ostaju u istoriji (Daten & Sicherung → Versionen) i u lokalnim kopijama.
async function factoryReset() {
  const sum = M.summary(V.db());
  const r = await dialog({
    title: t('reset_title'),
    body: `<p class="hint danger">${t('reset_warn', { p: sum.patients, i: sum.invoices + sum.drafts })}</p>
      <label class="check"><input type="checkbox" id="keep" checked> ${t('reset_keep')}</label>
      <p class="small muted">${t('reset_undo')}</p>
      <label class="field"><span>${t('reset_pw')}</span><input type="password" id="pw" autocomplete="current-password"></label>`,
    ok: t('reset_btn'), danger: true,
    collect: (m) => ({ keep: m.querySelector('#keep').checked, pw: m.querySelector('#pw').value }),
  });
  if (!r) return;
  if (!(await V.verifyPassword(r.pw))) { toast(t('wrong_pw'), 'error'); return; }
  if (!(await confirmBox(t('reset_last'), { danger: true, ok: t('reset_btn') }))) return;
  await busy(t('reset_busy'), async () => {
    if (V.status.mode === 'cloud') await V.syncNow().catch(() => {});
    await V.replaceAll(M.factoryReset(V.db(), { keepSettings: r.keep }), 'replace');
  });
  setGuard(null);
  toast(t('reset_done'));
  go('#/', true);
}
