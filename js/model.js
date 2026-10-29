// Poslovna logika: računi, brojevi, provere, storno, spajanje podataka sa više uređaja.
// Bez DOM-a, da bi se sve moglo testirati u Node-u (npm test).

import {
  uid, nowStamp, todayISO, addDays, daysBetween, isISODate, dmy, fmtMoney,
  ibanValid, clone, norm, datesLine,
} from './util.js';

export const SCHEMA = 1;
export const COLLECTIONS = ['services', 'patients', 'invoices'];

export const DEFAULT_PRAXIS = {
  name: '', title: 'Staatlich examinierter Physiotherapeut',
  street: '', plz: '', city: '', phone: '', email: '',
  steuernummer: '', iban: '', bic: '', bank: '', bankHolder: '',
  paymentDays: 14,
  taxNote: 'Gemäß § 4 Nr. 14 lit. a UStG wird keine Umsatzsteuer erhoben (steuerfreie heilberufliche Leistung).',
  introText: 'Für die im Rahmen der ärztlichen Verordnung vom {verordnung} erbrachten physiotherapeutischen Leistungen stelle ich Ihnen folgende Positionen in Rechnung:',
  introNoPresc: 'Für die erbrachten physiotherapeutischen Leistungen stelle ich Ihnen folgende Positionen in Rechnung:',
  closing: 'Vielen Dank für das entgegengebrachte Vertrauen.',
  reminderDays: 10,
  updatedAt: '',
};

const SERVICE_SEED = [
  ['KG', 'Krankengymnastik', 2970, 20],
  ['HB', 'Hausbesuch', 2760, null],
  ['MT', 'Manuelle Therapie', 0, 20],
  ['MLD30', 'Manuelle Lymphdrainage 30 Min.', 0, 30],
  ['MLD45', 'Manuelle Lymphdrainage 45 Min.', 0, 45],
  ['KMT', 'Klassische Massagetherapie', 0, 20],
  ['KGG', 'Gerätegestützte Krankengymnastik', 0, 60],
  ['WP', 'Wärmepackung', 0, null],
];

// Brzi izbor: dijagnoze i lekari koji se biraju klikom (lista se menja u Podešavanjima i sama dopunjuje)
export const DIAG_SEED = [
  'M54.4 Lumboischialgie',
  'M54.2 Zervikalneuralgie',
  'M51.2 Bandscheibenverlagerung',
  'M17.1 Primäre Gonarthrose',
  'M16.1 Primäre Koxarthrose',
  'M75.1 Läsion der Rotatorenmanschette',
  'Z96.6 Z. n. Gelenkendoprothese',
  'I69.3 Folgen eines Hirninfarktes',
  'R26.8 Gangstörung / eingeschränkte Mobilität',
];
export const PICK_KINDS = ['diagnoses', 'doctors'];

// Više dijagnoza u jednom polju razdvojeno je sa "; "
export const splitPicks = (s) => String(s || '').split(/\s*;\s*/).map(norm).filter(Boolean);

export function togglePick(text, item) {
  const parts = splitPicks(text);
  const i = parts.findIndex((x) => x.toLowerCase() === item.toLowerCase());
  if (i >= 0) parts.splice(i, 1); else parts.push(item);
  return parts.join('; ');
}

export const hasPick = (text, item) => splitPicks(text).some((x) => x.toLowerCase() === item.toLowerCase());

// Upisuje nove vrednosti u listu brzog izbora (bez duplikata); vraća true ako je nešto dodato
export function learnPicks(db, kind, text) {
  const list = db.praxis[kind] || (db.praxis[kind] = []);
  let added = false;
  for (const v of kind === 'diagnoses' ? splitPicks(text) : [norm(text)].filter(Boolean)) {
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) { list.push(v); added = true; }
  }
  if (added) touch(db.praxis);
  return added;
}

export const INSURANCE = ['selbstzahler', 'pkv', 'beihilfe', 'gkv'];
export const STATUSES = ['draft', 'final', 'sent', 'paid', 'cancelled', 'storno'];
export const OPEN = ['final', 'sent'];
// Računi koji su važeći prihod (storno i stornirani se međusobno poništavaju i ne broje se)
export const BILLED = ['final', 'sent', 'paid'];

export function newDB() {
  const t = nowStamp();
  return {
    schema: SCHEMA,
    praxis: { ...DEFAULT_PRAXIS, diagnoses: [...DIAG_SEED], doctors: [], updatedAt: t },
    services: SERVICE_SEED.map(([code, name, priceCents, minutes], i) => ({
      id: uid(), code, name, priceCents, minutes, ziffer: '', active: true, sort: i,
      createdAt: t, updatedAt: t,
    })),
    patients: [],
    invoices: [],
    tombstones: {},
    meta: { createdAt: t },
  };
}

// Dopunjava polja koja nedostaju (stariji podaci, uvoz) — nikad ne briše postojeće.
export function migrate(db) {
  if (!db || typeof db !== 'object') throw new Error('Ungültige Daten');
  db.schema = db.schema || SCHEMA;
  if (db.schema > SCHEMA) throw new Error('Daten stammen aus einer neueren Programmversion. Bitte Seite neu laden.');
  db.praxis = { ...DEFAULT_PRAXIS, ...(db.praxis || {}) };
  if (!Array.isArray(db.praxis.diagnoses)) db.praxis.diagnoses = [...DIAG_SEED];
  if (!Array.isArray(db.praxis.doctors)) db.praxis.doctors = [];
  for (const c of COLLECTIONS) db[c] = Array.isArray(db[c]) ? db[c] : [];
  db.tombstones = db.tombstones || {};
  db.meta = db.meta || {};
  for (const p of db.patients) {
    p.prescriptions = Array.isArray(p.prescriptions) ? p.prescriptions : [];
    p.billTo = p.billTo || { enabled: false, name: '', extra: '', street: '', plz: '', city: '' };
  }
  for (const i of db.invoices) {
    i.items = i.items || [];
    i.dates = i.dates || [];
    i.reminders = i.reminders || [];
    i.kind = i.kind || 'invoice';
  }
  return db;
}

export const touch = (rec) => { rec.updatedAt = nowStamp(); return rec; };

/* ===================== Iznosi ===================== */

export const lineTotal = (it) => Math.round((Number(it.qty) || 0) * (Number(it.priceCents) || 0));
export const invoiceTotal = (inv) => inv.items.reduce((s, it) => s + lineTotal(it), 0);
export const amountOf = (inv) => (inv.snapshot ? inv.snapshot.totalCents : invoiceTotal(inv));

/* ===================== Pacijent / primalac ===================== */

export const fullName = (p) => norm(`${p?.firstName || ''} ${p?.lastName || ''}`);
export const sortName = (p) => (p ? norm(`${p.lastName || ''}, ${p.firstName || ''}`).replace(/^, |, $/g, '') : '–');

export function recipientLines(p) {
  if (!p) return [];
  const b = p.billTo;
  if (b && b.enabled && norm(b.name)) {
    return [b.name, b.extra, b.street, norm(`${b.plz || ''} ${b.city || ''}`)].map(norm).filter(Boolean);
  }
  const sal = p.salutation === 'Herr' ? 'Herrn' : (p.salutation || '');
  return [
    norm(`${sal ? 'An ' + sal + ' ' : ''}${fullName(p)}`),
    p.institution, p.street, norm(`${p.plz || ''} ${p.city || ''}`),
  ].map(norm).filter(Boolean);
}

// Linija "Patient: ..." ide na račun kada je primalac neko drugi, ili za PKV/Beihilfe sa datumom rođenja.
export function patientLine(p) {
  if (!p) return '';
  const showBirth = p.birthDate && ['pkv', 'beihilfe'].includes(p.insurance);
  if (!(p.billTo && p.billTo.enabled && norm(p.billTo.name)) && !showBirth) return '';
  return `${fullName(p)}${p.birthDate ? ', geb. ' + dmy(p.birthDate) : ''}`;
}

export const prescriptionOf = (p, id) => p?.prescriptions?.find((x) => x.id === id) || null;

// Poslednja (najnovija) Verordnung pacijenta
export function latestPrescription(p) {
  const l = [...(p?.prescriptions || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return l[0] || null;
}

/* ===================== Brojevi računa (format MMYY/NN) ===================== */

export function numberPrefix(isoDate) {
  return `${isoDate.slice(5, 7)}${isoDate.slice(2, 4)}/`;
}

export function nextNumber(db, isoDate) {
  const prefix = numberPrefix(isoDate);
  let max = 0;
  for (const i of db.invoices) {
    if (!i.number || !i.number.startsWith(prefix)) continue;
    const n = Number(i.number.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(2, '0');
}

// Broj je zauzet ako ga ima bilo koji drugi ne-nacrt račun (i stornirani zadržavaju broj!)
export function numberTaken(db, number, exceptId) {
  const n = norm(number);
  return db.invoices.some((i) => i.id !== exceptId && i.status !== 'draft' && norm(i.number) === n);
}

export function numberConflicts(db) {
  const seen = new Map();
  for (const i of db.invoices) {
    if (i.status === 'draft' || !i.number) continue;
    seen.set(i.number, (seen.get(i.number) || 0) + 1);
  }
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n);
}

/* ===================== Termini i Verordnung ===================== */

// Datumi koji su već fakturisani tom pacijentu (u važećim računima): datum -> broj računa
export function billedDates(db, patientId, exceptInvoiceId) {
  const m = new Map();
  for (const i of db.invoices) {
    if (i.id === exceptInvoiceId || i.patientId !== patientId || i.kind !== 'invoice') continue;
    if (!BILLED.includes(i.status)) continue;
    for (const d of i.dates) m.set(d, i.number);
  }
  return m;
}

export function prescriptionUsage(db, patientId, prescriptionId) {
  let billed = 0, drafted = 0;
  for (const i of db.invoices) {
    if (i.patientId !== patientId || i.prescriptionId !== prescriptionId || i.kind !== 'invoice') continue;
    if (BILLED.includes(i.status)) billed += i.dates.length;
    else if (i.status === 'draft') drafted += i.dates.length;
  }
  return { billed, drafted };
}

/* ===================== Nacrt računa ===================== */

export function newDraft(db, patientId, today = todayISO()) {
  const p = db.patients.find((x) => x.id === patientId);
  const presc = latestPrescription(p);
  const inv = {
    id: uid(), kind: 'invoice', status: 'draft', number: '', patientId: patientId || '',
    prescriptionId: presc?.id || '', prescriptionDate: presc?.date || '',
    diagnosis: presc?.diagnosis || '', showDiagnosis: !!(p && ['pkv', 'beihilfe'].includes(p.insurance)),
    invoiceDate: today, dates: [], items: [], note: '',
    reminders: [], createdAt: nowStamp(), updatedAt: nowStamp(),
  };
  for (const code of rxServices(p, presc)) {
    const s = db.services.find((x) => x.code === code && x.active);
    if (s) inv.items.push(itemFromService(s, 0));
  }
  return inv;
}

// Usluge koje Verordnung unapred bira na računu (podrazumevano KG, uz HB ako je pacijent u ustanovi)
export function rxServices(p, presc) {
  return presc?.services?.length ? presc.services : ['KG', ...(p?.institution ? ['HB'] : [])];
}

export function itemFromService(s, qty) {
  return { id: uid(), serviceId: s.id, ziffer: s.ziffer || '', desc: s.name, qty, priceCents: s.priceCents, linked: true };
}

// Stavke "vezane za termine" uvek imaju količinu = broj termina
export function syncLinked(inv) {
  for (const it of inv.items) if (it.linked) it.qty = inv.dates.length;
  return inv;
}

/* ===================== Provere pre finalizacije ===================== */

// Vraća {errors, warnings}; svaki element je {k: ključ prevoda, p: parametri}
export function validate(db, inv, today = todayISO()) {
  const errors = [], warnings = [];
  const E = (k, p) => errors.push({ k, p }), W = (k, p) => warnings.push({ k, p });
  const pr = db.praxis;
  const p = db.patients.find((x) => x.id === inv.patientId);

  if (!norm(pr.name) || !norm(pr.street) || !norm(pr.plz) || !norm(pr.city)) E('v_praxis_addr');
  if (!norm(pr.steuernummer)) E('v_praxis_taxno');
  if (!ibanValid(pr.iban)) E('v_praxis_iban');
  if (!p) E('v_no_patient');
  else if (recipientLines(p).length < 3) E('v_recipient_addr');

  if (!isISODate(inv.invoiceDate)) E('v_inv_date');
  else if (inv.invoiceDate > today) W('v_inv_date_future');

  if (inv.number && numberTaken(db, inv.number, inv.id)) E('v_number_taken', { n: inv.number });
  if (inv.number && !/^\S+$/.test(inv.number)) E('v_number_format');

  if (!inv.items.length) E('v_no_items');
  inv.items.forEach((it, idx) => {
    const pos = idx + 1;
    if (!norm(it.desc)) E('v_item_desc', { pos });
    if (!(Number.isInteger(it.qty) && it.qty > 0)) E('v_item_qty', { pos });
    if (!(Number.isInteger(it.priceCents) && it.priceCents > 0)) E('v_item_price', { pos });
    if (!it.linked && inv.dates.length && it.qty !== inv.dates.length) W('v_item_qty_dates', { pos, q: it.qty, n: inv.dates.length });
  });

  if (!inv.dates.length) E('v_no_dates');
  const dup = inv.dates.filter((d, i) => inv.dates.indexOf(d) !== i);
  if (dup.length) E('v_dates_dup');
  const late = inv.dates.filter((d) => isISODate(inv.invoiceDate) && d > inv.invoiceDate);
  if (late.length) E('v_dates_after_invoice', { d: late.map(dmy).join(', ') });

  if (p) {
    const billed = billedDates(db, p.id, inv.id);
    const twice = inv.dates.filter((d) => billed.has(d));
    if (twice.length) E('v_dates_billed', { d: twice.map((d) => `${dmy(d)} (${billed.get(d)})`).join(', ') });
  }

  if (!inv.prescriptionDate) W('v_no_presc');
  else {
    const before = inv.dates.filter((d) => d < inv.prescriptionDate);
    if (before.length) E('v_dates_before_presc', { d: before.map(dmy).join(', ') });
    if (inv.prescriptionDate > inv.invoiceDate) E('v_presc_after_invoice');
  }
  if (p && inv.prescriptionId) {
    const rx = prescriptionOf(p, inv.prescriptionId);
    if (rx && rx.sessions) {
      const used = prescriptionUsage(db, p.id, rx.id).billed;
      if (used + inv.dates.length > rx.sessions) W('v_presc_exceeded', { u: used + inv.dates.length, t: rx.sessions });
    }
  }
  if (p && ['pkv', 'beihilfe'].includes(p.insurance) && !(inv.showDiagnosis && norm(inv.diagnosis))) W('v_no_diag');
  if (invoiceTotal(inv) <= 0 && inv.items.length) E('v_total_zero');
  const first = [...inv.dates].sort()[0];
  if (first && isISODate(inv.invoiceDate) && daysBetween(first, inv.invoiceDate) > 365) W('v_dates_old');
  return { errors, warnings };
}

/* ===================== Snimak (ono što ide na papir, zamrznuto) ===================== */

export function introFor(praxis, inv) {
  if (inv.kind === 'storno') return inv.intro || '';
  if (inv.intro) return inv.intro;
  return inv.prescriptionDate
    ? praxis.introText.replace('{verordnung}', dmy(inv.prescriptionDate))
    : praxis.introNoPresc;
}

// Podaci prakse koji se zamrzavaju u računu (bez lista za brzi izbor)
export function praxisSnapshot(praxis) {
  const pr = { ...praxis };
  delete pr.updatedAt; delete pr.diagnoses; delete pr.doctors;
  return pr;
}

export function buildSnapshot(db, inv) {
  const p = db.patients.find((x) => x.id === inv.patientId);
  const pr = praxisSnapshot(db.praxis);
  const dates = [...inv.dates].sort();
  return {
    kind: inv.kind,
    number: inv.number,
    invoiceDate: inv.invoiceDate,
    serviceDate: dates.length ? dates[dates.length - 1] : (inv.serviceDate || inv.invoiceDate),
    firstDate: dates[0] || '',
    dueDate: inv.dueDate || '',
    prescriptionDate: inv.prescriptionDate || '',
    praxis: pr,
    recipient: inv.recipientOverride || recipientLines(p),
    patientLine: patientLine(p),
    patientName: fullName(p),
    intro: introFor(db.praxis, inv),
    diagnosis: inv.showDiagnosis ? norm(inv.diagnosis) : '',
    items: inv.items.map((it) => ({ ziffer: it.ziffer || '', desc: norm(it.desc), qty: it.qty, priceCents: it.priceCents, totalCents: lineTotal(it) })),
    dates,
    datesText: datesLine(dates),
    totalCents: invoiceTotal(inv),
    cancelsNumber: inv.cancelsNumber || '',
  };
}

// Finalizacija: dodeljuje broj, zamrzava sve podatke. Posle ovoga račun se više ne menja.
export function finalize(db, inv, today = todayISO()) {
  const { errors } = validate(db, inv, today);
  if (errors.length) throw Object.assign(new Error('validation'), { errors });
  syncLinked(inv);
  inv.number = norm(inv.number) || nextNumber(db, inv.invoiceDate);
  if (numberTaken(db, inv.number, inv.id)) throw Object.assign(new Error('validation'), { errors: [{ k: 'v_number_taken', p: { n: inv.number } }] });
  inv.status = 'final';
  inv.dueDate = addDays(inv.invoiceDate, Number(db.praxis.paymentDays) || 14);
  inv.finalizedAt = nowStamp();
  inv.snapshot = buildSnapshot(db, inv);
  touch(inv);
  if (!db.invoices.includes(inv)) {
    const i = db.invoices.findIndex((x) => x.id === inv.id);
    if (i >= 0) db.invoices[i] = inv; else db.invoices.push(inv);
  }
  return inv;
}

/* ===================== Status, storno, kopija ===================== */

export function markSent(inv, date = todayISO()) {
  if (inv.status !== 'final') throw new Error('status');
  inv.status = 'sent'; inv.sentOn = date; return touch(inv);
}

export function markPaid(inv, date = todayISO()) {
  if (!OPEN.includes(inv.status)) throw new Error('status');
  inv.prevStatus = inv.status; inv.status = 'paid'; inv.paidOn = date; return touch(inv);
}

export function unmarkPaid(inv) {
  if (inv.status !== 'paid') throw new Error('status');
  inv.status = inv.prevStatus || 'final'; inv.paidOn = null; return touch(inv);
}

// Storno = novi račun sa negativnim iznosima i sopstvenim brojem; original ostaje sačuvan kao "storniran".
export function createStorno(db, inv, date = todayISO()) {
  if (!BILLED.includes(inv.status) || inv.kind !== 'invoice') throw new Error('status');
  const snap = inv.snapshot;
  const s = {
    id: uid(), kind: 'storno', status: 'storno', number: nextNumber(db, date),
    patientId: inv.patientId, prescriptionId: inv.prescriptionId, prescriptionDate: inv.prescriptionDate,
    diagnosis: inv.diagnosis, showDiagnosis: inv.showDiagnosis,
    invoiceDate: date, dates: [], serviceDate: snap.serviceDate,
    items: inv.items.map((it) => ({ ...it, id: uid(), qty: -it.qty, linked: false })),
    cancels: inv.id, cancelsNumber: inv.number,
    intro: `Hiermit storniere ich die Rechnung Nr. ${inv.number} vom ${dmy(inv.invoiceDate)} über ${fmtMoney(snap.totalCents)} € in voller Höhe.`,
    recipientOverride: snap.recipient,
    reminders: [], createdAt: nowStamp(), finalizedAt: nowStamp(), updatedAt: nowStamp(),
  };
  s.snapshot = buildSnapshot(db, s);
  s.snapshot.praxis = praxisSnapshot(db.praxis);
  s.snapshot.datesText = snap.datesText;
  s.snapshot.cancelledTotalCents = snap.totalCents;
  db.invoices.push(s);
  inv.prevStatus = inv.status;
  inv.status = 'cancelled';
  inv.cancelledBy = s.id;
  touch(inv);
  return s;
}

export function copyAsDraft(db, inv, { withDates = false, today = todayISO() } = {}) {
  const c = {
    id: uid(), kind: 'invoice', status: 'draft', number: '', patientId: inv.patientId,
    prescriptionId: inv.prescriptionId, prescriptionDate: inv.prescriptionDate,
    diagnosis: inv.diagnosis, showDiagnosis: inv.showDiagnosis, invoiceDate: today,
    dates: withDates ? [...inv.dates] : [],
    items: inv.items.map((it) => ({ ...it, id: uid(), qty: Math.abs(it.qty) })),
    note: '', reminders: [], correctionOf: withDates ? inv.number : undefined,
    createdAt: nowStamp(), updatedAt: nowStamp(),
  };
  syncLinked(c);
  db.invoices.push(c);
  return c;
}

export function deleteRecord(db, coll, id) {
  db[coll] = db[coll].filter((x) => x.id !== id);
  db.tombstones[id] = nowStamp();
}

export function canDeleteInvoice(inv) { return inv.status === 'draft'; }

// Brisanje i finalizovanog računa (npr. pogrešan probni račun). Storno par se briše zajedno;
// brisanje samo storno računa vraća original u prethodni status. Vraća brojeve obrisanih računa.
export function deleteInvoice(db, id) {
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) return [];
  const gone = [inv];
  if (inv.cancelledBy) {
    const s = db.invoices.find((i) => i.id === inv.cancelledBy);
    if (s) gone.push(s);
  }
  if (inv.kind === 'storno' && inv.cancels) {
    const orig = db.invoices.find((i) => i.id === inv.cancels);
    if (orig && orig.status === 'cancelled') {
      orig.status = orig.prevStatus || 'final';
      delete orig.cancelledBy;
      touch(orig);
    }
  }
  for (const g of gone) deleteRecord(db, 'invoices', g.id);
  return gone.map((g) => g.number).filter(Boolean);
}

// Fabričko resetovanje: brišu se svi pacijenti i računi. Podaci prakse, cene i liste brzog izbora
// po želji ostaju. Vraća nove podatke; vault.replaceAll ih upisuje kao novu "generaciju" na sve uređaje.
export function factoryReset(db, { keepSettings = true } = {}) {
  const fresh = newDB();
  if (keepSettings) {
    fresh.praxis = { ...clone(db.praxis), updatedAt: nowStamp() };
    fresh.services = clone(db.services);
  }
  fresh.meta = { createdAt: nowStamp(), resetAt: nowStamp() };
  return fresh;
}
export function canDeletePatient(db, id) { return !db.invoices.some((i) => i.patientId === id); }
export function canDeleteService(db, id) { return !db.invoices.some((i) => i.items.some((it) => it.serviceId === id)); }

export function isOverdue(inv, today = todayISO()) {
  return OPEN.includes(inv.status) && inv.dueDate && inv.dueDate < today;
}

export function reminderDue(db, inv, today = todayISO()) {
  return addDays(today, Number(db.praxis.reminderDays) || 10);
}

/* ===================== Pregled / statistika ===================== */

export function stats(db, today = todayISO()) {
  const ym = today.slice(0, 7), y = today.slice(0, 4);
  const open = db.invoices.filter((i) => OPEN.includes(i.status));
  const billed = db.invoices.filter((i) => i.kind === 'invoice' && BILLED.includes(i.status));
  const sum = (l) => l.reduce((s, i) => s + amountOf(i), 0);
  return {
    openCount: open.length, openCents: sum(open),
    overdue: open.filter((i) => isOverdue(i, today)),
    monthCents: sum(billed.filter((i) => i.invoiceDate.startsWith(ym))),
    yearCents: sum(billed.filter((i) => i.invoiceDate.startsWith(y))),
    paidMonthCents: sum(db.invoices.filter((i) => i.status === 'paid' && (i.paidOn || '').startsWith(ym))),
    drafts: db.invoices.filter((i) => i.status === 'draft'),
  };
}

export function summary(db) {
  const fin = db.invoices.filter((i) => i.status !== 'draft').sort((a, b) => (b.finalizedAt || '').localeCompare(a.finalizedAt || ''));
  return {
    patients: db.patients.length,
    invoices: db.invoices.filter((i) => i.status !== 'draft').length,
    drafts: db.invoices.filter((i) => i.status === 'draft').length,
    last: fin[0] ? `${fin[0].number} (${dmy(fin[0].invoiceDate)})` : '–',
    praxis: db.praxis.name || '–',
  };
}

/* ===================== CSV za knjigovođu ===================== */

function csvCell(v, text = true) {
  let s = String(v ?? '');
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // zaštita od formula u Excel-u
  return '"' + s.replace(/"/g, '""') + '"';
}

export function invoicesCSV(db, list) {
  const head = ['Rechnungsnr', 'Art', 'Rechnungsdatum', 'Leistung von', 'Leistung bis', 'Patient', 'Rechnungsempfänger', 'Betrag EUR', 'Status', 'Fällig am', 'Bezahlt am', 'Storno zu'];
  const st = { final: 'Offen', sent: 'Versendet', paid: 'Bezahlt', cancelled: 'Storniert', storno: 'Storno' };
  const rows = list.filter((i) => i.status !== 'draft').map((i) => {
    const s = i.snapshot;
    return [
      csvCell(i.number), csvCell(i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'),
      csvCell(dmy(i.invoiceDate)), csvCell(dmy(s.firstDate)), csvCell(dmy(s.serviceDate)),
      csvCell(s.patientName), csvCell(s.recipient[0] || ''),
      csvCell(fmtMoney(s.totalCents).replace(/\./g, ''), false), csvCell(st[i.status] || i.status),
      csvCell(dmy(i.dueDate)), csvCell(dmy(i.paidOn)), csvCell(i.cancelsNumber || ''),
    ].join(';');
  });
  return '﻿' + [head.map((h) => csvCell(h)).join(';'), ...rows].join('\r\n') + '\r\n';
}

/* ===================== Spajanje (više uređaja) ===================== */

const newer = (a, b) => ((b?.updatedAt || '') > (a?.updatedAt || '') ? b : a);

// Spaja dve verzije podataka zapis po zapis: pobeđuje novija izmena; brisanja se pamte (tombstones).
export function merge(a, b) {
  a = migrate(clone(a)); b = migrate(clone(b));
  const tomb = { ...a.tombstones };
  for (const [id, t] of Object.entries(b.tombstones)) if (!tomb[id] || t > tomb[id]) tomb[id] = t;
  const out = {
    schema: Math.max(a.schema, b.schema),
    praxis: newer(a.praxis, b.praxis),
    tombstones: tomb,
    meta: { ...b.meta, ...a.meta },
  };
  for (const c of COLLECTIONS) {
    const m = new Map();
    for (const r of a[c]) m.set(r.id, r);
    for (const r of b[c]) m.set(r.id, m.has(r.id) ? newer(m.get(r.id), r) : r);
    out[c] = [...m.values()]
      .filter((r) => !(tomb[r.id] && tomb[r.id] >= (r.updatedAt || '')))
      .sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || '') || x.id.localeCompare(y.id));
  }
  return out;
}
