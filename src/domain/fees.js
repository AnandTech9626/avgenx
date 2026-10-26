// Fees: installment plans, scholarships, offline payment recording, refunds, collections.
// Online card/UPI collection requires a payment provider; this module never marks a gateway
// payment as successful without a provider confirmation reference.
import { iso, addDays } from '../core/util.js';

export const OFFLINE_MODES = ['UPI (offline reference)', 'NEFT', 'IMPS', 'Cheque', 'Cash at counter'];

export function invoiceStatus(inv, now) {
  const today = iso(now);
  const paid = inv.installments.filter((i) => i.paidAt).reduce((a, i) => a + i.amount, 0);
  const overdue = inv.installments.filter((i) => !i.paidAt && i.due < today);
  const next = inv.installments.find((i) => !i.paidAt) || null;
  const refunded = (inv.refunded || 0);
  return { paid, refunded, outstanding: inv.total - paid, overdueAmt: overdue.reduce((a, i) => a + i.amount, 0), overdueCount: overdue.length, next, status: paid >= inv.total ? 'paid' : overdue.length ? 'overdue' : paid > 0 ? 'partial' : 'due' };
}

export function recordPayment(inv, n, { ref, mode, date }, now = new Date()) {
  const inst = inv.installments.find((i) => i.n === Number(n));
  if (!inst) throw new Error('Installment not found.');
  if (inst.paidAt) throw new Error('This installment is already paid.');
  if (!OFFLINE_MODES.includes(mode)) throw new Error('Card and online payments must come from the payment provider, not manual entry.');
  if (!/^[A-Za-z0-9-]{6,30}$/.test(String(ref || '').trim())) throw new Error('Enter the bank or UPI reference (6 to 30 letters, digits or dashes).');
  const d = date || iso(now);
  if (d > iso(now)) throw new Error('Payment date cannot be in the future.');
  Object.assign(inst, { paidAt: d, ref: ref.trim(), mode, recordedAt: new Date(now).toISOString() });
  return inst;
}

/** Re-price unpaid installments after a scholarship or discount change. */
export function applyAdjustment(inv, { scholarshipPct = inv.scholarshipPct, discountPct = inv.discountPct || 0 }) {
  const s = Number(scholarshipPct), d = Number(discountPct);
  if (!(s >= 0 && s <= 100 && d >= 0 && d <= 50)) throw new Error('Scholarship 0 to 100%, discount 0 to 50%.');
  const total = Math.round(inv.list * (1 - s / 100) * (1 - d / 100));
  const paid = inv.installments.filter((i) => i.paidAt).reduce((a, i) => a + i.amount, 0);
  if (paid > total) throw new Error(`Already paid ${paid}, more than the new total ${total}. Raise a refund instead.`);
  const unpaid = inv.installments.filter((i) => !i.paidAt);
  const remaining = total - paid;
  const base = unpaid.reduce((a, i) => a + i.amount, 0) || unpaid.length;
  let acc = 0;
  unpaid.forEach((i, k) => { i.amount = k === unpaid.length - 1 ? remaining - acc : Math.round((remaining * (i.amount || 1)) / base); acc += k === unpaid.length - 1 ? 0 : i.amount; });
  Object.assign(inv, { scholarshipPct: s, discountPct: d, total });
  return inv;
}

export function requestRefund(state, studentId, amount, reason, now = new Date()) {
  const inv = state.invoices.find((i) => i.studentId === studentId);
  if (!inv) throw new Error('No invoice for this learner.');
  const st = invoiceStatus(inv, now);
  const pending = state.refunds.filter((r) => r.studentId === studentId && r.status !== 'rejected').reduce((a, r) => a + r.amount, 0);
  if (!(amount > 0)) throw new Error('Refund amount must be more than zero.');
  if (amount + pending > st.paid) throw new Error(`Refunds cannot exceed the amount paid (${st.paid}); ${pending} is already requested or refunded.`);
  if (String(reason || '').trim().length < 8) throw new Error('Give a reason (at least 8 characters).');
  const r = { id: `RF-${state.refunds.length + 1}-${Date.now().toString(36)}`, studentId, amount: Math.round(amount), reason: reason.trim(), status: 'requested', at: new Date(now).toISOString() };
  state.refunds.push(r);
  return r;
}
export function decideRefund(state, id, approve, by, now = new Date()) {
  const r = state.refunds.find((x) => x.id === id);
  if (!r || r.status !== 'requested') throw new Error('Only requested refunds can be decided.');
  Object.assign(r, { status: approve ? 'approved' : 'rejected', decidedBy: by, decidedAt: new Date(now).toISOString(), payout: approve ? 'Payout pending: requires payment provider or bank transfer' : null });
  if (approve) { const inv = state.invoices.find((i) => i.studentId === r.studentId); if (inv) inv.refunded = (inv.refunded || 0) + r.amount; }
  return r;
}

/** Monthly net collections for the last n months (₹), oldest first. */
export function collectionsByMonth(state, months, now) {
  const out = [];
  const d = new Date(now);
  for (let k = months - 1; k >= 0; k--) {
    const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: m.toLocaleDateString('en-GB', { month: 'short' }), collected: 0, refunds: 0 });
  }
  const byKey = Object.fromEntries(out.map((o) => [o.key, o]));
  state.invoices.forEach((inv) => inv.installments.forEach((i) => { if (i.paidAt && byKey[i.paidAt.slice(0, 7)]) byKey[i.paidAt.slice(0, 7)].collected += i.amount; }));
  state.refunds.filter((r) => r.status === 'approved').forEach((r) => { const k = (r.decidedAt || r.at).slice(0, 7); if (byKey[k]) byKey[k].refunds += r.amount; });
  return out.map((o) => ({ ...o, net: o.collected - o.refunds }));
}

export function newInvoice(student, cohort, scholarshipPct = 0, now = new Date()) {
  const total = Math.round(cohort.fee * (1 - scholarshipPct / 100));
  const span = Math.floor((cohort.weeks * 7) / 3);
  return { id: `INV-${student.id}`, studentId: student.id, cohortId: cohort.id, list: cohort.fee, scholarshipPct, discountPct: 0, total, installments: [0.4, 0.3, 0.3].map((f, k) => ({ n: k + 1, due: iso(addDays(now, 7 + k * span)), amount: k === 2 ? total - Math.round(total * 0.4) - Math.round(total * 0.3) : Math.round(total * f), paidAt: null, ref: null, mode: null })) };
}
