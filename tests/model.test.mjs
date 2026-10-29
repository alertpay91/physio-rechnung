import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { uid, nowStamp } from '../js/util.js';

function setup() {
  const db = M.newDB();
  Object.assign(db.praxis, {
    name: 'Max Muster', street: 'Musterweg 1', plz: '10115', city: 'Berlin',
    steuernummer: '12/345/67890', iban: 'DE89 3704 0044 0532 0130 00',
  });
  const p = {
    id: uid(), salutation: 'Herr', firstName: 'Hans', lastName: 'Beispiel', institution: 'Pflegeheim Sonnenhof',
    street: 'Lindenstraße 5', plz: '14167', city: 'Berlin', insurance: 'selbstzahler', birthDate: '',
    prescriptions: [{ id: uid(), date: '2026-06-04', doctor: 'Dr. A', diagnosis: '', sessions: 20 }],
    billTo: { enabled: false }, createdAt: nowStamp(), updatedAt: nowStamp(),
  };
  db.patients.push(p);
  return { db, p };
}

function draftWith(db, p, dates, invoiceDate = '2026-09-09') {
  const inv = M.newDraft(db, p.id, invoiceDate);
  inv.dates = dates;
  M.syncLinked(inv);
  db.invoices.push(inv);
  return inv;
}

const twenty = ['2026-06-10', '2026-06-13', '2026-06-17', '2026-06-22', '2026-06-24', '2026-06-25', '2026-07-01', '2026-07-06', '2026-07-15', '2026-07-20', '2026-07-27', '2026-07-29', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-20', '2026-08-24', '2026-08-26', '2026-09-02', '2026-09-04'];

test('Dejanov primer: 20 × KG + 20 × HB = 1.146,00 €', () => {
  const { db, p } = setup();
  const inv = draftWith(db, p, twenty);
  assert.deepEqual(inv.items.map((i) => [i.desc, i.qty, i.priceCents]), [['Krankengymnastik', 20, 2970], ['Hausbesuch', 20, 2760]]);
  assert.equal(M.invoiceTotal(inv), 114600);
  M.finalize(db, inv, '2026-09-09');
  assert.equal(inv.number, '0926/01');
  assert.equal(inv.dueDate, '2026-09-23');
  assert.equal(inv.snapshot.serviceDate, '2026-09-04');
  assert.equal(inv.snapshot.recipient[0], 'An Herrn Hans Beispiel');
  assert.match(inv.snapshot.intro, /Verordnung vom 04\.06\.2026/);
  assert.match(inv.snapshot.datesText, /^10\.06\. • .* • 04\.09\.2026$/);
});

test('brojevi idu redom po mesecu i ne ponavljaju se', () => {
  const { db, p } = setup();
  const a = draftWith(db, p, ['2026-09-01']);
  M.finalize(db, a, '2026-09-09');
  const b = draftWith(db, p, ['2026-09-02']);
  M.finalize(db, b, '2026-09-09');
  const c = draftWith(db, p, ['2026-10-01'], '2026-10-02');
  M.finalize(db, c, '2026-10-02');
  assert.deepEqual([a.number, b.number, c.number], ['0926/01', '0926/02', '1026/01']);
  const d = draftWith(db, p, ['2026-09-03']);
  d.number = '0926/02';
  assert.throws(() => M.finalize(db, d, '2026-09-09'), (e) => e.errors.some((x) => x.k === 'v_number_taken'));
});

test('provera: dupli termini u drugom računu se ne mogu fakturisati', () => {
  const { db, p } = setup();
  const a = draftWith(db, p, ['2026-09-01', '2026-09-02']);
  M.finalize(db, a, '2026-09-09');
  const b = draftWith(db, p, ['2026-09-02', '2026-09-03']);
  const v = M.validate(db, b, '2026-09-09');
  assert.ok(v.errors.some((e) => e.k === 'v_dates_billed'));
});

test('provera: termin posle datuma računa, pre Verordnung, cena 0, podaci prakse', () => {
  const { db, p } = setup();
  const b = draftWith(db, p, ['2026-06-01', '2026-09-20']);
  b.items[0].priceCents = 0;
  db.praxis.iban = 'DE00 1234';
  const keys = M.validate(db, b, '2026-09-09').errors.map((e) => e.k);
  for (const k of ['v_dates_after_invoice', 'v_dates_before_presc', 'v_item_price', 'v_praxis_iban']) assert.ok(keys.includes(k), k);
});

test('upozorenje kad se pređe broj propisanih termina', () => {
  const { db, p } = setup();
  const a = draftWith(db, p, twenty);
  M.finalize(db, a, '2026-09-09');
  // Novi termini posle prvog računa, ista Verordnung -> 21. termin
  const b = draftWith(db, p, ['2026-09-07'], '2026-09-09');
  const w = M.validate(db, b, '2026-09-09').warnings.map((x) => x.k);
  assert.ok(w.includes('v_presc_exceeded'));
});

test('storno: negativni iznosi, sopstveni broj, original zaključan kao storniran', () => {
  const { db, p } = setup();
  const a = draftWith(db, p, twenty);
  M.finalize(db, a, '2026-09-09');
  const s = M.createStorno(db, a, '2026-09-15');
  assert.equal(a.status, 'cancelled');
  assert.equal(s.number, '0926/02');
  assert.equal(s.snapshot.totalCents, -114600);
  assert.equal(s.snapshot.cancelsNumber, '0926/01');
  const st = M.stats(db, '2026-09-20');
  assert.equal(st.openCount, 0);
  assert.equal(st.monthCents, 0);
  // posle storna isti termini mogu ponovo da se fakturišu (ispravka)
  const c = M.copyAsDraft(db, a, { withDates: true, today: '2026-09-15' });
  assert.equal(M.validate(db, c, '2026-09-15').errors.length, 0);
  M.finalize(db, c, '2026-09-15');
  assert.equal(c.number, '0926/03');
});

test('statistika i plaćanje', () => {
  const { db, p } = setup();
  const a = draftWith(db, p, ['2026-09-01']);
  M.finalize(db, a, '2026-09-09');
  let st = M.stats(db, '2026-09-30');
  assert.equal(st.openCents, 5730);
  assert.equal(st.overdue.length, 1);
  M.markPaid(a, '2026-09-30');
  st = M.stats(db, '2026-09-30');
  assert.equal(st.openCount, 0);
  assert.equal(st.paidMonthCents, 5730);
  M.unmarkPaid(a);
  assert.equal(a.status, 'final');
});

test('primalac: druga adresa i linija pacijenta', () => {
  const { p } = setup();
  p.billTo = { enabled: true, name: 'Maria Beispiel (Betreuerin)', street: 'Weg 2', plz: '10000', city: 'Berlin' };
  p.birthDate = '1940-01-02';
  assert.deepEqual(M.recipientLines(p), ['Maria Beispiel (Betreuerin)', 'Weg 2', '10000 Berlin']);
  assert.equal(M.patientLine(p), 'Hans Beispiel, geb. 02.01.1940');
});

test('merge: novija izmena pobeđuje, brisanje se pamti, novi zapisi se spajaju', async () => {
  const { db } = setup();
  const a = structuredClone(db), b = structuredClone(db);
  await new Promise((r) => setTimeout(r, 5));
  a.patients[0].lastName = 'NeuA'; a.patients[0].updatedAt = new Date().toISOString();
  b.patients.push({ id: 'x2', firstName: 'Neu', lastName: 'B', prescriptions: [], createdAt: nowStamp(), updatedAt: nowStamp() });
  const s = b.services[0]; M.deleteRecord(b, 'services', s.id);
  const m = M.merge(a, b);
  assert.equal(m.patients.length, 2);
  assert.equal(m.patients.find((x) => x.id === db.patients[0].id).lastName, 'NeuA');
  assert.ok(!m.services.some((x) => x.id === s.id));
  // simetrično
  const m2 = M.merge(b, a);
  assert.equal(m2.patients.length, 2);
  assert.ok(!m2.services.some((x) => x.id === s.id));
});

test('dupli brojevi sa dva uređaja se otkrivaju', () => {
  const { db, p } = setup();
  const a = structuredClone(db), b = structuredClone(db);
  const ia = draftWith(a, a.patients[0], ['2026-09-01']); M.finalize(a, ia, '2026-09-09');
  const ib = draftWith(b, b.patients[0], ['2026-09-02']); M.finalize(b, ib, '2026-09-09');
  const m = M.merge(a, b);
  assert.deepEqual(M.numberConflicts(m), ['0926/01']);
  void p;
});

test('CSV: tačka-zarez, BOM, zaštita od formula', () => {
  const { db, p } = setup();
  p.firstName = '=HYPERLINK()';
  const a = draftWith(db, p, ['2026-09-01']);
  M.finalize(db, a, '2026-09-09');
  const csv = M.invoicesCSV(db, db.invoices);
  assert.ok(csv.startsWith('﻿"Rechnungsnr"'));
  assert.match(csv, /"57,30"/);
  assert.match(csv, /"'=HYPERLINK\(\) Beispiel"/);
});

test('brzi izbor: dijagnoze i lekari', () => {
  const db = M.newDB();
  assert.ok(db.praxis.diagnoses.length > 5);
  assert.deepEqual(db.praxis.doctors, []);
  let d = M.togglePick('', 'M54.4 Lumboischialgie');
  d = M.togglePick(d, 'M17.1 Primäre Gonarthrose');
  assert.equal(d, 'M54.4 Lumboischialgie; M17.1 Primäre Gonarthrose');
  assert.ok(M.hasPick(d, 'm17.1 primäre gonarthrose'));
  assert.equal(M.togglePick(d, 'M54.4 Lumboischialgie'), 'M17.1 Primäre Gonarthrose');
  const n = db.praxis.diagnoses.length;
  assert.equal(M.learnPicks(db, 'diagnoses', 'M54.4 Lumboischialgie; Neu: Tennisarm'), true);
  assert.equal(db.praxis.diagnoses.length, n + 1);
  assert.equal(M.learnPicks(db, 'diagnoses', 'neu: tennisarm'), false);
  M.learnPicks(db, 'doctors', '  Dr. Müller ');
  assert.deepEqual(db.praxis.doctors, ['Dr. Müller']);
  // stari podaci bez lista dobijaju podrazumevane, a liste ne ulaze u zamrznuti račun
  const old = M.migrate({ praxis: { name: 'X' } });
  assert.ok(old.praxis.diagnoses.length > 5);
  assert.equal(M.praxisSnapshot(db.praxis).diagnoses, undefined);
  old.praxis.diagnoses.push('Y');
  assert.ok(!M.DIAG_SEED.includes('Y'));
});

test('deleteInvoice: brisanje finalizovanog računa oslobađa broj', () => {
  const { db, p } = setup();
  const a = M.finalize(db, draftWith(db, p, ['2026-09-01'], '2026-10-09'), '2026-10-10');
  const b = M.finalize(db, draftWith(db, p, ['2026-09-02'], '2026-10-09'), '2026-10-10');
  assert.equal(b.number, '1026/02');
  assert.deepEqual(M.deleteInvoice(db, b.id), ['1026/02']);
  assert.ok(db.tombstones[b.id]);
  assert.equal(M.nextNumber(db, '2026-10-20'), '1026/02');
  assert.equal(db.invoices.length, 1);
  assert.equal(a.status, 'final');
});

test('deleteInvoice: storno par se briše zajedno, brisanje storna vraća original', () => {
  const { db, p } = setup();
  const a = M.finalize(db, draftWith(db, p, ['2026-09-01'], '2026-10-09'), '2026-10-10');
  const s = M.createStorno(db, a, '2026-10-11');
  M.deleteInvoice(db, s.id);
  assert.equal(a.status, 'final');
  assert.equal(a.cancelledBy, undefined);
  const s2 = M.createStorno(db, a, '2026-10-12');
  assert.equal(M.deleteInvoice(db, a.id).length, 2);
  assert.ok(!db.invoices.some((i) => i.id === a.id || i.id === s2.id));
});

test('factoryReset: briše pacijente i račune, po želji čuva podešavanja', () => {
  const { db, p } = setup();
  M.finalize(db, draftWith(db, p, ['2026-09-01'], '2026-10-09'), '2026-10-10');
  const keep = M.factoryReset(db, { keepSettings: true });
  assert.equal(keep.patients.length, 0);
  assert.equal(keep.invoices.length, 0);
  assert.equal(keep.praxis.name, 'Max Muster');
  assert.deepEqual(keep.services.map((x) => x.id), db.services.map((x) => x.id));
  assert.equal(M.nextNumber(keep, '2026-10-20'), '1026/01');
  const wipe = M.factoryReset(db, { keepSettings: false });
  assert.equal(wipe.praxis.name, '');
});

test('reopen: samo poslednji, neposlat račun; broj ostaje i ostaje rezervisan', () => {
  const { db, p } = setup();
  const a = M.finalize(db, draftWith(db, p, ['2026-09-01'], '2026-10-09'), '2026-10-10');
  const b = M.finalize(db, draftWith(db, p, ['2026-09-02'], '2026-10-09'), '2026-10-10');
  assert.equal(M.canReopen(db, a), false);
  assert.equal(M.canReopen(db, b), true);
  M.reopen(db, b);
  assert.equal(b.status, 'draft');
  assert.equal(b.number, '1026/02');
  assert.equal(b.snapshot, undefined);
  assert.equal(M.nextNumber(db, '2026-10-20'), '1026/03');
  assert.equal(M.billedDates(db, p.id).has('2026-09-02'), false);
  b.dates = ['2026-09-03']; M.syncLinked(b);
  M.finalize(db, b, '2026-10-10');
  assert.equal(b.number, '1026/02');
  M.markSent(b);
  assert.equal(M.canReopen(db, b), false);
  assert.throws(() => M.reopen(db, b));
});

test('reopen: storniran račun i račun posle kog postoji storno se ne menjaju', () => {
  const { db, p } = setup();
  const a = M.finalize(db, draftWith(db, p, ['2026-09-01'], '2026-10-09'), '2026-10-10');
  M.createStorno(db, a, '2026-10-11');
  assert.equal(M.canReopen(db, a), false);
});

test('validate: upozorenje kad broj ne odgovara mesecu', () => {
  const { db, p } = setup();
  const d = draftWith(db, p, ['2026-09-01'], '2026-11-02');
  d.number = '1026/02';
  assert.ok(M.validate(db, d, '2026-11-03').warnings.some((w) => w.k === 'v_number_month'));
});
