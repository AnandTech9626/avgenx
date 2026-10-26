# AVGENX Academy

A learning and institute management platform for a software engineering institute: programs across nine domains, a coding lab with judged problems, assessments, projects, live classes, mentoring, placement, fees, admissions, corporate tenants, executive analytics and administration, behind an 11-role permission model.

**Sign-in is real, and the Excel file decides who can sign in.** A small Node server checks every sign-in. When `accounts.xlsx` is in the project folder, only the people listed in it as Active can sign in; save the file and the server applies it within seconds (and re-checks it before every sign-in). Anyone without a valid session gets the sign-in page and never receives the LMS. There is no public sign-up.

**Learning records are still sample data.** Courses, submissions, grades, fees and analytics come from a deterministic seed held in each browser. Moving those records onto the server is the next step (see `docs/IMPLEMENTATION_MATRIX.md`).

## Quick start

Requirements: Node.js 22.5 or newer.

```bash
npm install
npm run build
npm start              # opens http://127.0.0.1:8080 in your browser; keep this window open
```

Then open `accounts.xlsx`, pick a row, and sign in with its **Role**, **User ID** and **Password**. You will be asked to choose your own password, and the server writes it into the file's Password column. It does the same every time someone changes or resets a password.

## Managing people in accounts.xlsx

| Column | What to enter |
|---|---|
| User ID | Required and unique, for example `AVX-STU003` |
| Full name, Email | Required; email must be unique |
| Role | One role from the Roles sheet, or several separated by commas (`Instructor, Mentor`) |
| Status | `Active` or `Disabled` |
| Linked profile | Optional sample-data person whose records this account sees, for example `S1001` |
| Password | The person's current password, kept up to date by the server. Leave empty for a new person and the server writes one in. Type a new value (10+ characters) to reset it |
| Sync result | Written by the server: `OK` or the reason a row was not imported |

* **Add someone**: add a row and save. **Remove access**: delete the row or set Status to Disabled; they are signed out immediately. **Reset a password**: type a new password in their Password cell and save; they choose their own at the next sign-in, and that is written back.
* Rows with mistakes (unknown role, duplicate ID or email, bad email) are not imported and those people cannot sign in; the Sync result column says why.
* If the file is open in Excel when someone changes their password, Windows locks it; the server holds the new password and writes it as soon as you close the file (it tells you in the terminal and in the app). Reopen the file to see the latest values.
* **Password not showing in the file?** (1) Check the terminal says `AVGENX Academy server v2.1.0` or later. (2) Close `accounts.xlsx` in Excel: while it is open, Windows does not let the server save it. The server keeps the new password queued and saves it within a few seconds of closing; the terminal prints `Wrote the new password for ...`. (3) Reopen the file to see it. The app also tells the person right after they change it whether it was written or is waiting.
* The file shows everyone's current password, so keep it private. It stays on the server and is never sent to browsers, and people are told on the change-password screen that administrators can see their password. Sign-in itself is checked against an Argon2id hash in the server database.
* Make a fresh file with `npm run accounts -- init-excel` (`--force` replaces an existing one, `--empty` gives just the headers). Use `ACCOUNTS_XLSX` to keep it somewhere else.
* Without an `accounts.xlsx`, accounts are managed in the app instead (Administration, Accounts and Sign-in), and `npm run seed:dev` can create development test accounts.

The starter file comes with eight people, one per main role:

| User ID | Sign in as | Linked sample profile |
|---|---|---|
| AVX-ADMIN | Super Administrator | Arvind Rao |
| AVX-OPS | Institute Administrator | Farah Siddiqui |
| AVX-INS01 | Instructor | Vivek Menon |
| AVX-MEN01 | Mentor | Aparna Hegde |
| AVX-PLC01 | Placement Officer | Jaya Raman |
| AVX-STU001 | Student | Riya Menon (S1001) |
| AVX-STU002 | Student | Aditya Varma (S1002), an at-risk learner |
| AVX-CORP01 | Corporate Training Client | Rekha Menon, Northwind Logistics |

Each account is linked to one person in the sample data, which is whose records it sees. The sidebar shows both the account name and the linked profile.

## Preview without a server

`dist/preview.html` (also `npm run preview`, and the published Claude artifact) is a static preview with sample data. It opens on a preview screen where you choose a role; it says plainly that no server is connected and no password is checked. Never deploy the preview as if it were the real platform.

## Deploying

Step-by-step guide, server sizes and the 100-user load test: **`docs/DEPLOY.md`**. Ready-made files are in `deploy/` (systemd service, environment file, Caddy HTTPS config). In short: one always-on Node process on a small Linux server with a persistent disk, behind HTTPS, with daily backups. Netlify and Vercel cannot host it as it is.

## Environment variables

Read only by the server; nothing here reaches the browser. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables the start-up checks and secure cookies |
| `PORT`, `HOST` | `8080`, `127.0.0.1` (dev) / `0.0.0.0` (prod) | Listen address |
| `DB_PATH` | `data/avgenx.db` | Account database file |
| `ACCOUNTS_XLSX` | `accounts.xlsx` | The Excel account list (if present, it decides who can sign in) |
| `COOKIE_SECURE` | `true` in production | `Secure` flag and `__Host-` prefix on the session cookie |
| `KEEP_SESSIONS` | `false` | By default every server start signs everyone out, so people begin at the sign-in page. `true` keeps sessions across restarts and shows "Keep me signed in" |
| `SESSION_IDLE_MINUTES` | `480` | Sign out after this much inactivity; lower it on shared lab computers |
| `LOGIN_IP_LIMIT` | `200` | Failed sign-ins allowed per IP in 15 minutes (high, because a whole institute often shares one IP; each user ID is still limited to 5) |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `X-Forwarded-Proto` from your reverse proxy |
| `ANTHROPIC_API_KEY` | empty | Turns on the AI copilot through `POST /api/ai` (key stays on the server) |
| `AI_MODEL`, `AI_MAX_TOKENS` | `claude-sonnet-5-5`, `1200` | AI settings |
| `CHROMIUM_PATH` | empty | Tests only |

## Accounts and administration

* **Create**: Accounts and Sign-in → Create account. Choose roles, a linked sample profile, and either a temporary password or a 72-hour invitation link. Both are shown to you once.
* **Roles**: an account can hold several roles. At sign-in the chosen role must be one of them. Institute administrators cannot grant or manage super administrator, institute administrator or CEO; only a super administrator can.
* **Disable, reset, sign out everywhere**: from an account's panel. Disabling ends all of that person's sessions immediately.
* **Forgot password**: email delivery is not connected yet. In development the reset link is printed to the server console; in production the page tells people to contact their administrator, who can issue a temporary password or a 24-hour reset link.
* **Audit**: every sign-in, failure, creation, role change, reset and export is in the Sign-in audit tab (append-only in the database).
* **Excel register**: "Export register (.xlsx)" downloads user IDs, names, emails, roles, status and dates for audit. It contains no passwords, hashes, tokens or links. It is a report only; sign-in never reads it.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Bundle with esbuild into `dist/` |
| `npm start` | Run the server |
| `npm run dev` | Unminified build, then run the server |
| `npm run seed:dev` | Create the development test accounts (refuses in production) |
| `npm run accounts -- <cmd>` | `init-excel`, `create-admin`, `purge-test`, `list` |
| `npm run preview` | Serve the static preview |
| `npm run lint` | Syntax and architecture rules for `src/` and `server/` |
| `npm run test:unit` | Domain logic, API client, AI proxy, and server sign-in and accounts over HTTP |
| `npm run test:e2e` | Playwright: preview journeys, plus sign-in and administration against the real server |
| `npm run test:smoke` | Every route as every role in the preview, failing on any runtime error |
| `npm run test:a11y` | axe-core across roles, both themes, plus the sign-in pages and accounts console |
| `npm run test:load` | 100 people signing in and using the site at the same moment against the real server |
| `npm run accounts -- backup` | Safe copy of the database and accounts.xlsx into `backups/` |
| `npm test` | lint, unit, build, e2e |

## Directory structure

```
server/                Node server: sign-in, sessions, accounts API, Excel register, AI proxy, CLI
  index.mjs            entry point and production safety checks
  app.mjs              HTTP routes, page gating, cookies, CSRF and origin checks
  auth.mjs             Argon2id, sessions, rate limits, reset tokens, account rules, audit
  db.mjs               SQLite schema and migrations
  register.mjs         .xlsx account register (export)
  excel-accounts.mjs   accounts.xlsx: who can sign in
  cli.mjs              seed-dev, purge-test, create-admin, list
  ai-proxy.mjs         AI copilot proxy
src/
  login/               sign-in page (server mode and preview mode)
  main.js              LMS boot: identity from the server session, shell, routing
  core/                store, router, RBAC, session identity, UI kit, overlays, selectors
  data/  domain/       sample data and pure business rules
  services/            auth calls, sandboxed executor, AI providers, API client, exporter
  views/               one module per area (54 routes, including accounts.js)
  styles/
db/migrations/         PostgreSQL schema (0001 platform, 0002 sign-in)
docs/                  ARCHITECTURE, API, SECURITY, IMPLEMENTATION_MATRIX, TEST_RESULTS
tests/unit, tests/e2e  node:test and Playwright suites
scripts/               lint, smoke, a11y, screenshots, preview server
Dockerfile
legacy/                the original single-file pages this platform replaced
```
