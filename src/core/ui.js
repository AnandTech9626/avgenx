// Presentation components: pure functions returning escaped HTML strings.
// Interactions are wired by data-act / data-form / data-change attributes (see core/events.js).
import { esc, initials, fmtShort, fmtDate } from './util.js';
import { icon } from './icons.js';
import { DOMAINS } from '../data/catalog.js';

export const h = esc;
export const attrs = (o = {}) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`)).join(' ');

export const pill = (text, cls = 'p-mute', plain = false) => `<span class="pill ${cls}${plain ? ' plain' : ''}">${esc(text)}</span>`;
export const tag = (t) => `<span class="tag">${esc(t)}</span>`;
export const domainOf = (id) => DOMAINS.find((d) => d.id === id);
export const domainVar = (id) => `--cat:var(${domainOf(id)?.color || '--accent'})`;
export const avatar = (name, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${esc(initials(name))}</span>`;
export const bar = (pct, cls = '', label = 'Progress') => `<div class="bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${esc(label)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
export const ring = (pct, label = `${Math.round(pct)}`, size = 72, c = 'var(--accent)') => `<div class="ring" style="--p:${Math.max(0, Math.min(100, pct))};--size:${size}px;--c:${c}" role="img" aria-label="${esc(label)}"><span>${esc(label)}</span></div>`;
export const dateChip = (d) => `<div class="date-chip" aria-hidden="true"><b>${new Date(d).getDate()}</b><span>${esc(fmtShort(d).split(' ')[1] || '')}</span></div>`;
export const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

export function btn(label, { act, cls = 'btn-ghost', ic, attrs: a = {}, href, sm, disabled, title, type = 'button' } = {}) {
  const c = `btn ${cls}${sm ? ' btn-sm' : ''}`;
  const inner = `${ic ? icon(ic) : ''}${label ? `<span>${esc(label)}</span>` : ''}`;
  if (href) return `<a class="${c}" href="#${esc(href)}" ${attrs(a)} ${title ? `title="${esc(title)}"` : ''}>${inner}</a>`;
  return `<button type="${type}" class="${c}" ${act ? `data-act="${esc(act)}"` : ''} ${attrs(a)} ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}" aria-label="${esc(title)}"` : ''}>${inner}</button>`;
}

export function empty(title, text = '', { ic = 'inbox', action = '' } = {}) {
  return `<div class="empty">${icon(ic)}<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}${action}</div>`;
}

export function kpi({ label, value, foot = '', delta = null, alert = false, act = null, a = {} }) {
  const d = delta === null || delta === undefined || !Number.isFinite(delta) ? '' : `<span class="delta ${delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat'}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${Math.abs(delta).toFixed(0)}%</span>`;
  const tagName = act ? 'button' : 'div';
  return `<${tagName} class="kpi${alert ? ' alert' : ''}" ${act ? `type="button" data-act="${esc(act)}"` : ''} ${attrs(a)}><span class="k-label">${esc(label)}</span><span class="k-value">${value}</span><span class="k-foot">${d}${foot}</span></${tagName}>`;
}

export function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([label, href], i) => (href && i < items.length - 1 ? `<a href="#${esc(href)}">${esc(label)}</a>` : `<span ${i === items.length - 1 ? 'aria-current="page"' : ''}>${esc(label)}</span>`)).join('<span aria-hidden="true">/</span>')}</nav>`;
}

export function pageHead({ title, lede = '', eyebrow = '', crumb = null, actions = '' }) {
  return `<header class="page-head"><div class="min0">${crumb ? crumbs(crumb) : ''}${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1 id="page-title">${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</header>`;
}

export function tabs(items, current, act, { label = 'Sections' } = {}) {
  return `<div class="tabs" role="tablist" aria-label="${esc(label)}">${items.map(([id, text, count]) => `<button type="button" role="tab" aria-selected="${id === current}" data-act="${esc(act)}" data-id="${esc(id)}">${esc(text)}${count !== undefined && count !== null ? ` <span class="count">${esc(count)}</span>` : ''}</button>`).join('')}</div>`;
}

export function chips(items, current, act, { label = 'Filter', multi = false } = {}) {
  return `<div class="chips" role="group" aria-label="${esc(label)}">${items.map(([id, text]) => `<button type="button" class="chip" aria-pressed="${multi ? current.includes(id) : id === current}" data-act="${esc(act)}" data-id="${esc(id)}">${esc(text)}</button>`).join('')}</div>`;
}

export function seg(items, current, act, label = 'View') {
  return `<div class="btn-group" role="group" aria-label="${esc(label)}">${items.map(([id, text]) => `<button type="button" aria-pressed="${id === current}" data-act="${esc(act)}" data-id="${esc(id)}">${esc(text)}</button>`).join('')}</div>`;
}

// ---------------- forms ----------------
const fid = (id) => esc(id);
const errAttr = (error, id) => (error ? `aria-invalid="true" aria-describedby="${fid(id)}-err"` : '');
const errLine = (error, id) => (error ? `<span class="error-text" id="${fid(id)}-err" role="alert">${esc(error)}</span>` : '');
export function input({ id, label, value = '', type = 'text', req = false, error = '', hint = '', a = {}, cls = '' }) {
  return `<div class="field ${cls}"><label for="${fid(id)}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label><input class="input" id="${fid(id)}" name="${fid(id)}" type="${type}" value="${esc(value)}" ${req ? 'required aria-required="true"' : ''} ${errAttr(error, id)} ${attrs(a)}>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}${errLine(error, id)}</div>`;
}
export function textarea({ id, label, value = '', req = false, error = '', hint = '', rows = 3, a = {}, cls = '' }) {
  return `<div class="field ${cls}"><label for="${fid(id)}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label><textarea class="textarea" id="${fid(id)}" name="${fid(id)}" rows="${rows}" ${req ? 'required aria-required="true"' : ''} ${errAttr(error, id)} ${attrs(a)}>${esc(value)}</textarea>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}${errLine(error, id)}</div>`;
}
export function select({ id, label, value = '', options = [], req = false, error = '', hint = '', a = {}, cls = '', sm = false }) {
  const opts = options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
  return `<div class="field ${cls}">${label ? `<label for="${fid(id)}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>` : ''}<select class="select${sm ? ' sm' : ''}" id="${fid(id)}" name="${fid(id)}" ${label ? '' : `aria-label="${esc(a['aria-label'] || id)}"`} ${req ? 'required' : ''} ${errAttr(error, id)} ${attrs(a)}>${opts}</select>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}${errLine(error, id)}</div>`;
}
export const check = ({ id, label, checked = false, a = {} }) => `<label class="check" for="${fid(id)}"><input type="checkbox" id="${fid(id)}" name="${fid(id)}" ${checked ? 'checked' : ''} ${attrs(a)}><span>${label}</span></label>`;
export const toggle = ({ id, label, checked = false, a = {} }) => `<label class="switch" for="${fid(id)}"><input type="checkbox" role="switch" id="${fid(id)}" name="${fid(id)}" ${checked ? 'checked' : ''} ${attrs(a)}><span>${esc(label)}</span></label>`;
export function searchBox({ id, value = '', placeholder = 'Search', a = {} }) {
  return `<div class="search-input">${icon('search')}<label class="sr-only" for="${fid(id)}">${esc(placeholder)}</label><input class="input" type="search" id="${fid(id)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${attrs(a)}></div>`;
}

// ---------------- data table ----------------
/**
 * cols: [{ key, label, r (right align), sort (fn), render (row => html) }]
 * opts: { sortKey, sortDir, sortAct, page, pageSize, pageAct, rowAct, rowId, empty, wide, caption }
 */
export function table(cols, rows, o = {}) {
  let list = rows;
  if (o.sortKey) {
    const col = cols.find((c) => c.key === o.sortKey);
    if (col?.sort) { const m = o.sortDir === 'desc' ? -1 : 1; list = rows.slice().sort((a, b) => { const x = col.sort(a), y = col.sort(b); return x < y ? -m : x > y ? m : 0; }); }
  }
  const total = list.length;
  const size = o.pageSize || 0;
  const pages = size ? Math.max(1, Math.ceil(total / size)) : 1;
  const page = Math.min(Math.max(1, o.page || 1), pages);
  if (size) list = list.slice((page - 1) * size, page * size);
  const th = cols.map((c) => {
    const cls = c.r ? 'r' : c.c ? 'c' : '';
    if (c.sort && o.sortAct) { const s = o.sortKey === c.key ? (o.sortDir === 'desc' ? 'descending' : 'ascending') : 'none'; return `<th class="${cls}" scope="col" aria-sort="${s}"><button type="button" data-act="${esc(o.sortAct)}" data-id="${esc(c.key)}">${esc(c.label)}</button></th>`; }
    return `<th class="${cls}" scope="col">${esc(c.label)}</th>`;
  }).join('');
  const body = list.length ? list.map((r) => `<tr ${o.rowAct ? `class="clickable" data-act="${esc(o.rowAct)}" data-id="${esc(o.rowId(r))}" tabindex="0"` : ''}>${cols.map((c) => `<td class="${c.r ? 'r' : c.c ? 'c' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}"><div style="padding:18px 0;text-align:center" class="muted">${esc(o.empty || 'No records match.')}</div></td></tr>`;
  const pager = size && total > size ? `<div class="pager"><span>${(page - 1) * size + 1} to ${Math.min(page * size, total)} of ${total}</span><div class="row">${btn('Previous', { act: o.pageAct, sm: true, disabled: page <= 1, attrs: { 'data-id': page - 1 } })}<span class="mono">${page} / ${pages}</span>${btn('Next', { act: o.pageAct, sm: true, disabled: page >= pages, attrs: { 'data-id': page + 1 } })}</div></div>` : '';
  return `<div class="tbl-wrap"><table class="tbl${o.wide ? ' wide' : ''}">${o.caption ? `<caption class="sr-only">${esc(o.caption)}</caption>` : ''}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>${pager}`;
}

// ---------------- covers ----------------
export function cover(course, { corner = '', big = true } = {}) {
  const d = domainOf(course.domain);
  return `<div class="cover" style="${domainVar(course.domain)}"><span class="code">${esc(course.id)} · ${esc(d.short)}</span>${corner ? `<span class="corner">${corner}</span>` : ''}${big ? `<span class="big">${esc(course.id.replace(/\D+/g, ''))}</span>` : ''}</div>`;
}
export const swatch = (course) => `<span class="swatch" style="${domainVar(course.domain)}" aria-hidden="true">${esc(course.id.replace(/\d+/g, ''))}</span>`;

// ---------------- charts (inline SVG, theme-aware via CSS classes) ----------------
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
export function lineChart({ series, labels, height = 180, yFmt = (v) => v, title = 'Chart', area = true, every = 1 }) {
  const W = 640, H = height, L = 44, Rr = 14, T = 14, B = 26;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const x = (i) => L + (n <= 1 ? 0 : (i * (W - L - Rr)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const grid = ticks.map((t) => `<line class="grid-line" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${esc(yFmt(t))}</text>`).join('');
  const xl = labels.map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>` : '')).join('');
  const paths = series.map((s, si) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
    const line = `<path class="series-${si + 1}" d="M${pts.join('L')}"/>`;
    const ar = area && si === 0 ? `<path class="area-1" d="M${x(0)},${y(0)}L${pts.join('L')}L${x(n - 1)},${y(0)}Z"/>` : '';
    const end = si === 0 ? `<circle class="dot-end" cx="${x(n - 1)}" cy="${y(s.values[n - 1])}" r="4"/><text class="val" x="${x(n - 1) - 6}" y="${y(s.values[n - 1]) - 9}" text-anchor="end">${esc(yFmt(s.values[n - 1]))}</text>` : '';
    return ar + line + end;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}<line class="axis-line" x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}"/>${paths}${xl}</svg>`;
}
export function barChart({ values, labels, height = 180, yFmt = (v) => v, title = 'Chart', hl = -1, cls = 'bar-1', showVals = true }) {
  const W = 640, H = height, L = 44, Rr = 10, T = 18, B = 26;
  const max = niceMax(Math.max(1, ...values));
  const n = values.length, bw = (W - L - Rr) / n;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => max * f);
  const grid = ticks.map((t) => `<line class="grid-line" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${esc(yFmt(t))}</text>`).join('');
  const bars = values.map((v, i) => `<rect class="${i === hl ? 'bar-hl' : cls}" x="${L + i * bw + bw * 0.18}" y="${y(v)}" width="${bw * 0.64}" height="${Math.max(0, y(0) - y(v))}" rx="3"><title>${esc(labels[i])}: ${esc(yFmt(v))}</title></rect>${showVals && v ? `<text class="val" x="${L + i * bw + bw / 2}" y="${y(v) - 5}" text-anchor="middle">${esc(yFmt(v))}</text>` : ''}<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(labels[i])}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${bars}</svg>`;
}
/** rows: [{ label, value, max?, color?, display?, act?, id? }] */
export function hbars(rows, { max = null, fmt = (v) => v, act = null } = {}) {
  const m = max || Math.max(1, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows.map((r) => { const tagName = act ? 'button' : 'div'; return `<${tagName} class="hbar" ${act ? `type="button" data-act="${esc(act)}" data-id="${esc(r.id)}"` : ''}><span class="hb-lab" title="${esc(r.label)}">${esc(r.label)}</span><span class="tr"><i style="width:${Math.max(0, Math.min(100, (r.value / (r.max || m)) * 100))}%;background:${r.color || 'var(--s1)'}"></i></span><span class="v">${esc(r.display ?? fmt(r.value))}</span></${tagName}>`; }).join('')}</div>`;
}
export function spark(values, label = 'Trend') {
  const W = 120, H = 36, n = values.length, max = Math.max(1, ...values);
  const x = (i) => (n <= 1 ? 0 : (i * (W - 4)) / (n - 1)) + 2, y = (v) => H - 3 - (v / max) * (H - 8);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join('L');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><path class="a" d="M${x(0)},${H}L${pts}L${x(n - 1)},${H}Z"/><path class="l" d="M${pts}"/><circle cx="${x(n - 1)}" cy="${y(values[n - 1] || 0)}" r="2.5"/></svg>`;
}
export function heatmap(daily, { cols = 26, label = 'Activity' } = {}) {
  const max = Math.max(1, ...daily.map((d) => d.mins));
  const lvl = (m) => (m <= 0 ? 0 : m < max * 0.25 ? 1 : m < max * 0.5 ? 2 : m < max * 0.8 ? 3 : 4);
  return `<div class="heat" style="--cols:${cols}" role="img" aria-label="${esc(label)}">${daily.map((d) => `<i data-l="${lvl(d.mins)}" title="${esc(fmtDate(d.date))}: ${d.mins} min"></i>`).join('')}</div>`;
}

export function stepper(steps, current, { bad = -1 } = {}) {
  return `<div class="stepper" role="list" tabindex="0" aria-label="Workflow progress: step ${current + 1} of ${steps.length}">${steps.map((s, i) => `<div role="listitem" class="${i < current ? 'done' : i === current ? 'now' : ''}${i === bad ? ' bad' : ''}">${esc(s)}</div>`).join('')}</div>`;
}

export function timeline(items) {
  return `<ol class="timeline">${items.map((it) => `<li class="${it.cls || 'done'}"><span class="dot">${it.cls === 'fail' ? icon('x') : it.cls === 'now' || it.cls === 'todo' ? '' : icon('check')}</span><div class="min0"><b>${esc(it.title)}</b><span class="s">${it.sub || ''}</span></div></li>`).join('')}</ol>`;
}

export function denied(what = 'this page') {
  return `<div class="denied"><div class="lock">${icon('lock')}</div><h2>You do not have access to ${esc(what)}</h2><p class="muted">Your current role does not include the permission this page needs. Switch role in the sidebar to explore it in the demo. In production this check is enforced by the server, not only hidden in the interface.</p></div>`;
}
export const demoNote = (text) => `<div class="callout info small">${icon('info', 'style="width:14px;height:14px;vertical-align:-2px"')} ${text}</div>`;
