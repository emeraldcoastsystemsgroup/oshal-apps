/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24: a made-up person and the harness the Years by skill suites share (tests/career-years-edit.test.mjs, tests/career-years-by-skill-page.test.mjs). The harness mounts Career's real compiled résumé route module (routes/career-resume-studio-routes.js) on a local Express server and runs the real engine programs through the real command mapping (bin/oshal-jobhunter.js) over the made-up person's own folder. Only what sits outside that boundary is stood in: the logger, the bot client, the caller's identity and the path of the person's folder. The person's jobs all have an end month, so the years counted from them do not move with the calendar.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
export const packageRoot = path.resolve(import.meta.dirname, '../..');
const repo = path.resolve(packageRoot, '..'), toolchain = path.join(repo, 'scripts/toolchain');
const express = require(require.resolve('express', { paths: [toolchain] }));
const platform = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_CORE_ROOT;
const python = process.env.CAREER_TEST_PYTHON || 'python3';

/**
 * @description A made-up person: three jobs with end months (3.5, 5 and 1 years, 9.5 in all), a figure of their own
 * for one skill their jobs name (Python) and for one they do not (a three-word name), and a total of their own.
 * @param {object} [extra] Keys to add or replace.
 * @returns {object} a career_db.json
 */
export function yearsProfile(extra = {}) {
  return {
    profile: { name: 'Morgan Sample', headline: 'Platform engineer', experience_summary: 'Made-up summary.', clearance: 'None' },
    roles: [
      { id: 'r1', title: 'Platform Engineer', org: 'Sample Freight', start: '2021-01', end: '2024-06', deliverables: ['Ran the build farm.'], skills: ['Python', 'Docker'] },
      { id: 'r2', title: 'Systems Engineer', org: 'Northwind Logistics', start: '2016-01', end: '2020-12', deliverables: ['Kept the ledger running.'], skills: ['Java', 'SQL'] },
      { id: 'r3', title: 'Support Analyst', org: 'Sample Library', start: '2015-01', end: '2015-12', deliverables: ['Answered the help desk.'], skills: ['Linux'] },
    ],
    skills: { Core: { items: ['Python', 'Java'] } },
    career_years: 15,
    years_by_skill: [{ skill: 'Python', years: 10 }, { skill: 'SAP NetWeaver Java', years: 6.5 }],
    ...extra,
  };
}

/** Career's real route module, loaded once with only its collaborators outside the engine and the router stood in. */
function loadStudio(current) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
    if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
    if (request === '@/app/routes/inline-bot-execution' || request === './career-engine-runner') return {};
    if (request === './career-user-store') return { callerSub: () => 'morgan', findUserPaths: () => ({ userDir: current.dir }), userPaths: () => ({ userDir: current.dir }) };
    if (request === './career-engine-dispatch') return { runCareerCliAwait: async (_pool, sub, args, env) => { assert.equal(sub, 'morgan'); return current.engine(args, env); } };
    return original.call(this, request, ...rest);
  };
  try { return require('../../routes/career-resume-studio-routes.js'); } finally { Module._load = original; }
}

/** The engine's own command mapping, so a route's verb runs the program the shipped launcher would run. */
function loadMapping() {
  const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
  cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
  return cli.exports.mapping;
}

const RIBBON = [['home', 'Home', 'home'], ['work-history', 'Work history', 'work-history']]
  .map(([id, name, view]) => ({ id: 'tool-career-' + id, label: name, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));

/** The server: the real routes, and for a page test the shipped Work history page with what its frame asks for. */
function serve(studio, page) {
  const web = express(), router = express.Router(), tools = path.join(packageRoot, 'tools');
  web.use(express.json());
  studio.registerCareerResumeStudio(router, { pool: {} });
  web.use('/api/career-hunter', router);
  if (!page) return web;
  // Relative to a root: an absolute path through a dot folder (a platform pin under a dot folder) is refused by sendFile.
  web.get('/api/career-hunter/work-history', (_req, res) => res.sendFile('career-work-history.html', { root: tools }));
  web.use('/api/career-hunter/static', express.static(tools));
  web.use('/shared/ui', express.static(path.join(platform, 'src/shared/ui')));
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: RIBBON } } }));
  web.get('/api/auth/user', (_req, res) => res.json({ displayName: 'Morgan' }));
  web.get('/api/career-hunter/jobs/stats', (_req, res) => res.json({ saved: 0, queued: 0, tracked: 0 }));
  web.get('/api/presentations/editor/documents', (_req, res) => res.json({ documents: [] }));
  return web;
}

/** What a case reads of the person's folder: the main résumé, its backups, the audit, and engine code run over it. */
function folder(current, env) {
  const file = () => path.join(current.dir, 'career_db.json'), kept = () => path.join(current.dir, 'backups');
  return {
    text: () => fs.readFileSync(file(), 'utf8'),
    saved: () => JSON.parse(fs.readFileSync(file(), 'utf8')),
    backups: () => (fs.existsSync(kept()) ? fs.readdirSync(kept()).map((name) => path.join(kept(), name)) : []),
    audit: () => fs.readFileSync(path.join(current.dir, 'enrichment_log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
    digest: (value) => crypto.createHash('sha256').update(value).digest('hex'),
    /** Run engine code over the case's folder and answer the JSON it prints; a failure fails the case with its words. */
    python(code) {
      const out = spawnSync(python, ['-c', code], { cwd: packageRoot, encoding: 'utf8', timeout: 30000, env: env() });
      assert.equal(out.status, 0, out.stderr);
      return JSON.parse(out.stdout);
    },
  };
}

/**
 * @description The harness: a temporary folder per case, the real engine over it, and the real routes over HTTP.
 * One harness per process (the route module is loaded once, bound to this harness's folder).
 * @param {string} label Names the temporary folder.
 * @returns {object} reset, text, saved, backups, audit, digest, python, call, read, save, start, stop and origin.
 */
export function yearsHarness(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label + '-')), mapping = loadMapping();
  const current = { dir: '', engine: null }, harness = { origin: '', server: null };
  const env = () => ({ ...process.env, JOBHUNTER_DATA: current.dir, JOBHUNTER_CAREER_DB: path.join(current.dir, 'career_db.json'), PYTHONPATH: path.join(packageRoot, 'engine') });
  current.engine = (args, extra = {}) => {
    const out = spawnSync(python, mapping(args[0], args.slice(1))[0], { cwd: packageRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...env(), ...extra } });
    return { ok: out.status === 0, out: out.stdout, err: out.stderr };
  };
  const studio = loadStudio(current);
  return Object.assign(harness, folder(current, env), {
    /** A new folder for one case, holding `data` as the person's main résumé (none when `data` is null). */
    reset(name, data = yearsProfile()) {
      current.dir = path.join(root, name); fs.mkdirSync(current.dir, { recursive: true });
      if (data) fs.writeFileSync(path.join(current.dir, 'career_db.json'), JSON.stringify(data, null, 2));
    },
    async call(method, route, body) {
      const response = await fetch(harness.origin + '/api/career-hunter' + route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      return { code: response.status, body: await response.json() };
    },
    read: () => harness.call('GET', '/resume/master-section?field=years'),
    save: (revision, value) => harness.call('POST', '/resume/master-edit', { revision, edits: [{ op: 'set', field: 'years', value, summary: 'Years by skill edited on Work history' }] }),
    /** Start the server; `page: true` also serves the shipped Work history page, which needs the kernel platform folder. */
    async start({ page = false } = {}) {
      if (page) assert.ok(platform, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
      harness.server = serve(studio, page).listen(0, '127.0.0.1');
      await new Promise((done) => harness.server.once('listening', done));
      harness.origin = 'http://127.0.0.1:' + harness.server.address().port;
      return harness.origin;
    },
    async stop() {
      harness.server?.closeAllConnections();
      await new Promise((done) => (harness.server ? harness.server.close(done) : done()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  });
}
