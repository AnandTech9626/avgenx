// Excel account register: an administrator-only export of account metadata for audit.
// It deliberately contains no passwords, hashes, session tokens, reset or invitation tokens.
import ExcelJS from 'exceljs';
import { publicAccount, roleLabel } from './auth.mjs';

export const REGISTER_COLUMNS = [
  { header: 'User ID', key: 'userId', width: 16 },
  { header: 'Name', key: 'name', width: 26 },
  { header: 'Email', key: 'email', width: 32 },
  { header: 'Assigned roles', key: 'roles', width: 34 },
  { header: 'Status', key: 'status', width: 10 },
  { header: 'Password change pending', key: 'mustChange', width: 14 },
  { header: 'Invitation pending', key: 'invited', width: 12 },
  { header: 'Development test account', key: 'isTest', width: 14 },
  { header: 'Linked LMS profile', key: 'lmsRef', width: 14 },
  { header: 'Created (UTC)', key: 'createdAt', width: 20 },
  { header: 'Created by', key: 'createdBy', width: 14 },
  { header: 'Last sign-in (UTC)', key: 'lastLoginAt', width: 20 },
];

const utc = (s) => (s ? s.replace('T', ' ').slice(0, 19) : '');

export async function buildRegister(db, { exportedBy }) {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map((a) => publicAccount(db, a));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AVGENX Academy'; wb.created = new Date();
  const ws = wb.addWorksheet('Accounts', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = REGISTER_COLUMNS;
  for (const a of accounts) ws.addRow({ userId: a.userId, name: a.name, email: a.email, roles: a.roles.map(roleLabel).join(', '), status: a.status, mustChange: a.mustChangePassword ? 'Yes' : 'No', invited: a.invited ? 'Yes' : 'No', isTest: a.isTest ? 'Yes' : 'No', lmsRef: a.lmsRef || '', createdAt: utc(a.createdAt), createdBy: a.createdBy || '', lastLoginAt: utc(a.lastLoginAt) });
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14213D' } };
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + REGISTER_COLUMNS.length)}1` };

  const roles = wb.addWorksheet('Role assignments');
  roles.columns = [{ header: 'User ID', key: 'u', width: 16 }, { header: 'Role', key: 'r', width: 30 }, { header: 'Granted by', key: 'g', width: 14 }, { header: 'Granted (UTC)', key: 't', width: 20 }];
  for (const r of db.prepare('SELECT a.user_id u, r.role, g.user_id g, r.granted_at t FROM account_roles r JOIN accounts a ON a.id = r.account_id LEFT JOIN accounts g ON g.id = r.granted_by ORDER BY a.user_id').all()) roles.addRow({ u: r.u, r: roleLabel(r.role), g: r.g || '', t: utc(r.t) });
  roles.getRow(1).font = { bold: true };

  const about = wb.addWorksheet('About');
  about.columns = [{ width: 110 }];
  [
    'AVGENX Academy account register',
    `Exported ${utc(new Date().toISOString())} UTC by ${exportedBy}.`,
    'This workbook is a read-only report for administration and audit. Sign-in is verified against the server database, never against this file.',
    'It contains no passwords, password hashes, session tokens, one-time codes, reset links or invitation links.',
    'Handle it as confidential personal data and delete copies you no longer need.',
  ].forEach((t, i) => { const row = about.addRow([t]); if (!i) row.font = { bold: true, size: 13 }; });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count: accounts.length };
}
