/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-LOCATION: `person(sub, {locations})` gives some of the made-up person's jobs a location (role id to location) on the record and in the packet's profile snapshot, as Work history saves them before the job's documents are made; without it the person is exactly as before.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.76.3: the scripted ticket port answers getTicket with a status a test can set (ticketStatus), so a run whose ticket the kernel failed can be proved.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.76.4: the scripted port can answer getTicketWork as gone (workGone), as the kernel does for a cancelled ticket's work.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH: `job(sub, id, {company, title, url})` adds another prepared job to a made-up person already in the harness (its own company, posting, packet folder with both PDFs and the parse résumé, its row and its preparation receipt, the way job 7 is stored), and `mark(id, status)` sets a job's row as I applied does, so a batch of several jobs runs over the same real routes and store.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: the made-up Word file beside the packet is the parse résumé, Resume_Parse.docx, which generation now writes and the packet uploads; `executive` also writes an executive Resume_ATS.docx, so a case can show it is not the one uploaded. The packet's profile snapshot carries the recorded roles, as generation saves it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G): a made-up person's job may name its company's engine and token and the posting's engine id ({company: {atsType, atsToken}, atsJobId}), as Career's sources record them, for a company page that embeds an engine's form.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the made-up person's address is held as a person's record holds it, in profile.application_contact (address1, city, state, state_abbrev, postal_code, country), beside profile.phone.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the shared harness of the career-apply suites. A made-up person (Dana Example: four recorded roles, one held by year only and one current, two schools) with one prepared Workday job whose résumé carries three of them (the fourth ended more than 20 years ago, so no résumé must carry it), stored the way Career stores it (the engine's own SQLite schemas, the packet folder, the preparation receipt) under a disposable store root; Career's real lib/career-apply-routes.js over real Express and HTTP, the real user store, autofill profile reader, containment checks and docx_resume.py; the main résumé's month edit runs the real engine program over the person's folder. Only the kernel's ticket port is stood in (a scripted work record), because the kernel is outside the package.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { loadCompiledModules } from './career-route-harness.mjs';

const require = createRequire(import.meta.url);
export const packageRoot = path.resolve(import.meta.dirname, '../..');
const toolchain = path.join(packageRoot, '..', 'scripts/toolchain');
const express = require(require.resolve('express', { paths: [toolchain] }));
const Database = require(require.resolve('better-sqlite3', { paths: [toolchain] }));
const python = process.env.JOBHUNTER_PYTHON || 'python3';
/** A made-up Word file beside a packet, as generation writes Resume_Parse.docx (only the cases that need a render make one). */
export const WORD = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('made-up Word résumé of job 7')]);
export const WORKDAY = 'https://example.wd1.myworkdayjobs.com/en-US/External/job/Office-Manager_R100';
export const ROLES = [
  { id: 'r1', title: 'Office Manager', org: 'Example Freight Co', start: '2019-04', end: null, deliverables: ['Ran the front office for 40 people.'] },
  { id: 'r2', title: 'Operations Coordinator', org: 'Sample Logistics LLC', start: '2015-06', end: '2019-03', deliverables: ['Scheduled 300 deliveries a week.'] },
  { id: 'r3', title: 'Administrative Assistant', org: 'Northwind Traders', start: '2012', end: '2015', deliverables: ['Kept the calendar for three directors.'] },
  { id: 'r4', title: 'Receptionist', org: 'Contoso Clinic', start: '2002-01', end: '2005-12', deliverables: ['Answered the phones.'] },
];
/** @description The made-up person's record. @returns {object} career_db.json */
export function record() {
  return {
    profile: { name: 'Dana Q Example', email: 'dana@example.test', phone: '555-0100', linkedin: 'https://www.linkedin.com/in/dana-example', location: 'Springfield, IL',
      application_contact: { address1: '1 Example Way', city: 'Springfield', state: 'Illinois', state_abbrev: 'IL', postal_code: '62701', country: 'United States' } },
    roles: ROLES.map((role) => ({ ...role })),
    education: ['MBA, Example State University, 2011', { school: 'Sample College', degree: 'BS', field: 'Accounting', start: 2001, end: 2005 }],
  };
}
/** @description The job's generated résumé: three of the four roles (the receptionist job is not on it). @returns {object} */
function resume() {
  return {
    headline: 'Office manager', summary: 'Runs offices.', skills: ['Scheduling'],
    experience: [
      { title: 'Office Manager', org: 'Example Freight Co', span: 'Apr 2019 to Present', bullets: ['Ran the front office.'] },
      { title: 'Operations Coordinator', org: 'Sample Logistics LLC', span: 'Jun 2015 to Mar 2019', bullets: ['Scheduled deliveries.'] },
      { title: 'Administrative Assistant', org: 'Northwind Traders', span: '2012 to 2015', bullets: ['Kept calendars.'] },
    ],
    education: ['MBA | Example State University | 2011'],
  };
}

/** The engine's own command mapping, so the month edit runs the program the shipped launcher would run. */
function loadMapping() {
  const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
  cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
  return cli.exports.mapping;
}

/**
 * @description The kernel's ticket port as a scripted work record: what Career asked of it, and what it answers.
 * @returns {object} The port and its record.
 */
export function kernel() {
  const port = { created: [], started: [], rows: [], accepted: new Map(), artifacts: new Map(), refuseStart: null, ticketStatus: new Map() };
  port.createTicket = async (input) => { port.created.push(input); return { ticketId: 'a2000000-0000-0000-0000-00000000000' + port.created.length }; };
  port.startTicket = async (ticketId, input) => {
    if (port.refuseStart) throw port.refuseStart;
    port.started.push({ ticketId, input });
    return { envelope: { id: 'b2000000-0000-0000-0000-00000000000' + port.started.length } };
  };
  port.getTicketWork = async () => { if (port.workGone) throw Object.assign(Error('no such work'), { code: 'not_found' }); return port.rows.map((row) => ({ ...row })); };
  port.getTicket = async (id) => ({ id, status: port.ticketStatus.get(id) || 'open' });
  port.getAcceptedWork = async (_ticket, work) => (port.accepted.has(work) ? { answer: JSON.stringify(port.accepted.get(work)) } : null);
  port.getAcceptedArtifact = async (_ticket, work, name) => port.artifacts.get(work + '/' + name) || null;
  return port;
}

/**
 * @description The harness: a disposable store root, the real route module over HTTP, and people in it.
 * @returns {Promise<object>} person, call, raw, kernel, input, stop and the store root.
 */
export async function applyHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-apply-')), previous = process.env.JOBHUNTER_STORE_ROOT;
  process.env.JOBHUNTER_STORE_ROOT = root;
  const mapping = loadMapping(), engineCalls = [];
  const runEngine = async (_pool, sub, args, extra = {}) => {
    const dir = modules.store.userPaths(sub).userDir;engineCalls.push({ sub, args, extra });
    const out = spawnSync(python, mapping(args[0], args.slice(1))[0], { cwd: packageRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, JOBHUNTER_DATA: dir, JOBHUNTER_CAREER_DB: path.join(dir, 'career_db.json'), PYTHONPATH: path.join(packageRoot, 'engine'), ...extra } });
    return { ok: out.status === 0, out: out.stdout, err: out.stderr };
  };
  const { modules } = loadCompiledModules({ apply: 'lib/career-apply-routes.js', store: 'routes/career-user-store.js' },
    { 'better-sqlite3': Database, express, '../routes/career-engine-dispatch': { runCareerCliAwait: runEngine } });
  const port = kernel(), app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { const sub = req.headers['x-test-person']; if (sub) req.oidc = { user: { sub: String(sub) } }; next(); });
  app.use('/api/career-hunter', modules.apply.createCareerApplyRoutes({ pool: {}, ticketService: port }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((done) => server.once('listening', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const raw = (method, route, body, sub) => fetch(origin + '/api/career-hunter' + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(sub ? { 'x-test-person': sub } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const call = async (method, route, body, sub) => { const response = await raw(method, route, body, sub); return { code: response.status, body: await response.json().catch(() => null) }; };
  return { root, origin, port, engineCalls, call, raw, person: (sub, options) => person(modules, sub, options), job: (sub, id, options) => addJob(modules, sub, id, options),
    async stop() { await new Promise((done) => server.close(done)); if (previous === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = previous; fs.rmSync(root, { recursive: true, force: true }); } };
}

/**
 * @description One made-up person with one prepared job (id 7) on `url`, stored the way Career stores it.
 * @param {object} modules The loaded modules. @param {string} sub The person's subject.
 *   @param {{url?:string,word?:Buffer|null,executive?:Buffer,company?:{atsType?:string,atsToken?:string},atsJobId?:string,locations?:Record<string,string>}} [options]
 *   The posting's address; the parse résumé beside the packet (a made-up one by default; null: none, so Career renders one with
 *   docx_resume.py); an executive Word résumé (Resume_ATS.docx) to write beside it; the company's engine and token and the
 *   posting's engine id, as a source records them; where some of the person's jobs were (role id to location), as Work history
 *   saves them on the record before the job's documents are made, so the record and the packet's profile snapshot both hold them.
 * @returns {{sub:string,dir:string,folder:string,signal:Function}} The person.
 */
function person(modules, sub, { url = WORKDAY, word = WORD, executive = null, company = {}, atsJobId = 'fiction-7', locations = {} } = {}) {
  const paths = modules.store.userPaths(sub), dir = paths.userDir, engine = fs.readFileSync(path.join(packageRoot, 'engine/jobhunter/db.py'), 'utf8');
  const own = record();
  own.roles = own.roles.map((role) => (locations[role.id] ? { ...role, location: locations[role.id] } : role));
  fs.mkdirSync(path.dirname(paths.corpusDb), { recursive: true }); fs.mkdirSync(dir, { recursive: true });
  const corpus = new Database(paths.corpusDb);
  corpus.exec(engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1].replaceAll('corpus.', ''));
  corpus.prepare("INSERT OR REPLACE INTO companies(id,name,ats_type,ats_token)VALUES(1,'Example Freight Co',?,?)").run(company.atsType ?? null, company.atsToken ?? null);
  corpus.prepare("INSERT OR REPLACE INTO postings_corpus(id,company_id,ats_job_id,title,url,active)VALUES(7,1,?,'Office Manager',?,1)").run(atsJobId, url);corpus.close();
  fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(own, null, 2));
  const folder = path.join(dir, 'applications', 'Example_Freight_Co__7'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'application.json'), JSON.stringify({ company: 'Example Freight Co', title: 'Office Manager', template_family: 'Professional',
    generated: { resume: resume(), cover: { greeting: 'Dear team,', paragraphs: ['I run offices well.'], closing: 'Sincerely,' } }, profile_snapshot: { profile: own.profile, roles: own.roles } }, null, 2));
  fs.writeFileSync(path.join(folder, 'Resume_ATS.pdf'), '%PDF-1.7\nDana Example resume\n%%EOF');
  fs.writeFileSync(path.join(folder, 'CoverLetter.pdf'), '%PDF-1.7\nDana Example cover\n%%EOF');
  if (word) fs.writeFileSync(path.join(folder, 'Resume_Parse.docx'), word);
  if (executive) fs.writeFileSync(path.join(folder, 'Resume_ATS.docx'), executive);
  const db = new Database(paths.userDb); db.exec(engine.match(/USER_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);
  db.prepare("INSERT OR REPLACE INTO user_signals(posting_id,status,resume_path,cover_path)VALUES(7,'generated',?,?)").run(path.join(folder, 'Resume_ATS.pdf'), path.join(folder, 'CoverLetter.pdf')); db.close();
  const draft = require('../../lib/career-application-draft'), board = require('../../lib/career-board-state'), bank = require('../../lib/career-experience-bank');
  const job = { id: 7, status: 'generated', has_resume: true, has_cover: true, resume_path: path.join(folder, 'Resume_ATS.pdf'), cover_path: path.join(folder, 'CoverLetter.pdf') };
  draft.begin(dir, 7, job, { revision: 0, guidance: '', experienceIds: [], experienceRevision: bank.read(dir).revision, experienceChosen: true }, 'req-7', true);
  board.updateBoardState(dir, 7, { requestId: 'req-7', phase: 'ready', completedAt: new Date().toISOString() });
  const signal = () => { const d = new Database(paths.userDb); try { return d.prepare('SELECT * FROM user_signals WHERE posting_id=7').get(); } finally { d.close(); } };
  const mark = (id, status) => { const d = new Database(paths.userDb); try { d.prepare('UPDATE user_signals SET status=? WHERE posting_id=?').run(status, id); } finally { d.close(); } };
  assert.ok(dir.startsWith(fs.realpathSync(os.tmpdir())) || dir.startsWith(os.tmpdir()), 'the made-up person stays inside the disposable root');
  return { sub, dir, folder, signal, mark };
}

/**
 * @description Another prepared job for a made-up person already made by person(): its own company and posting in the
 * corpus, its packet folder (both PDFs and the parse résumé), its row and its preparation receipt, stored as job 7 is.
 * @param {object} modules The loaded modules. @param {string} sub The person. @param {number} id The posting.
 * @param {{company?:string,title?:string,url?:string}} [options] @returns {{id:number,folder:string}}
 */
function addJob(modules, sub, id, { company = 'Sample Company ' + id, title = 'Office Manager', url = `https://example${id}.wd1.myworkdayjobs.com/en-US/External/job/Office-Manager_R${id}` } = {}) {
  const paths = modules.store.userPaths(sub), dir = paths.userDir, corpus = new Database(paths.corpusDb);
  corpus.prepare('INSERT OR REPLACE INTO companies(id,name)VALUES(?,?)').run(id + 100, company);
  corpus.prepare('INSERT OR REPLACE INTO postings_corpus(id,company_id,ats_job_id,title,url,active)VALUES(?,?,?,?,?,1)').run(id, id + 100, 'fiction-' + id, title, url); corpus.close();
  const folder = path.join(dir, 'applications', company.replace(/\W+/g, '_') + '__' + id); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'application.json'), JSON.stringify({ company, title, template_family: 'Professional',
    generated: { resume: resume(), cover: { greeting: 'Dear team,', paragraphs: ['I run offices well.'], closing: 'Sincerely,' } }, profile_snapshot: { profile: record().profile, roles: record().roles } }, null, 2));
  fs.writeFileSync(path.join(folder, 'Resume_ATS.pdf'), `%PDF-1.7\nDana Example resume for job ${id}\n%%EOF`);
  fs.writeFileSync(path.join(folder, 'CoverLetter.pdf'), `%PDF-1.7\nDana Example cover for job ${id}\n%%EOF`);
  fs.writeFileSync(path.join(folder, 'Resume_Parse.docx'), Buffer.concat([WORD.subarray(0, 4), Buffer.from('made-up Word résumé of job ' + id)]));
  const db = new Database(paths.userDb);
  db.prepare("INSERT OR REPLACE INTO user_signals(posting_id,status,resume_path,cover_path)VALUES(?,'generated',?,?)").run(id, path.join(folder, 'Resume_ATS.pdf'), path.join(folder, 'CoverLetter.pdf')); db.close();
  const draft = require('../../lib/career-application-draft'), board = require('../../lib/career-board-state'), bank = require('../../lib/career-experience-bank');
  const row = { id, status: 'generated', has_resume: true, has_cover: true, resume_path: path.join(folder, 'Resume_ATS.pdf'), cover_path: path.join(folder, 'CoverLetter.pdf') };
  draft.begin(dir, id, row, { revision: 0, guidance: '', experienceIds: [], experienceRevision: bank.read(dir).revision, experienceChosen: true }, 'req-' + id, true);
  board.updateBoardState(dir, id, { requestId: 'req-' + id, phase: 'ready', completedAt: new Date().toISOString() });
  return { id, folder };
}
