# Test results

Run on 24 October 2026 against the minified build (`login.html` 49 KB, `app.html` 913 KB, `preview.html` 913 KB), Node 22.22, Chrome for Testing 153 (Playwright 1.63.0, esbuild 0.28.2). Path handling was also fixed for Windows (the build, the account CLI and the test URLs previously assumed POSIX paths).

| Suite | Command | Result |
|---|---|---|
| Architecture lint | `npm run lint` | 57 source files and 7 server files, 0 problems |
| Unit and server HTTP | `npm run test:unit` | **53 / 53 passed** (27 platform, 16 sign-in and accounts including restart sign-out, 10 Excel account list, including a simulated Excel file lock) |
| Browser end-to-end | `npm run test:e2e` | **25 / 25 passed**: 10 against the real server (started as its own process), including a mentor and a student working at the same time on separate devices; 15 against the preview |
| Load | `npm run test:load` | 100 people at the same instant, 2 rounds, on 2 CPUs: 0 wrong-person answers, failed sign-ins or lost sessions; sign-in p95 2.5 s when all 100 press it in the same second; app page sent Brotli-compressed (240 KB) |
| Route smoke | `npm run test:smoke` | 594 role × route pages, 0 runtime errors |
| Accessibility (axe-core 4.10) | `npm run test:a11y` | Preview: 9 roles, 40 pages, light and dark. Server: 19 sign-in, error, forgot, forced-change and accounts states at desktop and phone widths. 0 serious or critical violations |
| Database migrations | `psql -f db/migrations/*.sql` | 0001 and 0002 apply cleanly on PostgreSQL 16 |
| Dependency audit | `npm audit` | 0 vulnerabilities, including development tools (`uuid` pinned to a patched version under `exceljs`) |

## Acceptance tests from the brief

| Requirement | Test |
|---|---|
| Without a valid session the sign-in page is shown | e2e: `/`, `/#/admin/exec`, `/#/dashboard` show sign-in; response has no LMS content |
| The demo role switcher no longer appears | e2e (server and preview): no role or "acting as" selectors or text |
| Valid credentials plus an assigned role sign in | unit and e2e |
| Invalid credentials are rejected | unit and e2e (same message for unknown user and wrong password) |
| An unassigned role is rejected | unit and e2e |
| Disabled accounts cannot sign in | unit and e2e (admin disables in the console, then the sign-in attempt fails) |
| Protected pages and APIs need authentication | unit: 401 on `/api/auth/me`, accounts and register; e2e: deep links show sign-in |
| Changing browser storage or the URL grants nothing | e2e: forged localStorage and sessionStorage plus a forbidden deep link land on the student home; admin API returns 403. unit: forged role headers and bodies ignored |
| Each role goes to its own home page | e2e: all seven seeded roles |
| Students cannot create accounts or assign roles | unit and e2e: 403 |
| Administrators can create and disable accounts | e2e through the console UI; unit for update, reset, revoke and privilege limits |
| Sign-out invalidates the session | unit and e2e: the old cookie gets 401 |
| Accounts persist after a server restart | unit: close and reopen the database, sign in again |
| Existing LMS functionality still works | e2e: coding lab Accepted under the live server CSP; 15 preview journeys; 594-page smoke |
| Development credentials are not exposed in production | unit: seed refuses with `NODE_ENV=production`; server refuses to start while test accounts exist |

## Also covered

* First sign-in session is restricted to changing the password; the temporary password cannot be reused; the old session is revoked.
* Cross-origin writes and forged CSRF tokens are rejected.
* Five failed attempts lock an identifier, even with the right password afterwards.
* Invitation and reset links work once and expire; forgot-password answers the same for unknown accounts.
* "Keep me signed in" sets a 14-day cookie; otherwise the cookie ends with the browser.
* The Excel register is parsed and checked cell by cell for passwords, hashes, session and CSRF tokens and reset links.
* Audit entries exist for every administrative action, and the audit table rejects deletes.
* An injected script is blocked by the live CSP on the signed-in LMS.

## Not covered by automated tests

* The Docker image (not built in this environment).
* Email delivery (not connected).
* Real AI responses (the proxy is tested with a mocked upstream).
* Screen reader behaviour beyond axe. A scripted keyboard check of the sign-in page confirmed the tab order (role, user ID, password, show or hide, remember me, forgot password, sign in), that Enter submits, and that focus returns to the password field after an error. The accounts console has not had a dedicated keyboard pass beyond its use of the shared, previously checked dialog and panel components.
