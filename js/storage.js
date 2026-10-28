/*
 * storage.js — persistence only. Lookups never happen here: on start-up the app loads
 * every row once and rebuilds the hash tables and linked list in memory (structures.js).
 *
 *   CloudStore – Supabase (Postgres REST). Links are shared, so they work on any device.
 *   LocalStore – localStorage fallback when no cloud database is configured.
 */
(function (global) {
  'use strict';

  const PAGE = 1000; // Supabase returns at most 1000 rows per request

  async function errorText(res) {
    try {
      const body = await res.json();
      return body.message || body.hint || res.statusText;
    } catch (_) {
      return res.statusText || 'HTTP ' + res.status;
    }
  }

  async function request(url, options) {
    try {
      return await fetch(url, options);
    } catch (_) {
      throw new Error('Network error. Check your connection and try again.');
    }
  }

  class CloudStore {
    constructor(url, key, table = 'links') {
      const root = url.replace(/\/+$/, '') + '/rest/v1/';
      this.mode = 'cloud';
      this.tableUrl = root + table;
      this.resolveUrl = root + 'rpc/resolve_link';
      this.mineUrl = root + 'rpc/my_links';
      this.createUrl = root + 'rpc/create_link';
      this.deleteUrl = root + 'rpc/delete_link';
      this.headers = { apikey: key, 'Content-Type': 'application/json' };
      // Legacy anon keys are JWTs and go in Authorization too; new sb_publishable_ keys do not.
      if (key.startsWith('eyJ')) this.headers.Authorization = 'Bearer ' + key;
    }

    /*
     * Loads the public demo links plus the links this browser created (it proves ownership
     * with the secret tokens it holds). Other people's links are never listed.
     */
    async load(tokens = []) {
      const all = [];
      for (let offset = 0; ; offset += PAGE) {
        const res = await request(
          `${this.tableUrl}?select=code,url,clicks,created_at&order=created_at.asc,code.asc&limit=${PAGE}&offset=${offset}`,
          { headers: this.headers }
        );
        if (!res.ok) throw new Error('Could not load links: ' + (await errorText(res)));
        const rows = await res.json();
        for (const r of rows) all.push({ code: r.code, url: r.url, clicks: r.clicks, created: r.created_at });
        if (rows.length < PAGE) break;
      }
      if (tokens.length) {
        const res = await request(this.mineUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ p_tokens: tokens.slice(0, 500) }),
        });
        if (!res.ok) throw new Error('Could not load your links: ' + (await errorText(res)));
        for (const r of await res.json()) all.push({ code: r.code, url: r.url, clicks: r.clicks, created: r.created_at });
        all.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.code < b.code ? -1 : 1));
      }
      return all;
    }

    /* Looks up one link by its exact code (rate limited on the server). click = count a visit. */
    async resolve(code, click = true) {
      const res = await request(this.resolveUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ p_code: code, p_click: click }),
        keepalive: click,
      });
      if (!res.ok) throw new Error(await errorText(res));
      const url = await res.json();
      return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
    }

    // Links are created only through create_link (rate limited, even when the code is taken).
    // The database sets created_at and clicks itself, so only code, url and the token are sent.
    async add(entry) {
      let res;
      try {
        res = await request(this.createUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ p_code: entry.code, p_url: entry.url, p_token: entry.token }),
        });
      } catch (err) {
        return { ok: false, error: err.message };
      }
      if (!res.ok) return { ok: false, error: await errorText(res) };
      if ((await res.json()) !== true) return { ok: false, error: 'That short code is already taken.' };
      return { ok: true };
    }

    async addMany(entries) {
      for (const e of entries) {
        const r = await this.add(e);
        if (!r.ok) return r;
      }
      return { ok: true };
    }

    // Deleting needs the secret token generated when the link was created (kept in the creator's browser).
    async remove(code, token) {
      if (!token) return { ok: false, error: 'Only the browser that created this link can delete it.' };
      let res;
      try {
        res = await request(this.deleteUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ p_code: code, p_token: token }),
        });
      } catch (err) {
        return { ok: false, error: err.message };
      }
      if (!res.ok) return { ok: false, error: 'Delete failed: ' + (await errorText(res)) };
      if ((await res.json()) !== true) return { ok: false, error: 'Delete refused: this browser does not own that link.' };
      return { ok: true };
    }

  }

  class LocalStore {
    constructor(snapshot, storageKey = 'velerion-links-v1') {
      this.mode = 'local';
      this.snapshot = snapshot; // () => current entries, in insertion order
      this.storageKey = storageKey;
    }

    async load() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    _persist(extra) {
      try {
        const entries = this.snapshot();
        if (extra) entries.push(...extra);
        localStorage.setItem(this.storageKey, JSON.stringify(entries));
      } catch (_) {
        /* storage blocked — the session still works in memory */
      }
      return { ok: true };
    }

    // add() runs before the entry is inserted into the in-memory structures, so include it.
    async addMany(entries) {
      return this._persist(entries);
    }

    add(entry) {
      return this.addMany([entry]);
    }

    // remove() and increment() run after the in-memory structures have been updated.
    async remove() {
      return this._persist();
    }

    async increment() {
      return this._persist();
    }

    // Everything is already in the in-memory tables in demo mode.
    async resolve() {
      return null;
    }

    clear() {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (_) {}
    }
  }

  global.HashLinkStorage = { CloudStore, LocalStore };
})(window);
