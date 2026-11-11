/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | For the source maintenance route and page proofs: have the engine's own contract build the corpus six real nightly pulls leave, open it the way a request does (attached read-only as `corpus`), and load the shipped Companies routes over it with their real library and a real outbox folder.
 */
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
export const sourceHealth = require('../../lib/career-source-health');
export const sourceRequests = require('../../lib/career-source-requests');
/** The first employer in the fixture, whose name must stay text wherever it is shown. */
export const HOSTILE = '<img src=x onerror="window.__injected=1">Hostile & Co';

/**
 * @description The corpus the engine leaves after six real pulls. On the last night two decisions opened, one repair brief
 * opened, one employer was connected, two were suggested, and a third dead source was removed. Read-only, as a request sees it.
 * @returns {{db: object, file: string, owner: string, id: (name: string) => number, outbox: () => object[], close: () => void}}
 */
export function buildCorpus() {
  const folder = mkdtempSync(join(tmpdir(), 'career-maintenance-'));
  const file = join(folder, 'corpus.db');
  const built = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('../career-source-maintenance.py', import.meta.url)), '--corpus', file],
    {encoding: 'utf8', timeout: 120000, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  if (built.status !== 0) {
    rmSync(folder, {recursive: true, force: true});
    throw new Error(`the engine could not build the maintenance corpus: ${built.stderr || built.error?.message || built.stdout}`);
  }
  const db = new DatabaseSync(':memory:');
  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS corpus`);
  db.exec('PRAGMA query_only=ON');
  const owner = join(folder, 'owner');
  mkdirSync(owner);
  return {db, file, owner,
    id: name => db.prepare('SELECT id FROM corpus.companies WHERE name=?').get(name).id,
    outbox: () => {
      try { return readdirSync(join(owner, '.source-request-outbox')).map(name => JSON.parse(readFileSync(join(owner, '.source-request-outbox', name), 'utf8'))); }
      catch { return []; }
    },
    close: () => { db.close(); rmSync(folder, {recursive: true, force: true}); }};
}

/**
 * @description The shipped routes file with its kernel-side dependencies as plain doubles; its library, corpus reads and
 * outbox are real. Only `fixture-admin` is an administrator.
 * @param {{db: object, owner: string}} corpus - From buildCorpus, or any corpus attached the same way.
 * @returns {{registered: Map<string, Function[]>, engine: {runs: number}, call: Function}}
 */
export function loadRoutes({db, owner}) {
  const registered = new Map();
  const module = {exports: {}};
  const engine = {runs: 0};
  const leaves = {
    '@/shared/logger': {createChildLogger: () => ({info(){}, warn(){}, error(){}})},
    '@/shared/middleware/authz': {isOperator: () => false},
    './career-user-store': {callerSub: req => req.sub, userPaths: () => ({userDir: owner}),
      openCorpusDb: () => (db ? {prepare: sql => db.prepare(sql), close(){}} : null), openUserDb: () => { throw new Error('not used'); }},
    './career-engine-dispatch': {runCareerCliAwait: async () => { engine.runs++; return {ok: true, out: '{}'}; }},
    './career-engine-response': {},
    './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
    '../lib/career-source-health': sourceHealth,
    '../lib/career-source-requests': sourceRequests,
  };
  const before = process.env.CAREER_HUNTER_ADMIN_SUBS;
  process.env.CAREER_HUNTER_ADMIN_SUBS = 'fixture-admin';
  try {
    new Function('require', 'module', 'exports', readFileSync(new URL('../../routes/career-company-routes.js', import.meta.url), 'utf8'))(
      id => { if (!(id in leaves)) throw new Error(`dependency ${id}`); return leaves[id]; }, module, module.exports);
  } finally {
    if (before === undefined) delete process.env.CAREER_HUNTER_ADMIN_SUBS; else process.env.CAREER_HUNTER_ADMIN_SUBS = before;
  }
  const keep = (url, ...handlers) => registered.set(url, handlers);
  module.exports.registerCareerCompanyRoutes({get: keep, post: keep}, {});
  const call = async (url, query = {}, sub = 'fixture-admin') => {
    const out = {status: 200, passed: false};
    const res = {setHeader(){}, status(code) { out.status = code; return res; }, json(value) { out.body = value; }};
    const req = {sub, query, path: url, accepts: () => 'json'};
    const handlers = registered.get(url);
    if (!handlers) throw new Error(`route ${url}`);
    await new Promise(done => {
      handlers[0](req, res, () => { out.passed = true; handlers[1](req, res); });
      setImmediate(done);
    });
    return out;
  };
  return {registered, engine, call};
}
