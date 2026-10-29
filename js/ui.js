// DOM pomoćnici: dijalozi, obaveštenja, preuzimanje fajlova.

import { esc } from './util.js';
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, sel, ev, fn) {
  $$(sel, root).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
}

export function toast(msg, kind = 'info', ms = 2600) {
  const box = $('#toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toasts' }));
  const e = document.createElement('div');
  e.className = 'toast ' + kind;
  e.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  e.textContent = msg;
  box.appendChild(e);
  setTimeout(() => e.remove(), kind === 'error' ? Math.max(ms, 6000) : ms);
}

// Dijalog. opts: {title, body (HTML), ok, cancel, danger, input:{label, value, type}, wide}
export function dialog(opts) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="box${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      ${opts.title ? `<h2>${esc(opts.title)}</h2>` : ''}
      <div class="mbody">${opts.body || ''}</div>
      ${opts.input ? `<label class="field"><span>${esc(opts.input.label || '')}</span><input id="mIn" type="${opts.input.type || 'text'}" value="${esc(opts.input.value || '')}" autocomplete="${opts.input.type === 'password' ? 'current-password' : 'off'}"></label>` : ''}
      <div class="actions end">
        ${opts.cancel === false ? '' : `<button class="btn" data-r="0">${esc(opts.cancel || t('cancel'))}</button>`}
        <button class="btn ${opts.danger ? 'danger solid' : 'primary'}" data-r="1">${esc(opts.ok || t('ok'))}</button>
      </div></div>`;
    document.body.appendChild(m);
    const input = $('#mIn', m);
    const close = (v) => { m.remove(); document.removeEventListener('keydown', key); prevFocus?.focus?.(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter' && input && document.activeElement === input) $('[data-r="1"]', m).click(); };
    document.addEventListener('keydown', key);
    $$('[data-r]', m).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.r === '1') close(opts.collect ? opts.collect(m) : input ? input.value : true); else close(false);
    }));
    m.addEventListener('click', (e) => { if (e.target === m) close(false); });
    (input || $('[data-r="1"]', m)).focus();
    if (opts.onOpen) opts.onOpen(m);
  });
}

export const confirmBox = (body, opts = {}) => dialog({ body: `<p>${esc(body)}</p>`, ...opts });

// Prekrivač za duže operacije (npr. izvođenje ključa iz šifre ~1 s)
export async function busy(label, fn) {
  const o = document.createElement('div');
  o.className = 'busy-overlay';
  o.innerHTML = `<div class="spinner" aria-hidden="true"></div><div>${esc(label)}</div>`;
  document.body.appendChild(o);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  try { return await fn(); } finally { o.remove(); }
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function openBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) download(blob, name);
  setTimeout(() => URL.revokeObjectURL(url), 300_000);
}

export async function share(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return true; } catch (e) { if (e.name === 'AbortError') return true; }
  }
  download(blob, name);
  return false;
}

export const canShareFiles = () => {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); } catch { return false; }
};

export function readFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

export const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  invoice: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 8a3 3 0 1 1 0 6M22 21a5 5 0 0 0-5-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pdf: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 15h6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
};
