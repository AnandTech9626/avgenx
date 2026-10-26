-- AVGENX Academy: initial schema (PostgreSQL 15+)
-- Mirrors the demo state tree in src/data/seed.js so an export from the demo can be imported.
-- Conventions: text ids (keep the demo's readable ids), timestamptz everywhere, soft state via
-- status columns, tenant scoping through org_id, every write audited by the API layer.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Identity and access -------------------------------------------------------------------------

CREATE TYPE role_id AS ENUM ('superadmin','ceo','admin','director','pm','instructor','mentor','ta','placement','student','corporate');

CREATE TABLE organizations (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  industry      text,
  contract_seats integer NOT NULL DEFAULT 0 CHECK (contract_seats >= 0),
  contract_start date,
  contract_end   date,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL,
  role          role_id NOT NULL,
  org_id        text REFERENCES organizations(id),          -- set for corporate clients and their employees
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','deactivated')),
  auth_subject  text UNIQUE,                                 -- subject from the identity provider; no passwords stored here
  mfa_enrolled  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  CONSTRAINT corporate_has_org CHECK (role <> 'corporate' OR org_id IS NOT NULL)
);

-- Default matrix lives in code (src/core/rbac.js); this table stores the super admin's overrides.
CREATE TABLE permission_overrides (
  role        role_id NOT NULL,
  permission  text NOT NULL,
  granted     boolean NOT NULL,
  updated_by  text NOT NULL REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

CREATE TABLE sessions (
  id            text PRIMARY KEY,                            -- opaque, stored hashed by the auth service
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            inet,
  user_agent    text,
  revoked_at    timestamptz
);

-- Catalog -------------------------------------------------------------------------------------

CREATE TABLE domains (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  tagline     text,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE courses (
  id            text PRIMARY KEY,
  domain_id     text NOT NULL REFERENCES domains(id),
  title         text NOT NULL,
  level         text NOT NULL CHECK (level IN ('Beginner','Intermediate','Advanced')),
  summary       text,
  hours         integer CHECK (hours > 0),
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','review','approved','published','archived')),
  sequential    boolean NOT NULL DEFAULT true,
  owner_id      text REFERENCES users(id),
  version       integer NOT NULL DEFAULT 1,
  published_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courses_domain_state ON courses (domain_id, state);

CREATE TABLE course_prerequisites (
  course_id     text REFERENCES courses(id) ON DELETE CASCADE,
  requires_id   text REFERENCES courses(id),
  PRIMARY KEY (course_id, requires_id),
  CHECK (course_id <> requires_id)
);

CREATE TABLE modules (
  id          text PRIMARY KEY,
  course_id   text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       text NOT NULL,
  sort_order  integer NOT NULL
);

CREATE TABLE lessons (
  id            text PRIMARY KEY,
  module_id     text NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title         text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('video','reading','lab','quiz','project','live')),
  minutes       integer NOT NULL DEFAULT 10,
  requirement   text NOT NULL DEFAULT 'view' CHECK (requirement IN ('view','quiz','problem','reflection')),
  problem_id    text,                                         -- when requirement = 'problem'
  body          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order    integer NOT NULL
);

CREATE TABLE course_versions (                                -- immutable snapshot taken on publish
  course_id   text REFERENCES courses(id) ON DELETE CASCADE,
  version     integer,
  snapshot    jsonb NOT NULL,
  published_by text REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, version)
);

-- Cohorts and enrollment ----------------------------------------------------------------------

CREATE TABLE cohorts (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  course_ids    text[] NOT NULL,
  org_id        text REFERENCES organizations(id),           -- private corporate cohort when set
  start_date    date NOT NULL,
  weeks         integer NOT NULL CHECK (weeks > 0),
  capacity      integer NOT NULL CHECK (capacity > 0),
  instructor_id text REFERENCES users(id),
  mentor_ids    text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','completed','cancelled'))
);

CREATE TABLE students (
  id            text PRIMARY KEY,                              -- e.g. S1001
  user_id       text NOT NULL UNIQUE REFERENCES users(id),
  cohort_id     text REFERENCES cohorts(id),
  org_id        text REFERENCES organizations(id),
  mentor_id     text REFERENCES users(id),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','graduated','withdrawn')),
  accommodations jsonb NOT NULL DEFAULT '{}'::jsonb,           -- e.g. {"extraTimePct": 25}
  joined_at     date NOT NULL
);
CREATE INDEX students_cohort ON students (cohort_id);
CREATE INDEX students_org ON students (org_id) WHERE org_id IS NOT NULL;

CREATE TABLE enrollments (
  student_id  text REFERENCES students(id) ON DELETE CASCADE,
  course_id   text REFERENCES courses(id),
  course_version integer NOT NULL DEFAULT 1,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','dropped')),
  PRIMARY KEY (student_id, course_id)
);

CREATE TABLE lesson_completions (
  student_id  text REFERENCES students(id) ON DELETE CASCADE,
  lesson_id   text REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  evidence    jsonb,                                          -- quiz score, accepted submission id, reflection text
  PRIMARY KEY (student_id, lesson_id)
);

CREATE TABLE admissions (
  id            text PRIMARY KEY,
  applicant_name text NOT NULL,
  email         citext NOT NULL,
  phone         text,
  program       text NOT NULL,
  source        text,
  stage         text NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','screening','test','interview','offer','enrolled','rejected','withdrawn')),
  score         numeric(5,2),
  owner_id      text REFERENCES users(id),
  student_id    text REFERENCES students(id),                  -- set when enrolled
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Coding problems and submissions -------------------------------------------------------------

CREATE TABLE problems (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  difficulty    text NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  topics        text[] NOT NULL DEFAULT '{}',
  statement     text NOT NULL,
  fn_name       text NOT NULL,
  time_limit_ms integer NOT NULL DEFAULT 2000,
  memory_mb     integer NOT NULL DEFAULT 256,
  state         text NOT NULL DEFAULT 'published' CHECK (state IN ('draft','published','retired')),
  author_id     text REFERENCES users(id),
  reference_solution text,                                    -- never sent to learners
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE problem_tests (
  id          bigserial PRIMARY KEY,
  problem_id  text NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input       jsonb NOT NULL,
  expected    jsonb NOT NULL,
  hidden      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL
);

CREATE TABLE submissions (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES students(id),
  problem_id    text NOT NULL REFERENCES problems(id),
  language      text NOT NULL CHECK (language IN ('javascript','python','java','cpp','sql')),
  code          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('queued','running','accepted','wrong_answer','time_limit','runtime_error','compile_error','unavailable')),
  passed        integer,
  total         integer,
  runtime_ms    integer,
  judged_by     text NOT NULL DEFAULT 'execution-service',
  contest_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submissions_student_time ON submissions (student_id, created_at DESC);
CREATE INDEX submissions_problem_status ON submissions (problem_id, status);

-- Assessments ---------------------------------------------------------------------------------

CREATE TABLE questions (
  id          text PRIMARY KEY,
  topic       text NOT NULL,
  difficulty  smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  kind        text NOT NULL CHECK (kind IN ('mcq','multi','short','sql','code')),
  prompt      text NOT NULL,
  payload     jsonb NOT NULL,                                  -- options, answer key, regex, tests; key never sent to clients
  explanation text
);

CREATE TABLE assessments (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  course_id       text REFERENCES courses(id),
  minutes         integer NOT NULL CHECK (minutes > 0),
  pass_pct        integer NOT NULL CHECK (pass_pct BETWEEN 0 AND 100),
  max_attempts    integer NOT NULL DEFAULT 3,
  negative_marking numeric(4,2) NOT NULL DEFAULT 0,
  draw            jsonb NOT NULL,                              -- topic and difficulty mix
  opens_at        timestamptz,
  closes_at       timestamptz
);

CREATE TABLE attempts (
  id            text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES assessments(id),
  student_id    text NOT NULL REFERENCES students(id),
  question_ids  text[] NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  deadline_at   timestamptz NOT NULL,                          -- server-authoritative timer
  submitted_at  timestamptz,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  per_question  jsonb,
  score_pct     numeric(5,2),
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','needs_grading','graded','expired'))
);
CREATE INDEX attempts_student ON attempts (student_id, assessment_id);

-- Projects and assignments --------------------------------------------------------------------

CREATE TABLE assignments (
  id            text PRIMARY KEY,
  course_id     text NOT NULL REFERENCES courses(id),
  cohort_id     text REFERENCES cohorts(id),
  title         text NOT NULL,
  brief         text NOT NULL,
  rubric        jsonb NOT NULL,                              -- [{criterion, weight, max}]
  due_at        timestamptz NOT NULL,
  late_penalty_pct_per_day numeric(5,2) NOT NULL DEFAULT 5,
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','closed')),
  created_by    text REFERENCES users(id)
);

CREATE TABLE projects (
  id            text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES assignments(id),
  student_id    text NOT NULL REFERENCES students(id),
  state         text NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started','in_progress','submitted','in_review','revision','approved','rejected')),
  repo_url      text,
  demo_url      text,
  notes         text,
  scores        jsonb,
  total_score   numeric(5,2),
  reviewer_id   text REFERENCES users(id),
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE project_events (                                -- the state machine's history
  id          bigserial PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_state  text,
  to_state    text NOT NULL,
  actor_id    text NOT NULL REFERENCES users(id),
  comment     text,
  at          timestamptz NOT NULL DEFAULT now()
);

-- Live classes and attendance -----------------------------------------------------------------

CREATE TABLE live_sessions (
  id            text PRIMARY KEY,
  cohort_id     text NOT NULL REFERENCES cohorts(id),
  title         text NOT NULL,
  instructor_id text REFERENCES users(id),
  starts_at     timestamptz NOT NULL,
  minutes       integer NOT NULL,
  meeting_url   text,                                          -- from the video provider integration
  recording_url text,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','completed','cancelled'))
);

CREATE TABLE attendance (
  session_id  text REFERENCES live_sessions(id) ON DELETE CASCADE,
  student_id  text REFERENCES students(id),
  status      text NOT NULL CHECK (status IN ('present','late','absent','excused')),
  marked_by   text REFERENCES users(id),
  marked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, student_id)
);

CREATE TABLE leave_requests (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES students(id),
  session_id  text REFERENCES live_sessions(id),
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  decided_by  text REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Mentoring, community, interventions ---------------------------------------------------------

CREATE TABLE mentor_requests (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES students(id),
  mentor_id   text REFERENCES users(id),
  topic       text NOT NULL,
  detail      text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','resolved','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE mentor_notes (                                  -- private: mentors and directors only
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES students(id),
  author_id   text NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE threads (
  id          text PRIMARY KEY,
  course_id   text REFERENCES courses(id),
  cohort_id   text REFERENCES cohorts(id),
  org_id      text REFERENCES organizations(id),
  author_id   text NOT NULL REFERENCES users(id),
  title       text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','locked','hidden')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id          text PRIMARY KEY,
  thread_id   text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id   text NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  accepted    boolean NOT NULL DEFAULT false,
  hidden_by   text REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_groups (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  course_id   text REFERENCES courses(id),
  member_ids  text[] NOT NULL DEFAULT '{}',
  capacity    integer NOT NULL DEFAULT 8
);

CREATE TABLE interventions (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES students(id),
  owner_id    text NOT NULL REFERENCES users(id),
  reasons     jsonb NOT NULL,                                  -- the explainable risk flags that triggered it
  plan        text,
  state       text NOT NULL DEFAULT 'open' CHECK (state IN ('open','contacted','plan_agreed','monitoring','resolved','escalated')),
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Career and placement ------------------------------------------------------------------------

CREATE TABLE employers (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  sector      text,
  contact_email citext
);

CREATE TABLE jobs (
  id            text PRIMARY KEY,
  employer_id   text NOT NULL REFERENCES employers(id),
  title         text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('job','internship')),
  location      text,
  ctc_min_lpa   numeric(6,2),
  ctc_max_lpa   numeric(6,2),
  skills        text[] NOT NULL DEFAULT '{}',
  min_readiness integer NOT NULL DEFAULT 0,
  closes_at     date,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE applications (
  id          text PRIMARY KEY,
  job_id      text NOT NULL REFERENCES jobs(id),
  student_id  text NOT NULL REFERENCES students(id),
  stage       text NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','shortlisted','interview','offer','accepted','rejected','withdrawn')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, student_id)
);

CREATE TABLE mock_interviews (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES students(id),
  interviewer_id text REFERENCES users(id),
  kind        text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  scores      jsonb,
  feedback    text
);

CREATE TABLE portfolios (
  student_id  text PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  slug        text UNIQUE NOT NULL,
  public      boolean NOT NULL DEFAULT false,
  headline    text,
  links       jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured_project_ids text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE repo_links (                                    -- OAuth via GitHub/GitLab app; no tokens in this table
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES students(id),
  provider    text NOT NULL CHECK (provider IN ('github','gitlab')),
  repo_full_name text NOT NULL,
  installation_id text,                                        -- tokens live in the secret store keyed by this
  linked_at   timestamptz NOT NULL DEFAULT now()
);

-- Certificates --------------------------------------------------------------------------------

CREATE TABLE certificates (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES students(id),
  course_id     text NOT NULL REFERENCES courses(id),
  verify_code   text NOT NULL UNIQUE,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  issued_by     text NOT NULL REFERENCES users(id),
  evidence      jsonb NOT NULL,                                -- the eligibility checklist at issue time
  revoked_at    timestamptz,
  revoked_by    text REFERENCES users(id),
  revoke_reason text,
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

-- Fees ----------------------------------------------------------------------------------------
-- No card data is ever stored. Online payments are recorded only from verified provider webhooks.

CREATE TABLE invoices (
  id          text PRIMARY KEY,
  student_id  text REFERENCES students(id),
  org_id      text REFERENCES organizations(id),
  description text NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  due_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue','void')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (student_id IS NOT NULL OR org_id IS NOT NULL)
);

CREATE TABLE payments (
  id            text PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices(id),
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  mode          text NOT NULL CHECK (mode IN ('cash','bank_transfer','cheque','upi_offline','gateway')),
  reference     text,
  provider_payment_id text UNIQUE,                             -- set only for gateway payments, from a verified webhook
  recorded_by   text REFERENCES users(id),
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE adjustments (
  id          text PRIMARY KEY,
  invoice_id  text NOT NULL REFERENCES invoices(id),
  kind        text NOT NULL CHECK (kind IN ('scholarship','discount','waiver','late_fee')),
  amount_paise bigint NOT NULL,
  reason      text NOT NULL,
  approved_by text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id          text PRIMARY KEY,
  invoice_id  text NOT NULL REFERENCES invoices(id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','declined','paid')),
  requested_by text NOT NULL REFERENCES users(id),
  decided_by  text REFERENCES users(id),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),   -- maker-checker
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Notifications, settings, audit --------------------------------------------------------------

CREATE TABLE notifications (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_prefs (
  user_id     text REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  in_app      boolean NOT NULL DEFAULT true,
  email       boolean NOT NULL DEFAULT true,
  sms         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE settings (
  key         text PRIMARY KEY,                                -- flags, risk thresholds, xp, grading, retention
  value       jsonb NOT NULL,
  updated_by  text REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (                                     -- append-only; the API role has INSERT only
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    text REFERENCES users(id),
  actor_role  role_id,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  kind        text NOT NULL DEFAULT 'data' CHECK (kind IN ('data','security','permission','finance','academic')),
  before      jsonb,
  after       jsonb,
  ip          inet,
  request_id  text
);
CREATE INDEX audit_entity ON audit_log (entity, entity_id);
CREATE INDEX audit_actor_time ON audit_log (actor_id, at DESC);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Search support
CREATE INDEX courses_title_trgm ON courses USING gin (title gin_trgm_ops);
CREATE INDEX problems_title_trgm ON problems USING gin (title gin_trgm_ops);

-- Tenant isolation: corporate users see only their organization's students.
-- The API sets app.org_id per request; superadmin/ops connections bypass via a separate role.
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE POLICY students_tenant ON students
  USING (current_setting('app.org_id', true) IS NULL
         OR current_setting('app.org_id', true) = ''
         OR org_id = current_setting('app.org_id', true));

COMMIT;
