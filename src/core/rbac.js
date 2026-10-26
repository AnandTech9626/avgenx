// Role and permission model. The frontend uses this for navigation, route guards and
// data scoping in demo mode. In production the same matrix must be enforced server-side
// (see docs/API.md: every endpoint lists the permission it requires).

export const ROLES = [
  { id: 'superadmin', label: 'Super Administrator', short: 'Super admin', home: '/admin/settings' },
  { id: 'ceo', label: 'CEO / Executive Director', short: 'CEO', home: '/admin/exec' },
  { id: 'admin', label: 'Institute Administrator', short: 'Institute admin', home: '/ops/students' },
  { id: 'director', label: 'Academic Director', short: 'Academic director', home: '/ops/courses' },
  { id: 'pm', label: 'Program Manager', short: 'Program manager', home: '/ops/cohorts' },
  { id: 'instructor', label: 'Instructor', short: 'Instructor', home: '/ops/teaching' },
  { id: 'mentor', label: 'Mentor', short: 'Mentor', home: '/mentors' },
  { id: 'ta', label: 'Teaching Assistant', short: 'Teaching assistant', home: '/ops/teaching' },
  { id: 'placement', label: 'Placement Officer', short: 'Placement officer', home: '/ops/placements' },
  { id: 'student', label: 'Student', short: 'Student', home: '/dashboard' },
  { id: 'corporate', label: 'Corporate Training Client', short: 'Corporate client', home: '/corporate' },
];
export const roleById = Object.fromEntries(ROLES.map((r) => [r.id, r]));

const STAFF = ['superadmin', 'ceo', 'admin', 'director', 'pm', 'instructor', 'mentor', 'ta', 'placement'];
const ACADEMIC = ['superadmin', 'admin', 'director', 'pm', 'instructor', 'mentor', 'ta'];

/** permission -> roles that hold it by default */
export const PERMISSIONS = {
  'learn.self': { label: 'Learn as a student (own enrollments, practice, submissions)', roles: ['student'] },
  'dashboard.any': { label: 'Open any learner dashboard in scope', roles: ['superadmin', 'admin', 'director', 'pm', 'instructor', 'mentor', 'ta', 'placement'] },
  'programs.view': { label: 'Browse programs and courses', roles: [...STAFF, 'student', 'corporate'] },
  'lab.use': { label: 'Use the coding lab', roles: ['student', 'instructor', 'mentor', 'ta', 'superadmin', 'director'] },
  'arena.use': { label: 'Use the practice arena', roles: ['student', 'instructor', 'mentor', 'ta', 'superadmin', 'director', 'placement'] },
  'problems.manage': { label: 'Create and publish coding problems', roles: ['instructor', 'director', 'superadmin'] },
  'projects.submit': { label: 'Submit projects and assignments', roles: ['student'] },
  'projects.review': { label: 'Review projects, request revisions, approve', roles: ['instructor', 'mentor', 'ta', 'director', 'superadmin'] },
  'projects.manage': { label: 'Create and publish assignments', roles: ['instructor', 'director', 'pm', 'superadmin'] },
  'assess.take': { label: 'Take assessments', roles: ['student'] },
  'assess.grade': { label: 'Grade manual questions', roles: ['instructor', 'ta', 'director', 'superadmin'] },
  'assess.manage': { label: 'Configure assessments and question banks', roles: ['instructor', 'director', 'superadmin'] },
  'certs.own': { label: 'View own certificates', roles: ['student'] },
  'certs.manage': { label: 'Issue and revoke certificates', roles: ['admin', 'director', 'superadmin'] },
  'career.self': { label: 'Career profile, applications, mock interviews', roles: ['student'] },
  'placement.manage': { label: 'Manage jobs, employers and application stages', roles: ['placement', 'admin', 'superadmin'] },
  'placement.view': { label: 'View placement pipeline', roles: ['placement', 'admin', 'superadmin', 'ceo', 'director', 'pm'] },
  'live.attend': { label: 'Register for and attend live classes', roles: ['student'] },
  'live.view': { label: 'View the class schedule', roles: [...STAFF, 'student'] },
  'live.manage': { label: 'Schedule, reschedule and cancel sessions', roles: ['instructor', 'pm', 'admin', 'superadmin'] },
  'attendance.mark': { label: 'Mark attendance', roles: ['instructor', 'ta', 'pm', 'admin', 'superadmin'] },
  'mentor.request': { label: 'Request mentor help', roles: ['student'] },
  'mentor.workspace': { label: 'Mentor workspace (assigned learners, queue)', roles: ['mentor', 'director', 'superadmin'] },
  'mentor.notes': { label: 'Read and write private mentor notes', roles: ['mentor', 'director', 'superadmin'] },
  'community.post': { label: 'Post in discussions', roles: ['student', 'instructor', 'mentor', 'ta', 'director', 'pm', 'superadmin'] },
  'community.moderate': { label: 'Moderate discussions', roles: ['instructor', 'ta', 'director', 'admin', 'superadmin'] },
  'students.view': { label: 'View student records', roles: ['superadmin', 'ceo', 'admin', 'director', 'pm', 'instructor', 'mentor', 'ta', 'placement'] },
  'students.manage': { label: 'Edit students, cohorts, enrollment status', roles: ['admin', 'pm', 'superadmin'] },
  'admissions.manage': { label: 'Process applications and enrollment', roles: ['admin', 'pm', 'superadmin'] },
  'courses.view': { label: 'View the course builder', roles: ['instructor', 'director', 'pm', 'admin', 'superadmin'] },
  'courses.edit': { label: 'Create and edit course drafts', roles: ['instructor', 'director', 'pm', 'superadmin'] },
  'courses.approve': { label: 'Approve courses for publication', roles: ['director', 'superadmin'] },
  'courses.publish': { label: 'Publish, schedule and archive courses', roles: ['director', 'admin', 'superadmin'] },
  'faculty.view': { label: 'Faculty directory and workload', roles: ['superadmin', 'ceo', 'admin', 'director', 'pm'] },
  'cohorts.manage': { label: 'Manage cohorts', roles: ['pm', 'admin', 'director', 'superadmin'] },
  'cohorts.view': { label: 'View cohorts', roles: ['superadmin', 'ceo', 'admin', 'director', 'pm', 'instructor', 'mentor', 'ta', 'placement'] },
  'fees.view': { label: 'View fees and balances', roles: ['admin', 'ceo', 'superadmin'] },
  'fees.manage': { label: 'Record payments, scholarships, refunds', roles: ['admin', 'superadmin'] },
  'refunds.approve': { label: 'Approve refunds', roles: ['admin', 'superadmin'] },
  'exec.view': { label: 'Executive analytics', roles: ['ceo', 'superadmin', 'admin', 'director'] },
  'reports.view': { label: 'Operational reports and risk analytics', roles: ['ceo', 'superadmin', 'admin', 'director', 'pm', 'mentor'] },
  'risk.intervene': { label: 'Run learner interventions', roles: ['mentor', 'director', 'pm', 'superadmin'] },
  'teaching.center': { label: 'Instructor control center', roles: ['instructor', 'ta', 'director', 'superadmin'] },
  'orgs.view': { label: 'View all corporate organizations', roles: ['superadmin', 'ceo', 'admin', 'pm'] },
  'orgs.own': { label: 'Own organization workspace', roles: ['corporate'] },
  'users.manage': { label: 'People directory (LMS profiles)', roles: ['superadmin', 'admin'] },
  'accounts.manage': { label: 'Sign-in accounts: create, roles, disable, reset passwords (enforced by the server)', roles: ['superadmin', 'admin'] },
  'roles.manage': { label: 'Edit the permission matrix', roles: ['superadmin'] },
  'audit.view': { label: 'Audit and security logs', roles: ['superadmin', 'admin'] },
  'integrations.manage': { label: 'Integrations and credentials', roles: ['superadmin'] },
  'settings.manage': { label: 'System settings and feature flags', roles: ['superadmin', 'admin'] },
  'data.export': { label: 'Export data (CSV / JSON)', roles: ['superadmin', 'admin', 'ceo', 'director'] },
  'ai.use': { label: 'Use the AI learning copilot', roles: ['student', 'instructor', 'mentor', 'ta', 'director', 'superadmin'] },
};
export const PERM_IDS = Object.keys(PERMISSIONS);
// These can never be removed in the matrix editor, so nobody locks themselves out.
export const LOCKED = { superadmin: ['roles.manage', 'settings.manage', 'audit.view', 'accounts.manage'] };
// Enforced by the server from this default matrix; the in-app matrix editor cannot change them.
export const SERVER_ENFORCED = ['accounts.manage', 'ai.use'];
// Roles that only a super administrator may grant or manage.
export const PRIVILEGED_ROLES = ['superadmin', 'admin', 'ceo'];

/** Effective permission check, applying demo overrides { role: { perm: true|false } }. */
export function can(role, perm, overrides = {}) {
  const o = SERVER_ENFORCED.includes(perm) ? undefined : overrides?.[role]?.[perm];
  if (LOCKED[role]?.includes(perm)) return true;
  if (typeof o === 'boolean') return o;
  return !!PERMISSIONS[perm]?.roles.includes(role);
}
export const canAny = (role, perms, ov) => perms.some((p) => can(role, p, ov));

/** Navigation architecture. Each item names the permissions that unlock it (any of). */
export const NAV = [
  { group: 'Learn', items: [
    { path: '/dashboard', label: 'My Dashboard', icon: 'dash', perms: ['learn.self', 'dashboard.any'] },
    { path: '/programs', label: 'Explore Programs', icon: 'compass', perms: ['programs.view'] },
    { path: '/paths', label: 'My Learning Paths', icon: 'route', perms: ['learn.self'] },
    { path: '/lab', label: 'Coding Lab', icon: 'code', perms: ['lab.use'] },
    { path: '/arena', label: 'Practice Arena', icon: 'trophy', perms: ['arena.use'] },
    { path: '/projects', label: 'Projects', icon: 'folder', perms: ['projects.submit', 'projects.review'], badge: 'projects' },
    { path: '/assessments', label: 'Assessments', icon: 'exam', perms: ['assess.take', 'assess.grade', 'assess.manage'], badge: 'grading' },
    { path: '/certificates', label: 'Certificates', icon: 'cert', perms: ['certs.own', 'certs.manage'] },
  ] },
  { group: 'Career', items: [
    { path: '/interview', label: 'Interview Preparation', icon: 'mic', perms: ['career.self'] },
    { path: '/placement', label: 'Placement Center', icon: 'target', perms: ['career.self'] },
    { path: '/jobs', label: 'Jobs and Internships', icon: 'brief', perms: ['career.self', 'placement.view'] },
    { path: '/portfolio', label: 'Portfolio', icon: 'user', perms: ['career.self'] },
  ] },
  { group: 'Community', items: [
    { path: '/live', label: 'Live Classes', icon: 'video', perms: ['live.view'] },
    { path: '/mentors', label: 'Mentors', icon: 'users', perms: ['mentor.request', 'mentor.workspace'], badge: 'mentor' },
    { path: '/discussions', label: 'Discussions', icon: 'chat', perms: ['community.post', 'community.moderate'], badge: 'reports' },
    { path: '/groups', label: 'Study Groups', icon: 'group', perms: ['community.post'] },
  ] },
  { group: 'Institute Operations', items: [
    { path: '/ops/teaching', label: 'Instructor Center', icon: 'book', perms: ['teaching.center'] },
    { path: '/ops/students', label: 'Students', icon: 'users', perms: ['students.view'] },
    { path: '/ops/admissions', label: 'Admissions', icon: 'inbox', perms: ['admissions.manage'], badge: 'admissions' },
    { path: '/ops/courses', label: 'Courses', icon: 'layers', perms: ['courses.view'], badge: 'review' },
    { path: '/ops/faculty', label: 'Faculty', icon: 'user', perms: ['faculty.view'] },
    { path: '/ops/cohorts', label: 'Cohorts', icon: 'group', perms: ['cohorts.view'] },
    { path: '/ops/attendance', label: 'Attendance', icon: 'checkSq', perms: ['attendance.mark'] },
    { path: '/ops/fees', label: 'Fees', icon: 'card', perms: ['fees.view'] },
    { path: '/ops/placements', label: 'Placements', icon: 'brief', perms: ['placement.view'] },
    { path: '/ops/risk', label: 'At-risk Learners', icon: 'pulse', perms: ['reports.view'], badge: 'risk' },
  ] },
  { group: 'Administration', items: [
    { path: '/admin/exec', label: 'Executive Analytics', icon: 'chart', perms: ['exec.view'] },
    { path: '/admin/reports', label: 'Reports', icon: 'log', perms: ['reports.view'] },
    { path: '/corporate', label: 'My Organization', icon: 'building', perms: ['orgs.own'] },
    { path: '/admin/orgs', label: 'Organizations', icon: 'building', perms: ['orgs.view'] },
    { path: '/admin/accounts', label: 'Accounts and Sign-in', icon: 'key', perms: ['accounts.manage'] },
    { path: '/admin/users', label: 'People Directory', icon: 'users', perms: ['users.manage'] },
    { path: '/admin/permissions', label: 'Permissions', icon: 'key', perms: ['roles.manage', 'users.manage'] },
    { path: '/admin/audit', label: 'Audit Logs', icon: 'shield', perms: ['audit.view'] },
    { path: '/admin/integrations', label: 'Integrations', icon: 'plug', perms: ['integrations.manage', 'settings.manage'] },
    { path: '/admin/settings', label: 'System Settings', icon: 'gear', perms: ['settings.manage'] },
  ] },
];

export function navFor(role, overrides) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => canAny(role, i.perms, overrides)) })).filter((g) => g.items.length);
}
