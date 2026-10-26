// Hash router with parameter matching and permission guards.
export function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: path || '/', query };
}

export function compile(routes) {
  return routes.map((r) => {
    const keys = [];
    const re = new RegExp('^' + r.path.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    return { ...r, re, keys };
  });
}

export function match(compiled, path) {
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export const nav = (path) => { const target = path.startsWith('#') ? path : `#${path}`; if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = target; };
