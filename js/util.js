// Pomoćne funkcije bez zavisnosti od DOM-a (testiraju se u Node-u).
// Novac se svuda čuva u CENTIMA (cele brojeve) da ne bi bilo grešaka zaokruživanja.

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- Novac ---------- */

// 114600 -> "1.146,00"
export function fmtMoney(c) {
  c = Math.round(Number(c) || 0);
  const neg = c < 0;
  const abs = Math.abs(c);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + euros + ',' + pad2(abs % 100);
}

// "29,70" | "29.70" | "1.146,00" | "1146" | "29,7 €" -> cente; NaN ako nije broj.
export function parseMoney(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s * 100) : NaN;
  s = String(s ?? '').replace(/[\s€]/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [i, f = ''] = s.split('.');
  const c = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -c : c;
}

// cente -> "29,70" za polja za unos
export const moneyInput = (c) => fmtMoney(c).replace(/\./g, '');

/* ---------- Datumi (uvek lokalno vreme, nikad UTC) ---------- */

export function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export const todayISO = () => toISO(new Date());

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
export const isISODate = (s) => parseISO(s) !== null;

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

// "2026-09-04" -> "04.09.2026"
export const dmy = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
// "2026-09-04" -> "04.09."
export const dm = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '');

// Lista termina kao na Dejanovom računu: "10.06. • 13.06. • ... • 04.09.2026"
// Ako termini prelaze preko godine, svaki poslednji dan u godini dobija i godinu.
export function datesLine(dates) {
  const s = [...dates].sort();
  return s.map((d, i) => {
    const lastOfYear = i === s.length - 1 || s[i + 1].slice(0, 4) !== d.slice(0, 4);
    return lastOfYear ? dmy(d) : dm(d);
  }).join(' • ');
}

export function nowStamp() {
  return new Date().toISOString();
}

/* ---------- Tekst ---------- */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// Za imena fajlova: "Blümel" -> "Bluemel"
export function fileSafe(s) {
  return String(s ?? '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ---------- IBAN (ISO 13616, provera mod 97) ---------- */

export const ibanCompact = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

export function ibanValid(s) {
  const iban = ibanCompact(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const r = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const v = ch >= 'A' ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export const ibanFormat = (s) => ibanCompact(s).replace(/(.{4})/g, '$1 ').trim();

/* ---------- Stabilan JSON (isti sadržaj -> isti string) ---------- */

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
