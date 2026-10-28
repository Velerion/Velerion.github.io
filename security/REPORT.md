# Velerion security report

**Date:** 2026-10-27 · **Scope:** whole repository at commit `1b8d887` (`index.html`, `404.html`, `js/*.js`, `css/style.css`, `supabase/setup.sql`, `cli/demo.js`, `security/pentest.mjs`) plus the live Supabase project and https://velerion.github.io.
**Standard:** OWASP Top 10:2025.
**Methods:** static review of the code; read-only checks of the live database (grants, policies, function definitions, Supabase security advisor); one targeted live probe that created no rows; `security/pentest.mjs` against the live site after the fixes.

## How the two tools ran

| Tool | Result |
|---|---|
| **claude-security** (deep scan, `max` effort requested) | **Did not run** (tried 2026-10-27; still unavailable on the 2026-10-28 re-run). Its scan needs the `claude-security:scan` workflow, which needs a Workflow tool this session does not have. It produced no findings, so none are listed under it below. To run it, start a session with Claude Security as the main agent with workflows enabled (`claude --agent claude-security:claude-security`). |
| **OWASP Security Audit** (Top 10:2025) | Completed. All findings below come from this audit and from live verification. |

## Summary

One **High** finding was confirmed against the live API and has been **fixed**: failed link creations were never counted by the rate limiter, so anyone could test whether short codes exist, about 20 per request, with no limit. No Medium findings. The rest are Low or Informational. No XSS, SQL injection, token leak or way to list or delete another person's links was found.

| Severity | Count | Fixed |
|---|---|---|
| High | 1 | 1 |
| Medium | 0 | – |
| Low | 8 | 4 (in the same migration as the High fix) |
| Informational | 3 | – |
| False positives | 9 | – |

## Combined findings

Line numbers refer to commit `1b8d887` (before the fix) unless marked "now".

| ID | Severity | Confidence | Location | Issue | Verdict | Status |
|---|---|---|---|---|---|---|
| OWASP-A06-001 | **High** | High (confirmed live) | `supabase/setup.sql:25,30,74-84` | **Failed creates bypass the rate limit (code-existence oracle).** The insert rate limit ran in a BEFORE INSERT trigger. When the insert then failed (duplicate code → HTTP 409), the whole transaction rolled back, **including the rate-limit log row**. Live probe: 40 inserts of a taken code in a row → 40 × 409, never throttled. A batch insert of about 20 codes returns 409 if *any* of them exists, and its log rows also roll back. That gives an unlimited oracle for which private codes and custom endings exist. The URL can then be read with `resolve_link`. This defeats the "private links can't be found by guessing" model. CWE-799. | **Real** | **Fixed.** Anon has no INSERT right now. Links are created only through the new `create_link(code, url, token)` RPC (now `setup.sql:111`). It rate-limits first, then runs `insert … on conflict do nothing` and returns `false` when the code is taken, so the log row is committed either way. Pentest: "Probing taken codes via create_link is rate-limited, blocked after 17 attempts" (plus 3 earlier creates = 20). |
| OWASP-A06-002 | Low | Medium | `supabase/setup.sql:113-121` | `my_links` had no rate limit and took up to 500 tokens per call, against an **unindexed** `delete_token` column (sequential scan per call), so it could be used to load the database cheaply. Guessing tokens is infeasible (UUIDv4, 122 random bits). CWE-799. | Real (low impact) | Fixed: rate limit of 30/min, index `links_delete_token_idx`, error when more than 500 tokens. |
| OWASP-A06-003 | Low | High | `supabase/setup.sql:124-131` | `delete_link` had no rate limit, and its `SECURITY DEFINER` used `search_path = public` instead of `''`. Brute force is infeasible (UUID), and anon cannot create objects through PostgREST, so this was hardening only. CWE-799. | Real (low impact) | Fixed: rate limit of 30/min, `search_path = ''`. |
| OWASP-A06-004 | Low | High | `supabase/setup.sql:25,30` | Direct inserts accepted `delete_token = null`. That created private links nobody can ever delete, and the setup step `update … set is_public = true where delete_token is null` would have made them **publicly listable** if re-run. CWE-841. | Real | Fixed: `create_link` requires a token. Direct inserts are refused. |
| OWASP-A06-005 | Low | High | `supabase/setup.sql:14` vs `js/app.js:104` | The server URL check (`^https?://`) was weaker than the app's: direct API callers could store `https://paypal.com@evil.example/` (credential-style phishing). The redirect screen shows the real host (`evil.example`), which limits the damage. Private and localhost destinations are still accepted server-side. CWE-602. | Real | Partly fixed: `create_link` rejects a username or password in the URL and whitespace in the host. Private/local hosts are still checked only by the app (Low). |
| OWASP-A06-006 | Low | Low [MANUAL VERIFICATION REQUIRED] | `supabase/setup.sql:43-51` | The per-IP limit treated every IPv6 address separately, so a client with a /64 could rotate addresses without limit. `nslookup` found **no AAAA record** for the API host, so this is probably not reachable today. CWE-799. | Lead | Hardened anyway: IPv6 clients are now counted per /64 (`private.client_id`, now `setup.sql:47`). |
| OWASP-A06-007 | Low | Medium | `supabase/setup.sql:81,102` | Global caps (300 creates or 5000 lookups per minute for everyone) let an attacker with about 15 (creates) or 42 (lookups) IPv4 addresses lock everyone out for a minute at a time. This is a deliberate trade-off to protect the free-tier database. CWE-799. | Real (design) | Not fixed (Low). Options: raise the caps, or add a CAPTCHA/Turnstile for creation. |
| OWASP-A06-008 | Low | High | `index.html:6` (meta CSP), live headers | **Clickjacking:** `frame-ancestors` cannot be set in a `<meta>` CSP, and GitHub Pages sends no `X-Frame-Options` (checked with `curl -I`: only HSTS). A framing page could trick a visitor into clicking "Delete" on their own link. Undo exists, and links can't be deleted cross-browser. CWE-1021. | Real | **Fixed 2026-10-28** (commit `9e3b9bd`): `app.js` refuses to run when `window.top !== window.self` and shows an "Open it directly" notice. See the re-run section. |
| OWASP-A10-001 | Low | Medium | `js/app.js:1011` | `new URL(url).hostname` throws for a stored URL that passes the database regex but isn't a valid URL (e.g. `https://[`). The redirect screen then stays on "Looking up…" (unhandled rejection). It only affects links an attacker created through the API, and fails closed (no redirect). CWE-248. | Real (fails safe) | Not fixed (Low). |
| INFO-1 | Info | High | Supabase Auth settings | Public sign-ups are **enabled** (`disable_signup: false`). Signed-in users have no table or RPC rights, but sign-up emails can be abused for spam. | Real | Not fixed: disable it in Supabase Dashboard → Authentication → Sign In / Providers. This is a dashboard setting, not SQL. |
| INFO-2 | Info | High | `js/app.js:182` | Delete tokens are stored in plain `localStorage`. This is by design (no accounts). Any XSS would expose them, but none was found. The "Forget this browser" button clears them. | By design | – |
| INFO-3 | Info | High | `supabase/setup.sql:37` | `request_log.client` stores `md5(ip)`, which can be reversed for IPv4 by brute force. The table is in the unexposed `private` schema and rows are deleted after 5 minutes. CWE-328. | By design | – |

### False positives (checked and rejected)

| Candidate | Source | Why it is not a vulnerability |
|---|---|---|
| "anon can execute SECURITY DEFINER functions" for `resolve_link`, `my_links`, `delete_link` (lint 0028) | Supabase security advisor | These are the intended public API. Each one checks its inputs and authorization itself (exact code / secret token). Internal functions in `private` are not executable by anon (checked in `pg_proc.proacl`). |
| Publishable key in `js/config.js:10` | Static | `sb_publishable_…` keys are designed to be public. Access is enforced by grants and RLS. No `service_role`/`sb_secret_` key is shipped (checked by the pentest). |
| Stored XSS through the link URL or code | Static and pentest | All rendering uses `textContent`/`setAttribute` through `h()` (`js/app.js:48-65`). There is no `innerHTML`/`eval`. `href` values must match `^https?://` in the database, `build()` and `resolve()`. The CSP has no `unsafe-inline`. |
| `javascript:`/`data:` redirect | Static and pentest | Rejected by the database CHECK, `create_link`, `CloudStore.resolve` (`js/storage.js:82`) and `handleRoute` (`js/app.js:998`). |
| SQL injection in the RPCs | Static and pentest | Parameters are bound. There is no dynamic SQL. Codes are validated with a regex before any lookup. |
| Spoofed `X-Forwarded-For` bypasses the rate limit | Static and pentest | The limiter uses the **last** XFF entry, which Supabase's proxy appends. The pentest sends a different spoofed XFF per request and still gets blocked. |
| Open redirect in `404.html`/`js/route.js` | Static | It only redirects to same-origin `/#/<code>` after the code regex. |
| Event-handler injection through `h()` (`on*` attributes) | Static | Attribute names are fixed in the code and never come from data. |
| Third-party requests or referrer leaks | Static and pentest | No external scripts, fonts or images. `connect-src` allows only the API. `<meta name="referrer" content="no-referrer">` and `rel="noopener noreferrer"` are in place. `sessionStorage` holds only the view, undo and activity entries, and `localStorage` only the delete tokens. |

## What was changed

**Database** (applied as migration `create_link_rpc_and_rate_limit_hardening`; `supabase/setup.sql` now matches the live function bodies exactly, checked by md5 comparison):
- Removed anon `INSERT` and the "anyone can add links" policy. Added `public.create_link(p_code, p_url, p_token) → boolean`.
- The trigger no longer rate-limits (so each link is counted once).
- `private.client_id`: parses the IP and counts IPv6 per /64, falling back safely on unparsable values.
- `my_links`: plpgsql, rate limited (30/min), errors above 500 tokens. New partial index on `delete_token`.
- `delete_link`: rate limited (30/min), `search_path = ''`, null inputs return `false`.

**Client:** `js/storage.js` creates links through `rpc/create_link`, and a `false` result shows "That short code is already taken." The hash tables, linked list, stack and queue are unchanged.
**Tests:** `security/pentest.mjs` now covers direct INSERT being refused, credential URLs, missing tokens, and the taken-code probing limit.
**Docs:** README security table updated.

## Verification

- `node security/pentest.mjs` (live site and API): **55 passed, 0 failed, 1 warning** (public sign-ups, INFO-1). Every test row was deleted afterwards. The database still holds 32 public rows and 1 private row, as before.
- `node cli/demo.js`: runs as before (32 links, 12 collisions, chaining 1.47 vs linked list 16.50 average comparisons, delete/undo and queue output).
- UI check against the live database (local copy of the site): shortening a link created it through `create_link`, it appeared under "Your links", and Delete removed it. No console errors.

**Deployment note:** the database change is live, but the deployed site still runs the old `storage.js`, which inserts directly. **Link creation on velerion.github.io fails until this commit is pushed.** Opening, listing and deleting links still work.

## Re-run 2026-10-28

**Scope:** the same repository at commit `9e3b9bd`, focusing on what changed since `1b8d887`: `create_link` and the hardened functions in `supabase/setup.sql`, `js/storage.js`, and the frame guard in `js/app.js`. The unchanged files were re-checked against the first audit. claude-security still could not run (no Workflow tool in this session).

| ID | Severity | Confidence | Location | Issue | Verdict | Status |
|---|---|---|---|---|---|---|
| OWASP-A06-008 | Low | High | `js/app.js` `framed()` / `init()` | Clickjacking (from the first audit). | Real | **Fixed and verified.** A test page that framed the site got only the notice, with the app never rendered (0 table rows, mode badge empty). The unframed page loads normally. A sandboxed frame without scripts keeps the full-screen loader over the app, so nothing can be clicked. |
| OWASP-A06-009 | Low | High (confirmed live) | `supabase/setup.sql` `private.rate_limit` | **The rate limit can be overshot by parallel requests.** It counts and then inserts without a lock, so concurrent requests all see the old count. Live: 60 parallel `create_link` calls on a taken code gave **22** answers before throttling, against a limit of 20. The overshoot is bounded by the API's connection pool, so it is small and doesn't change the conclusions of A06-001. CWE-362. | Real (low impact) | **Fixed 2026-10-28** (migration `rate_limit_advisory_lock`): `rate_limit` takes `pg_advisory_xact_lock(hashtext(kind:client))` before counting. Re-test: 60 parallel calls gave exactly **20** answers and 40 blocks. The site-wide caps are still counted without a lock (a few requests over 300/5000 make no practical difference). |
| INFO-4 | Info | High | `supabase/setup.sql` `resolve_link` | Anyone who knows a code can inflate its click count (up to 120/min per IP). Only the statistic is affected. | By design | – |
| INFO-1 | Info | High | Supabase Auth | Public sign-ups are **still enabled** (`disable_signup: false`, re-checked 2026-10-28). | Real | Open: dashboard setting. |

**Re-checked and still sound:** `create_link` (validation, then rate limit, then `on conflict do nothing`; the "taken" result is now counted), `my_links` (qualified columns, 500-token cap, rate limited), `delete_link` (`search_path = ''`, null-safe), `client_id` (unparsable values fall back safely), and `storage.js` (creates only through the RPC). Supabase's advisor still reports only lint 0028 for the four intended public functions (false positive, as before). There are no new XSS sinks: the frame notice is built with `h()`/text nodes.

**Verification:** `node security/pentest.mjs` against the deployed site after `9e3b9bd`: **56 passed, 0 failed, 1 warning** (public sign-ups), including the new "App refuses to run inside a frame" check.

## OWASP Top 10:2025 coverage

| Category | Coverage |
|---|---|
| A01 Broken Access Control | Assessed: grants, RLS, RPC authorization, token handling, redirects. No findings. |
| A02 Security Misconfiguration | Assessed for the meta CSP, live response headers, and Supabase Auth settings (INFO-1). GitHub Pages server config is outside the repository. |
| A03 Software Supply Chain | Assessed: no dependencies, no CDN scripts, no build step. Nothing to report. |
| A04 Cryptographic Failures | Assessed: `crypto.randomUUID`/`getRandomValues` for tokens and codes, HTTPS + HSTS. INFO-3 only. |
| A05 Injection | Assessed: XSS (DOM), SQL (RPC/PostgREST). No findings. |
| A06 Insecure Design | Assessed: rate limiting and abuse cases. A06-001 to A06-008. |
| A07 Authentication Failures | Partly assessed: the app has no accounts. Ownership is a bearer token. Supabase Auth is enabled but unused (INFO-1). |
| A08 Software or Data Integrity | Assessed: no deserialization, no mass assignment (column-level grants, then RPC only). Nothing to report. |
| A09 Logging and Alerting | Partly assessed: no security-event logging or alerting beyond Supabase's platform logs. That is acceptable for a student project, but there is no abuse alerting. |
| A10 Exceptional Conditions | Assessed: errors are caught and shown as generic messages. A10-001 only. |

**Limits:** static review plus black-box testing from one IPv4 address. Supabase's proxy behaviour (XFF ordering, IPv6 reachability) was inferred from tests, not documentation. The claude-security deep scan did not run.
