// Build: bundle the ES-module source with esbuild and emit
//   dist/login.html     sign-in page served by the AVGENX server to anyone without a session
//   dist/app.html       the LMS, served by the server only after a verified sign-in
//   dist/pages.json     Content Security Policy for each served page (read by the server)
//   dist/preview.html   static preview: sample data, no server, role chosen on a preview screen
//   dist/artifact.html  body-only copy of the preview for publishing as a Claude artifact
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const dev = process.argv.includes('--dev');

// `import css from './x.css?text'` gives the stylesheet as a string (used for the preview's
// shadow-DOM sign-in screen, so its styles and the LMS styles cannot collide).
const textCss = {
  name: 'css-text',
  setup(b) {
    b.onResolve({ filter: /\.css\?text$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace('?text', '')), namespace: 'css-text' }));
    b.onLoad({ filter: /.*/, namespace: 'css-text' }, async (a) => {
      const r = await build({ entryPoints: [a.path], bundle: true, minify: !dev, write: false, logLevel: 'silent' });
      return { contents: r.outputFiles[0].text, loader: 'text' };
    });
  },
};

async function bundle(entry, preview) {
  const res = await build({
    entryPoints: [entry], bundle: true, format: 'iife', target: ['es2020'], minify: !dev, write: false, outdir: 'dist/tmp',
    loader: { '.css': 'css' }, legalComments: 'none', sourcemap: false, logLevel: 'warning', plugins: [textCss],
    define: { __PREVIEW__: String(preview) },
  });
  return {
    js: res.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script'),
    css: res.outputFiles.find((f) => f.path.endsWith('.css'))?.text.replace(/<\/style/gi, '<\\/style') || '',
  };
}

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&family=Instrument+Serif:ital@1&family=JetBrains+Mono:wght@500;700&display=swap">';
const APP_BODY = `<div id="app"><noscript><p style="padding:24px">AVGENX Academy needs JavaScript enabled.</p></noscript></div>
<div id="toasts" class="toast-host" aria-live="polite"></div>
<div id="modal" class="modal-host" hidden></div>
<div id="drawer" class="drawer-host" hidden></div>
<div id="palette" class="palette-host" hidden></div>`;
const SAFE_AREA = ':root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}';
const doc = ({ title, description, css, js, body }) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<title>${title}</title>\n<meta name="description" content="${description}">\n<meta name="robots" content="noindex">\n${FONTS}\n<style>${SAFE_AREA}</style>\n<style>${css}</style>\n</head>\n<body>\n${body}\n<script>${js}</script>\n</body>\n</html>\n`;

// Content Security Policy. The one inline script is allowed by its hash, so injected scripts and
// inline handlers cannot run. Deliberate relaxations (docs/SECURITY.md): the LMS needs
// 'unsafe-eval' because the coding lab compiles learner JavaScript in a blob Web Worker, which
// inherits this policy; styles allow 'unsafe-inline' because views set computed widths.
const sha = (t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`;
const csp = (js, { lab }) => [
  "default-src 'none'",
  `script-src ${sha(js)}${lab ? " 'unsafe-eval'" : ''}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  ...(lab ? ['worker-src blob:'] : []),
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
].join('; ');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const [app, login, preview] = await Promise.all([bundle('src/main.js', false), bundle('src/login/main.js', false), bundle('src/main.js', true)]);
const out = {
  'app.html': doc({ title: 'AVGENX Academy', description: 'AVGENX Academy learning platform.', ...app, body: APP_BODY }),
  'login.html': doc({ title: 'Sign in · AVGENX Academy', description: 'Sign in to AVGENX Academy.', ...login, body: '<div id="app"><noscript><p style="padding:24px;color:#fff">AVGENX Academy needs JavaScript enabled to sign in.</p></noscript></div>' }),
  'preview.html': doc({ title: 'AVGENX Academy (preview)', description: 'Preview of AVGENX Academy with sample data. No real accounts.', ...preview, body: APP_BODY }),
};
for (const [f, html] of Object.entries(out)) writeFileSync(`dist/${f}`, html);
writeFileSync('dist/artifact.html', `<title>AVGENX Academy (preview)</title>\n<meta name="description" content="Preview of AVGENX Academy with sample data. No real accounts.">\n<meta name="claude:viewport-fit-sides" content="cover">\n${FONTS}\n<style>${preview.css}</style>\n${APP_BODY}\n<script>${preview.js}</script>\n`);
writeFileSync('dist/pages.json', JSON.stringify({ app: { csp: csp(app.js, { lab: true }) }, login: { csp: csp(login.js, { lab: false }) } }, null, 2));

const kb = (f) => `${Math.round(readFileSync(`dist/${f}`).length / 1024)} KB`;
console.log(['login.html', 'app.html', 'preview.html', 'artifact.html'].map((f) => `dist/${f.padEnd(14)} ${kb(f)}`).join('\n'));
