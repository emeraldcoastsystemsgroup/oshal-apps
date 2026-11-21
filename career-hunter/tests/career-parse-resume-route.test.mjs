/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: the Send step's "Résumé for upload forms" download, GET /resume?id=<job>&kind=parse&format=docx, through Career's real compiled board routes over real Express and HTTP on made-up people's real stores. It serves the packet's own Resume_Parse.docx byte for byte; for a packet made before 1.72.0 it renders one from the packet's application.json with the real docx_resume.py (the same bytes as the export, and nothing written into the packet); it is Word only (400 for PDF or RTF); nobody signed in is refused (401) and another person's job is not found (404). Red before: kind=parse was read as the résumé, so it served the executive Word résumé (Resume_Professional.docx) and a PDF for format=pdf.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isolateRunnerEnv, loadCompiledModules, sqliteRows } from './helpers/career-route-harness.mjs';

const require = createRequire(import.meta.url);
const toolchain = path.resolve(import.meta.dirname, '../../scripts/toolchain');
const express = require(require.resolve('express', { paths: [toolchain] }));
const Database = require(require.resolve('better-sqlite3', { paths: [toolchain] }));
const docx = require('../lib/career-docx-export');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-parse-route-'));
const OWN = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('made-up parse résumé of job 81')]);
let restoreEnv, server, origin, modules;

/** A made-up person's packet for job 81, as generation leaves it; `own` is a Resume_Parse.docx beside it, or none. */
function seed(sub, own) {
  const paths = modules.store.userPaths(sub), folder = path.join(paths.userDir, 'applications', 'Example_Freight_Co__81');
  fs.mkdirSync(folder, { recursive: true });
  const profile = { name: 'Morgan T Example', email: 'morgan@example.test', phone: '555-0177',
    application_contact: { address1: '7 Sample Street', city: 'Dayton', state: 'Ohio', state_abbrev: 'OH', postal_code: '45402', country: 'United States' } };
  const roles = [{ id: 'r1', title: 'Office Manager', org: 'Example Freight Co', start: '2019-04', end: null }];
  fs.writeFileSync(path.join(paths.userDir, 'career_db.json'), JSON.stringify({ profile, roles }));
  fs.writeFileSync(path.join(folder, 'application.json'), JSON.stringify({ company: 'Example Freight Co', title: 'Office Manager', template_family: 'Professional',
    generated: { resume: { headline: 'Office manager', summary: 'Runs offices.', experience: [{ id: 'r1', title: 'Office Manager', org: 'Example Freight Co', span: 'Apr 2019 to Present', bullets: ['Ran the front office.'] }] }, cover: {} },
    profile_snapshot: { profile, roles } }));
  fs.writeFileSync(path.join(folder, 'Resume_ATS.pdf'), '%PDF-1.7\nmade-up résumé\n%%EOF');
  if (own) fs.writeFileSync(path.join(folder, 'Resume_Parse.docx'), own);
  sqliteRows(paths, sub, [['INSERT OR REPLACE INTO corpus.companies(id,name) VALUES(?,?)', [1, 'Example Freight Co']],
    ['INSERT OR REPLACE INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,active) VALUES(?,?,?,?,?,1)', [81, 1, '81', 'Office Manager', 'https://jobs.example.com/81']],
    ['INSERT OR REPLACE INTO user_signals(posting_id,status,resume_path) VALUES(?,?,?)', [81, 'generated', path.join(folder, 'Resume_ATS.pdf')]]]);
  return folder;
}
const get = async (route, sub) => { const r = await fetch(origin + '/api/career-hunter' + route, { headers: sub ? { 'x-test-person': sub } : {} }); return { status: r.status, type: r.headers.get('content-type') || '', disposition: r.headers.get('content-disposition') || '', bytes: Buffer.from(await r.arrayBuffer()) }; };
const documentXml = (bytes) => execFileSync(process.env.JOBHUNTER_PYTHON || 'python3', ['-c', 'import io,sys,zipfile; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read("word/document.xml").decode())'], { input: bytes, encoding: 'utf8' });

before(async () => {
  restoreEnv = isolateRunnerEnv(path.join(root, 'store'));
  ({ modules } = loadCompiledModules({ board: 'routes/career-board-routes.js', store: 'routes/career-user-store.js' }, { 'better-sqlite3': Database, express }));
  const app = express(), router = express.Router();
  app.use((req, _res, next) => { const sub = req.headers['x-test-person']; if (sub) req.oidc = { user: { sub: String(sub) } }; next(); });
  modules.board.registerCareerBoardRoutes(router, { pool: { async query() { return { rows: [] }; } } });
  app.use('/api/career-hunter', router);
  server = app.listen(0, '127.0.0.1'); await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise((done) => (server ? server.close(done) : done())); restoreEnv?.(); fs.rmSync(root, { recursive: true, force: true }); });

test('the packet’s own Resume_Parse.docx is served byte for byte as a Word file', async () => {
  seed('morgan-own', OWN);
  const got = await get('/resume?id=81&kind=parse&format=docx', 'morgan-own');
  assert.equal(got.status, 200);
  assert.equal(got.type.split(';')[0], docx.MIME_BY_FORMAT.docx);
  assert.match(got.disposition, /Resume_For_Upload\.docx"$/);
  assert.deepEqual(got.bytes, OWN);
});

test('a packet made before the parse résumé gets one rendered from its application.json, and nothing is written into it', async () => {
  const folder = seed('morgan-older', null), before = fs.readdirSync(folder).sort();
  const got = await get('/resume?id=81&kind=parse&format=docx', 'morgan-older');
  assert.equal(got.status, 200);
  assert.deepEqual([...got.bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'a Word file, not the PDF');
  const xml = documentXml(got.bytes);
  for (const line of ['Job Title: ', 'Office Manager', 'Company: ', 'Start Date: ', '04/2019', 'End Date: ', 'Present', 'Address: ', '7 Sample Street, Dayton, OH 45402, United States'])
    assert.ok(xml.includes(line), 'the parse résumé carries ' + line);
  const direct = await docx.renderPacketArtifact({ packetJsonPath: path.join(folder, 'application.json'), kind: 'parse', format: 'docx' });
  assert.deepEqual(got.bytes, direct.bytes, 'the same bytes as the export');
  assert.deepEqual(fs.readdirSync(folder).sort(), before, 'a download changes nothing in the packet');
});

test('it is Word only, and only the signed-in person’s own job', async () => {
  seed('morgan-refusals', OWN);
  for (const format of ['pdf', 'rtf']) {
    const refused = await get(`/resume?id=81&kind=parse&format=${format}`, 'morgan-refusals');
    assert.equal(refused.status, 400, format);
    assert.match(refused.bytes.toString(), /Word \(\.docx\)/);
  }
  assert.equal((await get('/resume?id=81&kind=parse&format=docx', null)).status, 401, 'nobody signed in');
  fs.mkdirSync(modules.store.userPaths('someone-else').userDir, { recursive: true });
  sqliteRows(modules.store.userPaths('someone-else'), 'someone-else', []);
  const theirs = await get('/resume?id=81&kind=parse&format=docx', 'someone-else');
  assert.equal(theirs.status, 404, 'another person has no such job');
  assert.notDeepEqual(theirs.bytes, OWN);
});
