/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A preview of Career's pages before they are delivered: a local proxy that shows a running kernel's own cockpit and data with Career's pages and static files read from this working copy, and the Home tile added to the profile answer. Used to check Career as its own application (1.53.0) in the real cockpit at 1440 and 412 wide; career-frame-walk.cjs drives it.
 *
 * Use it on the test slot. It signs in as the operator persona with the administrator token read from the kernel's
 * own environment file, adds that session only to requests it sends to the kernel, and never prints it or gives it to
 * the browser. Everything a page does through it reaches that kernel, so do not point it at production.
 *
 *   node scripts/career-frame-preview.cjs          # then open http://127.0.0.1:38951/cockpit/?app=intelligent-career
 *   KERNEL=http://127.0.0.1:38798 ENVFILE=~/.local/state/oshal-native/oshald.env PORT=38951 TOOLS=<path to tools/>
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const os = require('node:os');
const KERNEL = process.env.KERNEL || 'http://127.0.0.1:38798';
const TOOLS = process.env.TOOLS || path.resolve(__dirname, '..', 'tools');
const ENVFILE = process.env.ENVFILE || path.join(os.homedir(), '.local/state/oshal-native/oshald.env');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(KERNEL)) throw new Error('the preview only fronts a kernel on this machine');
const PORT = Number(process.env.PORT || 38951);
const admin = (fs.readFileSync(ENVFILE, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m) || [])[1].trim().replace(/^"|"$/g, '');
let token = '';

const bySurface = new Map();
for (const file of fs.readdirSync(TOOLS).filter((f) => f.endsWith('.html'))) {
  const m = fs.readFileSync(path.join(TOOLS, file), 'utf8').match(/data-career-surface="([^"]+)"/);
  if (m) bySurface.set(m[1], file);
}
const TYPES = { '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const HOME = (prefix) => ({ group: null, icon: 'codicon codicon-home', id: 'tool-' + prefix + 'career-home', label: 'Home', section: 'top',
  toolUi: { iframeUrl: '/api/career-hunter/home', sidebarLabel: 'Home', visibilityToolName: 'career-home' } });

async function signIn() {
  const r = await fetch(KERNEL + '/api/auth/switch', { method: 'POST', headers: { authorization: 'Bearer ' + admin, 'content-type': 'application/json' }, body: JSON.stringify({ persona: 'operator' }) });
  token = (await r.json()).token;
  if (!token) throw new Error('no persona session');
}

function local(res, file, type) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(fs.readFileSync(path.join(TOOLS, file)));
}

function rewriteProfile(text, name) {
  try {
    const data = JSON.parse(text), ribbon = data.profile && data.profile.ribbon;
    if (!ribbon || !Array.isArray(ribbon.items)) return text;
    const prefix = name === 'intelligent-career' ? 'career-hunter--' : '';
    if (!ribbon.items.some((item) => item && item.id === 'tool-' + prefix + 'career-home')) ribbon.items.unshift(HOME(prefix));
    data.profile.defaultView = 'tool-' + prefix + 'career-home';
    return JSON.stringify(data);
  } catch (_) { return text; }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://preview');
  const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if (asset && fs.existsSync(path.join(TOOLS, asset[1]))) return local(res, asset[1], TYPES[path.extname(asset[1])] || 'application/octet-stream');
  if (req.method === 'GET' && url.pathname === '/api/career-hunter/home') return local(res, 'career-home.html', 'text/html');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = { ...req.headers, authorization: 'Bearer ' + token, host: new URL(KERNEL).host };
  delete headers['content-length']; delete headers.connection; delete headers['accept-encoding'];
  const upstream = await fetch(KERNEL + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual' });
  const type = upstream.headers.get('content-type') || '';
  const out = {};
  upstream.headers.forEach((value, key) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) out[key] = value; });
  if (type.includes('text/html') && url.pathname.startsWith('/api/career-hunter/')) {
    const text = await upstream.text(), m = text.match(/data-career-surface="([^"]+)"/);
    if (m && bySurface.has(m[1])) return local(res, bySurface.get(m[1]), 'text/html');
    res.writeHead(upstream.status, out); return res.end(text);
  }
  if (url.pathname === '/api/ui/profile' && type.includes('json')) {
    res.writeHead(upstream.status, out); return res.end(rewriteProfile(await upstream.text(), url.searchParams.get('name')));
  }
  if (type.includes('text/event-stream')) {
    res.writeHead(upstream.status, out);
    const reader = upstream.body.getReader();
    req.on('close', () => reader.cancel().catch(() => {}));
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
    return res.end();
  }
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

signIn().then(() => {
  http.createServer((req, res) => { handle(req, res).catch((error) => { if (!res.headersSent) res.writeHead(502); res.end('preview: ' + String(error.message).slice(0, 120)); }); })
    .listen(PORT, '127.0.0.1', () => console.log('preview ready on ' + PORT));
});
