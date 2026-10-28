/*
 * app.js — UI for the Velerion URL shortener. All lookups go through structures.js:
 *   chain  – ChainingHashTable        (primary store, separate chaining)
 *   oa     – OpenAddressingHashTable  (same data, linear probing)
 *   list   – LinkedList               (same data, sequential-search baseline)
 * The three hold the same value objects, so a click count updated through one is seen by all.
 */
(function () {
  'use strict';

  const { ChainingHashTable, OpenAddressingHashTable, LinkedList, Stack, CircularQueue,
    hashIndex, hashSteps, nextPrime, randomCode, TOMBSTONE } = window.DSA;
  const { CloudStore, LocalStore } = window.HashLinkStorage;
  const CONFIG = window.HASHLINK_CONFIG || {};
  const MEMES = window.MEMES || [];

  const PREFS_KEY = 'velerion-prefs-v1';
  const OWNED_KEY = 'hashlink-owned-v1'; // kept from the first version so existing owners keep their links
  const CODE_RE = /^[A-Za-z0-9_-]{1,24}$/;
  const PAGE_SIZE = 12;
  const VIZ_LIMIT = { chainNodes: 8, listNodes: 80, slots: 400 };
  const REDIRECT_MS = CONFIG.redirectDelayMs == null ? 2500 : CONFIG.redirectDelayMs;

  const state = {
    store: null,
    list: new LinkedList(),
    chain: new ChainingHashTable(17),
    oa: new OpenAddressingHashTable(17),
    owned: new ChainingHashTable(17), // code -> delete token, for links created in this browser
    undo: new Stack(),
    activity: new CircularQueue(10),
    view: 'hash',
    hashCode: '',
    hl: null, // highlight of the last operation in the visualisations
    page: 1,
    redirectTimer: null,
    memeTimer: null,
    lastMeme: -1,
  };

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const name of Object.keys(attrs)) {
        const v = attrs[name];
        if (v == null || v === false) continue;
        if (name === 'class') el.className = v;
        else if (name === 'style') el.style.cssText = v; // CSSOM: allowed by the CSP
        else if (name.startsWith('on')) el.addEventListener(name.slice(2), v);
        else el.setAttribute(name, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const code = (text) => h('code', null, text);
  const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function basePath() {
    return location.pathname.replace(/[^/]*$/, '');
  }

  // On GitHub Pages, 404.html turns /<code> into /#/<code>, so links can be clean paths.
  function shortUrl(c) {
    const pretty = location.hostname.endsWith('github.io');
    return location.origin + basePath() + (pretty ? '' : '#/') + c;
  }

  const displayUrl = (c) => shortUrl(c).replace(/^https?:\/\//, '');

  function isPrivateHost(host) {
    return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host) ||
      host.startsWith('[');
  }

  /* Returns { url } or { error }. */
  function checkUrl(raw) {
    let s = (raw || '').trim();
    if (!s) return { error: 'Paste a link to shorten.' };
    if (s.length > 2048) return { error: 'That link is too long (2048 characters max).' };
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    let u;
    try {
      u = new URL(s);
    } catch (_) {
      return { error: 'That doesn’t look like a valid link.' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http and https links can be shortened.' };
    if (u.username || u.password) return { error: 'Links containing a username or password are not allowed.' };
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || isPrivateHost(host)) return { error: 'Use a public web address.' };
    if (host === location.hostname) return { error: 'That is already a Velerion link.' };
    if (u.href.length > 2048) return { error: 'That link is too long (2048 characters max).' };
    return { url: u.href };
  }

  /* Accepts a code, a full short link or a #/code link and returns the code (or ''). */
  function parseCode(raw) {
    let s = (raw || '').trim();
    if (!s) return '';
    const hashMatch = s.match(/#\/([A-Za-z0-9_-]{1,24})\/?$/);
    if (hashMatch) return hashMatch[1];
    s = s.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    const last = s.split('/').pop();
    return CODE_RE.test(last) ? last : '';
  }

  function copy(text) {
    const ok = () => toast('Copied ' + text.replace(/^https?:\/\//, ''));
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok, () => window.prompt('Copy this link:', text));
    } else {
      window.prompt('Copy this link:', text);
    }
  }

  function toast(message, { type = 'info', action = null, timeout = 3200 } = {}) {
    const el = h('div', { class: 'toast' + (type === 'error' ? ' error' : ''), role: type === 'error' ? 'alert' : 'status' }, message);
    let timer;
    const close = () => { clearTimeout(timer); el.remove(); };
    if (action) {
      el.append(h('button', { type: 'button', onclick: () => { close(); action.fn(); } }, action.label));
    }
    $('toasts').append(el);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    timer = setTimeout(close, action ? Math.max(timeout, 6000) : timeout);
  }

  function loadPrefs() {
    try {
      try { localStorage.removeItem(PREFS_KEY); } catch (_) {} // older versions kept history permanently
      const p = JSON.parse(sessionStorage.getItem(PREFS_KEY) || '{}');
      if (['hash', 'chain', 'open', 'list'].includes(p.view)) state.view = p.view;
      for (const item of (p.undo || []).slice(0, 20).reverse()) state.undo.push(item);
      for (const item of p.activity || []) state.activity.enqueue(item);
    } catch (_) {}
  }

  function savePrefs() {
    try {
      sessionStorage.setItem(PREFS_KEY, JSON.stringify({
        view: state.view,
        undo: state.undo.toArray().slice(0, 20),
        activity: state.activity.toArray(),
      }));
    } catch (_) {}
  }

  function log(type, text) {
    state.activity.enqueue({ type, text, at: new Date().toISOString() });
    savePrefs();
  }

  /* Delete tokens: a random secret per link, created and kept only in the creator's browser. */
  function loadOwned() {
    try {
      for (const o of JSON.parse(localStorage.getItem(OWNED_KEY) || '[]')) {
        if (o && CODE_RE.test(o.code) && typeof o.token === 'string') state.owned.insert(o.code, o.token);
      }
    } catch (_) {}
  }

  function saveOwned() {
    const out = [];
    for (const bucket of state.owned.buckets) for (const node of bucket) out.push({ code: node.key, token: node.value });
    try {
      localStorage.setItem(OWNED_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  const newToken = () => (state.store.mode === 'cloud' ? crypto.randomUUID() : null);

  function own(c, token) {
    if (!token) return;
    state.owned.remove(c);
    state.owned.insert(c, token);
    saveOwned();
  }

  const canDelete = (c) => state.store.mode !== 'cloud' || state.owned.has(c);

  /* ------------------------------------------------------------------ */
  /* memes (loading + redirect screens)                                  */
  /* ------------------------------------------------------------------ */

  function memeCard(m) {
    return h('figure', { class: 'meme' },
      m.img ? h('img', { src: m.img, alt: m.caption || 'Meme', loading: 'lazy' }) : h('div', { class: 'meme-emoji', 'aria-hidden': 'true' }, m.emoji || '🎬'),
      m.quote ? h('p', { class: 'meme-quote' }, '“', m.quote, '”') : null,
      h('p', { class: 'meme-caption' }, m.caption),
      h('figcaption', { class: 'meme-movie' }, m.movie));
  }

  function nextMeme() {
    if (!MEMES.length) return null;
    let i;
    do i = Math.floor(Math.random() * MEMES.length); while (MEMES.length > 1 && i === state.lastMeme);
    state.lastMeme = i;
    return MEMES[i];
  }

  function startMemes(slotId) {
    stopMemes();
    const show = () => {
      const m = nextMeme();
      if (m) $(slotId).replaceChildren(memeCard(m));
    };
    show();
    state.memeTimer = setInterval(show, 3500);
  }

  function stopMemes() {
    clearInterval(state.memeTimer);
    state.memeTimer = null;
  }

  /* ------------------------------------------------------------------ */
  /* data operations                                                     */
  /* ------------------------------------------------------------------ */

  function entries() {
    return state.list.toArray().map(({ key, value }) => ({
      code: key, url: value.url, clicks: value.clicks, created: value.created,
    }));
  }

  function build(list) {
    state.list = new LinkedList();
    state.chain = new ChainingHashTable(17);
    state.oa = new OpenAddressingHashTable(17);
    for (const e of list) {
      // Never trust stored data: only well-formed codes and http(s) URLs are loaded.
      if (!CODE_RE.test(e.code) || !/^https?:\/\//i.test(e.url || '')) continue;
      insertLocal(e.code, { url: e.url, clicks: e.clicks || 0, created: e.created });
    }
  }

  function insertLocal(c, value) {
    const chain = state.chain.insert(c, value);
    if (!chain.ok) return { ok: false, chain };
    const oa = state.oa.insert(c, value);
    state.list.append(c, value);
    return { ok: true, chain, oa, position: state.list.size };
  }

  function removeLocal(c) {
    return { chain: state.chain.remove(c), oa: state.oa.remove(c), list: state.list.remove(c) };
  }

  // New links get 7 random characters (62^7 ≈ 3.5 trillion codes), so private links can't be guessed.
  function secureRandom() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }

  function newCode() {
    let c;
    do c = randomCode(secureRandom, 7); while (state.chain.has(c));
    return c;
  }

  // Finds an unused code whose hash lands in a bucket that already holds a key.
  function collidingCode() {
    const t = state.chain;
    if (!t.size) return newCode();
    // Adding a link may grow the table first, so aim at a bucket of the table as it will be.
    const size = (t.size + 1) / t.bucketCount > t.maxLoad ? nextPrime(t.bucketCount * 2) : t.bucketCount;
    const keys = [];
    for (const node of state.list) keys.push(node.key);
    const target = hashIndex(keys[Math.floor(Math.random() * keys.length)], size);
    let c;
    do c = randomCode(secureRandom, 7); while (hashIndex(c, size) !== target || t.has(c));
    return c;
  }

  let busy = false;

  async function shorten(rawUrl, alias, forceCollision) {
    if (busy) return;
    const checked = forceCollision && !rawUrl.trim()
      ? { url: 'https://example.com/collision-demo/' + Date.now() }
      : checkUrl(rawUrl);
    if (checked.error) {
      $('long-url').setAttribute('aria-invalid', 'true');
      return toast(checked.error, { type: 'error' });
    }
    $('long-url').removeAttribute('aria-invalid');

    let c;
    if (forceCollision) c = collidingCode();
    else if (alias) {
      if (!CODE_RE.test(alias)) return toast('Endings may use letters, numbers, “-” and “_” (24 max).', { type: 'error' });
      if (state.chain.has(alias)) return toast(`“${alias}” is already taken. Try another ending.`, { type: 'error' });
      c = alias;
    } else c = newCode();

    busy = true;
    $('shorten-btn').disabled = true;
    $('shorten-btn').textContent = 'Shortening…';
    try {
      const created = new Date().toISOString();
      const token = newToken();
      const saved = await state.store.add({ code: c, url: checked.url, created, token });
      if (!saved.ok) return toast(saved.error, { type: 'error' });
      own(c, token);

      const r = insertLocal(c, { url: checked.url, clicks: 0, created });
      state.hl = { kind: 'insert', code: c, bucket: r.chain.index, chainKeys: [], oaSlots: r.oa.path, listKeys: [] };
      state.hashCode = c;
      log(r.chain.collision ? 'collision' : 'shorten',
        r.chain.collision ? `${c} collided in bucket ${r.chain.index}, chained behind ${r.chain.chainedBehind}` : `Shortened ${c}`);
      $('long-url').value = '';
      $('alias').value = '';
      showResult(c, checked.url, r, forceCollision);
      renderAll();
      if (forceCollision) {
        setView('chain');
        document.querySelector('.bucket.active')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      }
    } finally {
      busy = false;
      $('shorten-btn').disabled = false;
      $('shorten-btn').textContent = 'Shorten';
    }
  }

  function retrieve(c) {
    const chain = state.chain.get(c);
    const oa = state.oa.get(c);
    const list = state.list.search(c);
    state.hl = { kind: chain.found ? 'found' : 'miss', code: c, bucket: chain.index,
      chainKeys: chain.path, oaSlots: oa.path, listKeys: list.path };
    state.hashCode = c;
    log('find', `${chain.found ? 'Found' : 'Missed'} ${c}: hash table ${chain.comparisons} vs list ${list.comparisons}`);
    showLookup(c, chain, oa, list);
    renderAll();
    if (!chain.found && state.store.mode === 'cloud') checkPrivate(c);
  }

  // Someone else's link is private, so it isn't in this browser's tables; ask for it by exact code.
  async function checkPrivate(c) {
    let url = null;
    try {
      url = await state.store.resolve(c, false);
    } catch (err) {
      return toast(err.message, { type: 'error' });
    }
    if (!url) return;
    $('lookup-result').querySelector('.lookup-card')?.append(h('div', { class: 'callout' },
      h('strong', null, 'This is someone else’s private link. '),
      'Private links are never downloaded into your hash table (it holds only your own links), so the database looked it up by its exact code: ',
      h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url)));
  }

  async function del(c) {
    const chain = state.chain.get(c);
    if (!chain.found) return toast(`No link with code “${c}”.`, { type: 'error' });
    if (!canDelete(c)) return toast('Only the browser that created a link can delete it.', { type: 'error' });
    const value = chain.value;
    const saved = await state.store.remove(c, state.owned.get(c).value);
    if (!saved.ok) return toast(saved.error, { type: 'error' });
    state.owned.remove(c);
    saveOwned();
    const r = removeLocal(c);
    state.undo.push({ code: c, url: value.url, clicks: value.clicks, created: value.created });
    state.hl = { kind: 'delete', code: c, bucket: r.chain.index, chainKeys: [], oaSlots: r.oa.path, listKeys: [] };
    log('delete', `Deleted ${c}`);
    showDelete(c, r);
    renderAll();
    toast(`Deleted ${c}`, { action: { label: 'Undo', fn: undo } });
  }

  async function undo() {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const item = state.undo.pop();
    if (!item) return toast('Nothing to undo.', { type: 'error' });
    savePrefs();
    if (state.chain.has(item.code)) {
      renderAll();
      return toast(`“${item.code}” is in use again, so it can't be restored.`, { type: 'error' });
    }
    const created = new Date().toISOString();
    const token = newToken();
    const saved = await state.store.add({ code: item.code, url: item.url, created, token });
    if (!saved.ok) {
      state.undo.push(item);
      savePrefs();
      return toast(saved.error, { type: 'error' });
    }
    own(item.code, token);
    const r = insertLocal(item.code, { url: item.url, clicks: 0, created });
    state.hl = { kind: 'insert', code: item.code, bucket: r.chain.index, chainKeys: [], oaSlots: r.oa.path, listKeys: [] };
    log('undo', `Restored ${item.code} (popped from the undo stack)`);
    renderAll();
    toast(`Restored ${item.code}`);
  }

  /* ------------------------------------------------------------------ */
  /* result cards                                                        */
  /* ------------------------------------------------------------------ */

  function showResult(c, url, r, forced) {
    const { chain, oa } = r;
    const url_ = shortUrl(c);
    const chips = [
      h('span', { class: 'chip' }, `Bucket ${chain.index} of ${state.chain.bucketCount}`),
      chain.collision
        ? h('span', { class: 'chip warn' }, `Collision! Chained behind ${chain.chainedBehind}`)
        : h('span', { class: 'chip ok' }, 'Empty bucket, no collision'),
      oa.collision
        ? h('span', { class: 'chip warn' }, `Open addressing: slot ${oa.home} taken, stored in ${oa.index}`)
        : h('span', { class: 'chip' }, `Open addressing: slot ${oa.index}`),
    ];
    if (chain.grew) chips.push(h('span', { class: 'chip info' }, `Chaining table grew ${chain.grew.from} → ${chain.grew.to} buckets`));
    if (oa.grew) chips.push(h('span', { class: 'chip info' }, `Open addressing grew ${oa.grew.from} → ${oa.grew.to} slots`));

    const box = $('result');
    box.hidden = false;
    box.replaceChildren(...[
      forced ? h('p', { class: 'eyebrow' }, 'Collision demo') : null,
      h('div', { class: 'result-top' },
        h('a', { class: 'short-big', href: url_, target: '_blank', rel: 'noopener noreferrer' }, displayUrl(c)),
        h('button', { class: 'btn primary', type: 'button', onclick: () => copy(url_) }, 'Copy'),
        h('a', { class: 'btn', href: url_, target: '_blank', rel: 'noopener noreferrer' }, 'Open')),
      h('p', { class: 'dest trunc', title: url }, '→ ', url),
      h('div', { class: 'chips' }, chips),
      h('div', { class: 'result-foot' },
        h('button', { class: 'btn linkish', type: 'button', onclick: () => explain(c) }, 'See how it was hashed and stored →')),
    ].filter(Boolean));
  }

  function explain(c) {
    state.hashCode = c;
    $('hash-input').value = c;
    setView('hash');
    renderHash();
    $('inside').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function compareBars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return h('div', { class: 'bars' }, rows.map((r) =>
      h('div', { class: 'bar-row' },
        h('span', null, r.label),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill ' + r.cls, style: `width:${(r.value / max) * 100}%` })),
        h('span', { class: 'bar-value' }, String(r.value)))));
  }

  function showLookup(c, chain, oa, list) {
    const found = chain.found;
    const ratio = chain.comparisons ? list.comparisons / chain.comparisons : null;
    $('lookup-result').replaceChildren(h('div', { class: 'card lookup-card' },
      h('h3', null, found ? 'Found ' : 'Not found: ', code(c)),
      found ? h('a', { class: 'dest-link', href: chain.value.url, target: '_blank', rel: 'noopener noreferrer' }, chain.value.url) : null,
      compareBars([
        { label: 'Hash table · chaining', value: chain.comparisons, cls: 'c-chain' },
        { label: 'Hash table · open addressing', value: oa.comparisons, cls: 'c-oa' },
        { label: 'Linked list · sequential', value: list.comparisons, cls: 'c-list' },
      ]),
      h('p', { class: 'verdict' }, found
        ? (ratio && ratio > 1
          ? `The hash table needed ${plural(chain.comparisons, 'comparison')}; the linked list needed ${list.comparisons}, ${fmt(ratio, 1)}× more.`
          : `Both needed few comparisons because ${c} is near the start of the list. Try a newer link.`)
        : `Not stored. The hash table only checked bucket ${chain.index} (${plural(chain.comparisons, 'comparison')}); the linked list had to check all ${list.comparisons} nodes.`),
      h('details', { class: 'paths' },
        h('summary', null, 'Show the search paths'),
        h('div', { class: 'step' }, `Chaining: bucket ${chain.index} → `,
          chain.path.length ? chain.path.flatMap((k, i) => [i ? ' → ' : '', code(k)]) : '(empty bucket)'),
        h('div', { class: 'step' }, `Open addressing: slots ${oa.path.join(' → ')}`),
        h('div', { class: 'step' }, `Linked list: ${plural(list.comparisons, 'node')} visited from head`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn linkish', type: 'button', onclick: () => explain(c) }, 'Show the hashing →'))));
  }

  function showDelete(c, r) {
    $('lookup-result').replaceChildren(h('div', { class: 'card lookup-card' },
      h('h3', null, 'Deleted ', code(c)),
      compareBars([
        { label: 'Hash table · chaining', value: r.chain.comparisons, cls: 'c-chain' },
        { label: 'Hash table · open addressing', value: r.oa.comparisons, cls: 'c-oa' },
        { label: 'Linked list · sequential', value: r.list.comparisons, cls: 'c-list' },
      ]),
      h('p', { class: 'step' }, `Chaining: unlinked from bucket ${r.chain.index}. Open addressing: slot ${r.oa.index} now holds a tombstone. Pushed onto the undo stack (${state.undo.size} item${state.undo.size === 1 ? '' : 's'}).`)));
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderStats() {
    const s = state.chain.stats();
    const tile = (value, label) => h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));
    $('stats').replaceChildren(
      tile(String(s.size), 'links in your table'),
      tile(String(s.bucketCount), 'hash table buckets'),
      tile(String(s.collisions), 'collisions resolved'),
      tile(fmt(s.loadFactor), 'load factor (links ÷ buckets)'));
  }

  function renderHash() {
    const m = state.chain.bucketCount;
    $('formula-m').textContent = String(m);
    const input = $('hash-input');
    if (!input.value && state.hashCode) input.value = state.hashCode;
    const key = input.value;
    if (!key) {
      $('hash-steps').replaceChildren(h('p', { class: 'muted' }, 'Type a code above to see it hashed step by step.'));
      return;
    }
    const { index, steps } = hashSteps(key, m);
    const stored = state.chain.get(key);
    const oaSlot = state.oa.homeIndex(key);
    $('hash-steps').replaceChildren(
      h('div', { class: 'table-wrap hash-table' }, h('table', null,
        h('thead', null, h('tr', null, ['Step', 'Character', 'Character code', `h × 31 + code`, `mod ${m} = new h`].map((t, i) =>
          h('th', { class: i > 1 ? 'num' : null }, t)))),
        h('tbody', null, steps.map((s, i) => h('tr', null,
          h('td', null, String(i + 1)),
          h('td', null, `'${s.char}'`),
          h('td', { class: 'num' }, String(s.code)),
          h('td', { class: 'num' }, `${s.prev} × 31 + ${s.code} = ${s.prev * 31 + s.code}`),
          h('td', { class: 'num' }, h('strong', null, String(s.next)))))))),
      h('div', { class: 'hash-final' },
        h('span', null, 'Result: bucket'), h('span', { class: 'big-index' }, String(index)),
        h('span', { class: 'muted' }, stored.found
          ? `· “${key}” is stored here${state.chain.buckets[index].size > 1 ? ` with ${plural(state.chain.buckets[index].size - 1, 'other link')} (a collision, so they share a chain)` : ', alone in its bucket'}.`
          : `· no link “${key}” is stored, so a search would check ${plural(state.chain.buckets[index].size, 'link')} in this bucket and stop.`)),
      h('p', { class: 'muted' }, `With ${state.oa.capacity} slots, open addressing uses the same formula and gives home slot ${oaSlot}.`));
  }

  function growthList(id, log, unit) {
    $(id).replaceChildren(...(log.length
      ? log.map((g) => h('li', null, `When link #${g.atItem} arrived: ${g.from} → ${g.to} ${unit}`))
      : [h('li', null, `No growth yet: still ${unit === 'buckets' ? state.chain.bucketCount : state.oa.capacity} ${unit}`)]));
  }

  function renderChain() {
    const hl = state.hl;
    growthList('chain-growth', state.chain.growLog, 'buckets');
    const rows = state.chain.buckets.map((bucket, i) => {
      const active = hl && hl.bucket === i;
      const nodes = [];
      let shown = 0;
      for (const node of bucket) {
        if (shown === VIZ_LIMIT.chainNodes) {
          nodes.push(h('span', { class: 'node more' }, `+${bucket.size - shown} more`), h('span', { class: 'arrow' }, '→'));
          break;
        }
        shown++;
        let cls = 'node';
        if (bucket.size > 1) cls += ' collided';
        if (active && hl.chainKeys.includes(node.key)) cls += ' visited';
        if (hl && hl.code === node.key && hl.kind !== 'miss') cls += ' target';
        nodes.push(h('span', { class: cls, title: node.value.url }, node.key), h('span', { class: 'arrow' }, '→'));
      }
      nodes.push(h('span', { class: 'null' }, '∅'));
      return h('div', { class: 'bucket' + (active ? ' active' : '') + (bucket.size > 1 ? ' has-collision' : '') },
        h('span', { class: 'bucket-idx' }, String(i)),
        h('div', { class: 'chain' }, nodes));
    });
    $('chain-viz').replaceChildren(...rows);
  }

  function renderOA() {
    const hl = state.hl;
    const oa = state.oa;
    growthList('oa-growth', oa.growLog, 'slots');
    const limit = Math.min(oa.capacity, VIZ_LIMIT.slots);
    const cells = [];
    for (let i = 0; i < limit; i++) {
      const slot = oa.slots[i];
      let cls = 'slot';
      let label = '';
      let sub = '';
      let title = `slot ${i}: empty`;
      if (slot === TOMBSTONE) {
        cls += ' tomb';
        label = '✕';
        title = `slot ${i}: tombstone (deleted)`;
      } else if (slot) {
        const home = oa.homeIndex(slot.key);
        label = slot.key;
        cls += home === i ? ' home' : ' moved';
        if (home !== i) sub = `home ${home}`;
        title = `slot ${i}: ${slot.key} → ${slot.value.url}`;
        if (hl && hl.code === slot.key && hl.kind !== 'miss') cls += ' target';
      }
      if (hl && hl.oaSlots.includes(i)) cls += ' visited';
      cells.push(h('div', { class: cls, title },
        h('span', { class: 'slot-idx' }, String(i)),
        h('span', { class: 'slot-key' }, label),
        h('span', { class: 'slot-sub' }, sub)));
    }
    if (oa.capacity > limit) cells.push(h('div', { class: 'slot' }, h('span', { class: 'slot-sub' }, `+${oa.capacity - limit} more slots`)));
    $('oa-viz').replaceChildren(...cells);
  }

  function renderList() {
    const hl = state.hl;
    const parts = [h('span', { class: 'ptr' }, 'head'), h('span', { class: 'arrow' }, '→')];
    let i = 0;
    for (const node of state.list) {
      i++;
      if (i > VIZ_LIMIT.listNodes) {
        parts.push(h('span', { class: 'node more' }, `… ${state.list.size - VIZ_LIMIT.listNodes} more`), h('span', { class: 'arrow' }, '→'));
        break;
      }
      let cls = 'node';
      if (hl && hl.listKeys.includes(node.key)) cls += ' visited';
      if (hl && hl.code === node.key && hl.kind !== 'miss') cls += ' target';
      parts.push(h('span', { class: cls, title: `#${i}: ${node.value.url}` }, node.key), h('span', { class: 'arrow' }, '→'));
    }
    parts.push(h('span', { class: 'null' }, 'null'));
    $('list-viz').replaceChildren(...parts);
  }

  function renderQueue() {
    const q = state.activity;
    const rear = (q.front + q.count - 1 + q.capacity) % q.capacity;
    const ring = [];
    for (let i = 0; i < q.capacity; i++) {
      const item = q.items[i];
      const marks = [];
      if (q.count && i === q.front) marks.push('front');
      if (q.count && i === rear) marks.push('rear');
      ring.push(h('div', { class: 'qslot' + (item ? ' full t-' + item.type : ''), title: item ? item.text : 'empty' },
        h('span', { class: 'qidx' }, String(i)),
        h('span', { class: 'qmark' }, marks.join(' · '))));
    }
    const items = q.toArray().reverse();
    $('queue-viz').replaceChildren(
      h('div', { class: 'qring' }, ring),
      h('p', { class: 'hint' }, `front = ${q.front}, count = ${q.count}. When the queue is full, the oldest entry is removed to make room.`),
      items.length
        ? h('ol', { class: 'activity' }, items.map((it) => h('li', { class: 't-' + it.type },
          h('span', { class: 'tag' }, it.type), it.text,
          h('span', { class: 'time' }, new Date(it.at).toLocaleTimeString()))))
        : h('p', { class: 'muted' }, 'Nothing yet.'));
  }

  function renderStack() {
    const items = state.undo.toArray();
    $('undo-btn').disabled = !items.length;
    $('stack-viz').replaceChildren(items.length
      ? h('div', { class: 'stack' }, items.map((it, i) => h('div', { class: 'stack-item' },
        h('span', { class: 'mono' }, it.code),
        h('span', { class: 'trunc muted' }, it.url),
        i === 0 ? h('span', { class: 'top' }, 'top') : null)))
      : h('p', { class: 'muted' }, 'Empty. Delete one of your links and it lands here.'));
  }

  function linkRow(n, c, v, actions) {
    return h('tr', null,
      h('td', { class: 'muted' }, String(n)),
      h('td', null, h('a', { class: 'mono', href: shortUrl(c), target: '_blank', rel: 'noopener noreferrer' }, c)),
      h('td', { class: 'trunc url-cell', title: v.url }, v.url),
      h('td', { class: 'num' }, String(state.chain.indexFor(c))),
      h('td', { class: 'num' }, String(v.clicks || 0)),
      h('td', { class: 'actions' },
        h('button', { class: 'btn tiny', type: 'button', onclick: () => copy(shortUrl(c)) }, 'Copy'),
        h('button', { class: 'btn tiny', type: 'button', onclick: () => { $('lookup-code').value = c; retrieve(c); $('lookup').scrollIntoView(); } }, 'Find'),
        actions));
  }

  const tableHead = () => h('thead', null, h('tr', null,
    ['#', 'Short link', 'Destination', 'Bucket', 'Clicks', ''].map((t, k) => h('th', { class: k === 3 || k === 4 ? 'num' : null }, t))));

  /* "Your links": only links created in this browser. */
  function renderTable() {
    const filter = $('filter').value.trim().toLowerCase();
    const rows = [];
    let i = 0;
    let mine = 0;
    for (const node of state.list) {
      i++;
      const c = node.key;
      const v = node.value;
      mine++;
      if (filter && !c.toLowerCase().includes(filter) && !v.url.toLowerCase().includes(filter)) continue;
      rows.push({ i, c, v });
    }
    rows.reverse(); // newest first
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    $('links-count').textContent = mine
      ? `${plural(mine, 'link')} created in this browser. Only you can see this list; other people's links are private.`
      : 'Links you shorten in this browser appear here. Nobody else can see them.';
    const body = h('tbody', null, slice.length
      ? slice.map(({ i: n, c, v }) => linkRow(n, c, v,
        canDelete(c) ? h('button', { class: 'btn tiny danger', type: 'button', onclick: () => del(c) }, 'Delete') : null))
      : h('tr', null, h('td', { colspan: 6, class: 'muted' }, mine ? 'No matching links.' : 'You haven’t shortened any links yet. Paste one at the top of the page.')));
    $('links-table').replaceChildren(tableHead(), body);

    $('pager').replaceChildren(...(pages > 1 ? [
      h('button', { class: 'btn small', type: 'button', disabled: state.page === 1, onclick: () => { state.page--; renderTable(); } }, '← Newer'),
      h('span', null, `Page ${state.page} of ${pages}`),
      h('button', { class: 'btn small', type: 'button', disabled: state.page === pages, onclick: () => { state.page++; renderTable(); } }, 'Older →'),
    ] : []));
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    for (const v of ['hash', 'chain', 'open', 'list']) $('panel-' + v).hidden = v !== view;
    savePrefs();
  }

  function renderAll() {
    renderStats();
    renderHash();
    renderChain();
    renderOA();
    renderList();
    renderQueue();
    renderStack();
    renderTable();
  }

  /* ------------------------------------------------------------------ */
  /* short-link redirects                                                */
  /* ------------------------------------------------------------------ */

  function routeCode() {
    const m = location.hash.match(/^#\/([A-Za-z0-9_-]{1,24})$/);
    return m ? m[1] : null;
  }

  function hideScreen(id) {
    const el = $(id);
    if (el.hidden) return;
    el.classList.add('leaving');
    setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 300);
  }

  function leaveRedirect() {
    clearTimeout(state.redirectTimer);
    stopMemes();
    hideScreen('redirect');
    if (routeCode()) history.replaceState(null, '', basePath());
  }

  async function handleRoute() {
    const c = routeCode();
    if (!c) {
      $('redirect').hidden = true;
      return;
    }
    $('redirect').hidden = false;
    if (!state.memeTimer) startMemes('redirect-meme');
    const chain = state.chain.get(c);
    const list = state.list.search(c);
    const go = $('redirect-go');
    let url = chain.found ? chain.value.url : null;
    if (state.store.mode === 'cloud') {
      try {
        url = await state.store.resolve(c, true);
      } catch (err) {
        $('redirect-eyebrow').textContent = 'Please wait';
        $('redirect-host').textContent = 'Too many requests';
        $('redirect-url').textContent = err.message;
        $('redirect-stats').textContent = '';
        go.hidden = true;
        return;
      }
    }
    if (!url || !/^https?:\/\//i.test(url)) {
      $('redirect-eyebrow').textContent = 'Link not found';
      $('redirect-host').textContent = `velerion/${c}`;
      $('redirect-url').textContent = 'This short link doesn’t exist or was deleted.';
      $('redirect-stats').textContent = '';
      $('redirect-stay').textContent = 'Go to Velerion';
      go.hidden = true;
      return;
    }
    if (chain.found) chain.value.clicks = (chain.value.clicks || 0) + 1;
    if (state.store.mode !== 'cloud') state.store.increment(c);
    log('redirect', `Redirected ${c}`);
    $('redirect-eyebrow').textContent = 'Taking you to';
    $('redirect-host').textContent = new URL(url).hostname.replace(/^www\./, '');
    $('redirect-url').textContent = url;
    $('redirect-stats').textContent = chain.found
      ? `Found in bucket ${chain.index} after ${plural(chain.comparisons, 'comparison')}. A linked list would need ${list.comparisons}.`
      : 'Private link, looked up by its exact code.';
    $('redirect-stay').textContent = 'Cancel';
    go.href = url;
    go.hidden = false;
    const bar = $('redirect-progress');
    bar.hidden = false;
    bar.style.setProperty('--dur', REDIRECT_MS + 'ms');
    bar.classList.remove('run');
    void bar.offsetWidth;
    bar.classList.add('run');
    clearTimeout(state.redirectTimer);
    state.redirectTimer = setTimeout(() => location.replace(url), REDIRECT_MS);
  }

  /* ------------------------------------------------------------------ */
  /* start-up                                                            */
  /* ------------------------------------------------------------------ */

  function setMode() {
    const cloud = state.store.mode === 'cloud';
    const badge = $('mode-badge');
    badge.textContent = cloud ? '● Live · links work everywhere' : '● Demo mode · this browser only';
    badge.className = 'pill ' + (cloud ? 'ok' : 'warn');
    $('alias-prefix').textContent = displayUrl('').replace(/#\/$/, '#/');
  }

  function ownedTokens() {
    const out = [];
    for (const bucket of state.owned.buckets) for (const node of bucket) out.push(node.value);
    return out;
  }

  async function load() {
    let list;
    let loaded = false;
    try {
      list = await state.store.load(ownedTokens());
      loaded = true;
    } catch (err) {
      toast(err.message, { type: 'error', timeout: 8000 });
      list = [];
    }
    // Forget delete tokens of links that no longer exist (only after a successful load).
    if (loaded && state.store.mode === 'cloud') {
      const live = new ChainingHashTable(17);
      for (const e of list) live.insert(e.code, true);
      const stale = [];
      for (const bucket of state.owned.buckets) for (const node of bucket) if (!live.has(node.key)) stale.push(node.key);
      if (stale.length) {
        for (const c of stale) state.owned.remove(c);
        saveOwned();
      }
    }
    if (!list) list = [];
    build(list);
  }

  function bind() {
    $('shorten-form').addEventListener('submit', (e) => {
      e.preventDefault();
      shorten($('long-url').value, $('alias').value.trim(), false);
    });
    $('long-url').addEventListener('input', () => $('long-url').removeAttribute('aria-invalid'));
    $('collide-btn').addEventListener('click', () => shorten('', '', true));

    $('lookup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const c = parseCode($('lookup-code').value);
      if (!c) return toast('Enter a short link or code.', { type: 'error' });
      retrieve(c);
    });
    $('delete-btn').addEventListener('click', () => {
      const c = parseCode($('lookup-code').value);
      if (!c) return toast('Enter the short link or code to delete.', { type: 'error' });
      del(c);
    });
    $('undo-btn').addEventListener('click', undo);

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
    $('hash-input').addEventListener('input', () => {
      state.hashCode = $('hash-input').value;
      renderHash();
    });

    $('filter').addEventListener('input', () => { state.page = 1; renderTable(); });
    $('forget-btn').addEventListener('click', () => {
      if (!window.confirm('Forget this browser? Your links keep working for anyone who has them, but this browser will no longer list them or be able to delete them. Use this on a shared computer.')) return;
      try {
        localStorage.removeItem(OWNED_KEY);
        localStorage.removeItem(PREFS_KEY);
        sessionStorage.clear();
      } catch (_) {}
      location.replace(basePath());
    });
    $('redirect-stay').addEventListener('click', leaveRedirect);
    window.addEventListener('hashchange', handleRoute);
  }

  // GitHub Pages can't send X-Frame-Options and a <meta> CSP can't set frame-ancestors,
  // so the app refuses to run inside another page (clickjacking).
  function framed() {
    try {
      return window.top !== window.self;
    } catch (_) {
      return true;
    }
  }

  async function init() {
    if (framed()) {
      document.querySelector('#loader .spinner')?.remove();
      $('loader-status').replaceChildren('Velerion can’t be used inside another page. ',
        h('a', { href: location.href, target: '_blank', rel: 'noopener noreferrer' }, 'Open it directly'));
      return;
    }
    const redirecting = !!routeCode();
    if (redirecting) {
      $('loader').hidden = true;
      $('redirect').hidden = false;
      startMemes('redirect-meme');
    } else {
      startMemes('loader-meme');
    }
    const started = Date.now();

    loadPrefs();
    state.store = CONFIG.supabaseUrl && CONFIG.supabaseKey
      ? new CloudStore(CONFIG.supabaseUrl, CONFIG.supabaseKey)
      : new LocalStore(entries);
    loadOwned();
    setMode();
    bind();
    setView(state.view);
    await load();
    renderAll();

    if (redirecting) {
      handleRoute();
    } else {
      // Keep the loading meme on screen long enough to read.
      const wait = Math.max(0, 1200 - (Date.now() - started));
      setTimeout(() => { stopMemes(); hideScreen('loader'); }, wait);
    }
  }

  init().catch((err) => {
    stopMemes();
    $('loader-status').textContent = 'Something went wrong while loading. Please refresh the page.';
    console.error(err);
  });
})();
