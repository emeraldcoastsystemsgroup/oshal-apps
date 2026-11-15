/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard that every person-facing string in Storage names the product Open Swarm (storage 1.4.3).
 *   Drives the compiled Home summary, storage settings/assistant/notes/upload routes and file-picker source routes, parses oshal-app.yaml
 *   and personas/storage-assistant.yaml, and scans routes/, src-routes/ and tools/ outside comments against an explicit identifier allowlist.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));

/** Technical identifier forms that legitimately keep `oshal` and are never spoken as the product's name. */
const IDENTIFIERS = [
  [/\bOSHAL_[A-Z0-9_]+\b/g, 'an environment variable (OSHAL_EGRESS, OSHAL_APP_PACKAGE_DIR)'],
  [/\boshal-local\b/g, 'the lowercase oshal-local provider id in schemas, routes and queries'],
  [/\boshal-app\.yaml\b/g, 'the manifest file name'],
  [/\boshal_[a-z0-9_]+\b/g, 'a kernel database table name (oshal_storage_prefs, oshal_connections)'],
  [/\bx-oshal-[a-z-]+/g, 'a request header name'],
  [/--oshal-[a-z-]+/g, 'a CSS custom property of the shell'],
  [/'User-Agent':\s*'OSHAL'/g, 'the outbound GitHub API User-Agent header'],
  [/github\.com\/[\w-]+\/oshal-apps\b/g, 'the store repository address'],
];

function productNames(text) {
  const words = IDENTIFIERS.reduce((left, [form]) => left.replace(form, ' '), String(text));
  return [...words.matchAll(/oshal/gi)].map((hit) =>
    words.slice(Math.max(0, hit.index - 45), hit.index + 50).replace(/\s+/g, ' ').trim()
  );
}

function strings(value, at = '', out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, at ? `${at}.${k}` : k, out);
  }
  return out;
}

const said = (what, value) =>
  strings(value).flatMap(([at, text]) => productNames(text).map((near) => `${what} ${at}: ${near}`));

function codeLines(text) {
  const out = [];
  let open = '';
  text.split('\n').forEach((line, i) => {
    let rest = line.trim();
    if (open) {
      if (!rest.includes(open)) return;
      rest = rest.slice(rest.indexOf(open) + open.length).trim();
      open = '';
    }
    while (rest.startsWith('/*') || rest.startsWith('<!--')) {
      const close = rest.startsWith('/*') ? '*/' : '-->';
      const end = rest.indexOf(close, 2);
      if (end < 0) { open = close; return; }
      rest = rest.slice(end + close.length).trim();
    }
    if (rest && !rest.startsWith('//')) out.push([i + 1, rest]);
  });
  return out;
}

function makeRouter() {
  const routes = {};
  const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.sent = b; return this; },
  };
}

function loadRouteModules(localRoot, botState) {
  process.env.CLINE_WORKSPACE_ROOT = localRoot;
  const stubs = {
    express: { Router: makeRouter },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/storage-target': {
      getStoragePrefs: async () => ({ code: { provider: 'oshal-local' }, files: { provider: 'oshal-local' } }),
      setStoragePrefs: async () => undefined,
      ensureStoragePrefsSchema: async () => undefined,
      sanitizeSubfolder: (v) => String(v || ''),
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: botState.reply }) },
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    return orig.call(this, req, ...rest);
  };
  try {
    return {
      createHomeSummaryRoutes: require('../routes/home-summary.js').createHomeSummaryRoutes,
      createStorageRoutes: require('../routes/storage-routes.js').createStorageRoutes,
      createFileSourceRoutes: require('../routes/file-sources.js').createFileSourceRoutes,
    };
  } finally {
    Module._load = orig;
  }
}

function createFakeStorageContext(state) {
  const intent = async (name, input) => {
    if (name === 'storage.list') {
      if (state.failList) throw new Error('store busy');
      return { provider: 'oshal-local', files: [...state.files].map(([n, b]) => ({ name: n, size: b.length })) };
    }
    if (name === 'storage.save') {
      state.files.set(input.name, Buffer.from(input.content, 'base64'));
      return { provider: 'oshal-local', location: input.name };
    }
    throw new Error(`unexpected intent ${name}`);
  };
  return { pool: { query: async () => ({ rows: [] }) }, intent };
}

async function collectRouteAnswers() {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-pname-'));
  const state = { reply: '{"action":"get_prefs","args":{}}', files: new Map(), failList: false };
  const mods = loadRouteModules(localRoot, state);
  const ctx = createFakeStorageContext(state);
  const home = mods.createHomeSummaryRoutes(ctx).routes;
  const storage = mods.createStorageRoutes(ctx).routes;
  const sources = mods.createFileSourceRoutes(ctx).routes;
  const req = (body = {}, query = {}) => ({ oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, body, query });
  const heard = [];
  const ask = async (what, table, key, body, query) => {
    const out = makeRes();
    await table[key](req(body, query), out);
    heard.push([what, out.statusCode, out.body]);
  };
  process.env.OSHAL_EGRESS = 'kernel';
  try {
    await ask('home summary default note', home, 'GET /');
    await ask('empty picker local page', sources, 'GET /local', {}, {});
    await ask('missing note read', storage, 'GET /local/read', {}, { name: 'missing.txt' });
    await ask('missing note delete', storage, 'DELETE /local/note', {}, { name: 'missing.txt' });
    await ask('assistant get_prefs', storage, 'POST /assistant', { message: 'where do my files save?' });
    state.reply = '{"action":"set_target","args":{"bucket":"files","provider":"unknown"}}';
    await ask('assistant set_target prompt', storage, 'POST /assistant', { message: 'set target' });
    state.reply = '{"action":"list_files","args":{}}';
    await ask('assistant list_files empty', storage, 'POST /assistant', { message: 'list files' });
    await ask('save note', storage, 'POST /local/save', { name: 'plan.txt', text: 'hello', confirm: true });
    await ask('upload file local', storage, 'POST /files/upload', { name: 'memo.txt', text: 'hi', provider: 'oshal-local', confirm: true });
    await ask('assistant list_files populated', storage, 'POST /assistant', { message: 'list files' });
    state.reply = '{"action":"usage","args":{}}';
    await ask('assistant usage', storage, 'POST /assistant', { message: 'space used?' });
    state.failList = true;
    await ask('local list outage', storage, 'GET /local/list');
    await ask('picker local outage', sources, 'GET /local', {}, {});
  } finally {
    delete process.env.OSHAL_EGRESS;
    fs.rmSync(localRoot, { recursive: true, force: true });
  }
  return heard;
}

test('the guard itself: OSHAL or oshal in any letter case is a product name, and each identifier form is not', () => {
  for (const words of ['choose where OSHAL saves generated code', 'Choose where oshal saves what it generates', 'OSHAL-local Files', 'Files in oshal local']) {
    assert.equal(productNames(words).length, 1, words);
  }
  for (const code of ['process.env.OSHAL_EGRESS === "kernel"', "{ provider: 'oshal-local' }", 'oshal_storage_prefs', 'oshal-app.yaml', "'User-Agent': 'OSHAL'"]) {
    assert.deepEqual(productNames(code), [], code);
  }
});

test('every answer of the compiled Storage routes, notes, uploads, picker sources and Home summary names Open Swarm', async () => {
  const heard = await collectRouteAnswers();
  assert.deepEqual(heard.flatMap(([what, , body]) => said(what, body)), []);
  const allText = heard.flatMap(([, , body]) => strings(body).map(([, t]) => t)).join('\n');
  for (const expected of ['Open Swarm (local)', 'Open Swarm local', 'your Open Swarm local store']) {
    assert.ok(allText.includes(expected), `route answers include: ${expected}`);
  }
});

test('the manifest and the persona name Open Swarm in every string the kernel hands a card, the picker or the model', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas/storage-assistant.yaml'), 'utf8'));
  assert.deepEqual(said('manifest', manifest), []);
  assert.deepEqual(said('persona', persona), []);
  const tool = (n) => manifest.tools.find((t) => t.name === n);
  assert.equal(tool('storage-local-files').displayName, 'Open Swarm Local Files');
  assert.equal(manifest.artifacts.provides.find((p) => p.list.endsWith('/local')).label, 'Open Swarm local files');
  for (const n of ['storage-save-note', 'storage-delete-note', 'storage-upload-file']) {
    assert.match(tool(n).cardText, /your Open Swarm storage/);
  }
  assert.match(persona.perspective, /Open Swarm Storage app/);
});

test('the shipped routes, TypeScript route sources and HTML screens name Open Swarm outside their comments', () => {
  const shipped = ['routes', 'src-routes', 'tools'].flatMap((folder) =>
    fs.readdirSync(path.join(ROOT, folder)).filter((f) => /\.(?:js|ts|html)$/.test(f)).map((f) => `${folder}/${f}`)
  );
  assert.ok(shipped.length >= 14, `expected >= 14 shipped files, saw ${shipped.length}`);
  const named = shipped.flatMap((file) =>
    codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8')).flatMap(([line, code]) =>
      productNames(code).map((near) => `${file}:${line}: ${near}`)
    )
  );
  assert.deepEqual(named, []);
  const settings = fs.readFileSync(path.join(ROOT, 'tools/storage-settings.html'), 'utf8');
  assert.ok(settings.includes('<title>Storage Settings — Open Swarm</title>'));
  assert.ok(settings.includes('Choose where Open Swarm saves what it generates'));
});
