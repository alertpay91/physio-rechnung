// Računi: lista, detalj, izrada/izmena nacrta, finalizacija, storno, opomena, PDF.

import * as V from '../vault.js';
import * as M from '../model.js';
import { t, locale, monthName } from '../i18n.js';
import { $, $$, on, toast, dialog, confirmBox, busy, download, openBlob, share, canShareFiles, icon } from '../ui.js';
import { esc, dmy, fmtMoney, parseMoney, moneyInput, todayISO, addDays, clone, toISO, parseISO, stableStringify } from '../util.js';
import { invoiceDoc, reminderDoc, pdfBlob, pdfName } from '../pdf.js';
import { makeZip } from '../zip.js';
import { sha256hex } from '../crypto.js';
import { setGuard, go } from '../app.js';

const patientOf = (db, inv) => db.patients.find((p) => p.id === inv.patientId);
export const tag = (inv) => `<span class="tag ${inv.status}">${t('st_' + inv.status)}</span>${M.isOverdue(inv) ? ` <span class="tag overdue">${t('overdue_tag')}</span>` : ''}`;

export function invoiceTable(list) {
  const db = V.db();
  if (!list.length) return `<div class="empty">${t('none_sel')}</div>`;
  const name = (i) => esc(i.snapshot?.patientName || M.fullName(patientOf(db, i)) || '–');
  return `<div class="tablewrap"><table class="click"><thead><tr><th>${t('col_no')}</th><th>${t('col_date')}</th><th>${t('col_patient')}</th><th>${t('col_status')}</th><th class="num">${t('col_amount')}</th></tr></thead><tbody>${
    list.map((i) => `<tr data-href="#/rechnung/${i.id}" tabindex="0"><td>${esc(i.number) || '<span class="muted">–</span>'}</td><td>${dmy(i.invoiceDate)}</td><td>${name(i)}</td><td>${tag(i)}</td><td class="num">${fmtMoney(M.amountOf(i))} €</td></tr>`).join('')
  }</tbody></table></div>
  <div class="list">${list.map((i) => `<a class="li" href="#/rechnung/${i.id}"><div class="a"><b>${name(i)}</b><span class="small muted">${esc(i.number) || t('draft_p')} · ${dmy(i.invoiceDate)}</span></div><div class="b"><b>${fmtMoney(M.amountOf(i))} €</b>${tag(i)}</div></a>`).join('')}</div>`;
}

export function bindRows(root) {
  on(root, 'tr[data-href]', 'click', (e, tr) => { location.hash = tr.dataset.href; });
  on(root, 'tr[data-href]', 'keydown', (e, tr) => { if (e.key === 'Enter') location.hash = tr.dataset.href; });
}

/* ===================== Lista ===================== */

const filt = { period: '', status: '', q: '' };

export function invoiceList(view, arg, query) {
  if (query && query.has('s')) { filt.status = query.get('s'); filt.period = ''; filt.q = ''; history.replaceState(null, '', '#/rechnungen'); }
  const db = V.db();
  const months = [...new Set(db.invoices.map((i) => i.invoiceDate.slice(0, 7)))].sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const q = filt.q.trim().toLowerCase();
  const list = db.invoices.filter((i) =>
    (!filt.period || i.invoiceDate.startsWith(filt.period)) &&
    (!filt.status || (filt.status === 'overdue' ? M.isOverdue(i) : filt.status === 'open' ? M.OPEN.includes(i.status) : i.status === filt.status)) &&
    (!q || (i.number || '').toLowerCase().includes(q) || (i.snapshot?.patientName || M.fullName(patientOf(db, i))).toLowerCase().includes(q) || (patientOf(db, i)?.institution || '').toLowerCase().includes(q)),
  ).sort((a, b) => (b.invoiceDate + (b.number || '~')).localeCompare(a.invoiceDate + (a.number || '~')));
  const billed = list.filter((i) => i.kind === 'invoice' && M.BILLED.includes(i.status));
  const sum = billed.reduce((s, i) => s + M.amountOf(i), 0);
  const fin = list.filter((i) => i.status !== 'draft');

  view.innerHTML = `<div class="head-row"><h1>${t('nav_invoices')}</h1><a class="btn primary" href="#/neu">${icon('plus')} ${t('new_invoice')}</a></div>
    <p class="muted">${t('invoices_sub')}</p>
    <div class="card">
      <div class="row keep filters">
        <label class="field"><span>${t('period')}</span><select id="fPeriod"><option value="">${t('all')}</option>${years.map((y) => `<option value="${y}" ${filt.period === y ? 'selected' : ''}>${y}</option>${months.filter((m) => m.startsWith(y)).map((m) => `<option value="${m}" ${filt.period === m ? 'selected' : ''}>&nbsp;&nbsp;${monthName(m)}</option>`).join('')}`).join('')}</select></label>
        <label class="field"><span>${t('status')}</span><select id="fStatus"><option value="">${t('all')}</option>${['open', 'overdue', ...M.STATUSES].map((k) => `<option value="${k}" ${filt.status === k ? 'selected' : ''}>${t(k === 'open' ? 'f_open' : k === 'overdue' ? 'overdue_tag' : 'st_' + k)}</option>`).join('')}</select></label>
        <label class="field grow"><span>${t('search')}</span><input type="search" id="fQ" value="${esc(filt.q)}" placeholder="${t('search_ph')}"></label>
      </div>
      <div id="tbl">${invoiceTable(list)}</div>
      <p class="small muted">${t('count_sum', { n: list.length, s: fmtMoney(sum) })}</p>
      <div class="actions">
        <button class="btn" id="csv" ${fin.length ? '' : 'disabled'}>${icon('download')} ${t('csv')}</button>
        <button class="btn" id="zip" ${fin.length ? '' : 'disabled'}>${icon('pdf')} ${t('zip_pdfs', { n: fin.length })}</button>
      </div>
    </div>`;
  bindRows(view);
  $('#fPeriod', view).onchange = (e) => { filt.period = e.target.value; invoiceList(view); };
  $('#fStatus', view).onchange = (e) => { filt.status = e.target.value; invoiceList(view); };
  $('#fQ', view).oninput = (e) => {
    filt.q = e.target.value;
    const pos = e.target.selectionStart;
    invoiceList(view);
    const i = $('#fQ', view); i.focus(); i.setSelectionRange(pos, pos);
  };
  const suffix = filt.period ? '_' + filt.period : '';
  $('#csv', view).onclick = () => download(new Blob([M.invoicesCSV(db, fin)], { type: 'text/csv;charset=utf-8' }), `Rechnungen${suffix}.csv`);
  $('#zip', view).onclick = async () => {
    const files = await busy(t('pdf_creating'), async () => {
      const out = [];
      for (const i of fin) out.push({ name: pdfName(i.snapshot), data: new Uint8Array(await (await pdfBlob(invoiceDoc(i.snapshot))).arrayBuffer()) });
      out.push({ name: `Rechnungen${suffix}.csv`, data: new TextEncoder().encode(M.invoicesCSV(db, fin)) });
      return out;
    });
    download(new Blob([makeZip(files)], { type: 'application/zip' }), `Rechnungen${suffix}.zip`);
  };
}

/* ===================== PDF akcije ===================== */

async function pdfActions(doc, name, title) {
  const blob = await busy(t('pdf_creating'), () => pdfBlob(doc));
  const r = await dialog({
    title,
    body: `<p class="muted small">${esc(name)}</p><div class="actions col">
      <button class="btn primary" data-p="open">${icon('pdf')} ${t('pdf_open')}</button>
      ${canShareFiles() ? `<button class="btn" data-p="share">${icon('share')} ${t('pdf_share')}</button>` : ''}
      <button class="btn" data-p="dl">${icon('download')} ${t('pdf_download')}</button></div>`,
    ok: t('close'), cancel: false,
    onOpen: (m) => on(m, '[data-p]', 'click', (e, b) => {
      if (b.dataset.p === 'open') openBlob(blob, name);
      if (b.dataset.p === 'share') share(blob, name, title);
      if (b.dataset.p === 'dl') download(blob, name);
    }),
  });
  return r;
}

/* ===================== Detalj ===================== */

export function invoiceDetail(view, id) {
  const db = V.db();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) { view.innerHTML = `<div class="empty">${t('not_found')}</div>`; return; }
  if (inv.status === 'draft') { go('#/neu/' + id, true); return; }
  const s = inv.snapshot;
  const p = patientOf(db, inv);
  const other = (x) => db.invoices.find((i) => i.id === x);

  view.innerHTML = `<a href="#/rechnungen" class="back">${icon('left')} ${t('nav_invoices')}</a>
    <div class="head-row"><h1>${t(inv.kind === 'storno' ? 'storno_invoice' : 'invoice')} ${esc(inv.number)}</h1><div>${tag(inv)}</div></div>
    <p class="muted">${p ? `<a href="#/patient/${p.id}">${esc(s.patientName)}</a>` : esc(s.patientName)}${p?.institution ? ' · ' + esc(p.institution) : ''}</p>
    ${inv.cancelledBy ? `<div class="hint warn">${t('cancelled_by', { n: esc(other(inv.cancelledBy)?.number || '') })} <a href="#/rechnung/${inv.cancelledBy}">${t('open_link')}</a></div>` : ''}
    ${inv.cancels ? `<div class="hint">${t('storno_of', { n: esc(inv.cancelsNumber) })} <a href="#/rechnung/${inv.cancels}">${t('open_link')}</a></div>` : ''}
    ${M.isOverdue(inv) ? `<div class="hint danger">${t('overdue_since', { d: dmy(inv.dueDate) })}</div>` : ''}

    <div class="actions" id="acts">
      <button class="btn primary" data-a="pdf">${icon('pdf')} ${t('pdf')}</button>
      ${inv.status === 'final' ? `<button class="btn" data-a="sent">${t('mark_sent')}</button>` : ''}
      ${M.OPEN.includes(inv.status) ? `<button class="btn" data-a="paid">${icon('check')} ${t('mark_paid')}</button>` : ''}
      ${M.OPEN.includes(inv.status) && inv.dueDate < todayISO() ? `<button class="btn" data-a="remind">${t('reminder')}</button>` : ''}
      ${inv.status === 'paid' ? `<button class="btn" data-a="unpaid">${t('unmark_paid')}</button>` : ''}
    </div>

    <div class="card"><div class="grid-info">
      <div><span>${t('inv_date')}</span>${dmy(inv.invoiceDate)}</div>
      ${inv.kind === 'invoice' ? `<div><span>${t('svc_period')}</span>${s.firstDate && s.firstDate !== s.serviceDate ? dmy(s.firstDate) + ' – ' : ''}${dmy(s.serviceDate)}</div>
      <div><span>${t('presc_of')}</span>${dmy(s.prescriptionDate) || '–'}</div>
      <div><span>${t('due')}</span>${dmy(inv.dueDate) || '–'}</div>` : ''}
      ${inv.sentOn ? `<div><span>${t('sent_on')}</span>${dmy(inv.sentOn)}</div>` : ''}
      ${inv.paidOn ? `<div><span>${t('paid_on')}</span>${dmy(inv.paidOn)}</div>` : ''}
      <div><span>${t('recipient')}</span><span class="pre">${esc(s.recipient.join('\n'))}</span></div>
    </div></div>

    <div class="card"><h2>${t('items')}</h2><div class="tablewrap"><table><thead><tr><th>${t('pos')}</th><th>${t('service')}</th><th class="num">${t('qty')}</th><th class="num">${t('unit')}</th><th class="num">${t('total')}</th></tr></thead><tbody>
      ${s.items.map((it, i) => `<tr><td>${i + 1}</td><td>${it.ziffer ? `<span class="muted">${esc(it.ziffer)}</span> ` : ''}${esc(it.desc)}</td><td class="num">${it.qty}</td><td class="num">${fmtMoney(it.priceCents)}</td><td class="num">${fmtMoney(it.totalCents)}</td></tr>`).join('')}
      <tr class="sum"><td colspan="4" class="num">${t('grand')}</td><td class="num">${fmtMoney(s.totalCents)} €</td></tr></tbody></table></div>
      ${s.dates.length ? `<p class="small muted">${t('dates_n', { n: s.dates.length })}: ${esc(s.datesText)}</p>` : ''}
      ${s.diagnosis ? `<p class="small muted">${t('diagnosis')}: ${esc(s.diagnosis)}</p>` : ''}
    </div>

    ${inv.reminders?.length ? `<div class="card"><h2>${t('reminders')}</h2>${inv.reminders.map((r) => `<div class="small">${r.level}. ${t('reminder')} · ${dmy(r.date)} · ${t('due')} ${dmy(r.due)}</div>`).join('')}</div>` : ''}

    <div class="card"><h2>${t('internal_note')}</h2><textarea id="note" placeholder="${t('internal_note_ph')}">${esc(inv.note || '')}</textarea></div>

    <div class="card subtle"><h2>${t('more_actions')}</h2>
      <div class="actions">
        ${inv.kind === 'invoice' && M.BILLED.includes(inv.status) ? `<button class="btn" data-a="correct">${t('correct')}</button><button class="btn danger" data-a="storno">${t('storno')}</button>` : ''}
        ${inv.kind === 'invoice' ? `<button class="btn" data-a="copy">${t('copy_draft')}</button>` : ''}
        <button class="btn danger" data-a="del">${icon('trash')} ${t('del_invoice')}</button>
      </div>
      <p class="small muted">${t('locked_note')}</p>
      ${s.hash ? `<p class="small muted mono">${t('integrity')}: ${s.hash.slice(0, 16)}… · ${t('finalized_at')} ${new Date(inv.finalizedAt).toLocaleString(locale())}</p>` : ''}
    </div>`;

  $('#note', view).onchange = (e) => V.commit((d) => { const x = d.invoices.find((i) => i.id === id); x.note = e.target.value; M.touch(x); }).then(() => toast(t('saved')));

  const act = {
    pdf: () => pdfActions(invoiceDoc(s), pdfName(s), `${t(inv.kind === 'storno' ? 'storno_invoice' : 'invoice')} ${inv.number}`),
    sent: async () => {
      const d = await dialog({ title: t('mark_sent'), input: { label: t('sent_on'), type: 'date', value: todayISO() } });
      if (d) await V.commit((x) => M.markSent(x.invoices.find((i) => i.id === id), d));
      invoiceDetail(view, id);
    },
    paid: async () => {
      const d = await dialog({ title: t('mark_paid'), body: `<p>${t('paid_amount', { s: fmtMoney(s.totalCents) })}</p>`, input: { label: t('paid_on'), type: 'date', value: todayISO() } });
      if (!d) return;
      await V.commit((x) => M.markPaid(x.invoices.find((i) => i.id === id), d));
      toast(t('marked_paid')); invoiceDetail(view, id);
    },
    unpaid: async () => {
      if (!(await confirmBox(t('confirm_unpaid')))) return;
      await V.commit((x) => M.unmarkPaid(x.invoices.find((i) => i.id === id)));
      invoiceDetail(view, id);
    },
    remind: async () => {
      const level = (inv.reminders?.length || 0) + 1;
      const due = await dialog({ title: `${level}. ${t('reminder')}`, body: `<p>${t('reminder_info')}</p>`, input: { label: t('reminder_due'), type: 'date', value: M.reminderDue(db, inv) } });
      if (!due) return;
      const date = todayISO();
      const greeting = greetingFor(p, s);
      await V.commit((x) => { const i = x.invoices.find((y) => y.id === id); i.reminders = [...(i.reminders || []), { level, date, due }]; M.touch(i); });
      await pdfActions(reminderDoc(s, { level, date, due, greeting }), pdfName(s, `Zahlungserinnerung${level > 1 ? level : ''}`), `${level}. ${t('reminder')}`);
      invoiceDetail(view, id);
    },
    storno: async () => {
      if (!(await dialog({ title: t('storno'), body: `<p>${t('confirm_storno', { n: esc(inv.number), s: fmtMoney(s.totalCents) })}</p>${inv.status === 'paid' ? `<p class="hint warn">${t('storno_paid_hint')}</p>` : ''}`, ok: t('storno'), danger: true }))) return;
      const sid = await stornoNow(id);
      if (sid) go('#/rechnung/' + sid);
    },
    correct: async () => {
      if (!(await dialog({ title: t('correct'), body: `<p>${t('confirm_correct', { n: esc(inv.number) })}</p>`, ok: t('correct') }))) return;
      const sid = await stornoNow(id);
      if (!sid) return;
      const c = await V.commit((x) => M.copyAsDraft(x, x.invoices.find((i) => i.id === id), { withDates: true }));
      toast(t('correct_done'));
      go('#/neu/' + c.id);
    },
    del: async () => {
      const pair = inv.cancelledBy ? other(inv.cancelledBy) : null;
      const ok = await dialog({
        title: `${t('del_invoice')} ${inv.number}`,
        body: `<p class="hint danger">${t('del_invoice_warn')}</p>
          ${pair ? `<p>${t('del_invoice_pair', { n: esc(pair.number) })}</p>` : ''}
          ${inv.kind === 'storno' ? `<p>${t('del_storno_restore', { n: esc(inv.cancelsNumber) })}</p>` : ''}
          <p class="small muted">${t('del_invoice_number')}</p>
          <label class="check"><input type="checkbox" id="sure"> ${t('del_invoice_sure')}</label>`,
        ok: t('delete'), danger: true,
        collect: (m) => m.querySelector('#sure').checked || 'unchecked',
      });
      if (!ok) return;
      if (ok === 'unchecked') { toast(t('del_need_check'), 'error'); return; }
      const nums = await V.commit((x) => M.deleteInvoice(x, id));
      toast(t('del_invoice_done', { n: nums.join(', ') }));
      go('#/rechnungen', true);
    },
    copy: async () => {
      const c = await V.commit((x) => M.copyAsDraft(x, x.invoices.find((i) => i.id === id), { withDates: false }));
      toast(t('copied'));
      go('#/neu/' + c.id);
    },
  };
  on(view, '[data-a]', 'click', (e, b) => act[b.dataset.a]?.().catch?.(showErr));
}

function greetingFor(p, s) {
  if (!p || (p.billTo?.enabled && p.billTo.name)) return 'Sehr geehrte Damen und Herren,';
  if (p.salutation === 'Herr') return `Sehr geehrter Herr ${p.lastName},`;
  if (p.salutation === 'Frau') return `Sehr geehrte Frau ${p.lastName},`;
  return `Guten Tag ${s.patientName},`;
}

// Pre dodeljivanja novog broja: pokušaj sinhronizacije, da dva uređaja ne bi dala isti broj.
async function syncBeforeNumber() {
  if (V.status.mode !== 'cloud') return true;
  try {
    await busy(t('syncing'), () => V.syncNow());
    return true;
  } catch {
    return confirmBox(t('offline_number_warn'), { ok: t('continue_anyway'), danger: true });
  }
}

async function stornoNow(id) {
  if (!(await syncBeforeNumber())) return null;
  const s = await V.commit((x) => M.createStorno(x, x.invoices.find((i) => i.id === id)));
  await addHash(s.id);
  toast(t('storno_done', { n: s.number }));
  return s.id;
}

async function addHash(id) {
  const inv = V.db().invoices.find((i) => i.id === id);
  const h = await sha256hex(stableStringify(inv.snapshot));
  await V.commit((x) => { const i = x.invoices.find((y) => y.id === id); i.snapshot.hash = h; });
}

export function showErr(e) {
  console.error(e);
  toast(t('error') + ': ' + (e?.kind ? t('err_' + e.kind) : e?.message || e), 'error');
}

/* ===================== Forma (nacrt) ===================== */

export function invoiceForm(view, id, query) {
  const db = V.db();
  if (!db.patients.length) {
    view.innerHTML = `<h1>${t('new_invoice')}</h1><div class="card"><div class="empty">${t('first_patient')}</div><a class="btn primary" href="#/patient/neu">${t('new_patient')}</a></div>`;
    return;
  }
  let draft;
  let saved = false;
  if (id) {
    const ex = db.invoices.find((i) => i.id === id);
    if (!ex) { view.innerHTML = `<div class="empty">${t('not_found')}</div>`; return; }
    if (ex.status !== 'draft') { go('#/rechnung/' + id, true); return; }
    draft = clone(ex); saved = true;
  } else {
    const pid = query.get('p') && db.patients.some((p) => p.id === query.get('p')) ? query.get('p') : '';
    draft = M.newDraft(db, pid || activePatients(db)[0]?.id);
  }
  let calMonth = ([...draft.dates].sort().pop() || draft.prescriptionDate || todayISO()).slice(0, 7);
  if (!draft.dates.length && draft.invoiceDate) calMonth = draft.invoiceDate.slice(0, 7);
  let saveTimer = null;
  setGuard(null);

  const save = (immediate) => {
    clearTimeout(saveTimer);
    const run = () => {
      const copy = clone(draft);
      M.touch(copy); draft.updatedAt = copy.updatedAt;
      saved = true;
      setStatus('saving');
      return V.commit((x) => {
        const i = x.invoices.findIndex((y) => y.id === copy.id);
        if (i >= 0) { if (x.invoices[i].status !== 'draft') throw new Error(t('already_final')); x.invoices[i] = copy; } else x.invoices.push(copy);
      }).then(() => {
        setStatus('saved');
        if (!id) { id = draft.id; if (location.hash.startsWith('#/neu')) history.replaceState(null, '', '#/neu/' + draft.id); }
      })
        .catch((e) => { setStatus('error'); showErr(e); });
    };
    if (immediate) return run();
    saveTimer = setTimeout(run, 500);
    setStatus('pending');
    return null;
  };
  // izmena -> provera + automatsko čuvanje
  const changed = (what) => {
    M.syncLinked(draft);
    if (what === 'all') renderAll(); else { if (what === 'items') renderItems(); if (what === 'cal') renderCal(); renderSum(); renderChecks(); }
    save();
  };
  const setStatus = (s) => { const e = $('#saveState', view); if (e) { e.textContent = t('ds_' + s); e.className = 'small save-' + s; } };

  function renderAll() {
    const db = V.db();
    const p = db.patients.find((x) => x.id === draft.patientId);
    view.innerHTML = `<a href="#/rechnungen" class="back">${icon('left')} ${t('nav_invoices')}</a>
      <div class="head-row"><h1>${draft.correctionOf ? t('correction_of', { n: esc(draft.correctionOf) }) : saved ? t('edit_draft') : t('new_invoice')}</h1><span id="saveState" class="small"></span></div>
      <div class="card"><h2>${t('patient_presc')}</h2>
        <div class="row">
          <label class="field grow2"><span>${t('patient')}</span><select id="pat">${activePatients(db, draft.patientId).map((x) => `<option value="${x.id}" ${x.id === draft.patientId ? 'selected' : ''}>${esc(M.sortName(x))}${x.institution ? ' · ' + esc(x.institution) : ''}</option>`).join('')}</select></label>
          <label class="field grow"><span>${t('prescription')}</span><select id="rx"><option value="">${t('no_presc_sel')}</option>${(p?.prescriptions || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map((r) => { const u = M.prescriptionUsage(db, p.id, r.id); return `<option value="${r.id}" ${r.id === draft.prescriptionId ? 'selected' : ''}>${dmy(r.date)}${r.doctor ? ' · ' + esc(r.doctor) : ''}${r.sessions ? ` · ${u.billed}/${r.sessions}` : ''}</option>`; }).join('')}</select></label>
          ${draft.prescriptionId ? '' : `<label class="field"><span>${t('presc_of')}</span><input type="date" id="rxDate" value="${draft.prescriptionDate || ''}"></label>`}
        </div>
        <div class="row">
          <label class="field"><span>${t('inv_date')}</span><input type="date" id="idate" value="${draft.invoiceDate}"></label>
          <label class="field"><span>${t('inv_no')}</span><input type="text" id="inum" value="${esc(draft.number || '')}" placeholder="${t('auto_ph', { n: M.nextNumber(db, draft.invoiceDate || todayISO()) })}"></label>
        </div>
        <label class="field"><span>${t('diagnosis')} <small class="muted">${t('pick_hint')}</small></span><input type="text" id="diag" value="${esc(draft.diagnosis || '')}" placeholder="${t('diag_ph')}"></label>
        <div class="chips pick" id="diagChips"></div>
        <label class="check"><input type="checkbox" id="showDiag" ${draft.showDiagnosis ? 'checked' : ''}> ${t('diag_label')}</label>
        <div class="small muted recipient"><b>${t('recipient')}:</b><br><span class="pre">${esc(M.recipientLines(p).join('\n'))}</span>${M.patientLine(p) ? `<br>${t('patient')}: ${esc(M.patientLine(p))}` : ''}
          <br><a href="#/patient/${p?.id}">${t('edit_patient')}</a></div>
      </div>
      <div class="card"><h2>${t('dates_title')} <span class="muted normal" id="dcount"></span></h2>
        <p class="small muted">${t('dates_hint')}</p><div id="cal"></div></div>
      <div class="card"><h2>${t('items')}</h2><p class="small muted">${t('pick_svc')}</p><div class="chips pick" id="svcChips"></div><div id="items"></div><div id="sum"></div>
        <div class="row keep add"><select id="addSvc">${db.services.filter((s) => s.active).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((s) => `<option value="${s.id}">${esc(s.name)} · ${fmtMoney(s.priceCents)} €</option>`).join('')}<option value="">${t('free_item')}</option></select><button class="btn" id="addBtn">${icon('plus')} ${t('add_item')}</button></div></div>
      <div class="card"><h2>${t('internal_note')}</h2><textarea id="note" placeholder="${t('internal_note_ph')}">${esc(draft.note || '')}</textarea></div>
      <div class="card" id="checks"></div>
      <div class="actions sticky-actions">
        <button class="btn" id="preview">${icon('pdf')} ${t('preview')}</button>
        <button class="btn primary" id="finalize">${t('save_final')}</button>
        ${saved ? `<button class="btn danger" id="delDraft">${icon('trash')} ${t('del_draft')}</button>` : ''}
      </div>`;

    $('#pat', view).onchange = (e) => {
      const np = db.patients.find((x) => x.id === e.target.value);
      const fresh = M.newDraft(db, np.id, draft.invoiceDate);
      Object.assign(draft, { patientId: np.id, prescriptionId: fresh.prescriptionId, prescriptionDate: fresh.prescriptionDate, diagnosis: fresh.diagnosis, showDiagnosis: fresh.showDiagnosis });
      if (!draft.dates.length) draft.items = fresh.items;
      changed('all');
    };
    $('#rx', view).onchange = (e) => {
      const r = M.prescriptionOf(p, e.target.value);
      draft.prescriptionId = r?.id || '';
      draft.prescriptionDate = r?.date || '';
      if (r?.diagnosis) draft.diagnosis = r.diagnosis;
      changed('all');
    };
    $('#rxDate', view) && ($('#rxDate', view).onchange = (e) => { draft.prescriptionDate = e.target.value; changed('cal'); });
    $('#idate', view).onchange = (e) => { draft.invoiceDate = e.target.value; changed('cal'); $('#inum', view).placeholder = t('auto_ph', { n: M.nextNumber(db, draft.invoiceDate || todayISO()) }); };
    $('#inum', view).onchange = (e) => { draft.number = e.target.value.trim(); changed(); };
    $('#showDiag', view).onchange = (e) => { draft.showDiagnosis = e.target.checked; changed(); };
    $('#diag', view).oninput = (e) => { draft.diagnosis = e.target.value; renderDiagChips(); };
    $('#diag', view).onchange = (e) => { draft.diagnosis = e.target.value; changed(); };
    $('#note', view).onchange = (e) => { draft.note = e.target.value; changed(); };
    $('#addBtn', view).onclick = () => {
      const s = db.services.find((x) => x.id === $('#addSvc', view).value);
      draft.items.push(s ? M.itemFromService(s, draft.dates.length) : { id: crypto.randomUUID?.() || String(Date.now()), serviceId: '', ziffer: '', desc: '', qty: draft.dates.length || 1, priceCents: 0, linked: !!draft.dates.length });
      changed('items');
    };
    $('#preview', view).onclick = async () => {
      const s = M.buildSnapshot(V.db(), { ...draft, number: draft.number || M.nextNumber(V.db(), draft.invoiceDate), dueDate: addDays(draft.invoiceDate, Number(V.db().praxis.paymentDays) || 14) });
      await pdfActions(invoiceDoc(s, { draft: true }), pdfName(s, 'Entwurf'), t('preview'));
    };
    $('#finalize', view).onclick = () => doFinalize().catch(showErr);
    $('#delDraft', view) && ($('#delDraft', view).onclick = async () => {
      if (!(await confirmBox(t('confirm_del_draft'), { danger: true, ok: t('delete') }))) return;
      clearTimeout(saveTimer);
      await V.commit((x) => M.deleteRecord(x, 'invoices', draft.id));
      go('#/rechnungen');
    });
    renderCal(); renderItems(); renderSum(); renderChecks(); renderDiagChips();
    setStatus(saved ? 'saved' : 'new');
  }

  // Dijagnoze iz liste brzog izbora: klik dodaje/uklanja, i uključuje prikaz na računu
  function renderDiagChips() {
    const list = V.db().praxis.diagnoses || [];
    $('#diagChips', view).innerHTML = list.map((d, i) => `<button type="button" class="chip ${M.hasPick(draft.diagnosis, d) ? 'on' : ''}" data-dg="${i}" aria-pressed="${M.hasPick(draft.diagnosis, d)}">${esc(d)}</button>`).join('')
      + `<a class="chip-link small" href="#/einstellungen/auswahl">${icon('settings')} ${t('edit_picks')}</a>`;
    on(view, '#diagChips [data-dg]', 'click', (e, b) => {
      draft.diagnosis = M.togglePick(draft.diagnosis, list[+b.dataset.dg]);
      $('#diag', view).value = draft.diagnosis;
      if (draft.diagnosis && !draft.showDiagnosis) { draft.showDiagnosis = true; $('#showDiag', view).checked = true; }
      renderDiagChips(); changed();
    });
  }

  // Usluge kao dugmići: klik dodaje stavku (količina = termini) ili je uklanja
  function renderSvcChips() {
    const svcs = V.db().services.filter((s) => s.active).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    $('#svcChips', view).innerHTML = svcs.map((s) => {
      const isOn = draft.items.some((it) => it.serviceId === s.id);
      return `<button type="button" class="chip ${isOn ? 'on' : ''}" data-sv="${s.id}" aria-pressed="${isOn}">${isOn ? '✓ ' : '+ '}${esc(s.name)}</button>`;
    }).join('') + `<a class="chip-link small" href="#/einstellungen/leistungen">${icon('settings')} ${t('edit_picks')}</a>`;
    on(view, '#svcChips [data-sv]', 'click', (e, b) => {
      const s = svcs.find((x) => x.id === b.dataset.sv);
      if (draft.items.some((it) => it.serviceId === s.id)) draft.items = draft.items.filter((it) => it.serviceId !== s.id);
      else draft.items.push(M.itemFromService(s, draft.dates.length));
      changed('items');
    });
  }

  function renderCal() {
    const billed = M.billedDates(V.db(), draft.patientId, draft.id);
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const pad = (first.getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    const today = todayISO();
    const dow = t('dow');
    let cells = dow.map((d) => `<div class="dow">${d}</div>`).join('') + '<div class="d pad"></div>'.repeat(pad);
    for (let d = 1; d <= days; d++) {
      const iso = toISO(new Date(y, m - 1, d));
      const on = draft.dates.includes(iso);
      const b = billed.get(iso);
      const cls = ['d', on && 'on', b && 'billed', iso === today && 'today',
        (draft.prescriptionDate && iso < draft.prescriptionDate) && 'before', (iso > draft.invoiceDate) && 'after'].filter(Boolean).join(' ');
      cells += `<button type="button" class="${cls}" data-d="${iso}" ${b && !on ? `title="${t('billed_in', { n: esc(b) })}"` : ''} aria-pressed="${on}">${d}</button>`;
    }
    $('#cal', view).innerHTML = `<div class="cal"><div class="calhead"><button type="button" class="btn sm" id="prevM" aria-label="${t('prev_month')}">${icon('left')}</button><b>${monthName(calMonth)}</b><button type="button" class="btn sm" id="nextM" aria-label="${t('next_month')}">${icon('right')}</button></div>
      <div class="grid">${cells}</div>
      <div class="legend small muted"><span><i class="sw on"></i>${t('lg_selected')}</span><span><i class="sw billed"></i>${t('lg_billed')}</span>${draft.prescriptionDate ? `<span><i class="sw before"></i>${t('lg_before')}</span>` : ''}</div></div>
      <div class="chips">${[...draft.dates].sort().map((x) => `<button type="button" class="chip" data-rm="${x}" title="${t('remove')}">${dmy(x).slice(0, 6)}${x.slice(2, 4)} ✕</button>`).join('')}</div>
      ${draft.dates.length ? `<button type="button" class="btn sm" id="clearDates">${t('clear_dates')}</button>` : ''}`;
    $('#dcount', view).textContent = `(${t('appts', { n: draft.dates.length })})`;
    $('#prevM', view).onclick = () => { calMonth = shiftMonth(calMonth, -1); renderCal(); };
    $('#nextM', view).onclick = () => { calMonth = shiftMonth(calMonth, 1); renderCal(); };
    on(view, '#cal .d[data-d]', 'click', (e, b) => {
      const x = b.dataset.d;
      if (billed.has(x) && !draft.dates.includes(x)) { toast(t('billed_in', { n: billed.get(x) }), 'error'); return; }
      draft.dates = draft.dates.includes(x) ? draft.dates.filter((z) => z !== x) : [...draft.dates, x].sort();
      changed('cal'); renderItemsQty();
    });
    on(view, '#cal [data-rm]', 'click', (e, b) => { draft.dates = draft.dates.filter((z) => z !== b.dataset.rm); changed('cal'); renderItemsQty(); });
    $('#clearDates', view) && ($('#clearDates', view).onclick = async () => {
      if (await confirmBox(t('confirm_clear_dates'))) { draft.dates = []; changed('cal'); renderItemsQty(); }
    });
  }

  function renderItems() {
    renderSvcChips();
    $('#items', view).innerHTML = draft.items.length ? draft.items.map((it, i) => `<div class="item" data-i="${i}">
      <div class="top"><span class="pos">${i + 1}.</span><input type="text" data-k="desc" value="${esc(it.desc)}" aria-label="${t('service')}"><button type="button" class="btn sm icon-only" data-del="${i}" aria-label="${t('remove')}">${icon('trash')}</button></div>
      <div class="grid3">
        <label><span class="lbl">${t('qty')}</span><input type="number" inputmode="numeric" min="1" step="1" data-k="qty" value="${it.qty}" ${it.linked ? 'disabled' : ''}></label>
        <label><span class="lbl">${t('unit')} (€)</span><input type="text" inputmode="decimal" data-k="price" value="${moneyInput(it.priceCents)}" class="${it.priceCents > 0 ? '' : 'bad'}"></label>
        <div class="lsum">${fmtMoney(M.lineTotal(it))} €</div>
      </div>
      <div class="row keep itemopts"><label class="check small"><input type="checkbox" data-k="linked" ${it.linked ? 'checked' : ''}> ${t('linked')}</label>
      <label class="small ziffer"><span class="muted">${t('ziffer')}</span> <input type="text" data-k="ziffer" value="${esc(it.ziffer || '')}"></label></div>
    </div>`).join('') : `<div class="empty">${t('no_items')}</div>`;
    on(view, '#items [data-k]', 'change', (e, inp) => {
      const it = draft.items[+inp.closest('.item').dataset.i];
      const k = inp.dataset.k;
      if (k === 'desc') it.desc = inp.value;
      if (k === 'ziffer') it.ziffer = inp.value.trim();
      if (k === 'qty') it.qty = Math.max(0, Math.round(Number(inp.value) || 0));
      if (k === 'price') {
        const c = parseMoney(inp.value);
        if (Number.isNaN(c) || c < 0) { toast(t('bad_price'), 'error'); inp.value = moneyInput(it.priceCents); return; }
        it.priceCents = c; inp.value = moneyInput(c); inp.classList.toggle('bad', c <= 0);
      }
      if (k === 'linked') { it.linked = inp.checked; changed('items'); return; }
      $('.lsum', inp.closest('.item')).textContent = fmtMoney(M.lineTotal(it)) + ' €';
      changed();
    });
    on(view, '#items [data-del]', 'click', (e, b) => { draft.items.splice(+b.dataset.del, 1); changed('items'); });
  }

  function renderItemsQty() {
    $$('#items .item', view).forEach((el) => {
      const it = draft.items[+el.dataset.i];
      $('[data-k="qty"]', el).value = it.qty;
      $('.lsum', el).textContent = fmtMoney(M.lineTotal(it)) + ' €';
    });
  }

  function renderSum() {
    $('#sum', view).innerHTML = `<div class="sumline"><span>${t('grand')}</span><span>${fmtMoney(M.invoiceTotal(draft))} €</span></div>`;
  }

  function renderChecks() {
    const v = M.validate(V.db(), draft);
    const li = (x, cls) => `<li class="${cls}">${icon(cls === 'err' ? 'warn' : 'warn')} <span>${t(x.k, x.p || {})}${x.k.startsWith('v_praxis') ? ` <a href="#/einstellungen">${t('fix')}</a>` : ''}</span></li>`;
    $('#checks', view).innerHTML = `<h2>${t('checks')}</h2>${v.errors.length || v.warnings.length ? `<ul class="checks">${v.errors.map((x) => li(x, 'err')).join('')}${v.warnings.map((x) => li(x, 'wrn')).join('')}</ul>` : `<p class="ok">${icon('check')} ${t('checks_ok')}</p>`}`;
    $('#finalize', view).disabled = v.errors.length > 0;
  }

  async function doFinalize() {
    await save(true);
    if (!(await syncBeforeNumber())) return;
    const cur = V.db().invoices.find((i) => i.id === draft.id);
    if (!cur || cur.status !== 'draft') { toast(t('already_final'), 'error'); go('#/rechnungen'); return; }
    const v = M.validate(V.db(), cur);
    if (v.errors.length) { renderChecks(); toast(t('fix_errors'), 'error'); return; }
    const num = cur.number || M.nextNumber(V.db(), cur.invoiceDate);
    const body = `<p>${t('confirm_final', { n: esc(num), s: fmtMoney(M.invoiceTotal(cur)) })}</p>
      ${v.warnings.length ? `<p><b>${t('warnings')}:</b></p><ul class="checks">${v.warnings.map((x) => `<li class="wrn">${icon('warn')} <span>${t(x.k, x.p || {})}</span></li>`).join('')}</ul>` : ''}`;
    if (!(await dialog({ title: t('save_final'), body, ok: t('finalize_n', { n: num }) }))) return;
    await V.commit((x) => { const i = M.finalize(x, x.invoices.find((y) => y.id === draft.id)); if (i.showDiagnosis) M.learnPicks(x, 'diagnoses', i.diagnosis); });
    await addHash(draft.id);
    const fin = V.db().invoices.find((i) => i.id === draft.id);
    toast(t('finalized_as', { n: fin.number }));
    go('#/rechnung/' + draft.id);
    pdfActions(invoiceDoc(fin.snapshot), pdfName(fin.snapshot), `${t('invoice')} ${fin.number}`).catch(showErr);
  }

  renderAll();
}

function activePatients(db, keepId) {
  return db.patients.filter((p) => !p.archived || p.id === keepId).sort((a, b) => M.sortName(a).localeCompare(M.sortName(b), 'de'));
}

function shiftMonth(ym, n) {
  const d = parseISO(ym + '-01');
  d.setMonth(d.getMonth() + n);
  return toISO(d).slice(0, 7);
}

export { pdfActions };
