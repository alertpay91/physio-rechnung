// Pacijenti: lista i forma (lični podaci, adresa za račun, Verordnung-e).

import * as V from '../vault.js';
import * as M from '../model.js';
import { t } from '../i18n.js';
import { $, on, toast, confirmBox, icon } from '../ui.js';
import { esc, dmy, fmtMoney, uid, clone, nowStamp, norm, stableStringify, isISODate } from '../util.js';
import { invoiceTable, bindRows, showErr } from './invoices.js';
import { setGuard, go } from '../app.js';

let q = '', showArchived = false;

export function patientList(view) {
  const db = V.db();
  const s = q.trim().toLowerCase();
  const list = db.patients
    .filter((p) => (showArchived || !p.archived) && (!s || `${p.firstName} ${p.lastName} ${p.institution || ''}`.toLowerCase().includes(s)))
    .sort((a, b) => M.sortName(a).localeCompare(M.sortName(b), 'de'));
  const openOf = (p) => db.invoices.filter((i) => i.patientId === p.id && M.OPEN.includes(i.status));
  const rxInfo = (p) => {
    const r = M.latestPrescription(p);
    if (!r) return '–';
    const u = M.prescriptionUsage(db, p.id, r.id);
    return `${dmy(r.date)}${r.sessions ? ` · ${t('used', { u: u.billed, t: r.sessions })}` : ''}`;
  };
  view.innerHTML = `<div class="head-row"><h1>${t('nav_patients')}</h1><a class="btn primary" href="#/patient/neu">${icon('plus')} ${t('new_patient')}</a></div>
    <div class="card">
      <div class="row keep filters"><label class="field grow"><span>${t('search')}</span><input type="search" id="q" value="${esc(q)}" placeholder="${t('search_pat_ph')}"></label>
      <label class="check"><input type="checkbox" id="arch" ${showArchived ? 'checked' : ''}> ${t('show_archived')}</label></div>
      ${list.length ? `<div class="tablewrap"><table class="click"><thead><tr><th>${t('col_name')}</th><th>${t('col_inst')}</th><th>${t('prescription')}</th><th class="num">${t('f_open')}</th></tr></thead><tbody>
        ${list.map((p) => { const o = openOf(p); return `<tr data-href="#/patient/${p.id}" tabindex="0"><td><b>${esc(M.sortName(p))}</b>${p.archived ? ` <span class="tag cancelled">${t('archived')}</span>` : ''}<div class="small muted">${t('ins_' + (p.insurance || 'selbstzahler'))}</div></td><td>${esc(p.institution || [p.street, p.city].filter(Boolean).join(', '))}</td><td>${rxInfo(p)}</td><td class="num">${o.length ? fmtMoney(o.reduce((x, i) => x + M.amountOf(i), 0)) + ' €' : '–'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="list">${list.map((p) => `<a class="li" href="#/patient/${p.id}"><div class="a"><b>${esc(M.sortName(p))}</b><span class="small muted">${esc(p.institution || p.city || '')}</span></div><div class="b small muted">${rxInfo(p)}</div></a>`).join('')}</div>`
      : `<div class="empty">${t('no_patients')}</div>`}
    </div>`;
  bindRows(view);
  $('#q', view).oninput = (e) => { q = e.target.value; const pos = e.target.selectionStart; patientList(view); const i = $('#q', view); i.focus(); i.setSelectionRange(pos, pos); };
  $('#arch', view).onchange = (e) => { showArchived = e.target.checked; patientList(view); };
}

const emptyPatient = () => ({
  id: uid(), salutation: '', firstName: '', lastName: '', birthDate: '', insurance: 'selbstzahler',
  institution: '', street: '', plz: '', city: '', phone: '', email: '',
  billTo: { enabled: false, name: '', extra: '', street: '', plz: '', city: '' },
  prescriptions: [], notes: '', archived: false, createdAt: nowStamp(), updatedAt: nowStamp(),
});

export function patientForm(view, id) {
  const db = V.db();
  const isNew = !id || id === 'neu';
  const ex = isNew ? null : db.patients.find((p) => p.id === id);
  if (!isNew && !ex) { view.innerHTML = `<div class="empty">${t('not_found')}</div>`; return; }
  const p = ex ? clone(ex) : emptyPatient();
  M.migrate({ patients: [p] });
  const original = stableStringify(p);
  setGuard(() => stableStringify(p) !== original);

  const services = db.services.filter((s) => s.active);
  const diags = db.praxis.diagnoses || [];
  const docs = db.praxis.doctors || [];
  const f = (k, label, type = 'text', extra = '') => `<label class="field ${extra}"><span>${label}</span><input type="${type}" data-f="${k}" value="${esc(p[k] || '')}" ${type === 'tel' ? 'inputmode="tel"' : ''}></label>`;
  const b = (k, label, extra = '') => `<label class="field ${extra}"><span>${label}</span><input type="text" data-b="${k}" value="${esc(p.billTo[k] || '')}"></label>`;

  const rxRow = (r, i) => {
    const u = isNew ? { billed: 0, drafted: 0 } : M.prescriptionUsage(db, p.id, r.id);
    return `<div class="rx" data-i="${i}">
      <div class="row">
        <label class="field"><span>${t('presc_date')}</span><input type="date" data-r="date" value="${r.date || ''}"></label>
        <label class="field grow"><span>${t('doctor')}</span><input type="text" data-r="doctor" value="${esc(r.doctor || '')}"></label>
        <label class="field narrow"><span>${t('sess_total')}</span><input type="number" min="0" inputmode="numeric" data-r="sessions" value="${r.sessions || ''}"></label>
      </div>
      ${docs.length ? `<div class="chips pick">${docs.map((d, j) => `<button type="button" class="chip ${r.doctor === d ? 'on' : ''}" data-pdoc="${j}">${esc(d)}</button>`).join('')}</div>` : ''}
      <label class="field"><span>${t('diag_icd')} <small class="muted">${t('pick_hint')}</small></span><input type="text" data-r="diagnosis" value="${esc(r.diagnosis || '')}" placeholder="${t('diag_ph')}"></label>
      <div class="chips pick">${diags.map((d, j) => `<button type="button" class="chip ${M.hasPick(r.diagnosis, d) ? 'on' : ''}" data-pdg="${j}">${esc(d)}</button>`).join('')}<a class="chip-link small" href="#/einstellungen/auswahl">${icon('settings')} ${t('edit_picks')}</a></div>
      <div class="small muted">${t('rx_services')}</div>
      <div class="chips">${services.map((s) => `<label class="chip check"><input type="checkbox" data-rs="${esc(s.code)}" ${M.rxServices(p, r).includes(s.code) ? 'checked' : ''}> ${esc(s.code)}</label>`).join('')}</div>
      <div class="row keep between"><span class="small muted">${r.sessions ? t('used', { u: u.billed, t: r.sessions }) : ''}${u.drafted ? ' · ' + t('in_drafts', { n: u.drafted }) : ''}</span>
      ${u.billed || u.drafted ? '' : `<button type="button" class="btn sm danger" data-rxdel="${i}">${t('remove')}</button>`}</div>
    </div>`;
  };

  const render = () => {
    view.innerHTML = `<a href="#/patienten" class="back">${icon('left')} ${t('nav_patients')}</a>
      <div class="head-row"><h1>${isNew ? t('new_patient') : esc(M.fullName(p))}</h1>${!isNew ? `<a class="btn primary" href="#/neu?p=${p.id}">${icon('plus')} ${t('new_invoice')}</a>` : ''}</div>
      <form id="pf" autocomplete="off">
      <div class="card"><h2>${t('person')}</h2>
        <div class="row">
          <label class="field narrow"><span>${t('salut')}</span><select data-f="salutation">${[['', t('none_f')], ['Herr', 'Herr'], ['Frau', 'Frau']].map(([v, l]) => `<option value="${v}" ${p.salutation === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${f('firstName', t('first'), 'text', 'grow')}${f('lastName', t('last') + ' *', 'text', 'grow')}
        </div>
        <div class="row">
          ${f('birthDate', t('birth'), 'date')}
          <label class="field grow"><span>${t('payer')}</span><select data-f="insurance">${M.INSURANCE.map((k) => `<option value="${k}" ${p.insurance === k ? 'selected' : ''}>${t('ins_' + k)}</option>`).join('')}</select></label>
        </div>
        ${p.insurance === 'gkv' ? `<p class="hint">${t('gkv_hint')}</p>` : ''}
      </div>
      <div class="card"><h2>${t('address')}</h2>
        ${f('institution', t('institution'))}
        <div class="row">${f('street', t('street'), 'text', 'grow2')}${f('plz', t('plz'), 'text', 'narrow')}${f('city', t('city'), 'text', 'grow')}</div>
        <div class="row">${f('phone', t('phone'), 'tel')}${f('email', t('email'), 'email')}</div>
        <label class="check"><input type="checkbox" id="billTo" ${p.billTo.enabled ? 'checked' : ''}> ${t('bill_to')}</label>
        <div id="billBox" ${p.billTo.enabled ? '' : 'hidden'}>
          ${b('name', t('bill_name'))}${b('extra', t('bill_extra'))}
          <div class="row">${b('street', t('street'), 'grow2')}${b('plz', t('plz'), 'narrow')}${b('city', t('city'), 'grow')}</div>
        </div>
        <div class="small muted recipient"><b>${t('recipient')}:</b><br><span class="pre" id="recPrev"></span></div>
      </div>
      <div class="card"><h2>${t('prescriptions')}</h2><p class="small muted">${t('rx_hint')}</p>
        <div id="rxs">${p.prescriptions.map(rxRow).join('') || `<div class="empty small">${t('no_rx')}</div>`}</div>
        <button type="button" class="btn" id="addRx">${icon('plus')} ${t('add_rx')}</button>
      </div>
      <div class="card"><h2>${t('notes')}</h2><textarea data-f="notes" placeholder="${t('notes_ph')}">${esc(p.notes || '')}</textarea>
        <label class="check"><input type="checkbox" data-f="archived" ${p.archived ? 'checked' : ''}> ${t('archive_patient')}</label></div>
      <div class="actions sticky-actions"><button class="btn primary" type="submit">${t('save')}</button>
        ${!isNew && M.canDeletePatient(db, p.id) ? `<button type="button" class="btn danger" id="del">${icon('trash')} ${t('del_patient')}</button>` : ''}</div>
      </form>
      ${!isNew ? `<div class="card"><h2>${t('nav_invoices')}</h2>${invoiceTable(db.invoices.filter((i) => i.patientId === p.id).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)))}</div>` : ''}`;
    bind();
    preview();
  };

  const preview = () => { $('#recPrev', view).textContent = M.recipientLines(p).join('\n') || '–'; };

  const bind = () => {
    bindRows(view);
    on(view, '[data-f]', 'change', (e, el) => {
      p[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.f === 'insurance') render(); else preview();
    });
    on(view, '[data-b]', 'change', (e, el) => { p.billTo[el.dataset.b] = el.value; preview(); });
    $('#billTo', view).onchange = (e) => { p.billTo.enabled = e.target.checked; $('#billBox', view).hidden = !e.target.checked; preview(); };
    on(view, '[data-r]', 'change', (e, el) => {
      const r = p.prescriptions[+el.closest('.rx').dataset.i];
      r[el.dataset.r] = el.dataset.r === 'sessions' ? (Number(el.value) || 0) : el.value;
      r.updatedAt = nowStamp();
    });
    on(view, '[data-pdoc]', 'click', (e, el) => {
      const r = p.prescriptions[+el.closest('.rx').dataset.i];
      r.doctor = r.doctor === docs[+el.dataset.pdoc] ? '' : docs[+el.dataset.pdoc];
      r.updatedAt = nowStamp(); render();
    });
    on(view, '[data-pdg]', 'click', (e, el) => {
      const r = p.prescriptions[+el.closest('.rx').dataset.i];
      r.diagnosis = M.togglePick(r.diagnosis, diags[+el.dataset.pdg]);
      r.updatedAt = nowStamp(); render();
    });
    on(view, '[data-rs]', 'change', (e, el) => {
      const r = p.prescriptions[+el.closest('.rx').dataset.i];
      const set = new Set(M.rxServices(p, r));
      if (el.checked) set.add(el.dataset.rs); else set.delete(el.dataset.rs);
      r.services = services.map((s) => s.code).filter((c) => set.has(c));
    });
    on(view, '[data-rxdel]', 'click', async (e, el) => {
      if (!(await confirmBox(t('confirm_rx_del')))) return;
      p.prescriptions.splice(+el.dataset.rxdel, 1); render();
    });
    $('#addRx', view).onclick = () => {
      p.prescriptions.push({ id: uid(), date: '', doctor: '', diagnosis: '', sessions: 0, services: p.institution ? ['KG', 'HB'] : ['KG'], createdAt: nowStamp(), updatedAt: nowStamp() });
      render();
      $('#rxs .rx:last-child input[type=date]', view)?.focus();
    };
    $('#pf', view).onsubmit = async (e) => {
      e.preventDefault();
      for (const k of ['firstName', 'lastName', 'institution', 'street', 'plz', 'city', 'phone', 'email']) p[k] = norm(p[k]);
      if (!p.lastName) { toast(t('last_missing'), 'error'); $('[data-f="lastName"]', view).focus(); return; }
      if (p.billTo.enabled && !norm(p.billTo.name)) { toast(t('bill_name_missing'), 'error'); return; }
      if (p.prescriptions.some((r) => !isISODate(r.date))) { toast(t('rx_date_missing'), 'error'); return; }
      if (p.birthDate && !isISODate(p.birthDate)) { toast(t('bad_date'), 'error'); return; }
      try {
        M.touch(p);
        await V.commit((d) => {
          const i = d.patients.findIndex((x) => x.id === p.id);
          if (i >= 0) d.patients[i] = clone(p); else d.patients.push(clone(p));
          for (const r of p.prescriptions) { M.learnPicks(d, 'doctors', r.doctor); M.learnPicks(d, 'diagnoses', r.diagnosis); }
        });
        setGuard(null);
        toast(t('saved'));
        go('#/patient/' + p.id, true);
      } catch (err) { showErr(err); }
    };
    $('#del', view) && ($('#del', view).onclick = async () => {
      if (!(await confirmBox(t('confirm_del_pat'), { danger: true, ok: t('delete') }))) return;
      await V.commit((d) => M.deleteRecord(d, 'patients', p.id));
      setGuard(null);
      go('#/patienten');
    });
  };

  render();
}
