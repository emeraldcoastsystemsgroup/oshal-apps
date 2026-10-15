/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Notes in the OSHAL-local store: POST /local/save needs confirm, names the file the person asked for
 *   (.txt added when there is no extension, anything but .txt/.md or a path refused), never replaces a file of the same name unless
 *   asked, and bounds the text; GET /local/read reads it back. Under the native kernel both go through the storage.save / storage.read /
 *   storage.list intents for the verified caller with OSHAL local forced (the intent double answers like the kernel's file store); on the
 *   legacy framework they use the per-user directory. The manifest holds the write for the person's approval. Red before: no route
 *   saved or read a note, and the assistant had no write tool.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | DELETE /local/note removes a saved note through storage.delete (OSHAL local forced) under the kernel and from
 *   the per-user directory on the legacy framework; a missing note answers 404 and nothing is deleted; the manifest holds it for approval.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: GET /local/list answers "usage" (file count, total bytes, "<used> of 250.0 MB" and what it counts)
 *   over the kernel's storage.list sizes, and the in-app assistant's usage action says it in words; the persona proposes a held tool at
 *   once (the card is the confirmation, never a typed "yes" first) and answers "how much space" from that usage. Red before: the
 *   list answered files only and the assistant said it had no tool to check usage.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: a .txt note is saved through the kernel store as plain text (the chat Markdown of the approved
 *   card, "**Sweep10 Budget Note**" and "*   **Rent:** $1,800", is taken out) while a .md note keeps its Markdown byte for byte; an
 *   asterisk that wraps no word stays; the tool and persona ask for plain text in a .txt note.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Review of sweep 10: the clean-up changed approved content ("__init__" lost its dunder, "rm *.txt,*.md" became "rm .txt,.md",
 *   a "# install" shell line lost its "#", `--force` lost its ticks). Must-keep through the kernel store: those, a crontab "* * * * *" line,
 *   x**2 + y**2, f(**a,**b), bullets, headings and links are saved exactly as sent; only word-bounded **bold** is taken out of a .txt note.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the delete card showed 'Delete note' over 'Remove Note' (the display name, no sentence). Both held note
 *   tools declare a people-facing cardText.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: 'Delete that note.' got 'has been deleted' with no card and no tool run, and a save reply said 'the
 *   change card above'. Every delete request calls storage-delete-note, nothing is called deleted or saved until the tool answers
 *   ok, and a card is named by what it does, never by where it sits.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SUB = 'alice';
const LOCAL = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-notes-'));
process.env.CLINE_WORKSPACE_ROOT = LOCAL;
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/storage-target': { getStoragePrefs: async () => ({ code: { provider: 'oshal-local' }, files: { provider: 'oshal-local' } }), setStoragePrefs: async () => undefined, ensureStoragePrefsSchema: async () => undefined, sanitizeSubfolder: (v) => String(v || '') },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createStorageRoutes } = require('../routes/storage-routes.js');
test.after(() => { Module._load = original; fs.rmSync(LOCAL, { recursive: true, force: true }); });

const req = (body = {}, query = {}) => ({ oidc: { user: { sub: SUB }, isAuthenticated: () => true }, body, query });
function res() { return { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } }; }

/** A kernel file store double for the storage.* intents, keyed by path, refusing another subject as the kernel does. */
function kernel() {
  const files = new Map(), calls = [];
  const intent = async (name, input) => {
    calls.push([name, input]);
    assert.equal(input.subject, SUB, 'the verified caller is the subject');
    if (name === 'storage.list') return { provider: 'oshal-local', files: [...files].map(([n, b]) => ({ name: n, size: b.length, downloadUrl: `/api/applications/storage/storage/download?path=${encodeURIComponent(n)}` })) };
    if (name === 'storage.save') { files.set(input.name, Buffer.from(input.content, 'base64')); return { provider: 'oshal-local', location: input.name, downloadUrl: `/api/applications/storage/storage/download?path=${encodeURIComponent(input.name)}` }; }
    if (name === 'storage.delete') { files.delete(input.name); return { provider: 'oshal-local', removed: true }; }
    if (name === 'storage.read') { const b = files.get(input.path); if (!b) throw new Error('file not found in the current caller\'s storage'); return { content: b.toString('base64'), name: input.path, size: b.length }; }
    throw new Error(`unexpected intent ${name}`);
  };
  return { files, calls, r: createStorageRoutes({ pool: { query: async () => ({ rows: [] }) }, intent }).routes };
}

async function underKernel(run) {
  process.env.OSHAL_EGRESS = 'kernel';
  try { await run(); } finally { delete process.env.OSHAL_EGRESS; }
}

const call = async (r, key, body, query) => { const out = res(); await r[key](req(body, query), out); return out; };

test('under the kernel a confirmed note is saved in the kernel file store and read back; nothing is replaced unasked', async () => {
  const k = kernel();
  await underKernel(async () => {
    const text = 'Rent: $1,800\nGroceries: $600\nSavings: $400\nTravel: capped at $300\n';
    assert.equal((await call(k.r, 'POST /local/save', { name: 'sweep budget', text })).statusCode, 400, 'confirm is required');
    assert.equal(k.calls.length, 0, 'an unconfirmed save touches nothing');
    const saved = await call(k.r, 'POST /local/save', { name: 'sweep budget', text, confirm: true });
    assert.equal(saved.statusCode, 201);
    assert.deepEqual([saved.body.name, saved.body.size, saved.body.provider], ['sweep budget.txt', Buffer.byteLength(text), 'oshal-local']);
    assert.match(saved.body.where, /Storage/);
    assert.match(saved.body.downloadUrl, /^\/api\/applications\/storage\/storage\/download\?path=/);
    const save = k.calls.find(([name]) => name === 'storage.save')[1];
    assert.deepEqual({ ...save, content: undefined }, { kind: 'files', name: 'sweep budget.txt', content: undefined, override: { provider: 'oshal-local' }, subject: SUB });
    assert.equal(Buffer.from(save.content, 'base64').toString('utf8'), text);
    const again = await call(k.r, 'POST /local/save', { name: 'sweep budget.txt', text: 'other', confirm: true });
    assert.equal(again.statusCode, 409);
    assert.equal(k.files.get('sweep budget.txt').toString('utf8'), text, 'the first note is kept');
    assert.equal((await call(k.r, 'POST /local/save', { name: 'sweep budget.txt', text: 'replaced', confirm: true, replace: true })).statusCode, 201);
    const read = await call(k.r, 'GET /local/read', {}, { name: 'sweep budget.txt' });
    assert.deepEqual(read.body, { name: 'sweep budget.txt', size: 8, text: 'replaced' });
    assert.deepEqual(k.calls.filter(([name]) => name === 'storage.read').map(([, i]) => i), [{ path: 'sweep budget.txt', provider: 'oshal-local', subject: SUB }]);
    assert.equal((await call(k.r, 'GET /local/read', {}, { name: 'missing.txt' })).statusCode, 404);
    const listed = await call(k.r, 'GET /local/list');
    assert.deepEqual(listed.body.files.map((f) => f.name), ['sweep budget.txt'], 'the list shows what was saved');
    assert.equal((await call(k.r, 'DELETE /local/note', {}, { name: 'missing.txt' })).statusCode, 404);
    assert.ok(!k.calls.some(([name]) => name === 'storage.delete'), 'a missing note deletes nothing');
    assert.deepEqual((await call(k.r, 'DELETE /local/note', {}, { name: 'sweep budget.txt' })).body, { ok: true, removed: 'sweep budget.txt' });
    assert.deepEqual(k.calls.filter(([name]) => name === 'storage.delete').map(([, i]) => i), [{ kind: 'files', name: 'sweep budget.txt', override: { provider: 'oshal-local' }, subject: SUB }]);
    assert.deepEqual((await call(k.r, 'GET /local/list')).body.files, []);
  });
});

test('a note name, its kind and its size are bounded before anything is written', async () => {
  const k = kernel();
  await underKernel(async () => {
    for (const name of ['../escape.txt', 'a/b.txt', '.hidden', 'run.exe', '', 'x'.repeat(121)]) {
      const out = await call(k.r, 'POST /local/save', { name, text: 'x', confirm: true });
      assert.equal(out.statusCode, 400, name);
    }
    assert.equal((await call(k.r, 'POST /local/save', { name: 'empty', text: '  ', confirm: true })).statusCode, 400);
    assert.equal((await call(k.r, 'POST /local/save', { name: 'big', text: 'x'.repeat(256 * 1024 + 1), confirm: true })).statusCode, 413);
    assert.equal((await call(k.r, 'POST /local/save', { name: 'notes.md', text: '# ok', confirm: true })).statusCode, 201, '.md is a note too');
    assert.deepEqual(k.calls.filter(([name]) => name === 'storage.save').map(([, i]) => i.name), ['notes.md']);
  });
});

test('on the legacy framework a note lands in the per-user directory the list reads', async () => {
  const k = kernel();
  const saved = await call(k.r, 'POST /local/save', { name: 'legacy note', text: 'hello', confirm: true });
  assert.equal(saved.statusCode, 201);
  const dir = path.join(LOCAL, 'userfiles', crypto.createHash('sha256').update(SUB).digest('hex').slice(0, 32));
  assert.equal(fs.readFileSync(path.join(dir, 'legacy note.txt'), 'utf8'), 'hello');
  assert.deepEqual((await call(k.r, 'GET /local/read', {}, { name: 'legacy note.txt' })).body, { name: 'legacy note.txt', size: 5, text: 'hello' });
  assert.deepEqual((await call(k.r, 'GET /local/list')).body.files.map((f) => f.name), ['legacy note.txt']);
  assert.deepEqual((await call(k.r, 'DELETE /local/note', {}, { name: 'legacy note.txt' })).body, { ok: true, removed: 'legacy note.txt' });
  assert.equal(fs.existsSync(path.join(dir, 'legacy note.txt')), false);
  assert.equal(k.calls.length, 0, 'the legacy framework never calls a kernel intent');
});

test('the manifest offers the note tools to the assistant and holds the write for approval', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(__dirname, '../../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8'));
  const tool = (name) => manifest.tools.find((t) => t.name === name);
  assert.deepEqual([tool('storage-save-note').executor.apiEndpoint, tool('storage-save-note').requiresApproval], ['POST /api/storage/local/save', true]);
  assert.deepEqual(tool('storage-save-note').inputSchema.required, ['name', 'text', 'confirm']);
  assert.deepEqual([tool('storage-read-file').executor.apiEndpoint, tool('storage-read-file').requiresApproval], ['GET /api/storage/local/read?name={input.name}', false]);
  assert.deepEqual([tool('storage-delete-note').executor.apiEndpoint, tool('storage-delete-note').requiresApproval], ['DELETE /api/storage/local/note?name={input.name}', true]);
});

test('the list answers how much of the OSHAL-local limit the files use, and the assistant says it in words', async () => {
  const k = kernel();
  await underKernel(async () => {
    k.files.set('a.txt', Buffer.alloc(1536)); k.files.set('b.md', Buffer.alloc(2 * 1024 * 1024));
    const listed = await call(k.r, 'GET /local/list');
    assert.equal(listed.statusCode, 200);
    const { usage } = listed.body;
    assert.deepEqual([usage.files, usage.bytes, usage.limitBytes, usage.used], [2, 1536 + 2 * 1024 * 1024, 250 * 1024 * 1024, '2.0 MB of 250.0 MB']);
    assert.match(usage.scope, /moved into folders are not counted/);
    STUBS['@/app/routes/inline-bot-execution'].executeBotOrInline = async () => ({ response: '{"action":"usage","args":{}}' });
    try {
      const said = await call(k.r, 'POST /assistant', { message: 'How much space am I using?' });
      assert.match(said.body.reply, /^Your OSHAL-local store holds 2 file\(s\) using 2\.0 MB of 250\.0 MB\. Counts the files at the top/);
    } finally { STUBS['@/app/routes/inline-bot-execution'].executeBotOrInline = async () => ({ response: '{}' }); }
  });
  const empty = kernel();
  await underKernel(async () => assert.equal((await call(empty.r, 'GET /local/list')).body.usage.used, '0 B of 250.0 MB'));
});

test('the persona proposes a held tool at once and answers space questions from the usage', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'storage-assistant.yaml'), 'utf8');
  assert.match(persona, /that card is their confirmation/);
  assert.match(persona, /never ask them to type "yes" or\s+"confirm" first/);
  assert.match(persona, /Asked how much space they use, call it/);
});

test('a .txt note is saved as plain text through the kernel store; a .md note keeps its Markdown', async () => {
  const k = kernel();
  await underKernel(async () => {
    const chat = '**Sweep10 Budget Note**\n\n*   **Rent:** $1,800\n*   *Food:* $600\n## Total\nTotal: 5 * 480 = $2,400, see [plan](https://example.com/p)';
    assert.equal((await call(k.r, 'POST /local/save', { name: 'sweep12-budget-note.txt', text: chat, confirm: true })).statusCode, 201);
    const saved = k.files.get('sweep12-budget-note.txt').toString('utf8');
    assert.equal(saved, 'Sweep10 Budget Note\n\n*   Rent: $1,800\n*   *Food:* $600\n## Total\nTotal: 5 * 480 = $2,400, see [plan](https://example.com/p)',
      'only the bold pairs are taken out; every other mark is saved as sent');
    const read = await call(k.r, 'GET /local/read', {}, { name: 'sweep12-budget-note.txt' });
    assert.equal(read.body.text, saved, 'what is read back is what was saved');
    assert.doesNotMatch(read.body.text, /\*\*/, 'no chat bold');
    assert.equal((await call(k.r, 'POST /local/save', { name: 'sweep12-budget-note.md', text: chat, confirm: true })).statusCode, 201);
    assert.equal(k.files.get('sweep12-budget-note.md').toString('utf8'), chat, 'a .md note is saved exactly as sent');
  });
  const yaml = require(path.resolve(__dirname, '../../scripts/toolchain/node_modules/js-yaml'));
  const manifest = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8'));
  assert.match(manifest.tools.find((t) => t.name === 'storage-save-note').inputSchema.properties.text.description, /Plain text for a \.txt note/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'personas', 'storage-assistant.yaml'), 'utf8'), /For a \.txt note write "text" as plain\s+text/);
});

test('a .txt note keeps every character that is not chat bold: code, globs, comments, ticks and a crontab line', async () => {
  const k = kernel();
  const mustKeep = ['from pkg import __init__ as x', 'rm *.txt,*.md', '# install\npip install foo', 'Use `--force` flag',
    '* * * * * /usr/bin/backup', 'area = x**2 + y**2', 'f(**a,**b)', '- milk\n* eggs', 'see [plan](https://example.com/p)', '2 ** 3 = 8'];
  await underKernel(async () => {
    for (const [i, text] of mustKeep.entries()) {
      assert.equal((await call(k.r, 'POST /local/save', { name: `sweep12-keep-${i}.txt`, text, confirm: true })).statusCode, 201);
      assert.equal(k.files.get(`sweep12-keep-${i}.txt`).toString('utf8'), text, `saved as approved: ${JSON.stringify(text)}`);
    }
    const bold = 'Plan: **Rent:** $1,800 and (**Food**).';
    assert.equal((await call(k.r, 'POST /local/save', { name: 'sweep12-bold.txt', text: bold, confirm: true })).statusCode, 201);
    assert.equal(k.files.get('sweep12-bold.txt').toString('utf8'), 'Plan: Rent: $1,800 and (Food).');
  });
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /Plain text for a \.txt note \(\*\* bold is taken out on saving; everything else is saved exactly as sent\)/);
});

test('each held note tool declares a people-facing card sentence (sweep 12)', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(__dirname, '../../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8'));
  const held = manifest.tools.filter((t) => t.requiresApproval === true && /note/.test(t.name));
  assert.deepEqual(held.map((t) => t.name).sort(), ['storage-delete-note', 'storage-save-note']);
  for (const tool of held) {
    assert.match(tool.cardText || '', /^[A-Z][^]*\byour OSHAL storage\b[^]*\.$/, `${tool.name} declares a sentence to the person`);
    assert.doesNotMatch(tool.cardText, /storage-[a-z-]+|\bconfirm\b|\bcall\b|the person/i, tool.name);
  }
  assert.equal(manifest.tools.find((t) => t.name === 'storage-delete-note').cardText, 'Deletes this note from your OSHAL storage.');
});

test('every delete request calls the delete tool, and nothing is called deleted before it answers (sweep 13)', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'storage-assistant.yaml'), 'utf8');
  const served = persona.slice(persona.indexOf('\nperspective:')).replace(/\s+/g, ' ');
  assert.match(served, /Each time they ask to delete a note \("delete that note", "delete <name> from Storage"\), call storage-delete-note for it in that reply/);
  assert.match(served, /even when an earlier turn saved or discussed it\. Never say a note was deleted or saved unless that tool answered ok/);
  assert.match(served, /Name a card by what it does \("the Remove Note card for <name>"\)\. Never say where it sits on the screen: no "above", "below", "previous" or "earlier"/);
});
