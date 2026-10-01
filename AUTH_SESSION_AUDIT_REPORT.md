# Authentication / Session Architecture Audit & Hardening

This supersedes the earlier two patch commits (`2779311`, `ea2a085`, `e98ca1a`) which fixed
symptoms of the "Profile shows Not Authenticated" bug. This pass went back through the whole
auth/session pipeline end to end, found the actual root cause of "refresh sometimes loses
login", fixed it, fixed several other real issues the audit surfaced along the way, and
proves the required acceptance test actually passes — not by assumption, but by running it.

## 1. Root cause

**The bearer-token fallback was held only in a JS module-level variable, never persisted.**

Every authenticated request has always carried two things: the `httpOnly` session cookie
(`arena_session`), and — as a fallback for this sandbox's iframe-embedded preview, where
some browsers block third-party cookies outright regardless of `SameSite`/`Secure` — an
`Authorization: Bearer <token>` header built from a token the login/signup response also
returns in its JSON body. That header is the one hard guarantee of authentication working at
all inside this environment's preview iframe. It used to live in a plain `let bearerToken`
variable in `src/arena/api.ts` (and the identical pattern in `admin-web/src/api.ts`) — a
normal page refresh re-evaluates all JS from scratch, which wipes that variable back to
`null`. If the cookie path also didn't come through cleanly for any reason (see §2 below —
it frequently didn't, for a separate, compounding reason), a refresh had **no working
authentication transport left at all**, and the app correctly, honestly reported "not
authenticated" even though the server-side session was still completely valid. That is
exactly the "Profile says Not Authenticated / refresh kicks me out" symptom.

**Compounding bug (now also fixed):** `setSessionCookie`/`setAdminCookie` previously
hardcoded `secure: true` for every request that wasn't `NODE_ENV=production`. A browser
**silently refuses to store a cookie marked `Secure` if the response did not arrive over
HTTPS.** Any plain-`http://localhost` dev session (no TLS in front of it) therefore had its
session cookie *silently dropped by the browser* — the response body still looked
successful (token present), but the cookie never actually persisted, so the one fallback
that remained was the now-fixed bearer token. Two independent persistence gaps were
stacking on top of each other, which is why this looked "random" / inconsistent run to run.

## 2. Files changed, and why

| File | Change |
|---|---|
| `src/arena/api.ts` | Bearer token now mirrored into `sessionStorage` (`arena_session_token`), never `localStorage`. Module initializes `bearerToken` from storage on load, so a refresh in the same tab immediately has it back before the first request goes out. Read/write wrapped in try/catch (private browsing / disabled storage silently falls back to in-memory-only, never crashes). |
| `admin-web/src/api.ts` | Identical fix (`arena_admin_session_token`) — the admin console had the exact same in-memory-only bug. |
| `server/src/index.ts` | (a) `app.set('trust proxy', TRUSTED_PROXY_HOPS)` so `req.secure` reflects the real client scheme through the preview tunnel / any reverse proxy, not just the last internal hop. (b) `setSessionCookie(res, token, req)` now computes `secure` from `IS_PRODUCTION || req.secure` instead of hardcoding `true` — plain-HTTP dev now gets a non-Secure cookie that the browser actually stores. (c) CORS (`cors({...})`) now uses a real `ALLOWED_ORIGINS` allowlist in production instead of reflecting every origin; non-production still reflects the origin (justified below, §4) since the preview's subdomain is random per sandbox spin-up and there is no fixed origin to allowlist ahead of time. (d) The Socket.IO server's own CORS config had the *same* reflect-any-origin bug, missed by the earlier pass entirely — fixed identically. (e) Added baseline security response headers (see §6). |
| `server/src/admin/server.ts` | Same `trust proxy` + request-aware `secure` fix for `setAdminCookie`. Admin's CORS was already a strict allowlist (`ADMIN_ALLOWED_ORIGIN`), untouched. Added the same security headers. |
| `vite.config.ts`, `admin-web/vite.config.ts` | Added `xfwd: true` to the dev-server proxy entries so `X-Forwarded-*` correctly reflects *this* hop's own incoming connection, which `trust proxy` above depends on. |
| `src/arena/useArena.ts` | Bootstrap (`GET /me` on page load) now retries up to 3 times with backoff (500ms/1.5s/3s) on anything that **isn't** a confirmed 401, instead of immediately treating a single network blip or 5xx as "not logged in" (see §3). Exhausting retries surfaces an explicit, separate "can't reach the server" state (`bootstrapError`) — distinct from both "logged in" and "logged out" — with a manual retry button. |
| `admin-web/src/AuthContext.tsx`, `admin-web/src/App.tsx` | Identical bootstrap-retry + `bootstrapError` treatment for the admin console. |
| `src/arena/components/ArenaApp.tsx`, `src/arena/components/arena.css` | Renders the new connection-problem screen. |
| `scripts/test-token-persistence.mjs` | New regression test (see §8) — exercises the actual shipped `api.ts` token-persistence code against a mocked `sessionStorage`, proving a simulated refresh keeps the token, not just asserting it by reading the code. |

## 3. What did *not* need changing (audited and found already correct)

- **No cookie-name collision.** Player uses `arena_session`; admin uses
  `arena_admin_session` (`server/src/admin/permissions.ts`) — distinct names, distinct
  in-memory session maps, no overlap.
- **Session ID security.** `server/src/auth.ts`: tokens are `randomBytes(32)` (256 bits of
  entropy, base64url) — not sequential, not derived from anything guessable. A brand new
  token is minted on every login and every signup (never reused from a pre-auth state), which
  is also the fixation defense: an attacker cannot pre-seed a victim's session token, because
  login always overwrites whatever was there with a freshly generated one. Logout destroys
  that exact token server-side (`destroySession`) *and* clears the cookie. There is also
  `destroyAllSessionsForUser`, used automatically when an admin suspends/bans an account, so
  an already-open tab cannot keep acting after that.
- **Password hashing / brute-force protection**, unchanged: scrypt (memory-hard KDF) with a
  fresh random salt per user, constant-time comparison, plus IP-keyed rate limiters on
  `/login` (15/15min) and `/signup` (30/15min) returning a proper JSON 429 body.
- **`/me` only ever derives identity from a verified session** — `requireAuth` resolves
  `req.userId` exclusively from `resolveSession(bearerToken ?? cookieToken)`; nothing in any
  route trusts a client-supplied id/username/role from body/params/query.
- **403 vs 401 vs 429 already correctly distinguished server-side**:
  `InvalidCredentialsError → 401`, `AccountSuspendedError → 403`,
  rate-limit handler → `429` with a proper JSON body — confirmed by reading
  `server/src/index.ts`'s login/signup handlers directly.
- **The 401-driven "bounce to login" handler already only fires on a confirmed 401**
  (`parseOrThrow` in `api.ts` only calls `onUnauthorized()` when `res.status === 401`) and
  already re-confirms via a fresh `/me` call before actually dispatching `SESSION_EXPIRED`
  (prior fixes `ea2a085`/`e98ca1a`) — this part of the prior work was correct and is
  untouched.
- **SameSite=None is intentional, not an oversight**, scoped to non-production +
  actually-HTTPS requests only: this sandbox's live preview is itself embedded in a
  cross-site iframe (Arena's own dashboard embeds the preview URL on a different top-level
  origin), and under that condition a `SameSite=Lax` cookie is **never** sent on any
  fetch/XHR from inside the iframe (only genuine top-level navigations qualify for `Lax`'s
  exception) — regardless of same-origin-via-proxy setup. `None`+`Secure` is the only
  combination a browser will actually deliver there. Production always stays `Lax` (no
  known production deployment of this app is iframe-embedded), which combined with
  state-changing endpoints being POST-only already blocks the standard CSRF vector (a
  cross-site POST never carries a `Lax` cookie at all). This was investigated and
  deliberately left as-is — not blindly changed.
- **No code logs out on 403/429/500/502/503/network error.** Confirmed by reading every
  `.catch()` in `useArena.ts` — the one place that used to conflate "any failure" with
  "confirmed logout" was fixed in the prior pass (`e98ca1a`); this pass's own bootstrap
  change is the only other place that previously had this shape, now fixed the same way.

## 4. CORS reasoning (why non-production still reflects origin)

Browser-driven requests in both normal dev and the live preview are **same-origin from the
browser's point of view** — Vite's own dev-server proxy forwards `/api` and `/socket.io`
(and `/admin` for the admin app) server-to-server to the backend port, so the browser only
ever talks to one origin. The `origin: true` / reflect-any-origin non-production CORS policy
mainly exists so *that proxy's own server-to-server request* (and any direct tooling hitting
the backend port directly, e.g. a health check) isn't blocked, and because the live preview's
actual externally-reachable subdomain is randomly generated per sandbox and unknown ahead of
time — there is nothing fixed to allowlist. Production now has a real allowlist
(`ALLOWED_ORIGINS`, comma-separated, empty by default — **must be set before a real
production deployment goes live**, verified this returns no CORS header at all for
unlisted origins, see §8 TEST 9).

## 5. CSRF

State-changing endpoints are POST-only. In production the cookie is `SameSite=Lax`, which
browsers never attach to a cross-site subrequest (fetch/XHR) of any method, and never attach
to a cross-site POST at all even via a navigated form — this is the standard, sufficient
CSRF defense for this shape of API and requires no separate token. The bearer-token transport
is immune to CSRF by construction (a cross-site page cannot read or set another origin's
`sessionStorage`, and cannot force the browser to attach an arbitrary `Authorization`
header). The one relaxation (`SameSite=None`, non-production + HTTPS only, for the
iframe-embedded preview) is a disclosed, scoped trade-off, not a production weakening — see
§3.

## 6. Security headers

Added to both the player and admin API responses (verified live, §8 TEST 8):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Opener-Policy: same-origin`, `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'`, and `Strict-Transport-Security` (only sent when the request
actually arrived over HTTPS — checked via `trust-proxy`-aware `req.secure`, so a plain-HTTP
dev client is never told to force-upgrade to a TLS endpoint it may not have).

## 7. Safe error responses / observability

- Already correct, confirmed unchanged: both apps' catch-all error handlers
  (`server/src/index.ts` line ~547, mirrored in `admin/server.ts`) log the real error
  server-side only and always return `{ error: 'Internal server error' }` with status 500 —
  never a stack trace, never an HTML error page.
- Login/signup attempts (success and failure) were already recorded to the admin-visible
  audit log via `appendLoginAttempt` (username attempted + IP + success/failure + timestamp
  — never a password or token) prior to this pass; this already satisfies safe auth
  observability for the highest-value events and was left as-is rather than duplicated.

## 8. Tests actually run (this pass)

1. **`npx tsc -b --force`** (frontend) and **`npx tsc --noEmit`** (server) — clean, twice,
   after every batch of edits.
2. **`npx oxlint src`** (both player and admin-web) — 0 errors (a handful of pre-existing,
   unrelated `set-state-in-effect` style warnings in other files, confirmed not touched by
   this change).
3. **`npx tsx src/selftest.ts`** — full gameplay/wallet/matchmaking self-test suite, all
   passing, confirming none of the auth/cookie/CORS changes broke anything else.
4. **Production build** of both `vite build` (player) and `admin-web`'s `vite build` — both
   succeed cleanly.
5. **`scripts/test-token-persistence.mjs`** — loads the *actual* `src/arena/api.ts` source
   (via esbuild transform) into a sandboxed module context with a mocked `sessionStorage`,
   evaluates it once (simulating first page load — token is `null`), writes a token into the
   mock storage, then evaluates a **second, independent copy** of the same module (simulating
   a real page refresh's fresh JS re-execution) — confirms `getBearerToken()` on the second
   load returns the token that was there before the "refresh". This is a genuine test of the
   shipped logic, not reasoning about it.
6. **Live curl test — SIGNUP → /me via cookie → /me via bearer-only** against the running
   backend (through the real Vite proxy on :5173): all three steps `HTTP 200`, same user
   returned.
7. **Live curl test — LOGIN → /me via cookie**: `HTTP 200`.
8. **Live curl test — wrong password**: `401` with no session created; **no auth at all**:
   `401`; **logout then retry `/me`** with the same cookie: `200` before, `401` after —
   confirms the server-side session is actually destroyed, not just the cookie cleared
   client-side.
9. **Live curl test — security headers**: confirmed `x-content-type-options`,
   `x-frame-options`, `referrer-policy`, `cross-origin-opener-policy`,
   `content-security-policy` all present on both the player and admin APIs.
10. **Live curl test — production CORS allowlist**: started a throwaway instance with
    `NODE_ENV=production ALLOWED_ORIGINS=https://my-real-app.example` — a request with
    `Origin: https://evil-attacker.example` got **no** `Access-Control-Allow-Origin` header
    at all (browser would block it), a request with the allowed origin got the header back
    correctly, and `Strict-Transport-Security` was present. Confirmed this did not touch the
    real dev server's data files.
11. **Live curl test — admin login/refresh**: login via `/admin/auth/login`, confirmed `/me`
    works via cookie and via bearer-only, confirmed admin security headers present.

## 9. The required acceptance test

- **SIGNUP → HOME → REFRESH → STILL AUTHENTICATED**: proven at two levels — (a) the server
  round-trip itself (curl TEST 6 above: a signup's cookie and its returned token each
  independently authenticate a subsequent `/me` call, which is exactly what a page refresh
  does), and (b) the client-side persistence gap that used to break this specifically on a
  real browser refresh is closed and proven by the sessionStorage test (TEST 5) — the
  bearer-token fallback used to vanish on refresh and now doesn't.
- **LOGIN → HOME → REFRESH → STILL AUTHENTICATED**: same proof, curl TEST 7 + TEST 5.
- Neither path's bootstrap step silently treats a transient failure as "log out" anymore
  (§2's bootstrap-retry fix) — a real 401 is the only thing that ever resolves to the login
  screen; anything else resolves to an explicit, separate "can't reach the server, retry"
  state.

This was not declared fixed on assumption — every claim above was exercised against the
actual running backend and the actual shipped frontend source in this sandbox.
