# Architecture

## Shape of the system

Two parts: a small Node server that owns identity, and a single-page LMS in plain ES modules (no framework; views return escaped HTML strings and one delegated event layer dispatches actions).

```
 browser ──GET /──▶ server/app.mjs ── valid session? ──no──▶ dist/login.html   (sign-in page only)
                          │                         └─yes─▶ dist/app.html     (the LMS)
                          │
                          ├─ /api/auth/*   sign-in, sessions, password change and reset
                          ├─ /api/admin/*  accounts, roles, status, resets, audit, .xlsx register
                          └─ /api/ai       AI proxy (key stays on the server)
                                  │
                          server/auth.mjs ── Argon2id · sessions · rate limits · audit
                                  │
                          server/db.mjs  ── SQLite file (accounts, roles, sessions, tokens, audit)

 LMS in the browser:
   boot ─GET /api/auth/me─▶ identity { role, linked profile, csrf }   (core/session.js)
   hash URL → router → guard (permission + feature flag) → view.render(ctx)
   ctx.commit(label, fn) → core/store.js (sample learning data, this browser)
```

The LMS never decides who someone is. It asks the server on every page load; the role it shows is the role the server verified at sign-in, and every account action is re-authorised by the server.

Builds (`build.mjs`): `login.html` (sign-in page, no LMS code), `app.html` (LMS for signed-in users), `pages.json` (per-page CSP read by the server), and `preview.html` / `artifact.html` (static preview with sample data and a preview screen instead of sign-in; it renders the sign-in design in a shadow root so its styles cannot collide with the LMS).

## Layers

| Layer | Folder | Rule |
|---|---|---|
| Server | `server/` | Identity and administration: the only place passwords, sessions, roles and accounts are handled. |
| Sign-in page | `src/login/` | The sign-in, password change, forgot and reset screens. Shared by the server page and the preview. |
| Core | `src/core/` | Store, router, RBAC, session identity, UI kit, overlays, selectors. No business rules. |
| Data | `src/data/` | Static catalog, problems, question bank, and the deterministic seed. |
| Domain | `src/domain/` | Pure functions over plain data: progress, assessments, projects, risk, fees, certificates, career, motivation, analytics, search, scope. No DOM, no storage. Unit-tested in Node. These are what a backend should run. |
| Services | `src/services/` | Everything that touches the outside: auth calls, code executor, AI providers, integrations registry, API client, exporter. The only place network calls are allowed (lint enforced). |
| Views | `src/views/` | Rendering and action handlers. They read through selectors and write only through `commit`. |

## Key mechanisms

**Store.** One state tree. Every write goes through `commit(label, fn, { audit })`: the store snapshots, runs the mutation, rolls back if it throws, appends an audit event, bumps a revision counter and notifies subscribers. Selectors in `core/select.js` memoise on that revision, so expensive derivations (activity index, risk for all learners, search index) are computed once per change.

**Routing and guards.** `views/index.js` maps paths to views. Each view declares the permissions it needs (any of) and an optional feature flag. A denied route renders an explanation rather than a blank page, and actions re-check permissions before writing.

**Scope.** `domain/scope.js` decides which students, threads, notes, cohorts and organisations a user can see. Views never filter on their own; they ask scope. The same rules are written into `docs/API.md` and, for tenants, into row-level security in the schema.

**Demo clock and seed.** `now()` returns the seed day plus the real time of day, and the seed is generated relative to today with a fixed PRNG seed, so the demo always looks current and is identical on every machine.

**Code execution.** JavaScript runs in a Web Worker built from a Blob URL. Before learner code runs, the worker removes network, storage and nested-worker APIs; the main thread terminates it on timeout. Other languages go to `runRemote`, which reports "Unavailable" until an execution service is configured.

**Identity.** `core/session.js` holds the identity from `GET /api/auth/me`, frozen for the page's lifetime. `actor()` derives role and profile only from it; persisted UI state no longer contains a role, and old keys are dropped on load. Deep links a role may not open land on that role's home page.

**AI.** `services/ai.js` tries providers in order: the Claude artifact viewer's sampling capability, then the server's `/api/ai` (when the server has a key) or a configured endpoint, else a "not connected" state. It never fabricates an answer.

## Path to production

Done: sign-in, sessions, roles, account administration and audit on the server.

1. **Learning records**: implement the "Contract for the learning platform" in `docs/API.md` on the server, reusing `src/domain/*` (dependency-free) and enforcing `core/rbac.js` plus `domain/scope.js` on every request. Use the session's role and account. Then point the store at `services/api.js`; views do not change because they only use `commit` and selectors.
2. **Database**: for several server instances, move to PostgreSQL (`db/migrations/0001_init.sql`, `0002_auth.sql`) and keep rate limits in a shared store.
3. **Email**: connect a provider so self-service resets and invitations are delivered (the server already has a `mailer` hook).
4. **MFA / SSO**: TOTP or WebAuthn for administrators; OIDC for staff and corporate clients.
5. **Execution**: a sandboxed judge behind `POST /execute`.
6. **Integrations**: per the matrix; each has its interface in `services/integrations.js`.
7. **Observability**: request ids into the audit log, error tracking, uptime checks, backups.
