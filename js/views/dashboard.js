// Početni pregled: otvoreni iznosi, dospeli računi, nacrti, upozorenja.

import * as V from '../vault.js';
import * as M from '../model.js';
import { t, locale } from '../i18n.js';
import { icon } from '../ui.js';
import { esc, fmtMoney, ibanValid, norm } from '../util.js';
import { invoiceTable, bindRows } from './invoices.js';

export async function dashboard(view) {
  const db = V.db();
  const s = M.stats(db);
  const st = await V.getState();
  const pr = db.praxis;
  const banners = [];

  const conflicts = M.numberConflicts(db);
  if (conflicts.length) banners.push(['danger', t('b_conflict', { n: conflicts.join(', ') }), '#/rechnungen']);
  if (V.status.mode === 'cloud' && V.status.error === 'auth') banners.push(['danger', t('b_token'), '#/daten']);
  else if (V.status.mode === 'cloud' && V.status.sync === 'error') banners.push(['warn', t('b_sync_err'), '#/daten']);
  if (!norm(pr.name) || !norm(pr.street) || !norm(pr.steuernummer) || !ibanValid(pr.iban)) banners.push(['warn', t('b_praxis'), '#/einstellungen']);
  if (db.services.some((x) => x.active && !(x.priceCents > 0))) banners.push(['info', t('b_prices'), '#/einstellungen/leistungen']);
  if (V.status.mode === 'local') {
    const days = st.lastExportAt ? (Date.now() - Date.parse(st.lastExportAt)) / 864e5 : Infinity;
    if (days > 14) banners.push(['warn', t('b_export'), '#/daten']);
  }

  view.innerHTML = `<div class="head-row"><h1>${t('nav_home')}</h1><span class="muted">${new Date().toLocaleDateString(locale(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
    ${banners.map(([k, m, href]) => `<a class="hint ${k} banner" href="${href}">${icon('warn')} <span>${esc(m)}</span></a>`).join('')}
    <div class="stats">
      <a class="stat" href="#/rechnungen?s=open"><div class="v">${fmtMoney(s.openCents)} €</div><div class="l">${t('open_sum', { n: s.openCount })}</div></a>
      <a class="stat ${s.overdue.length ? 'alert' : ''}" href="#/rechnungen?s=overdue"><div class="v">${s.overdue.length}</div><div class="l">${t('overdue')}</div></a>
      <div class="stat"><div class="v">${fmtMoney(s.monthCents)} €</div><div class="l">${t('month_sum')}</div></div>
      <div class="stat"><div class="v">${fmtMoney(s.yearCents)} €</div><div class="l">${t('year_sum')}</div></div>
    </div>
    <div class="actions"><a class="btn primary" href="#/neu">${icon('plus')} ${t('new_invoice')}</a><a class="btn" href="#/patient/neu">${t('new_patient')}</a></div>
    ${s.drafts.length ? `<div class="card"><h2>${t('drafts')}</h2>${invoiceTable(s.drafts)}</div>` : ''}
    ${s.overdue.length ? `<div class="card"><h2>${t('overdue')}</h2>${invoiceTable(s.overdue)}</div>` : ''}
    <div class="card"><h2>${t('open_invoices')}</h2>${s.openCount ? invoiceTable(db.invoices.filter((i) => M.OPEN.includes(i.status)).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))) : `<div class="empty">${t('all_paid')}</div>`}</div>`;
  bindRows(view);
}
