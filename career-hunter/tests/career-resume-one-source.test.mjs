/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "the resume concierge the resume tab and the database ... i dont think they are working together well. i cant use the tools to update my resume and see it in the resume tab after adding experience"). The main résumé is the one source of truth and the Word document on My résumé is a view of it: the document names the main résumé revision it was made from (the id of its first page), so Career can tell a document that is behind from one that holds typed text. A job or bullet added where no document was open is in the document the next time anything of Career looks, typed text is saved into the main résumé and never lost to an update, a document that is only behind is never saved back over an approved change, and a document at AI Office's 100-revision limit is replaced by a fresh one. Career's own engine and tools/career-resume-office.js are real; AI Office's document routes are an in-memory stand-in with the limits its store enforces. Made-up people only.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire, registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const office = createRequire(import.meta.url)('../tools/career-resume-office.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-one-source-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);

const SHIP = 'Shipped the routing service', CUT = 'Cut deploy time 40%';
const fixture = {
  profile: { name: 'Pat Example', headline: 'Engineer', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [
    { title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: null, deliverables: [SHIP, CUT] },
    { title: 'Software Engineer', org: 'Sample Bank', start: '2014-06', end: '2019-02', deliverables: ['Built the payments ledger'] },
  ],
  skills: { Core: { items: ['Rust'] } },
  competencies: ['Delivery'],
};
let stores = 0;
function store(value = fixture) {
  const dir = path.join(root, 'store-' + ++stores); fs.mkdirSync(dir);
  const file = path.join(dir, 'career_db.json'); fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return { dir, file };
}
function invoke(s, verb, input = {}) {
  const run = cli.exports.mapping('resume', [verb])[0];
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', run, {
    cwd: packageRoot, timeout: 20000, encoding: 'utf8', env: { ...process.env,
      JOBHUNTER_DATA: s.dir, JOBHUNTER_CAREER_DB: s.file, PYTHONPATH: path.join(packageRoot, 'engine'), CH_RESUME_DOC: JSON.stringify(input) },
  });
  assert.ok(result.stdout.trim(), result.stderr);
  return JSON.parse(result.stdout.trim());
}
const revision = s => createHash('sha256').update(fs.readFileSync(s.file)).digest('hex');
const master = s => invoke(s, 'base');
/** A card approved somewhere no Word document is open (Jarvis, another Career page): the engine's own patch. */
function card(s, edits) { const answer = invoke(s, 'base-patch', { revision: revision(s), edits }); assert.equal(answer.ok, true, JSON.stringify(answer)); }
const at = (roleIndex, roleTitle) => ({ roleIndex, roleTitle });
const IL6 = [
  { op: 'add', field: 'role', index: 0, before: '', value: 'IL6 Engineer', summary: 'Add IL6 Engineer at Demo Defense Cloud' },
  { op: 'set', field: 'role', ...at(0, 'IL6 Engineer'), key: 'org', before: '', value: 'Demo Defense Cloud' },
  { op: 'set', field: 'role', ...at(0, 'IL6 Engineer'), key: 'start', before: '', value: '2025-06' },
  { op: 'add', field: 'experience', ...at(0, 'IL6 Engineer'), index: 0, before: '', value: 'Stood up the IL6 enclave' },
  { op: 'add', field: 'experience', ...at(0, 'IL6 Engineer'), index: 1, before: '', value: 'Wrote the accreditation package' },
];
const MENTOR = [{ op: 'add', field: 'experience', ...at(0, 'Principal Engineer'), index: 2, before: '', value: 'Mentored four engineers' }];

// The page imports the shared document handoff by its served path; here it answers for the open document.
const handoff = { recordId: null, refreshed: 0 };
globalThis.__careerOneSourceHandoff = handoff;
registerHooks({ resolve(specifier, context, next) {
  if (specifier !== '/shared/ui/js/document-handoff.js') return next(specifier, context);
  const source = 'export async function beginDocumentHandoff(){return {context:{recordId:globalThis.__careerOneSourceHandoff.recordId}};}\n'
    + 'export async function refreshOpenDocument(){globalThis.__careerOneSourceHandoff.refreshed++;}';
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
} });

/**
 * One person's AI Office documents in memory, with the limits its store enforces (a revision is written on the
 * revision it read, and no document goes past revision 100), and Career's own résumé routes over the real engine.
 */
function world(s) {
  const documents = new Map(), reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  let clock = 0, made = 0;
  const listed = () => [...documents.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, kind, title, revision }) => ({ id, kind, title, revision }));
  async function fetch(url, init = {}) {
    const method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    const one = url.match(/^\/api\/presentations\/editor\/documents\/([^/]+)(\/revisions)?$/);
    if (url === '/api/presentations/editor/documents' && method === 'GET') return reply(200, { documents: listed() });
    if (url === '/api/presentations/editor/documents' && method === 'POST') {
      const id = `doc-${++made}`;
      documents.set(id, { id, kind: body.model.kind, title: body.model.title, revision: 1, model: body.model, updatedAt: ++clock });
      return reply(201, { document: documents.get(id) });
    }
    if (one && !one[2] && method === 'GET' && documents.has(one[1])) return reply(200, { document: documents.get(one[1]) });
    if (one && !one[2] && method === 'DELETE' && documents.has(one[1])) { documents.delete(one[1]); return reply(200, { deleted: true }); }
    if (one && one[2] && method === 'POST' && documents.has(one[1])) {
      const doc = documents.get(one[1]);
      if (!Number.isInteger(body.baseRevision) || body.baseRevision > 99) return reply(400, { message: 'Enter a number between 1 and 99.' });
      if (body.baseRevision !== doc.revision) return reply(409, { message: 'A newer revision exists.' });
      documents.set(one[1], { ...doc, revision: doc.revision + 1, model: body.model, updatedAt: ++clock });
      return reply(201, { document: documents.get(one[1]) });
    }
    const career = url.match(/^\/api\/career-hunter\/resume\/(doc|save)(?:\?(.*))?$/);
    if (career && career[1] === 'doc' && method === 'GET') {
      const query = new URLSearchParams(career[2] || '');
      if (!query.has('earlier')) return reply(200, master(s));
      const answer = invoke(s, 'base-earlier', query.get('earlier') === 'recent' ? {} : { revision: query.get('earlier') });
      return reply(answer.ok ? 200 : 422, answer);
    }
    if (career && career[1] === 'save' && method === 'POST') {
      const answer = invoke(s, 'base-save', { resume: body.resume });
      return reply(answer.ok ? 200 : 422, answer);
    }
    return reply(404, { error: `not in fixture: ${method} ${url}` });
  }
  return { documents, fetch, current: () => documents.get(listed()[0].id) };
}
async function inWorld(s, work) {
  const w = world(s), prior = { fetch: globalThis.fetch, document: globalThis.document };
  globalThis.fetch = w.fetch;
  globalThis.document = { createElement: () => ({ setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] ?? null; }, remove() {} }) };
  try { return await work(w); }
  finally { globalThis.fetch = prior.fetch; if (prior.document === undefined) delete globalThis.document; else globalThis.document = prior.document; }
}
/** My résumé's host on the page: it reads and saves the main résumé through Career's own routes. */
function page(statuses = []) {
  return office.createHost({ host: { hidden: true, append() {} }, status: text => statuses.push(text),
    readMaster: async () => (await globalThis.fetch('/api/career-hunter/resume/doc?id=master')).json(),
    saveMaster: async resume => {
      const answer = await globalThis.fetch('/api/career-hunter/resume/save', { method: 'POST', body: JSON.stringify({ postingId: 'master', resume }) });
      const body = await answer.json(); if (!answer.ok) throw new Error(body.error); return body;
    } });
}
async function open(s, statuses) { const host = page(statuses); handoff.recordId = await host.open(master(s)); return host; }
/** What the document says, read back as the main résumé's fields. */
function shown(w, s) {
  const mapped = office.modelToResume(w.current().model, master(s).resume);
  assert.equal(mapped.error, undefined, mapped.error);
  return mapped.resume;
}
const jobs = resume => resume.experience.map(role => [role.title, role.bullets]);
/** The person types in AI Office's editor and it saves: the same document, its text changed, as a new revision. */
async function typed(w, change) {
  const doc = w.current(), model = structuredClone(doc.model);
  const blocks = model.pages.flatMap(item => item.blocks);
  change(text => { const block = blocks.find(item => item.runs.map(run => run.text).join('') === text); assert.ok(block, `the document shows "${text}"`); return block; }, blocks);
  const answer = await w.fetch(`/api/presentations/editor/documents/${doc.id}/revisions`, { method: 'POST', body: JSON.stringify({ baseRevision: doc.revision, requestKey: 'k', model }) });
  assert.equal(answer.status, 201);
}
const retype = (find, from, to) => { find(from).runs = [{ ...find(from).runs[0], text: to }]; };

test('a job and its bullets added where no Word document was open are in the document when My résumé opens, with no press', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    card(s, IL6);
    const statuses = [], host = await open(s, statuses);
    assert.deepEqual(jobs(shown(w, s))[0], ['IL6 Engineer', ['Stood up the IL6 enclave', 'Wrote the accreditation package']]);
    assert.equal(office.sameResume(shown(w, s), master(s).resume), true, 'the document says what the main résumé says');
    assert.equal(statuses.at(-1), 'Updated with your work history');
    assert.equal(host.state(), 'updated');
    assert.equal(w.documents.size, 1, 'the same document, updated');
  });
});

test('a bullet added to an existing job where no document was open is in the document when My résumé opens', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    card(s, MENTOR);
    const statuses = []; await open(s, statuses);
    assert.deepEqual(jobs(shown(w, s))[0][1], [SHIP, CUT, 'Mentored four engineers']);
    assert.equal(statuses.at(-1), 'Updated with your work history');
  });
});

test('the save before a concierge turn never writes a document that is behind back over an approved change', async () => {
  const s = store();
  await inWorld(s, async w => {
    const host = await open(s);
    // Approved through Jarvis while My résumé stays open: the page's document is now one change behind.
    card(s, MENTOR);
    const result = await host.saveToMaster(false);
    assert.deepEqual(master(s).resume.experience[0].bullets, [SHIP, CUT, 'Mentored four engineers'], 'the approved bullet is still in the main résumé');
    assert.equal(result.changed, false, 'nothing was typed, so nothing is saved');
    assert.deepEqual(jobs(shown(w, s))[0][1], [SHIP, CUT, 'Mentored four engineers'], 'and the document was brought up to date');
    assert.ok(handoff.refreshed > 0, 'the open editor is told to show the new revision');
  });
});

test('what was typed in the document and a card approved meanwhile are both kept', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    await typed(w, find => { retype(find, 'Made-up summary.', 'Made-up summary, sharpened by hand.'); retype(find, CUT, 'Cut deploy time 40% across 12 services'); });
    card(s, [...MENTOR, ...IL6.map(edit => ({ ...edit }))]);
    const statuses = [], host = await open(s, statuses), now = master(s).resume;
    assert.equal(now.summary, 'Made-up summary, sharpened by hand.', 'the typed summary is in the main résumé');
    assert.deepEqual(jobs(now), [
      ['IL6 Engineer', ['Stood up the IL6 enclave', 'Wrote the accreditation package']],
      ['Principal Engineer', [SHIP, 'Cut deploy time 40% across 12 services', 'Mentored four engineers']],
      ['Software Engineer', ['Built the payments ledger']]], 'the typed bullet and the card\'s bullet and job are all there');
    assert.equal(office.sameResume(shown(w, s), now), true, 'and the document shows the same');
    assert.equal(host.state(), 'merged');
    assert.match(statuses.at(-1), /Saved what you typed/);
  });
});

test('typed text alone is saved into the main résumé when Career next looks, and costs the document no revision', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    await typed(w, find => retype(find, SHIP, 'Shipped the routing service to 40 depots'));
    const before = w.current().revision, outcome = await office.settle({ save: true });
    assert.equal(outcome.state, 'saved');
    assert.equal(master(s).resume.experience[0].bullets[0], 'Shipped the routing service to 40 depots');
    assert.equal(w.current().revision, before, 'the document already says it');
    assert.equal((await office.settle({ save: true })).state, 'same', 'and the next look finds nothing to do');
  });
});

test('a save that cannot go through when My résumé opens does not keep the document from opening', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    await typed(w, find => retype(find, SHIP, 'Shipped the routing service to 40 depots'));
    const statuses = [], busy = office.createHost({ host: { hidden: true, append() {} }, status: text => statuses.push(text),
      readMaster: async () => master(s), saveMaster: async () => { throw new Error('Save failed: engine busy'); } });
    const id = await busy.open(master(s));
    assert.equal(id, w.current().id, 'the document opens');
    assert.equal(busy.state(), 'typed');
    assert.equal(statuses.at(-1), 'Not yet saved to your main résumé');
    assert.equal(master(s).resume.experience[0].bullets[0], SHIP, 'nothing was saved');
    assert.equal(shown(w, s).experience[0].bullets[0], 'Shipped the routing service to 40 depots', 'and what was typed is still in the document');
  });
});

test('a main résumé field and the same field typed in the document: the saved one stays, and the person is told', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    await typed(w, find => retype(find, 'Made-up summary.', 'Typed summary.'));
    card(s, [{ op: 'set', field: 'summary', before: 'Made-up summary.', value: 'Summary from an approved card.', summary: 'Rewrite the summary' }]);
    const outcome = await office.settle({ save: true });
    assert.equal(master(s).resume.summary, 'Summary from an approved card.');
    assert.equal(shown(w, s).summary, 'Summary from an approved card.');
    assert.match(outcome.notes.join(' '), /summary/i);
    assert.match(outcome.notes.join(' '), /Revision history/);
  });
});

test('a document from before this version, which names no revision, is brought up to date when it reads exactly as an earlier main résumé', async () => {
  const s = store();
  await inWorld(s, async w => {
    const first = master(s);
    await w.fetch('/api/presentations/editor/documents', { method: 'POST', body: JSON.stringify({ model: office.resumeToModel(first.resume, first.meta) }) });
    assert.equal(office.revisionOf(w.current().model), '', 'made the old way: it names no revision');
    card(s, MENTOR); card(s, IL6);
    const outcome = await office.settle({ save: true });
    assert.equal(outcome.state, 'updated');
    assert.equal(office.sameResume(shown(w, s), master(s).resume), true);
    assert.equal(office.revisionOf(w.current().model), revision(s), 'and from now on it names the main résumé it shows');
  });
});

test('a document Career cannot place is never saved or replaced by itself: it says so, and Save or Use my work history decides', async () => {
  const s = store();
  await inWorld(s, async w => {
    const first = master(s), odd = structuredClone(first.resume);
    odd.experience[0].bullets = ['A bullet typed long ago, in a document that names no revision'];
    await w.fetch('/api/presentations/editor/documents', { method: 'POST', body: JSON.stringify({ model: office.resumeToModel(odd, first.meta) }) });
    card(s, MENTOR);
    const text = fs.readFileSync(s.file, 'utf8'), revisionBefore = w.current().revision, statuses = [];
    const host = await open(s, statuses);
    assert.equal(host.state(), 'unsure');
    assert.match(statuses.at(-1), /Use my work history/);
    assert.match(statuses.at(-1), /Save to main résumé/);
    assert.equal(fs.readFileSync(s.file, 'utf8'), text, 'nothing was saved');
    assert.equal(w.current().revision, revisionBefore, 'and the document is as it was');
    assert.equal((await host.saveToMaster(false)).changed, false, 'the save before a concierge turn leaves it too');
    assert.equal(fs.readFileSync(s.file, 'utf8'), text);
    await host.saveToMaster(true);
    assert.deepEqual(master(s).resume.experience[0].bullets, odd.experience[0].bullets, 'the person pressed Save to main résumé: the document wins');
  });
});

test('a document at AI Office\'s revision limit is replaced by a fresh one, so the main résumé keeps showing', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    const old = w.current(); w.documents.set(old.id, { ...old, revision: 100 });
    card(s, MENTOR);
    const outcome = await office.settle({ save: true });
    assert.equal(outcome.state, 'updated');
    assert.notEqual(w.current().id, old.id, 'a new document');
    assert.equal(w.current().revision, 1);
    assert.equal(office.sameResume(shown(w, s), master(s).resume), true);
    assert.equal(w.documents.has(old.id), false, 'the full one, which held nothing unsaved, is gone');
  });
});

test('a difference the main résumé does not take costs no revision, and a full document moves before the person\'s next save meets the limit', async () => {
  const s = store();
  await inWorld(s, async w => {
    await open(s);
    await typed(w, find => retype(find, SHIP, SHIP + '  '));
    await typed(w, find => retype(find, 'Made-up summary.', 'Made-up summary, reworded.'));
    const before = w.current().revision;
    // The save answers that nothing changed (as the engine does when the main résumé keeps its own wording).
    const outcome = await office.settle({ save: true, saveMaster: async () => ({ ok: true, changed: false, changelog: [] }) });
    assert.deepEqual([outcome.state, outcome.revised], ['same', false]);
    assert.equal(w.current().revision, before, 'the document is not rewritten on every look');
  });
  const t = store();
  await inWorld(t, async w => {
    await open(t);
    const old = w.current(); w.documents.set(old.id, { ...old, revision: 96 });
    const outcome = await office.settle({ save: true });
    assert.deepEqual([outcome.state, outcome.revised], ['same', true]);
    assert.notEqual(w.current().id, old.id, 'a fresh document while nothing is typed in the old one');
    assert.equal(office.sameResume(shown(w, t), master(t).resume), true);
  });
});

test('with no Word document, or no AI Office, there is nothing to do and nothing fails', async () => {
  const s = store();
  await inWorld(s, async w => {
    assert.equal((await office.settle({ save: true })).state, 'none');
    assert.equal(w.documents.size, 0, 'only My résumé makes the document');
  });
  const prior = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'no such application' }) });
  try { assert.equal((await office.settle({ save: true })).state, 'none'); } finally { globalThis.fetch = prior; }
});

test('two lists changed apart are merged bullet by bullet', () => {
  const base = ['a', 'b', 'c'];
  assert.deepEqual(office.mergeLists(base, ['a', 'B', 'c'], ['a', 'b', 'c', 'd']), ['a', 'B', 'c', 'd'], 'a typed change and an added bullet');
  assert.deepEqual(office.mergeLists(base, ['a', 'c'], ['x', 'a', 'b', 'c']), ['x', 'a', 'c'], 'a typed removal and an added bullet');
  assert.deepEqual(office.mergeLists(base, ['a', 'b', 'c', 'e'], ['a', 'c']), ['a', 'c', 'e'], 'a typed addition and a removed bullet');
  assert.deepEqual(office.mergeLists(base, base, ['z']), ['z'], 'nothing typed: the main résumé\'s list');
  assert.deepEqual(office.mergeLists(base, ['q'], base), ['q'], 'only typed: the typed list');
});
