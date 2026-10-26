// Minimalni klijent za GitHub REST API (samo ono što aplikaciji treba).

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(kind, status, message) { super(message || kind); this.kind = kind; this.status = status; }
}

const te = new TextEncoder();
const td = new TextDecoder();
const toB64 = (s) => { let b = ''; for (const x of te.encode(s)) b += String.fromCharCode(x); return btoa(b); };
const fromB64 = (s) => td.decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GitHub {
  constructor({ token, owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
  }

  async req(method, path, body) {
    let r;
    try {
      r = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError('offline', 0, e.message);
    }
    if (r.ok) return r.status === 204 ? null : r.json();
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* prazno */ }
    if (r.status === 401) throw new GitHubError('auth', 401, msg);
    if (r.status === 404) throw new GitHubError('notfound', 404, msg);
    if (r.status === 409 || (r.status === 422 && /sha/i.test(msg))) throw new GitHubError('conflict', r.status, msg);
    if (r.status === 403 || r.status === 429) throw new GitHubError(/rate limit/i.test(msg) ? 'ratelimit' : 'forbidden', r.status, msg);
    throw new GitHubError('http', r.status, msg);
  }

  repoPath() { return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`; }

  getRepo() { return this.req('GET', this.repoPath()); }

  // Vraća {sha, text} ili null ako fajl ne postoji
  async getFile(path, ref) {
    let j;
    try {
      j = await this.req('GET', `${this.repoPath()}/contents/${encPath(path)}${ref ? '?ref=' + encodeURIComponent(ref) : ''}`);
    } catch (e) {
      if (e.kind === 'notfound') return null;
      throw e;
    }
    if (Array.isArray(j) || j.type !== 'file') throw new GitHubError('http', 0, 'not a file');
    let content = j.encoding === 'base64' ? j.content : '';
    if (!content && j.size > 0) content = (await this.req('GET', `${this.repoPath()}/git/blobs/${j.sha}`)).content;
    return { sha: j.sha, text: fromB64(content || '') };
  }

  async putFile(path, text, sha, message) {
    const j = await this.req('PUT', `${this.repoPath()}/contents/${encPath(path)}`, {
      message, content: toB64(text), branch: this.branch, ...(sha ? { sha } : {}),
    });
    return { sha: j.content.sha, commit: j.commit.sha };
  }

  async listCommits(path, page = 1, perPage = 50) {
    const l = await this.req('GET', `${this.repoPath()}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(this.branch)}&per_page=${perPage}&page=${page}`);
    return l.map((c) => ({ sha: c.sha, date: c.commit.committer.date, message: c.commit.message }));
  }
}
