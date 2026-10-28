# Velerion: URL Shortener Service (DSA Micro Project 02)

A free, working URL shortener built on a **hand-written hash table**, with a **linked-list baseline**, live **comparison counts**, and a visual walk-through of every hash and collision.

**Live:** https://velerion.github.io · short links look like `velerion.github.io/aZ3kQ`

## What it does

| Requirement | Where |
|---|---|
| Hash table mapping short codes → long URLs, collisions handled explicitly | `ChainingHashTable` (separate chaining) and `OpenAddressingHashTable` (linear probing with tombstones) in `js/structures.js` |
| At least 30 entries | 32 seed URLs (`js/seed.js`); the table holds them in 37 buckets, with about a dozen collisions |
| Linked-list sequential-search baseline | `LinkedList.search` in `js/structures.js` |
| Shorten / retrieve / delete | The shortener at the top, **Find or delete a link**, and real redirects for every short link |
| Visible collision being resolved | **How it works → Separate chaining → Force a collision**, the result chips, and the highlighted chain |
| Printed comparison of retrieval comparisons | **Performance** section, **Print report**, and `node cli/demo.js` |

### Course outcomes

- **CO1 (stack / queue):** deleted links go on an **undo stack** (linked stack, LIFO); recent operations are kept in a **circular queue** of capacity 10, shown with its front and rear pointers.
- **CO2 (choosing a data structure):** the same data sits in three structures side by side: chaining, open addressing and a linked list. The table-size experiment shows how the load factor changes chain length.
- **CO3 (search performance):** average and worst-case comparisons when a link exists and when it doesn't, compared with the textbook formulas, plus a per-link chart (a straight line for the list, flat for the hash tables).

## The hash function, in one line

```
h = 0
for each character c in the code:
    h = (h × 31 + charCode(c)) mod tableSize
bucket = h
```

Taking the remainder at each step keeps every number below the table size, so you can check it by hand. For example, `vnrlK` in a 37-bucket table: `0×31+118=118 → 7`, `7×31+110=327 → 31`, … and the last value is the bucket. The **How it works → Hashing** tab shows this table for any code you type.

### How the tables grow

Both tables follow one rule: **when too full, about double the size (the next prime after 2 × size) and re-insert every link**. Each link must be re-inserted because its bucket depends on the table size.

- **Chaining** grows when there are more links than buckets (load factor > 1): 17 → 37 → 79 …
- **Open addressing** grows when 70% of its slots are used (deleted slots count, because searches still have to step over them).

## Architecture

- **Static site** on GitHub Pages (`Velerion/Velerion.github.io`). `404.html` + `js/route.js` turn `/aZ3kQ` into `/#/aZ3kQ`, and the app resolves it.
- **Supabase Postgres** stores the rows only. On page load the app fetches the public demo links (1,000 per request) plus your own links, and rebuilds the hash tables and the linked list in memory, so all searching is done by our own structures. Other people's private links are resolved by exact code on the server when opened.
- No `Map`, `Set` or plain-object dictionaries are used for storage anywhere.

## Security

| Threat | Protection |
|---|---|
| Seeing other people's links | Links are **private**. The database lets anyone list only the 32 public demo links. Your browser additionally loads the links it created, proving ownership with their secret tokens (`my_links`). Any other link opens only through `resolve_link(exact code)`; there is no listing, searching or partial matching. |
| Guessing someone's link | New codes are 7 random characters from a cryptographic generator (62⁷ ≈ 3.5 trillion), and lookups are limited to 120 per minute per network. New links are created only through `create_link`, whose rate limit also counts attempts on codes that are already taken, so creating links can't be used to probe which codes exist. Finding one link by guessing would take centuries. |
| Deleting someone else's link | Each link gets a random delete token kept only in its creator's browser. Deletes go through `delete_link(code, token)`, and the token can be written but never read. The demo links have no token, so nobody can delete them. |
| Editing or hijacking a link | The public role has no UPDATE or DELETE rights. The server sets `clicks`, `created_at` and `is_public` itself. |
| Spam / flooding | 20 new links per minute per network and 300 in total, enforced in the database. The limiter uses the IP that Supabase's proxy appends, so a forged `X-Forwarded-For` header doesn't bypass it. IPv6 clients are counted per /64. `my_links` and `delete_link` are rate limited too. IPs are stored only as MD5 hashes and kept for 5 minutes. |
| Malicious URLs | `http(s)` only, ≤ 2048 characters, checked by the database **and** the app. Links with credentials (refused by both), to private/local addresses, or back to Velerion are refused, and the redirect screen shows the destination first. |
| Script injection (XSS) | All text is rendered with `textContent`. There is no `innerHTML`, `eval` or inline script, and a strict Content-Security-Policy allows scripts only from this site and network calls only to the database. |
| SQL injection | Only parameterised functions and PostgREST filters on permitted columns. Codes are validated against `^[A-Za-z0-9_-]{1,24}$` before any lookup. |

### Automated security tests

```bash
node security/pentest.mjs
```

It runs 48 attacks against the live API and site: listing or searching private links, guessed tokens, deleting or editing other people's links, SQL and filter injection, `javascript:`/`data:`/`file:` URLs, oversized input, forged fields, rate limits with spoofed IP headers, mass code guessing, internal functions, the CSP, inline scripts, leaked keys and the HTTPS redirect. It cleans up after itself. Last run: **47 passed, 0 failed, 1 warning**. The warning is that Supabase Auth sign-ups are enabled; signed-in users get no extra access, but you can turn sign-ups off under *Authentication → Sign In / Providers*.

## Run locally

```bash
python -m http.server 5173
```

Open http://localhost:5173. Locally, links use the `#/code` form.

Console version of the comparison (same data-structure code):

```bash
node cli/demo.js
```

## Set up your own database (optional)

1. Create a free project at https://supabase.com.
2. In **SQL Editor**, run [`supabase/setup.sql`](supabase/setup.sql).
3. Add the **Project URL** and **publishable** key as repository secrets named `SUPABASE_URL` and `SUPABASE_KEY` (*Settings → Secrets and variables → Actions*). The deploy workflow writes them into `js/config.js` when it publishes the site, so they are never stored in the repository.
4. Set *Settings → Pages → Source* to **GitHub Actions**. Every push to `main` then deploys.

For local testing against a database, fill in `js/config.js` on your machine without committing it.

The publishable key is meant to be public. Never put a `service_role` / secret key in the site. Without a database the site runs in **demo mode** (links saved only in the current browser).

## Loading-screen memes

`js/memes.js` holds text memes built on Thalaivar one-liners and Jailer-series gags. To add image memes, put pictures you have the rights to in `assets/memes/` and add `{ movie, img, caption }` entries.

## Files

```
index.html            page layout
404.html, js/route.js turn /<code> into /#/<code> on GitHub Pages
css/style.css         styles (light + dark, responsive)
js/structures.js      hash function, LinkedList, ChainingHashTable, OpenAddressingHashTable, Stack, CircularQueue
js/app.js             UI, measurements, chart, redirects
js/storage.js         Supabase / localStorage persistence (no lookups)
js/memes.js           loading-screen memes
js/seed.js            32 seed URLs
js/config.js          Supabase settings
supabase/setup.sql    table, security policies, rate limit
security/pentest.mjs  automated security tests
cli/demo.js           console demo printing the comparison table
```
