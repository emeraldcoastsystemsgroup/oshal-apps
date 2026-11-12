/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the master resume as a Word document (tools/career-resume-office.js): the document Career makes passes AI Office's own model validation, an untouched document maps back to exactly the master, and an edited document saved through the REAL `resume base-save` engine path keeps the career profile valid (roles, titles, unsent fields intact). A changed role heading, a removed role and an extra section are said, never silently saved.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Saving the document never changes the master by itself (live 2026-11-09 02:35, a Send in the Chat rail): with an empty headline the document shows the credential line in its place, and the save stored that line as the headline; a skill holding two semicolons came back as three skills in a new "Additional Skills" group. Over a profile with both, the untouched document says "Matches your master resume" on open and on Save, Save sends nothing, and even a forced save through the real `resume base-save` changes no byte, backup or history; a real bullet edit saves only that bullet. A skill containing the " · " separator survives an untouched round trip.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: résumé carries its accents in the lines a person reads (the Save button, the picker, the status under the document); the expected text follows.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the document's status lines say main résumé.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import Module, { createRequire, registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const office = createRequire(import.meta.url)('../tools/career-resume-office.js');
const { validate } = await import('../../presentations/tools/office/model.mjs');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-'));
after(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });

const profile = {
  profile: { name: 'Alex Fixture', credential: 'PMP', location: 'Testville', clearance: 'None stated',
    citizenship: 'US', experience_summary: 'Seasoned platform lead.' },
  roles: [
    { title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null,
      deliverables: ['Led the team that shipped the platform', 'Cut deploy time 60%'] },
    { title: 'SRE', org: 'Beta Corp', start: '2015-05', end: '2018-12', deliverables: ['Ran the on-call rotation'] },
  ],
  skills: { Cloud: { items: ['AWS', 'Terraform'] }, Leadership: { items: ['Mentoring'] } },
  metrics_bank: ['Cut deploy time 60%'], certifications: ['PMP'],
};

function engine(verb, store, extra = {}) {
  const cli = new Module(binPath); cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(`${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__engineRuns=engineRuns;`, binPath);
  const env = { ...process.env, PYTHONPATH: path.join(packageRoot, 'engine'), PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_CAREER_DB: store.careerDb, JOBHUNTER_DATA: path.join(store.dir, 'data'), ...extra };
  const result = spawnSync(python, cli.exports.__engineRuns('resume', [verb])[0], { cwd: packageRoot, env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}
function store(name, data = profile) {
  const dir = path.join(fixtureRoot, name); fs.mkdirSync(dir, { recursive: true });
  const careerDb = path.join(dir, 'career_db.json'); fs.writeFileSync(careerDb, JSON.stringify(data, null, 2));
  return { dir, careerDb };
}
const paragraphs = (model) => model.pages[0].blocks;
const find = (model, text) => paragraphs(model).find((block) => block.runs.map((r) => r.text).join('') === text);
const setText = (block, text) => { block.runs = [{ ...block.runs[0], text }]; };

test('the master resume becomes a valid AI Office Word document with real headings and bullets', () => {
  const master = engine('base', store('layout'));
  const model = office.resumeToModel(master.resume, master.meta);
  assert.doesNotThrow(() => validate(model), 'AI Office accepts the document Career makes');
  assert.equal(model.kind, 'docx'); assert.equal(model.title, office.TITLE);
  assert.equal(find(model, 'Alex Fixture').style, 'title');
  assert.equal(find(model, 'Experience').style, 'heading1');
  assert.equal(find(model, 'Platform Lead — Acme').style, 'heading2');
  assert.equal(find(model, 'Cut deploy time 60%').list, 'bullet');
  const back = office.modelToResume(model, master.resume);
  assert.deepEqual(back.notes, []); assert.equal(back.error, undefined);
  assert.deepEqual(back.resume, master.resume, 'an untouched document maps back to exactly the master');
  assert.ok(office.sameResume(back.resume, master.resume));
});

test('an edited document saved through the existing base-save path keeps the career profile valid', () => {
  const s = store('save'), master = engine('base', s), model = office.resumeToModel(master.resume, master.meta);
  setText(find(model, master.resume.headline), 'Principal Platform Engineering Leader');
  setText(find(model, 'Led the team that shipped the platform'), 'Shipped the platform to 40 countries');
  const mapped = office.modelToResume(model, master.resume);
  assert.equal(mapped.error, undefined);
  assert.equal(office.sameResume(mapped.resume, master.resume), false);
  const saved = engine('base-save', s, { CH_RESUME_DOC: JSON.stringify({ resume: mapped.resume }) });
  assert.equal(saved.ok, true, JSON.stringify(saved)); assert.equal(saved.changed, true);
  const after = JSON.parse(fs.readFileSync(s.careerDb, 'utf8'));
  assert.equal(after.profile.headline, 'Principal Platform Engineering Leader');
  assert.deepEqual(after.roles.map((role) => role.title), ['Platform Lead', 'SRE'], 'roles and titles intact');
  assert.deepEqual(after.roles[0].deliverables, ['Shipped the platform to 40 countries', 'Cut deploy time 60%']);
  assert.deepEqual(after.roles[1].deliverables, profile.roles[1].deliverables);
  assert.equal(after.profile.experience_summary, 'Seasoned platform lead.', 'unsent fields survive');
  const reopened = engine('base', s);
  assert.ok(office.sameResume(office.modelToResume(model, reopened.resume).resume, reopened.resume),
    'the saved master and the document agree after the save');
});

test('a changed role heading is said and kept out of the save; the save still succeeds', () => {
  const s = store('heading'), master = engine('base', s), model = office.resumeToModel(master.resume, master.meta);
  setText(find(model, 'SRE — Beta Corp'), 'Senior SRE — Beta Corp');
  const mapped = office.modelToResume(model, master.resume);
  assert.match(mapped.notes.join(' '), /role heading "Senior SRE — Beta Corp" stays in this document only/);
  assert.equal(mapped.resume.experience[1].title, 'SRE');
  const saved = engine('base-save', s, { CH_RESUME_DOC: JSON.stringify({ resume: mapped.resume }) });
  assert.equal(saved.ok, true, 'no index/title mismatch refusal');
});

test('a removed role refuses the save in words; an extra section stays in the document only', () => {
  const master = engine('base', store('refuse')), model = office.resumeToModel(master.resume, master.meta);
  const blocks = paragraphs(model), role = blocks.indexOf(find(model, 'SRE — Beta Corp'));
  blocks.splice(role, 1);
  const removed = office.modelToResume(model, master.resume);
  assert.match(removed.error, /Experience section has 1 role and your profile has 2/);
  assert.equal(removed.resume, undefined, 'nothing to save');
  const extra = office.resumeToModel(master.resume, master.meta);
  paragraphs(extra).push({ ...find(extra, 'Summary'), id: 'extra-heading', runs: [{ ...find(extra, 'Summary').runs[0], text: 'Volunteering' }] });
  assert.match(office.modelToResume(extra, master.resume).notes.join(' '), /"Volunteering" stays in this document only/);
});

// ── Saving the document never changes the master by itself (live 2026-11-09 02:35) ─────────────
// An empty headline (the document shows the credential line in its place) and a skill holding two
// semicolons: the two things the 02:35 save changed in a master nobody had edited.
const quiet = {
  profile: { name: 'Sam Fixture', credential: 'Sam Fixture, PMP, CSM, SAFe Agilist', headline: '', location: 'Testville',
    clearance: '', citizenship: 'US', experience_summary: 'Leads delivery teams.' },
  roles: [{ title: 'Program Lead', org: 'Acme', start: '2020-01', end: null,
    deliverables: ['Ran the platform program for 40 engineers', 'Cut release time in half'] }],
  skills: {
    Delivery: { items: ['Agile delivery; Scrum ceremonies; SAFe release trains for 40 engineers', 'Kanban'] },
    Tools: { items: ['Jira', 'Confluence'] },
  },
};

// The page imports the shared document handoff by its served path; here it answers for the open document.
const handoff = { recordId: null };
globalThis.__careerOfficeHandoff = handoff;
registerHooks({ resolve(specifier, context, next) {
  if (specifier !== '/shared/ui/js/document-handoff.js') return next(specifier, context);
  const source = 'export async function beginDocumentHandoff(){return {context:{recordId:globalThis.__careerOfficeHandoff.recordId}};}\n'
    + 'export async function refreshOpenDocument(){}';
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
} });

/** AI Office's document routes as the host calls them, over one person's in-memory documents. */
function fakeOffice() {
  const documents = new Map(), reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  return async (url, init = {}) => {
    const method = init.method || 'GET', one = url.match(/^\/api\/presentations\/editor\/documents\/([^/]+)$/);
    if (url === '/api/presentations/editor/documents' && method === 'GET') {
      return reply(200, { documents: [...documents.values()].map(({ id, kind, title }) => ({ id, kind, title })) });
    }
    if (url === '/api/presentations/editor/documents' && method === 'POST') {
      const { model } = JSON.parse(init.body), id = `doc-${documents.size + 1}`;
      documents.set(id, { id, kind: model.kind, title: model.title, revision: 1, model });
      return reply(201, { document: documents.get(id) });
    }
    if (one && method === 'GET' && documents.has(one[1])) return reply(200, { document: documents.get(one[1]) });
    return reply(404, { error: `not in fixture: ${method} ${url}` });
  };
}

/** Open the master in createHost with the fake AI Office behind the page's fetch and a stand-in frame. */
async function withHost(master, saves, work) {
  const prior = { fetch: globalThis.fetch, document: globalThis.document }, statuses = [];
  globalThis.fetch = fakeOffice();
  globalThis.document = { createElement: () => ({ setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] ?? null; }, remove() {} }) };
  try {
    const host = office.createHost({ host: { hidden: true, append() {} }, readMaster: async () => master,
      saveMaster: async (resume) => { saves.push(resume); return { ok: true, changed: true, changelog: [] }; },
      status: (text) => statuses.push(text) });
    handoff.recordId = await host.open(master);
    return await work(host, statuses);
  } finally {
    globalThis.fetch = prior.fetch;
    if (prior.document === undefined) delete globalThis.document; else globalThis.document = prior.document;
  }
}

test('an empty headline and a skill with semicolons: the untouched document matches the master and Save changes nothing', async () => {
  const s = store('untouched', quiet), before = fs.readFileSync(s.careerDb), master = engine('base', s);
  assert.equal(master.resume.headline, quiet.profile.credential, 'the document shows the credential line where the empty headline is');
  const mapped = office.modelToResume(office.resumeToModel(master.resume, master.meta), master.resume);
  assert.deepEqual(mapped.resume.skills, master.resume.skills, 'a skill holding semicolons stays one skill');
  assert.ok(office.sameResume(mapped.resume, master.resume));
  const saves = [];
  await withHost(master, saves, async (host, statuses) => {
    assert.deepEqual(statuses, ['Matches your main résumé'], 'opening the untouched document says it matches');
    assert.equal((await host.saveToMaster()).changed, false, 'Save to main résumé says Matches your main résumé');
  });
  assert.deepEqual(saves, [], 'nothing is sent to the master save');
  const forced = engine('base-save', s, { CH_RESUME_DOC: JSON.stringify({ resume: mapped.resume }) });
  assert.equal(forced.ok, true, JSON.stringify(forced));
  assert.equal(forced.changed, false, `a forced save of the untouched document changes nothing: ${JSON.stringify(forced.changelog)}`);
  assert.ok(fs.readFileSync(s.careerDb).equals(before), 'the master file is byte for byte unchanged');
  assert.equal(fs.existsSync(path.join(s.dir, 'backups')), false, 'no snapshot was taken');
  assert.equal(fs.existsSync(path.join(s.dir, 'enrichment_log.jsonl')), false, 'no history record was written');
});

test('a real edit saves only that edit: the credential line shown for an empty headline is never saved as the headline', () => {
  const s = store('one-edit', quiet), master = engine('base', s), model = office.resumeToModel(master.resume, master.meta);
  setText(find(model, 'Cut release time in half'), 'Cut release time from 6 weeks to 3');
  const mapped = office.modelToResume(model, master.resume);
  const saved = engine('base-save', s, { CH_RESUME_DOC: JSON.stringify({ resume: mapped.resume }) });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(saved.changelog, ['role 1 (Program Lead) bullets updated (2)']);
  const after = JSON.parse(fs.readFileSync(s.careerDb, 'utf8'));
  assert.equal(after.profile.headline, '', 'the headline stays empty');
  assert.deepEqual(after.skills, quiet.skills, 'every skill stays in its own group, and no group is added');
  assert.deepEqual(after.roles[0].deliverables, ['Ran the platform program for 40 engineers', 'Cut release time from 6 weeks to 3']);
});

test('a skill holding the separator survives an untouched round trip; an edited line still reads semicolons as text', () => {
  const data = { ...quiet, skills: { Methods: { items: ['Lean · Six Sigma', 'Kaizen'] } } };
  const master = engine('base', store('separator', data)), model = office.resumeToModel(master.resume, master.meta);
  assert.deepEqual(office.modelToResume(model, master.resume).resume.skills, ['Lean · Six Sigma', 'Kaizen']);
  setText(find(model, 'Lean · Six Sigma · Kaizen'), 'Lean · Six Sigma · Kaizen · Value streams; flow mapping');
  assert.deepEqual(office.modelToResume(model, master.resume).resume.skills.slice(-1), ['Value streams; flow mapping']);
});
