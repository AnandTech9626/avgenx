# Security

What is enforced by the server, what the browser does, and what is still open.

## Sign-in and sessions (enforced by the server)

| Area | Measure | Verified by |
|---|---|---|
| Who can see the LMS | `GET /` returns the sign-in page unless the request carries a valid, unrestricted session. The LMS bundle (`app.html`) is never sent to anonymous visitors | e2e: anonymous visits to `/`, `/#/admin/exec`, `/#/dashboard`; the response contains no sample data or IDE |
| Passwords | Argon2id (memory 19 MiB, 2 passes, OWASP baseline) through the `argon2` library. Minimum 12 characters, no user ID, email name or common words | unit: stored hashes are `$argon2id$`, plaintext never stored |
| Credential check | Account exists, is active, password matches, and the selected role is assigned to the account. Unknown user and wrong password take the same time (dummy hash) and give the same message. "Disabled" and "role not assigned" are only revealed after a correct password | unit and e2e |
| Role | The role is fixed in the server-side session at sign-in and re-checked against the account's roles on every request. Roles sent by the browser, URL changes and browser storage are ignored | unit: forged role headers and bodies; e2e: tampered localStorage and sessionStorage, forbidden deep links |
| Session cookie | Random 256-bit token; only its SHA-256 is stored. `HttpOnly`, `SameSite=Strict`, `Path=/`, plus `Secure` and the `__Host-` prefix when `COOKIE_SECURE` (default in production) | unit: cookie attributes |
| Session lifetime | Every server start ends all sessions (unless `KEEP_SESSIONS=true`), and open tabs return to sign-in on focus or within a minute. 12 hours absolute and 8 hours idle; with `KEEP_SESSIONS=true`, "Keep me signed in" gives a persistent 14-day cookie. A session issued with a temporary password lasts 15 minutes and can only change the password or sign out | unit |
| Revocation | Sign-out deletes the session. Disabling an account, removing a role, a password change or an administrator reset ends the affected sessions immediately | unit and e2e: replayed cookies get 401 |
| CSRF | `SameSite=Strict`, an `Origin` check on every write, and a per-session token in `X-CSRF-Token` for authenticated writes | unit: cross-origin and forged-token writes rejected |
| Brute force | 5 failed sign-ins per identifier or 30 per IP address within 15 minutes locks further attempts (even with the right password) for that window. Forgot-password is limited to 5 per IP per hour | unit |
| Reset and invitation links | Random token, only the SHA-256 stored, single use (claimed atomically), expiring (30 minutes self-service, 24 hours from an administrator, 72 hours for invitations). Using one ends all sessions. Forgot-password answers identically whether or not the account exists | unit |
| Administration | Only roles with `accounts.manage` (super administrator, institute administrator) can manage accounts. Institute administrators cannot grant, remove or manage the super administrator, institute administrator or CEO roles. Nobody can disable themselves, drop the role they are signed in with, or remove the last active super administrator | unit |
| Audit | Sign-ins, failures, lockouts, creation, role changes, status changes, resets, revocations and register exports are written to `auth_audit`, which database triggers make append-only | unit: delete is rejected |
| Excel account list | When `accounts.xlsx` exists, only its valid Active rows can sign in; anyone else is disabled and signed out. The server reads it from disk (never serves it), applies changes on save and before every sign-in, checks sign-ins against Argon2id hashes, and, by the institute's choice, mirrors each person's current password into the Password column (first sign-in, own change, resets), queueing it in the database if the file is locked. A value typed into the cell is applied once as a reset (remembered by hash). A generated password is only used if it was successfully written to the file. Console edits of people are blocked so the file stays the single source | unit: 8 tests in `excel.test.mjs` |
| Excel register | Administrator-only. Contains user ID, name, email, roles, status, flags and dates. No passwords, hashes, session or CSRF tokens, reset or invitation links | unit: parses the workbook and checks every cell |
| Test accounts | Created only by `npm run seed:dev`, which refuses in production. Passwords are random (about 115 bits), printed once to the terminal, never stored in plain text, and must be changed at first sign-in. The server refuses to start in production while any exist | unit: both refusals |
| Headers | Per-page CSP with the inline script allowed by hash, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `Cross-Origin-Opener-Policy`, HSTS when secure. Responses are `Cache-Control: no-store` | e2e: injected script blocked on the live app |
| AI proxy | Requires a session with `ai.use` and the CSRF token. The key stays in the server environment; server-owned instructions precede page context | unit |

## In the browser

* Every dynamic value is escaped before it reaches HTML; lint forbids `eval` and `document.write`.
* Learner JavaScript runs only in a Web Worker with network, storage and worker APIs removed and a hard timeout.
* Browser storage holds only display preferences, the sample learning data, and harmless per-tab hints (last role picked, "you signed out"). It never holds passwords, tokens or the role used for authorisation.
* The page CSP for the LMS allows `unsafe-eval` because the coding lab compiles learner code in a blob worker that inherits the policy, and `style-src 'unsafe-inline'` because views set computed widths. The sign-in page needs neither and does not allow them.

## Still open

* **Plain-text passwords in accounts.xlsx (institute's choice).** The file shows every person's current password, and the database queue for a locked file holds passwords in plain text until written. Anyone who can read the file or the database can sign in as anyone and may learn passwords people reuse elsewhere. People are told on the change-password screens. Restrict the file and `DB_PATH` to administrators, keep backups encrypted, and consider switching to a status-only column (a small change in `server/excel-accounts.mjs`).

* **Learning records are client-side sample data.** Sign-in, accounts and administration are server-enforced, but courses, submissions, grades, fees and analytics still live in each browser. A signed-in user with developer tools could change their own copy of that sample data or render other screens from it locally; they cannot gain any server privilege. Moving these records behind `docs/API.md` with the same permission checks is the main remaining work.
* **Email** is not connected, so self-service reset links are not delivered in production (the page says so).
* **MFA and SSO** are not implemented. Recommended next for administrators.
* **Single process.** SQLite suits one server instance. For several instances, move the account store to PostgreSQL (`db/migrations/0002_auth.sql`) and keep rate limits in a shared store.
* **Graded code execution** for anything that counts should run on a server-side judge, not in the browser.

## Production checklist

1. Serve over HTTPS only; set `TRUST_PROXY=true` only behind your own proxy.
2. `NODE_ENV=production`; create the first super administrator with `npm run accounts -- create-admin`.
3. Keep `DB_PATH` on a persistent, backed-up volume with restricted permissions.
4. Never run `seed:dev` against a production database (it refuses, and start-up checks for leftovers).
5. Connect email before relying on self-service password resets.
6. Rotate any temporary passwords that were shared through insecure channels.

## Reporting

Report vulnerabilities privately to the institute's security contact rather than in a public issue.
