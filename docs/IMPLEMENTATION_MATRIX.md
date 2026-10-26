# Implementation matrix

How to read the status labels:

* **Implemented and tested**: the feature works end to end in this build and is covered by unit or end-to-end tests. In production its data moves from browser storage to the backend in `docs/API.md`; the logic in `src/domain/` is what the backend should run.
* **Implemented in demo mode**: the workflow works in the UI against sample data, but the real effect depends on a service that is not connected (for example, an email is recorded as a notification, not sent).
* **Partially implemented**: parts work; the gaps are listed.
* **Requires external integration**: cannot work without credentials or infrastructure; the app shows a "not connected" state rather than pretending.
* **Not yet implemented**: not built.

One rule applies to everything below: **sign-in, accounts and roles are server-enforced; learning records are not yet.** The server verifies every sign-in and authorises every account action. Courses, submissions, grades, fees and analytics are still sample data held in each browser, so their permission checks run in the client. Moving them onto the server (the contract in `docs/API.md`) is the main remaining work.

## The 30 modules

| # | Module | Status | What works | What it still needs |
|---|---|---|---|---|
| 1 | Roles and permissions (11 roles) | Implemented and tested | Real sign-in with the role verified against the account's assigned roles; the session role cannot be changed from the browser. 53 permissions, per-role navigation and home pages, route guards, data scope (tenant, mentor, instructor), feature flags. Account administration is enforced by the server | Server enforcement for learning-record APIs (comes with moving records to the server); the in-app permission matrix editor still only affects the client; MFA and SSO |
| 2 | Student intelligence dashboard | Implemented and tested | KPIs from records, activity heatmap, weekly velocity, streak, risk flags with evidence, next best action, filters, widget customisation, staff can open any in-scope learner | |
| 3 | Course builder | Implemented and tested | Modules and lessons, lesson requirements, prerequisites, validation checklist, draft → review → approved → published → archived with versioning and audit | Rich media upload (needs object storage) |
| 4 | Coding IDE (lab) | Partially implemented | CodeMirror editor, starters for JS, Python, Java, C++; JavaScript runs and is judged in an isolated Web Worker with no network or storage and a hard timeout (Accepted, Wrong Answer, TLE, runtime and compile errors); submissions history | **Requires external integration** for Python, Java and C++: the lab says "Unavailable" until an execution service endpoint is configured. Production judging of all languages should be server side |
| 5 | Competitive programming | Implemented and tested | 54 problems with hidden tests and hints, problem sets and paths, weekly contest and daily challenge, explainable leaderboards, problem studio (validate reference solution, then publish) | Server-side judging for contests that count |
| 6 | AI learning copilot | Requires external integration | Provider abstraction: Claude artifact viewer, or your `/api/ai` endpoint (Netlify function included, key server-side, streaming). Context-aware prompts that hint rather than solve; AI executive narrative; cancellation and error states | A connected provider. Without one it says "not connected" and offers offline helpers labelled "not AI" |
| 7 | Assessment engine | Implemented and tested | 57 questions across MCQ, multi-select, short answer, SQL and code; 13 assessments; difficulty-weighted draws, timers, accommodations (extra time), negative marking, attempt limits, manual grading queue, per-question analytics | Server-authoritative timers and proctoring (not built) |
| 8 | Project lifecycle | Implemented and tested | Assignment publishing creates work items; submit, review, revision, approve, reject state machine; rubric scoring; late penalties; history; approved work flows to portfolio | Plagiarism detection (integration) |
| 9 | Live classes | Implemented in demo mode | Week calendar and list, schedule, reschedule, cancel, registration, attendance after class, materials, leave requests | Video provider for real meeting links and recordings; calendar invites |
| 10 | Mentors | Implemented and tested | Help requests and queue, assignment, private mentor notes (hidden from students), mentor workspace with assigned learners | |
| 11 | Placement CRM | Implemented and tested | Readiness score (6 weighted parts, explained), jobs with eligibility reasons, applications pipeline with stages, employers, mock interviews | No employment guarantees anywhere in copy |
| 12 | Corporate tenants | Implemented and tested | Organisation workspace sees only its own employees, seats, progress and invoices; staff view across organisations; private org cohorts | SSO per tenant (integration) |
| 13 | Gamification | Implemented and tested | XP derived from records (cannot be farmed by resubmitting), badges, leaderboards with visible formula, contests, can be switched off by flag | |
| 14 | Notifications | Implemented in demo mode | In-app notifications, unread badges, mark read, per-category preferences for in-app, email and SMS | Email, SMS and push delivery (integrations). Preferences are stored but nothing is sent |
| 15 | Certification | Implemented and tested | Eligibility checklist from real records, issue, revoke with reason, public verification page by code | Signed PDF certificates (integration) |
| 16 | CEO dashboard | Implemented and tested | Revenue, collections, enrolment, completion, placement, risk, cohort health, drill-downs, CSV export | AI narrative needs the AI provider |
| 17 | Instructor operations | Implemented and tested | Instructor center: review and grading queues, teaching load, problem studio, cohort sessions | |
| 18 | Attendance, fees, admissions | Implemented and tested | Attendance marking and reports; invoices, offline payment recording, scholarships and adjustments, refunds with maker-checker; admissions pipeline that enrolls an applicant into learner, roadmap and fee plan | **Online payments require a payment gateway**: the app never takes card data and never marks an online payment as paid |
| 19 | Search | Implemented and tested | Command palette (Ctrl/Cmd + K) over courses, lessons, problems, people, jobs and actions, filtered by permission and scope | Server full-text search for large data (schema has trigram indexes) |
| 20 | Predictive interventions | Implemented and tested | Explainable rule-based risk (inactivity, failed attempts, overdue work, engagement drop, attendance, prerequisites, progress gap) with thresholds in settings; intervention workflow | Optional ML model is an integration seam only. Rules are deliberately used instead of claiming prediction |
| 21 | Community | Implemented and tested | Discussions with tags, accepted answers, moderation, study groups; cohort and tenant privacy | Real-time updates need a backend |
| 22 | Repository integration | Partially implemented | Repository and demo URLs on submissions with validation; GitHub profile on portfolio | **Requires external integration** for linking accounts, commits, PRs and CI status (GitHub App / GitLab OAuth). No credentials are ever collected |
| 23 | Portfolio | Implemented and tested | Editable profile, verified approved projects, public toggle, public page by slug | |
| 24 | Governance and audit | Implemented and tested | Server-side, append-only sign-in and account audit (sign-ins, failures, lockouts, creation, role and status changes, resets, exports) viewable in the accounts console; Excel account register; client audit log of learning-record changes with filters and export; typed confirmation for destructive actions | Learning-record audit moves to the server with those records; retention jobs |
| 25 | Design system | Implemented and tested | Tokens for colour, type, spacing; light and dark themes; component kit (tables with sort and paging, forms with errors, charts, stepper, kanban, dialogs, drawer, toasts) | |
| 26 | Personalisation and accessibility | Implemented and tested | Theme, text size, reduced motion, dashboard widgets; WCAG 2.2 AA work: focus management, keyboard traps in dialogs, labels, contrast fixes, skip link; axe clean across 9 roles in both themes and on the sign-in, password and accounts screens | Manual screen reader audit |
| 27 | Backend-ready architecture | Partially implemented | Node server with persistent SQLite account store, sessions, admin API and AI proxy; pure domain modules; production API client; API contract with permissions; PostgreSQL migrations including sign-in tables; Dockerfile | Learning-record endpoints are not built yet |
| 28 | Performance | Implemented and tested | 49 KB sign-in page, single 913 KB LMS file, memoised selectors keyed on a revision counter, paged tables, debounced inputs, no layout libraries | Code splitting for very large catalogs |
| 29 | Security | Partially implemented | Argon2id passwords, HttpOnly SameSite=Strict session cookies, CSRF and origin checks, sign-in rate limiting, single-use expiring reset and invitation links, session revocation, privilege rules for administrators, production start-up checks, per-page CSP, sandboxed code runner, escaped rendering, server-side AI key | Server checks for learning records; MFA; email delivery for resets. See SECURITY.md |
| 30 | Testing and deployment | Implemented and tested | Unit and HTTP tests for the server, browser tests against the real server and the preview, smoke, a11y, schema checks; CI workflow; Dockerfile | Docker image not built in this environment |

## Sign-in and account administration

| Requirement | Status |
|---|---|
| Sign-in page first for anyone without a session; LMS never served to them | Implemented and tested |
| Demo role switcher removed from the product | Implemented and tested |
| Role selector verified against server-side role assignments | Implemented and tested |
| Invalid credentials, wrong role, disabled account and lockout messages | Implemented and tested |
| Show or hide password, Caps Lock warning, remember me (server-side 14-day session), loading state | Implemented and tested |
| Refresh keeps a valid session; sign-out invalidates it on the server | Implemented and tested |
| No public sign-up; administrators create accounts with unique IDs | Implemented and tested |
| Temporary password with forced change, or invitation link | Implemented and tested |
| Disable or enable, reset password, sign out everywhere, role changes, audit | Implemented and tested |
| Institute administrators cannot grant or manage privileged roles | Implemented and tested |
| Forgot password with single-use expiring links | Implemented in demo mode (link goes to the server console in development; needs email in production) |
| Development test accounts via a local-only seed, refused in production | Implemented and tested |
| Accounts persist across server restarts | Implemented and tested |
| Excel account register export without secrets | Implemented and tested |
| Excel account list (`accounts.xlsx` decides who can sign in; saved changes apply within seconds and before each sign-in; each person's current password written into the file whenever it changes) | Implemented and tested |
| MFA, SSO | Not yet implemented |

Also delivered from the brief: **multi-domain catalog** with 9 domains and 28 courses built from one domain template (Implemented and tested), workflows A to F covered by the e2e journeys, and the seed (9 domains, 28 courses, 11 cohorts, 29 staff including 12 instructors, 8 mentors and 2 teaching assistants, 102 students, 54 challenges, 33 assignments, 30 sessions, 3 organisations, notifications and audit events), all labelled as sample data.

## Integrations that need credentials

| Integration | Needed for | Credential (server side only) |
|---|---|---|
| AI provider | Copilot, AI narrative | `ANTHROPIC_API_KEY` (proxy included) |
| Code execution service | Python, Java, C++ judging; server judging for contests | Execution service endpoint and token |
| Payment gateway | Online fees and refund payouts | Gateway key and webhook secret |
| Email | Password reset and invitation delivery, notification emails, receipts | SMTP or provider key |
| SMS | Reminders | SMS provider key, DLT templates |
| Web push | Browser notifications | VAPID private key |
| Video conferencing | Meeting links, recordings | Zoom / Meet / Teams app credentials |
| Calendar | Invites | OAuth client |
| GitHub / GitLab | Repository linking, PRs, CI | GitHub App or OAuth app secret |
| PDF signing | Downloadable certificates | Signing key |
| Plagiarism detection | Code similarity | MOSS or provider key |
| Single sign-on | Staff and corporate login | IdP metadata and client secret |
| Backups | Recovery | Cloud role |
| Risk model (optional) | Extra risk signal | Model endpoint |

Super admins see live status for each under **Administration → Integrations**.

## Known limitations

* Learning records are sample data in each browser. Sign-in and accounts are real and server-enforced, but a signed-in user with developer tools can still change their own copy of the sample data or render other screens from it locally (with no server privilege). Do not put real student records in this build until those records move to the server.
* Each account opens one linked sample profile, so two accounts linked to the same profile see the same sample records.
* Email is not connected: self-service password resets are not delivered in production; administrators issue temporary passwords or reset links instead.
* No MFA or SSO yet.
* SQLite means one server instance; scale-out needs the PostgreSQL migration.
* With the Excel account list, every person's current password is in the file in plain text by the institute's choice; keep the file private (see SECURITY.md). The file is read by one server process; it is not a shared database.
* Browser execution is JavaScript only. A Web Worker isolates the code from the page, but browser isolation is not a substitute for a server sandbox for graded or untrusted work.
* The CSP allows `unsafe-eval` because the JavaScript runner compiles learner code in a worker that inherits the page policy. A production runner on a separate origin or server removes this.
* Charts are hand-built SVG; very large datasets would need aggregation server side.
* Sample data is generated, dated relative to today, and plausible rather than realistic in every detail.

## Next steps

1. Move learning records onto the server: implement the learning-platform contract in `docs/API.md`, reuse `src/domain/` for the rules, enforce permissions and scope with the session role, and switch the store to the API client.
2. Add MFA for administrators, then OIDC single sign-on for staff and corporate clients.
3. Stand up a sandboxed execution service (containers or a managed judge) and point the lab at it.
4. Connect email, a payment gateway with verified webhooks, and a video provider, in that order.
5. Remove `unsafe-eval` from the LMS page by moving the code runner to a separate origin or the server.
