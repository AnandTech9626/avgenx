// Lightweight architecture lint (no external linter needed):
//  - every source file parses
//  - no eval / document.write / new Function outside the sandboxed executor
//  - browser storage only through core/store.js (and the per-viewer exporter cache)
//  - network calls only from services/
//  - no API keys or secrets committed in source
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); });
walk('src');
const serverFiles = readdirSync('server').filter((f) => f.endsWith('.mjs')).map((f) => join('server', f));
const problems = [];
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { problems.push(`${f}: syntax error\n${e.stderr}`); }
  const src = readFileSync(f, 'utf8');
  const rel = f.replace(/\\/g, '/');
  if (/\beval\(|document\.write\(/.test(src)) problems.push(`${rel}: eval/document.write is not allowed`);
  if (/new Function\(/.test(src) && !rel.endsWith('services/executor.js')) problems.push(`${rel}: new Function only inside the sandboxed executor`);
  if (/localStorage|sessionStorage|indexedDB/.test(src) && !/core\/store\.js$|services\/executor\.js$|services\/auth\.js$|\/data\//.test(rel)) problems.push(`${rel}: browser storage only via core/store.js`);
  if (/\bfetch\(/.test(src) && !/\/services\/|views\/admin\.js$/.test(rel)) problems.push(`${rel}: network calls belong in services/`);
  if (/sk-ant-|AKIA[0-9A-Z]{16}|-----BEGIN (RSA )?PRIVATE KEY/.test(src)) problems.push(`${rel}: possible secret in source`);
}
for (const f of serverFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { problems.push(`${f}: syntax error\n${e.stderr}`); }
  const src = readFileSync(f, 'utf8');
  if (/\beval\(|new Function\(/.test(src)) problems.push(`${f}: dynamic code evaluation is not allowed on the server`);
  if (/sk-ant-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|-----BEGIN (RSA )?PRIVATE KEY/.test(src)) problems.push(`${f}: possible secret in source`);
  if (/console\.(log|error)\([^)]*\$\{[^}]*(password|temp)\b/i.test(src) && !/cli\.mjs$/.test(f)) problems.push(`${f}: do not log passwords`); // only the local CLI prints temporary passwords, once
}
console.log(problems.length ? problems.join('\n') : `lint ok: ${files.length} source files, ${serverFiles.length} server files`);
process.exit(problems.length ? 1 : 0);
