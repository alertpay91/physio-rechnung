import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, encryptJSON, decryptJSON, decryptWithPassword, newSalt, WrongPassword, passwordProblems, passwordBlocked } from '../js/crypto.js';
import { makeZip, crc32 } from '../js/zip.js';

const ITER = 1000; // brže u testovima

test('šifrovanje i dešifrovanje', async () => {
  const salt = newSalt();
  const k = await deriveKey('Tačna šifra 2026!', salt, ITER);
  const data = { patients: [{ name: 'Blümel' }], n: 1146 };
  const env = await encryptJSON(k, data);
  assert.equal(env.format, 'physio-vault');
  assert.ok(!JSON.stringify(env).includes('Blümel'));
  assert.deepEqual(await decryptJSON(k, env), data);
  const k2 = await deriveKey('Tacna sifra 2026!', salt, ITER);
  await assert.rejects(decryptJSON(k2, env), WrongPassword);
  const { data: d2 } = await decryptWithPassword('Tačna šifra 2026!', env);
  assert.deepEqual(d2, data);
});

test('izmenjen šifrovan sadržaj se otkriva', async () => {
  const k = await deriveKey('x'.repeat(16), newSalt(), ITER);
  const env = await encryptJSON(k, { a: 1 });
  const bad = { ...env, data: env.data.slice(0, 10) + (env.data[10] === 'A' ? 'B' : 'A') + env.data.slice(11) };
  await assert.rejects(decryptJSON(k, bad));
});

test('jačina šifre', () => {
  assert.ok(passwordProblems('kurz').includes('pw_short'));
  assert.deepEqual(passwordProblems('Sonnenblume-Lindenweg-77'), []);
  assert.ok(passwordProblems('password12345').includes('pw_common'));
  assert.equal(passwordBlocked('Terapeut84'), false);
  assert.equal(passwordBlocked('kurz12'), true);
  assert.equal(passwordBlocked('password12345'), true);
});

test('zip', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const z = makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hallo') }]);
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
});
