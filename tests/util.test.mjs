import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtMoney, parseMoney, datesLine, addDays, ibanValid, ibanFormat, fileSafe, isISODate, stableStringify } from '../js/util.js';

test('fmtMoney', () => {
  assert.equal(fmtMoney(114600), '1.146,00');
  assert.equal(fmtMoney(2970), '29,70');
  assert.equal(fmtMoney(-114600), '-1.146,00');
  assert.equal(fmtMoney(5), '0,05');
  assert.equal(fmtMoney(123456789), '1.234.567,89');
});

test('parseMoney', () => {
  assert.equal(parseMoney('29,70'), 2970);
  assert.equal(parseMoney('29.70'), 2970);
  assert.equal(parseMoney('29,7 €'), 2970);
  assert.equal(parseMoney('1.146,00'), 114600);
  assert.equal(parseMoney('1.146'), 114600);
  assert.equal(parseMoney('1146'), 114600);
  assert.equal(parseMoney('0,1'), 10);
  assert.ok(Number.isNaN(parseMoney('abc')));
  assert.ok(Number.isNaN(parseMoney('1,234')));
  assert.ok(Number.isNaN(parseMoney('')));
});

test('datesLine kao na računu', () => {
  assert.equal(datesLine(['2026-09-04', '2026-06-10', '2026-06-13']), '10.06. • 13.06. • 04.09.2026');
  assert.equal(datesLine(['2026-12-30', '2027-01-04']), '30.12.2026 • 04.01.2027');
});

test('datumi bez UTC grešaka', () => {
  assert.equal(addDays('2026-09-09', 14), '2026-09-23');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // prelazak na letnje vreme
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.ok(isISODate('2026-02-28'));
  assert.ok(!isISODate('2026-02-30'));
});

test('IBAN', () => {
  assert.ok(ibanValid('DE89 3704 0044 0532 0130 00'));
  assert.ok(!ibanValid('DE89 3704 0044 0532 0130 01'));
  assert.ok(!ibanValid('DE89370400440532013'));
  assert.equal(ibanFormat('de89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
});

test('fileSafe i stableStringify', () => {
  assert.equal(fileSafe('Blümel Groß'), 'Bluemel-Gross');
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});
