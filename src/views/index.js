// Route table. Each route maps a path pattern to a view module; guards come from the view's
// `perms` (any of) and optional feature `flag`. Order matters: specific paths first.
import dashboard from './dashboard.js';
import { catalog, domain, course, paths } from './programs.js';
import player from './player.js';
import lab from './lab.js';
import arena from './arena.js';
import { list as assessList, detail as assessDetail, take as assessTake, result as assessResult, grade as assessGrade } from './assessments.js';
import { projectsList, projectDetail } from './projects.js';
import { certificates, verify } from './certificates.js';
import { placement, jobs, interview, portfolio, publicPortfolio } from './career.js';
import { live, mentors, discussions, thread, groups } from './community.js';
import { notifications, preferences } from './notifications.js';
import { students, studentProfile, admissions, cohorts, faculty, attendance, fees, placements, teaching } from './ops.js';
import { courseList, courseEditor } from './builder.js';
import { exec, reports, risk } from './exec.js';
import { myOrg, orgs, orgDetail } from './corporate.js';
import { users, permissions, audit, integrations, settings } from './admin.js';
import { accounts } from './accounts.js';

const R = (path, view, label, extra = {}) => ({ path, view, label, ...extra });
export const ROUTES = [
  R('/dashboard', dashboard, 'Dashboard'),
  R('/programs', catalog, 'Explore Programs'),
  R('/programs/:domain', domain, 'Domain'),
  R('/course/:id', course, 'Course'),
  R('/course/:id/learn/:lesson', player, 'Lesson'),
  R('/paths', paths, 'My Learning Paths'),
  R('/lab', lab, 'Coding Lab', { flag: 'codeExecution' }),
  R('/lab/:problem', lab, 'Coding Lab', { flag: 'codeExecution' }),
  R('/arena', arena, 'Practice Arena'),
  R('/assessments', assessList, 'Assessments'),
  R('/assessments/take/:attempt', assessTake, 'Assessment attempt'),
  R('/assessments/result/:attempt', assessResult, 'Assessment result'),
  R('/assessments/grade/:attempt', assessGrade, 'Grading'),
  R('/assessments/:id', assessDetail, 'Assessment'),
  R('/projects', projectsList, 'Projects'),
  R('/projects/:id', projectDetail, 'Project'),
  R('/certificates', certificates, 'Certificates'),
  R('/verify', verify, 'Verify a certificate'),
  R('/verify/:id', verify, 'Verify a certificate'),
  R('/interview', interview, 'Interview Preparation', { flag: 'placement' }),
  R('/placement', placement, 'Placement Center', { flag: 'placement' }),
  R('/jobs', jobs, 'Jobs and Internships', { flag: 'placement' }),
  R('/portfolio', portfolio, 'Portfolio'),
  R('/p/:slug', publicPortfolio, 'Portfolio'),
  R('/live', live, 'Live Classes'),
  R('/mentors', mentors, 'Mentors'),
  R('/discussions', discussions, 'Discussions', { flag: 'community' }),
  R('/discussions/:id', thread, 'Discussion', { flag: 'community' }),
  R('/groups', groups, 'Study Groups', { flag: 'community' }),
  R('/notifications', notifications, 'Notifications'),
  R('/me', preferences, 'Preferences'),
  R('/ops/teaching', teaching, 'Instructor Center'),
  R('/ops/students', students, 'Students'),
  R('/ops/students/:id', studentProfile, 'Student'),
  R('/ops/admissions', admissions, 'Admissions'),
  R('/ops/courses', courseList, 'Courses'),
  R('/ops/courses/:id', courseEditor, 'Course builder'),
  R('/ops/faculty', faculty, 'Faculty'),
  R('/ops/cohorts', cohorts, 'Cohorts'),
  R('/ops/attendance', attendance, 'Attendance'),
  R('/ops/fees', fees, 'Fees'),
  R('/ops/placements', placements, 'Placements', { flag: 'placement' }),
  R('/ops/risk', risk, 'At-risk Learners'),
  R('/admin/exec', exec, 'Executive Analytics'),
  R('/admin/reports', reports, 'Reports'),
  R('/corporate', myOrg, 'My Organization', { flag: 'corporate' }),
  R('/admin/orgs', orgs, 'Organizations', { flag: 'corporate' }),
  R('/admin/orgs/:id', orgDetail, 'Organization', { flag: 'corporate' }),
  R('/admin/accounts', accounts, 'Accounts and sign-in'),
  R('/admin/users', users, 'People directory'),
  R('/admin/permissions', permissions, 'Permissions'),
  R('/admin/audit', audit, 'Audit Logs'),
  R('/admin/integrations', integrations, 'Integrations'),
  R('/admin/settings', settings, 'System Settings'),
];
