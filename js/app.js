// Pokretanje aplikacije, ruter, okvir (meni, statusna traka).

import * as V from './vault.js';
import { t, applyLang } from './i18n.js';
import { $, $$, toast, icon, confirmBox } from './ui.js';
import { renderAuth } from './views/auth.js';
import { dashboard } from './views/dashboard.js';
import { invoiceList, invoiceDetail, invoiceForm, showErr } from './views/invoices.js';
import { patientList, patientForm } from './views/patients.js';
import { settings } from './views/settings.js';
import { dataView } from './views/data.js';

const root = $('#root');

const NAV = [
  ['/', 'home', 'nav_home'],
  ['/rechnungen', 'invoice', 'nav_invoices'],
  ['/patienten', 'users', 'nav_patients'],
  ['/einstellungen', 'settings', 'nav_settings'],
  ['/daten', 'cloud', 'nav_data'],
];
const ROUTES = {
  '/': dashboard,
  '/rechnungen': invoiceList,
  '/rechnung': invoiceDetail,
  '/neu': invoiceForm,
  '/patienten': patientList,
  '/patient': patientForm,
  '/einstellungen': settings,
  '/daten': dataView,
};
// Ekrani koji se automatski osvežavaju kad stignu izmene sa drugog uređaja
const LIVE = new Set(['/', '/rechnungen', '/rechnung', '/patienten', '/daten']);

let guard = null;
let lastHash = location.hash || '#/';
let restoring = false;
let currentPath = null;

// Forma prijavljuje "ima nesačuvanih izmena" preko ove funkcije
export function setGuard(fn) { guard = fn; }

export function go(hash, replace = false) {
  if (location.hash === hash) { route(true); return; }
  if (replace) { history.replaceState(null, '', hash); route(true); } else location.hash = hash;
}

function parse() {
  const h = (location.hash || '#/').slice(1);
  const [p, qs] = h.split('?');
  const parts = p.split('/').filter(Boolean);
  return { path: '/' + (parts[0] || ''), arg: parts[1] ? decodeURIComponent(parts[1]) : undefined, query: new URLSearchParams(qs || '') };
}

function shell() {
  if ($('#view')) return;
  root.innerHTML = `<div class="app">
    <header class="topbar"><a href="#/" class="brand">${icon('invoice')}<b>Physio-Rechnung</b></a><button type="button" id="syncBadge" class="sync-badge"></button></header>
    <nav class="side" aria-label="Hauptmenü">
      <a href="#/" class="brand">${icon('invoice')}<div><b>Physio-Rechnung</b><span id="brandName"></span></div></a>
      ${NAV.map(([r, ic, k]) => `<a href="#${r}" data-route="${r}">${icon(ic)}<span data-t="${k}">${t(k)}</span></a>`).join('')}
      <div class="side-foot"><button type="button" id="syncBadge2" class="sync-badge"></button><button type="button" class="btn sm" id="lockBtn">${icon('lock')} ${t('lock_now')}</button></div>
    </nav>
    <a class="fab" href="#/neu" aria-label="${t('new_invoice')}">${icon('plus')}</a>
    <main id="view" tabindex="-1"></main>
  </div><div id="toasts" aria-live="polite"></div>`;
  $('#lockBtn').onclick = () => V.lock();
  $$('.sync-badge').forEach((b) => { b.onclick = () => { location.hash = '#/daten'; }; });
}

function updateBadge() {
  const s = V.status;
  let cls = 'ok', txt;
  if (s.mode === 'local') { cls = 'local'; txt = t('badge_local'); }
  else if (s.sync === 'busy') { cls = 'busy'; txt = t('badge_busy'); }
  else if (s.sync === 'error') { cls = 'err'; txt = s.error === 'offline' ? t('badge_offline') : t('badge_error'); }
  else if (s.dirty) { cls = 'busy'; txt = t('badge_pending'); }
  else txt = t('badge_ok');
  $$('.sync-badge').forEach((b) => { b.className = 'sync-badge ' + cls; b.innerHTML = `<i></i>${txt}`; b.title = s.lastSyncAt ? t('last_sync') + ': ' + new Date(s.lastSyncAt).toLocaleString() : ''; });
  const bn = $('#brandName'); if (bn && V.db()) bn.textContent = V.db().praxis.name || '';
}

export async function route(force = false) {
  if (!V.isUnlocked()) { currentPath = null; root.innerHTML = ''; return renderAuth(root, start); }
  if (restoring) { restoring = false; return; }
  if (!force && location.hash === lastHash && currentPath) return;
  if (guard && guard()) {
    if (!(await confirmBox(t('leave_unsaved'), { ok: t('leave'), danger: true }))) { restoring = true; location.hash = lastHash; return; }
  }
  guard = null;
  lastHash = location.hash || '#/';
  shell();
  const { path, arg, query } = parse();
  currentPath = path;
  const navPath = { '/rechnung': '/rechnungen', '/neu': '/rechnungen', '/patient': '/patienten' }[path] || path;
  $$('nav.side a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === navPath));
  $('.app').classList.toggle('form-page', ['/neu', '/patient', '/einstellungen'].includes(path));
  const view = $('#view');
  view.innerHTML = '';
  try {
    await (ROUTES[path] || dashboard)(view, arg, query);
  } catch (e) { showErr(e); }
  updateBadge();
  if (!force) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}

function start() {
  lastHash = '';
  route(true);
}

V.onChange((what) => {
  if (what === 'lock') { guard = null; route(true); return; }
  if (what === 'sync' || what === 'change') updateBadge();
  if (what === 'remote' && currentPath && LIVE.has(currentPath) && !guard) {
    const y = window.scrollY;
    route(true).then(() => window.scrollTo(0, y));
  } else if (what === 'remote') updateBadge();
  if (what === 'error') toast(t('save_failed'), 'error', 10000);
});

window.addEventListener('hashchange', () => route());

// aktivnost korisnika odlaže automatsko zaključavanje
let lastAct = 0;
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  if (Date.now() - lastAct > 30_000) { lastAct = Date.now(); V.resetIdle(); }
}, { passive: true }));

// kad se aplikacija skloni (telefon, drugi tab) — odmah sačuvaj u oblak
document.addEventListener('visibilitychange', () => {
  if (!V.isUnlocked()) return;
  if (document.visibilityState === 'hidden' && V.status.dirty) V.syncNow().catch(() => {});
  if (document.visibilityState === 'visible') V.syncNow().catch(() => {});
});
window.addEventListener('online', () => { if (V.isUnlocked()) V.syncNow().catch(() => {}); });
window.addEventListener('beforeunload', (e) => {
  if (V.isUnlocked() && ((V.status.mode === 'cloud' && V.status.dirty) || (guard && guard()))) { e.preventDefault(); e.returnValue = ''; }
});

// Service worker samo omogućava rad bez interneta; kad ima mreže, uvek se učitava najnovija verzija.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async () => {
  applyLang();
  try {
    if (await V.tryResume()) { start(); return; }
  } catch (e) { console.error(e); }
  route(true);
})();
