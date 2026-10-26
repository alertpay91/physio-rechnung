// Lokalno skladište u IndexedDB. Sve što sadrži podatke o pacijentima je šifrovano.
// Ključevi:
//   vault     – šifrovana radna kopija baze
//   state     – nešifrovano stanje bez ličnih podataka (so, stanje sinhronizacije, id uređaja)
//   snapshots – poslednjih N šifrovanih lokalnih kopija (za vraćanje)
//   session   – neizvozivi ključ ako je uključeno "ostani prijavljen"

const DB_NAME = 'physio-rechnung';
const STORE = 'kv';
const MAX_SNAPSHOTS = 40;

let dbp = null;
function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(st)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('IndexedDB abort'));
  });
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const get = (k) => tx('readonly', (st) => req(st.get(k)));
export const set = (k, v) => tx('readwrite', (st) => { st.put(v, k); });
export const del = (k) => tx('readwrite', (st) => { st.delete(k); });

export async function getState() {
  return (await get('state')) || {};
}
export async function patchState(patch) {
  const s = await getState();
  Object.assign(s, patch);
  await set('state', s);
  return s;
}

// Lokalne kopije: dodaje se najviše jedna na sat (osim kad je razlog "pre vraćanja"/"pre uvoza")
export async function addSnapshot(env, reason = 'auto', force = false) {
  const list = (await get('snapshots')) || [];
  const last = list[list.length - 1];
  if (!force && last && Date.now() - Date.parse(last.at) < 3600_000) return;
  list.push({ at: new Date().toISOString(), reason, env });
  while (list.length > MAX_SNAPSHOTS) list.shift();
  await set('snapshots', list);
}
export async function listSnapshots() {
  return ((await get('snapshots')) || []).slice().reverse();
}

export async function persist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

export async function wipe() {
  const db = await open();
  db.close();
  dbp = null;
  await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}
