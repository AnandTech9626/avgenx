# API

Two parts:

1. **Implemented now** (`server/app.mjs`): sign-in, sessions, account administration, the Excel register and the AI proxy. These run on the AVGENX server and are covered by tests.
2. **Contract for the rest**: the learning-platform endpoints the frontend is designed against. Today those operations run as pure functions in `src/domain/` over sample data in the browser; each becomes an endpoint here, called through `src/services/api.js`.

## Implemented now

Conventions: JSON bodies (16 KB limit); errors are `{ "code", "message", "fields"? }`. Every write must come from the same origin; authenticated writes also need `X-CSRF-Token` (from `GET /api/auth/me`). The session is an HttpOnly cookie; nothing else identifies the caller.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/` | anyone | Sign-in page without a valid session; the LMS with one |
| GET | `/reset` | anyone | Sign-in page in "set a new password" mode (token in the URL fragment) |
| GET | `/healthz` | anyone | `{ ok: true }` |
| GET | `/api/auth/config` | anyone | `{ resetByEmail, devOutbox }` so the page can describe password resets honestly |
| POST | `/api/auth/login` | anyone | `{ role, identifier, password, remember }`. 200 `{ next: 'app' or 'change-password' }` plus cookie. 401 `invalid_credentials`, 403 `account_disabled` or `role_not_assigned`, 429 `rate_limited` |
| GET | `/api/auth/me` | session | `{ user: { userId, name, email, role, roles, lmsRef }, restricted, csrf, features }`; 401 without a session |
| POST | `/api/auth/logout` | session | Deletes the session and clears the cookie |
| POST | `/api/auth/change-password` | session (also restricted) | `{ current, next }`; ends other sessions and rotates this one |
| POST | `/api/auth/forgot` | anyone | `{ identifier }`; always 202 with the same message |
| POST | `/api/auth/reset` | anyone with a link | `{ token, password }`; single use; ends all sessions |
| GET | `/api/admin/accounts` | `accounts.manage` | All accounts (no secrets) |
| POST | `/api/admin/accounts` | `accounts.manage` | `{ name, email, userId?, roles[], lmsRef?, credential: 'temporary' or 'invite' }`. 201 with `temporaryPassword` or `inviteLink`, shown once |
| PATCH | `/api/admin/accounts/:id` | `accounts.manage` | Any of `{ name, email, roles, status, lmsRef }` |
| POST | `/api/admin/accounts/:id/reset-password` | `accounts.manage` | `{ mode: 'temporary' or 'link' }` |
| POST | `/api/admin/accounts/:id/revoke-sessions` | `accounts.manage` | Ends every session for the account |
| GET | `/api/admin/accounts.xlsx` | `accounts.manage` | Excel register (no secrets) |
| GET | `/api/admin/audit` | `accounts.manage` | Last 300 sign-in and account events |
| POST | `/api/ai` | `ai.use` | Streams `data: {"text"}` events; 503 when no key is configured |

`accounts.manage` belongs to super administrators and institute administrators. Institute administrators get 403 when creating, changing or resetting any account that holds, or would hold, the super administrator, institute administrator or CEO role.

## Contract for the learning platform

### Conventions

* Base path `/api`. JSON in and out. Times are ISO 8601 UTC. Money is integer paise.
* **Auth**: the session cookie from the sign-in above. SSO (OIDC) can be added for staff and corporate clients later.
* **CSRF**: every non-GET request carries `X-CSRF-Token` with the session's token. The API client adds it automatically.
* **Idempotency**: every non-GET request carries `Idempotency-Key`. The server stores the first response for 24 hours per key and user and replays it.
* **Authorization**: each endpoint lists the permission it requires (from `src/core/rbac.js`, plus overrides from `permission_overrides`). It is checked server-side on every call. Scope rules then narrow results (see "Scope").
* **Errors**: `{ "code": "...", "message": "...", "details": {...} }` with codes `invalid_request` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `validation_failed` 422, `rate_limited` 429, `server_error` 5xx. The client retries only 429, 502, 503, 504 and network errors.
* **Pagination**: `?cursor=&limit=` (max 100), response `{ items, nextCursor }`.
* **Audit**: every write appends to `audit_log` with actor, role, before and after, IP and request id.

### Scope

| Role | Students visible |
|---|---|
| superadmin, ceo, admin, director, pm, placement | all |
| instructor, ta | students enrolled in courses they teach |
| mentor | students assigned to them |
| corporate | students where `org_id` = their organisation (enforced by row-level security too) |
| student | only themselves |

Mentor notes are readable only with `mentor.notes`. Discussion threads tied to an organisation are visible only to that tenant and staff.

### Endpoints

#### Session, identity and accounts
Implemented: see "Implemented now" above. Permission overrides (`GET, PUT /permissions/overrides`, `roles.manage`) are still client-side; the server uses the default matrix in `src/core/rbac.js`.

#### Catalog and learning
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/domains`, `/courses`, `/courses/:id` | `programs.view` | published only unless `courses.view` |
| POST | `/courses/:id/enroll` | `learn.self` | checks prerequisites, returns 409 if unmet |
| GET | `/courses/:id/progress` | `learn.self` or `dashboard.any` | |
| POST | `/lessons/:id/complete` | `learn.self` | body `{ evidence }`; server verifies the lesson requirement (accepted submission, quiz pass, reflection length) and sequential unlock |
| GET | `/dashboard/:studentId` | `learn.self` (own) or `dashboard.any` | KPIs, activity series, risk flags, next best action |

#### Course builder
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/courses` | `courses.edit` | creates a draft |
| PATCH | `/courses/:id` | `courses.edit` | drafts only; 409 otherwise |
| POST | `/courses/:id/transition` | depends on target | `review` needs `courses.edit`, `approved` needs `courses.approve`, `published` and `archived` need `courses.publish`. Validation errors return 422 with the checklist |

#### Coding lab and arena
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/problems`, `/problems/:id` | `arena.use` or `lab.use` | never returns hidden tests or the reference solution |
| POST | `/execute` | `lab.use` | `{ lang, code, problemId?, stdin? }` → `202 { submissionId }`. Runs in the isolated execution service (see SECURITY.md). Result via `GET /submissions/:id` or SSE `/submissions/:id/events` |
| GET | `/submissions?student=` | own or `students.view` | |
| POST | `/problems` | `problems.manage` | draft with tests; publishing requires the reference solution to pass all tests on the execution service |
| GET | `/leaderboards/:kind` | `arena.use` | `weekly`, `cohort`, `all-time`; score formula returned with the data |

#### Assessments
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/assessments` | `assess.take` or `assess.manage` | |
| POST | `/assessments/:id/attempts` | `assess.take` | server draws questions and sets `deadline_at` (including accommodations); 409 when out of attempts |
| PATCH | `/attempts/:id` | `assess.take` (own) | autosave answers; rejected after deadline |
| POST | `/attempts/:id/submit` | `assess.take` (own) | server grades; answer keys never leave the server |
| POST | `/attempts/:id/grades` | `assess.grade` | manual grading of short and code answers |
| GET | `/assessments/:id/analytics` | `assess.manage` | per-question difficulty and discrimination |

#### Projects
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/assignments` | `projects.manage` | |
| POST | `/assignments/:id/publish` | `projects.manage` | creates a project row per learner in the cohort |
| POST | `/projects/:id/submit` | `projects.submit` (own) | validates repo and demo URLs |
| POST | `/projects/:id/transition` | `projects.review` | `in_review`, `revision`, `approved`, `rejected`; scores validated against the rubric; late penalty computed server-side |

#### Live classes and attendance
| Method | Path | Permission |
|---|---|---|
| GET | `/sessions` | `live.view` |
| POST, PATCH | `/sessions`, `/sessions/:id` | `live.manage` (video integration creates the meeting link) |
| PUT | `/sessions/:id/attendance` | `attendance.mark` |
| POST | `/leave-requests` | `live.attend` |
| PATCH | `/leave-requests/:id` | `attendance.mark` |

#### Mentoring, community, risk
| Method | Path | Permission |
|---|---|---|
| POST | `/mentor-requests` | `mentor.request` |
| PATCH | `/mentor-requests/:id` | `mentor.workspace` |
| GET, POST | `/students/:id/mentor-notes` | `mentor.notes` |
| GET, POST | `/threads`, `/threads/:id/posts` | `community.post` |
| PATCH | `/threads/:id`, `/posts/:id` | `community.moderate` (hide, lock, accept answer) |
| GET | `/risk` | `reports.view` |
| POST, PATCH | `/interventions`, `/interventions/:id` | `risk.intervene` |

#### Career and placement
| Method | Path | Permission |
|---|---|---|
| GET | `/me/readiness` | `career.self` |
| GET | `/jobs` | `career.self` or `placement.view` (eligibility computed per learner) |
| POST | `/jobs/:id/apply` | `career.self` |
| POST, PATCH | `/jobs`, `/applications/:id` | `placement.manage` |
| GET, PUT | `/me/portfolio` | `career.self` |
| GET | `/p/:slug` | public, only when `public = true` |
| POST | `/repos/connect` | `career.self` (starts GitHub/GitLab OAuth; no credentials ever posted) |

#### Certificates
| Method | Path | Permission |
|---|---|---|
| GET | `/certificates` | `certs.own` or `certs.manage` |
| POST | `/certificates` | `certs.manage` (eligibility re-checked server-side) |
| POST | `/certificates/:id/revoke` | `certs.manage`, reason required |
| GET | `/verify/:code` | public, rate limited; returns name, course, date, status only |
| GET | `/certificates/:id.pdf` | owner or `certs.manage` (signed PDF integration) |

#### Operations
| Method | Path | Permission |
|---|---|---|
| GET | `/students`, `/students/:id` | `students.view` (scoped) |
| PATCH | `/students/:id` | `students.manage` |
| GET, POST, PATCH | `/admissions`, `/admissions/:id` | `admissions.manage`; `POST /admissions/:id/enroll` creates user, student and invoice in one transaction |
| GET, POST, PATCH | `/cohorts` | `cohorts.view` / `cohorts.manage` |
| GET | `/faculty` | `faculty.view` |

#### Fees
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/invoices` | `fees.view` | |
| POST | `/invoices/:id/payments` | `fees.manage` | offline modes only (cash, bank transfer, cheque, UPI reference) |
| POST | `/payments/intents` | invoice owner | creates a gateway order; card data goes only to the provider |
| POST | `/payments/webhook` | provider signature | the **only** way a gateway payment is marked paid |
| POST | `/invoices/:id/adjustments` | `fees.manage` | |
| POST | `/refunds` | `fees.manage` | |
| PATCH | `/refunds/:id` | `refunds.approve`; approver must differ from requester |

#### Analytics, corporate, admin
| Method | Path | Permission |
|---|---|---|
| GET | `/analytics/exec` | `exec.view` |
| GET | `/reports/:name.csv` | `reports.view` + `data.export` |
| GET | `/orgs`, `/orgs/:id` | `orgs.view` |
| GET | `/orgs/me` | `orgs.own` (tenant only) |
| GET | `/audit` | `audit.view` |
| GET, PUT | `/settings/:key` | `settings.manage` |
| GET, PUT | `/integrations/:id` | `integrations.manage` (secrets write-only; never returned) |
| GET | `/search?q=` | signed in; results filtered by permission and scope |

#### AI
Implemented: `POST /api/ai`, see above.
