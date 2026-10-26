// Serves the static preview (dist/preview.html): sample data, no server, no real accounts.
// For the real platform with sign-in, run `npm start` instead.
// Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.argv[2] || process.env.PORT || 5173);
createServer(async (req, res) => {
  if ((req.url || '/').split('?')[0] !== '/') { res.writeHead(302, { Location: '/' }).end(); return; }
  try {
    const body = await readFile('dist/preview.html');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('dist/preview.html not found. Run npm run build first.');
  }
}).listen(port, '127.0.0.1', () => console.log(`AVGENX Academy preview (sample data, no sign-in server) at http://localhost:${port}`));
