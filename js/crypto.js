// Šifrovanje: PBKDF2-SHA256 (1.000.000 iteracija) -> AES-256-GCM.
// Podaci se pre šifrovanja kompresuju (gzip). Ključ nikad ne napušta uređaj.
// Format "koverte" (envelope) je običan JSON da bi se mogao čuvati bilo gde.

const te = new TextEncoder();
const td = new TextDecoder();
export const KDF_ITER = 1_000_000;
const AAD = te.encode('physio-vault-v1');

export function b64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const newSalt = () => b64(randomBytes(16));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const gzip = (b) => pipe(b, new CompressionStream('gzip'));
export const gunzip = (b) => pipe(b, new DecompressionStream('gzip'));

// Ključ je "neizvoziv": JavaScript ga može koristiti, ali ne i pročitati.
export async function deriveKey(password, saltB64, iter = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  return { key, salt: saltB64, iter };
}

export async function encryptJSON(k, obj) {
  const iv = randomBytes(12);
  const plain = await gzip(te.encode(JSON.stringify(obj)));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, k.key, plain);
  return { format: 'physio-vault', v: 1, kdf: { name: 'PBKDF2-SHA256', iter: k.iter, salt: k.salt }, iv: b64(iv), data: b64(ct), at: new Date().toISOString() };
}

export class WrongPassword extends Error { constructor() { super('wrong-password'); this.name = 'WrongPassword'; } }

export async function decryptJSON(k, env) {
  if (!env || env.format !== 'physio-vault') throw new Error('Keine gültige Sicherungsdatei');
  if (env.kdf.salt !== k.salt || env.kdf.iter !== k.iter) throw new WrongPassword();
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: AAD }, k.key, unb64(env.data));
  } catch {
    throw new WrongPassword();
  }
  return JSON.parse(td.decode(await gunzip(new Uint8Array(plain))));
}

// Dešifrovanje koverte koja ima sopstvenu so (npr. stara verzija posle promene šifre)
export async function decryptWithPassword(password, env) {
  const k = await deriveKey(password, env.kdf.salt, env.kdf.iter);
  return { data: await decryptJSON(k, env), key: k };
}

export async function sha256hex(str) {
  const h = await crypto.subtle.digest('SHA-256', te.encode(str));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Jednostavna procena jačine šifre (dužina + raznovrsnost + česte šifre)
export function passwordProblems(pw) {
  const p = [];
  if ((pw || '').length < 12) p.push('pw_short');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw || '')).length;
  if ((pw || '').length < 20 && classes < 3) p.push('pw_simple');
  if (/^(.)\1+$/.test(pw || '') || /(passwort|password|physio|123456|qwertz|qwerty)/i.test(pw || '')) p.push('pw_common');
  return p;
}

// Šifra koja se ne sme koristiti; ostale slabosti su samo upozorenje (korisnik može da potvrdi)
export function passwordBlocked(pw) {
  return (pw || '').length < 8 || passwordProblems(pw).includes('pw_common');
}
