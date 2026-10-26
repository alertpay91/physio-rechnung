// "Sef": prijava, šifrovano čuvanje, sinhronizacija sa privatnim GitHub repoom, istorija verzija.
//
// Kako radi pristup sa bilo kog uređaja bez GitHub naloga:
//  - access.json (javno, pored aplikacije) sadrži GitHub pristupni token ŠIFROVAN Dejanovom šifrom.
//  - Posle unosa šifre aplikacija dešifruje token i čita/piše data.vault.json u PRIVATNOM repou.
//  - I sami podaci su šifrovani istom šifrom, tako da ni GitHub ne vidi ništa čitljivo.

import * as store from './store.js';
import { deriveKey, encryptJSON, decryptJSON, decryptWithPassword, newSalt, KDF_ITER, WrongPassword } from './crypto.js';
import { GitHub, GitHubError } from './github.js';
import { newDB, migrate, merge, summary } from './model.js';
import { uid, stableStringify, clone, nowStamp } from './util.js';

export const DATA_PATH = 'data.vault.json';
const ACCESS_URL = './access.json';
const SESSION_DAYS = 30;

let K = null;          // {key, salt, iter}
let DB = null;         // podaci u memoriji (samo dok je otključano)
let GH = null;         // GitHub klijent za repo sa podacima
let ACCESS = null;     // dešifrovan sadržaj access.json
let rev = 0;           // brojač lokalnih izmena
let saving = Promise.resolve();
let syncTimer = null;
let syncing = null;
const listeners = new Set();

export const status = { mode: null, sync: 'idle', lastSyncAt: null, error: null, dirty: false };

export const db = () => DB;
export const isUnlocked = () => !!DB;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } });

const withGen = (d) => {
  d.meta = d.meta || {};
  if (!d.meta.gen) { d.meta.gen = uid(); d.meta.genAt = d.meta.createdAt || nowStamp(); }
  return d;
};

/* ===================== Pokretanje / prijava ===================== */

export async function fetchAccess() {
  try {
    const r = await fetch(ACCESS_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) {
      const env = await r.json();
      if (env && env.format === 'physio-vault') { await store.patchState({ cachedAccess: env }); return env; }
    }
    if (r.status === 404) return null;
  } catch { /* offline */ }
  return (await store.getState()).cachedAccess || null;
}

// 'login' | 'setup' — šta prikazati kada aplikacija krene
export async function bootMode() {
  const st = await store.getState();
  const access = await fetchAccess();
  if (access) return 'login';
  if (st.mode === 'local' && st.salt) return 'login';
  return 'setup';
}

export async function tryResume() {
  const s = await store.get('session');
  if (!s || !s.key || Date.parse(s.until) < Date.now()) return false;
  try {
    await unlockWith({ key: s.key, salt: s.salt, iter: s.iter });
    return true;
  } catch (e) {
    await store.del('session');
    return false;
  }
}

export async function login(password, remember) {
  const st = await store.getState();
  const access = await fetchAccess();
  let k;
  if (access) k = await deriveKey(password, access.kdf.salt, access.kdf.iter);
  else if (st.mode === 'local') k = await deriveKey(password, st.salt, st.iter);
  else throw new Error('setup-needed');
  await unlockWith(k);
  if (remember) await store.set('session', { key: k.key, salt: k.salt, iter: k.iter, until: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() });
  else await store.del('session');
}

async function unlockWith(k) {
  const st = await store.getState();
  const access = await fetchAccess();
  if (access) {
    ACCESS = await decryptJSON(k, access); // baca WrongPassword
    GH = new GitHub(ACCESS);
    status.mode = 'cloud';
  } else {
    if (st.mode !== 'local' || st.salt !== k.salt) throw new WrongPassword();
    status.mode = 'local';
  }
  K = k;

  // lokalna radna kopija
  const env = await store.get('vault');
  let local = null;
  if (env) {
    try {
      local = await decryptJSON(K, env);
    } catch (e) {
      if (!(e instanceof WrongPassword)) throw e;
      if (status.mode === 'local') throw e;
      // Šifra je u međuvremenu promenjena na drugom uređaju: staru kopiju čuvamo kao lokalnu kopiju.
      await store.addSnapshot(env, 'old-password', true);
      await store.del('vault');
    }
  }
  DB = local ? migrate(withGen(local)) : null;
  status.dirty = !!(await store.getState()).dirty && !!local;
  status.lastSyncAt = st.lastSyncAt || null;

  if (status.mode === 'cloud') {
    try {
      await syncNow();
    } catch (e) {
      if (!DB) { lock(); throw e; } // prvi put na ovom uređaju — potreban internet
    }
    if (!DB) { DB = withGen(newDB()); await saveLocal(); }
  }
  if (!DB) throw new Error('no-data');
  store.persist();
  startTimers();
  emit('unlock');
}

export function lock() {
  K = null; DB = null; GH = null; ACCESS = null;
  stopTimers();
  store.del('session').catch(() => {});
  emit('lock');
}

/* ===================== Prvo podešavanje ===================== */

export async function setupLocal(password) {
  const salt = newSalt();
  K = await deriveKey(password, salt, KDF_ITER);
  DB = withGen(newDB());
  status.mode = 'local';
  await store.patchState({ mode: 'local', salt, iter: KDF_ITER, deviceId: uid() });
  await saveLocal();
  startTimers();
  emit('unlock');
}

async function checkRepo(gh, mustBePrivate) {
  let r;
  try { r = await gh.getRepo(); } catch (e) {
    if (e.kind === 'auth') throw new Error('gh_token_invalid');
    if (e.kind === 'notfound') throw new Error('gh_repo_notfound:' + gh.owner + '/' + gh.repo);
    throw e;
  }
  if (mustBePrivate && !r.private) throw new Error('gh_repo_public:' + gh.owner + '/' + gh.repo);
  if (r.permissions && !r.permissions.push) throw new Error('gh_no_write:' + gh.owner + '/' + gh.repo);
  gh.branch = r.default_branch || 'main';
  return r;
}

// Povezivanje sa GitHub-om. Radi i kao prvo podešavanje (password zadat) i iz lokalnog režima (već otključano).
export async function setupCloud({ password, token, dataRepo, codeRepo }) {
  const [dOwner, dName] = dataRepo.split('/');
  const [cOwner, cName] = codeRepo.split('/');
  const gh = new GitHub({ token: token.trim(), owner: dOwner, repo: dName });
  const code = new GitHub({ token: token.trim(), owner: cOwner, repo: cName });
  await checkRepo(gh, true);
  await checkRepo(code, false);

  const remote = await gh.getFile(DATA_PATH);
  let k = K, data = DB;
  if (remote) {
    // U repou već postoje podaci: moraju se otvoriti istom šifrom kojom su sačuvani.
    const env = JSON.parse(remote.text);
    let remoteDb;
    if (k && k.salt === env.kdf.salt) remoteDb = await decryptJSON(k, env);
    else {
      if (!password) throw new WrongPassword();
      ({ data: remoteDb, key: k } = await decryptWithPassword(password, env));
    }
    remoteDb = migrate(withGen(remoteDb));
    const localHasData = DB && (DB.patients.length || DB.invoices.length);
    if (localHasData) {
      await snapshotNow('before-connect');
      data = merge(DB, remoteDb);
      data.meta = { ...remoteDb.meta };
    } else data = remoteDb;
  } else {
    if (!k) k = await deriveKey(password, newSalt(), KDF_ITER);
    if (!data) data = withGen(newDB());
  }

  const access = { type: 'access', token: token.trim(), owner: dOwner, repo: dName, branch: gh.branch, path: DATA_PATH, codeRepo, createdAt: nowStamp() };
  const accessEnv = await encryptJSON(k, access);
  const env = await encryptJSON(k, data);
  const put = await gh.putFile(DATA_PATH, JSON.stringify(env), remote?.sha, commitMsg('Einrichtung'));
  const old = await code.getFile('access.json');
  await code.putFile('access.json', JSON.stringify(accessEnv, null, 1), old?.sha, 'Zugang aktualisiert (verschlüsselt)');

  K = k; DB = data; GH = gh; ACCESS = access; status.mode = 'cloud';
  await store.patchState({ mode: 'cloud', salt: k.salt, iter: k.iter, remoteSha: put.sha, dirty: false, lastSyncAt: nowStamp(), cachedAccess: accessEnv, deviceId: (await store.getState()).deviceId || uid() });
  await saveLocal(false);
  status.lastSyncAt = nowStamp(); status.dirty = false; status.sync = 'ok';
  startTimers();
  emit('unlock');
}

/* ===================== Čuvanje izmena ===================== */

// Sve izmene idu kroz commit(): menja podatke, čuva šifrovano lokalno, pa šalje u oblak.
export function commit(mutator) {
  if (!DB) throw new Error('locked');
  const result = mutator(DB);
  rev++;
  status.dirty = true;
  const p = saveLocal(true);
  scheduleSync(5000);
  emit('change');
  return p.then(() => result);
}

function saveLocal(markDirty = true) {
  const snapshot = clone(DB);
  saving = saving.catch(() => {}).then(async () => {
    const env = await encryptJSON(K, snapshot);
    await store.set('vault', env);
    if (markDirty) await store.patchState({ dirty: true });
    await store.addSnapshot(env, 'auto');
  });
  saving.catch((e) => { status.error = 'save'; emit('error'); console.error(e); });
  return saving;
}

export async function snapshotNow(reason) {
  if (!DB) return;
  await store.addSnapshot(await encryptJSON(K, DB), reason, true);
}

export const pendingSave = () => saving;

/* ===================== Sinhronizacija ===================== */

function commitMsg(what) {
  const d = new Date();
  const ts = d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const dev = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Handy/Tablet' : 'Computer';
  return `${what} ${ts} · ${dev}`;
}

export function scheduleSync(ms = 2500) {
  if (status.mode !== 'cloud') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), ms);
}

export function syncNow() {
  if (status.mode !== 'cloud' || !GH) return Promise.resolve('local');
  if (syncing) { scheduleSync(1500); return syncing; }
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  status.sync = 'busy'; emit('sync');
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      await saving.catch(() => {});
      const st = await store.getState();
      const remote = await GH.getFile(DATA_PATH);
      if (DB && remote && remote.sha === st.remoteSha && !status.dirty) return finish(remote.sha);
      if (!DB && !remote) { DB = withGen(newDB()); rev++; status.dirty = true; await saveLocal(true); }
      let remoteDb = null;
      if (remote) {
        const env = JSON.parse(remote.text);
        try { remoteDb = migrate(withGen(await decryptJSON(K, env))); } catch (e) {
          if (e instanceof WrongPassword) { try { sessionStorage.setItem('physio_msg', 'msg_pw_changed'); } catch { /* */ } lock(); throw Object.assign(new Error('password-changed'), { kind: 'password-changed' }); }
          throw e;
        }
      }
      const startRev = rev;
      let next;
      if (!DB) next = remoteDb;
      else if (!remoteDb) next = DB;
      else if (DB.meta.gen !== remoteDb.meta.gen) {
        // Neko je vratio stariju verziju ili uvezao sigurnosnu kopiju -> novija "generacija" pobeđuje cela.
        if ((remoteDb.meta.genAt || '') >= (DB.meta.genAt || '')) { await snapshotNow('replaced-by-remote'); next = remoteDb; }
        else next = DB;
      } else next = merge(DB, remoteDb);

      if (!DB || stableStringify(next) !== stableStringify(DB)) {
        DB = next;
        await saveLocal(false);
        emit('remote');
      }
      if (remoteDb && stableStringify(DB) === stableStringify(remoteDb)) {
        if (rev === startRev) status.dirty = false;
        await store.patchState({ dirty: status.dirty });
        return finish(remote.sha);
      }
      const env = await encryptJSON(K, DB);
      try {
        const put = await GH.putFile(DATA_PATH, JSON.stringify(env), remote?.sha, commitMsg('Sicherung'));
        if (rev === startRev) status.dirty = false;
        await store.patchState({ dirty: status.dirty });
        return finish(put.sha);
      } catch (e) {
        if (e.kind === 'conflict') continue; // drugi uređaj je upravo sačuvao — ponovi spajanje
        throw e;
      }
    }
    throw new Error('sync-retry');
  } catch (e) {
    status.sync = 'error';
    status.error = e.kind || e.message;
    emit('sync');
    throw e;
  }
}

async function finish(sha) {
  status.lastSyncAt = nowStamp();
  status.sync = status.dirty ? 'pending' : 'ok';
  status.error = null;
  await store.patchState({ remoteSha: sha, lastSyncAt: status.lastSyncAt });
  emit('sync');
  if (status.dirty) scheduleSync(1000);
  return 'ok';
}

/* ===================== Tajmeri / automatsko zaključavanje ===================== */

let pollTimer = null, idleTimer = null;
const IDLE_MS = 20 * 60 * 1000;

function startTimers() {
  stopTimers();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow().catch(() => {}); }, 120_000);
  resetIdle();
}
function stopTimers() { clearInterval(pollTimer); clearTimeout(idleTimer); clearTimeout(syncTimer); }

export async function resetIdle() {
  clearTimeout(idleTimer);
  if (!DB) return;
  const remembered = await store.get('session');
  if (remembered) return; // "ostani prijavljen" — bez automatskog zaključavanja
  idleTimer = setTimeout(async () => {
    await saving.catch(() => {});
    if (status.dirty) await syncNow().catch(() => {});
    lock();
  }, IDLE_MS);
}

/* ===================== Istorija i vraćanje ===================== */

export async function history(page = 1) {
  if (!GH) return [];
  return GH.listCommits(DATA_PATH, page, 50);
}

// Učitava verziju (iz istorije ili fajla) i vraća {data, summary}; po potrebi traži staru šifru.
export async function openEnvelope(env, password) {
  if (env && env.format === 'physio-plain' && env.db) return { data: migrate(env.db), summary: summary(migrate(env.db)) };
  let data;
  try { data = await decryptJSON(K, env); } catch (e) {
    if (!(e instanceof WrongPassword) || !password) throw e;
    data = (await decryptWithPassword(password, env)).data;
  }
  data = migrate(withGen(data));
  return { data, summary: summary(data) };
}

export async function loadVersion(sha) {
  const f = await GH.getFile(DATA_PATH, sha);
  return JSON.parse(f.text);
}

// Zamena svih podataka (vraćanje verzije/uvoz). Pre toga se uvek pravi lokalna kopija trenutnog stanja.
export async function replaceAll(data, how = 'replace') {
  await snapshotNow('before-restore');
  let next = clone(data);
  if (how === 'merge') next = merge(DB, next);
  next.meta = { ...(how === 'merge' ? DB.meta : next.meta), gen: uid(), genAt: nowStamp() };
  DB = migrate(next);
  rev++;
  status.dirty = true;
  await saveLocal(true);
  emit('remote');
  if (status.mode === 'cloud') await syncNow();
}

export const snapshots = () => store.listSnapshots();

export async function exportEncrypted() {
  return encryptJSON(K, DB);
}

export async function markExported() {
  await store.patchState({ lastExportAt: nowStamp() });
}

export async function getState() { return store.getState(); }

/* ===================== Promena šifre / tokena ===================== */

export async function verifyPassword(pw) {
  try { const k = await deriveKey(pw, K.salt, K.iter); const t = await encryptJSON(k, 1); await decryptJSON(K, t); return true; } catch { return false; }
}

export async function changePassword(oldPw, newPw) {
  if (!(await verifyPassword(oldPw))) throw new WrongPassword();
  await snapshotNow('before-password-change');
  const k2 = await deriveKey(newPw, newSalt(), KDF_ITER);
  if (status.mode === 'cloud') {
    await syncNow();
    const remote = await GH.getFile(DATA_PATH);
    const put = await GH.putFile(DATA_PATH, JSON.stringify(await encryptJSON(k2, DB)), remote?.sha, commitMsg('Passwort geändert'));
    await writeAccess(k2, ACCESS);
    await store.patchState({ remoteSha: put.sha });
  }
  K = k2;
  await store.patchState({ salt: k2.salt, iter: k2.iter });
  await saveLocal(false);
  const s = await store.get('session');
  if (s) await store.set('session', { ...s, key: k2.key, salt: k2.salt, iter: k2.iter });
}

async function writeAccess(k, access) {
  const env = await encryptJSON(k, access);
  const [cOwner, cName] = (access.codeRepo || codeRepoGuess()).split('/');
  const code = new GitHub({ token: access.token, owner: cOwner, repo: cName });
  await checkRepo(code, false);
  const old = await code.getFile('access.json');
  await code.putFile('access.json', JSON.stringify(env, null, 1), old?.sha, 'Zugang aktualisiert (verschlüsselt)');
  await store.patchState({ cachedAccess: env });
}

export async function changeToken(token) {
  const gh = new GitHub({ ...ACCESS, token: token.trim() });
  await checkRepo(gh, true);
  const access = { ...ACCESS, token: token.trim(), createdAt: nowStamp() };
  await writeAccess(K, access);
  ACCESS = access; GH = gh;
  status.error = null;
  await syncNow();
}

export const accessInfo = () => (ACCESS ? { repo: `${ACCESS.owner}/${ACCESS.repo}`, createdAt: ACCESS.createdAt } : null);

// Na GitHub Pages adresa je https://VLASNIK.github.io/REPO/
export function codeRepoGuess() {
  const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m ? `${m[1]}/${repo || m[1] + '.github.io'}` : '';
}

export { GitHubError, WrongPassword };
