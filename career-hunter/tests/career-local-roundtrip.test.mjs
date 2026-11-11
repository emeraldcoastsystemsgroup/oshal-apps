/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | S-6 (1.52.0): Verify localEditing manifest declaration, .odt archive and structured text export, round-trip import mapping of edited .odt and plain text back into whitelisted master resume fields, and loopback HTTP execution of GET /resume/local-export and POST /resume/local-import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createRouter, loadCompiledModules, startServer } from './helpers/career-route-harness.mjs';

const require = createRequire(import.meta.url);
const roundtrip = require('../lib/career-local-roundtrip.js');

const SAMPLE_MASTER = {
  meta: { name: 'Olive Testperson', master: true },
  resume: {
    headline: 'Principal Distributed Systems Engineer',
    summary: 'Built high-reliability storage and compute systems across three generations.',
    competencies: ['Distributed consensus', 'Zero-trust runtime isolation'],
    skills: ['Rust', 'Python; C++', 'PostgreSQL'],
    experience: [
      {
        title: 'Principal Engineer',
        org: 'Horizon Systems',
        span: '2021 – Present',
        bullets: [
          'Architected multi-region consensus engine handling 120k writes/sec.',
          'Reduced tail latency by 42% through lock-free ring buffers.',
        ],
      },
      {
        title: 'Senior Software Engineer',
        org: 'Apex Data',
        span: '2018 – 2021',
        bullets: [
          'Led migration of 14 stateful services to isolated container sandboxes.',
        ],
      },
    ],
    education: ['M.S. Computer Science — State University'],
    certifications: ['AWS Certified Solutions Architect'],
    clearance: 'TS/SCI',
  },
};

test('oshal-app.yaml declares localEditing with career_resume_local_export and career_resume_local_import', () => {
  const manifest = fs.readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const catalog = fs.readFileSync(new URL('../authorization.yaml', import.meta.url), 'utf8');
  assert.match(manifest, /^localEditing:\n  itemId: master\n  format: odt\n  exportTool: career_resume_local_export\n  importTool: career_resume_local_import/m);
  assert.match(manifest, /- name: career_resume_local_export\b/);
  assert.match(manifest, /- name: career_resume_local_import\b/);
  assert.match(catalog, /- \{ id: career_resume_local_export, allOf: \[career\.read\] \}/);
  assert.match(catalog, /- \{ id: career_resume_local_import, allOf: \[career\.change\] \}/);
  assert.match(catalog, /- \{ id: resume-local-import, method: POST, path: \/resume\/local-import, allOf: \[career\.change\] \}/);
});

test('exportMasterResume builds a valid .odt archive and structured text that round-trip without drift', () => {
  const exported = roundtrip.exportMasterResume(SAMPLE_MASTER);
  assert.equal(exported.ok, true);
  assert.equal(exported.app, 'career-hunter');
  assert.equal(exported.itemId, 'master');
  assert.equal(exported.format, 'odt');
  assert.equal(exported.fileName, 'master-resume.odt');
  assert.equal(exported.mimeType, roundtrip.ODT_MIME);

  const odtBuf = Buffer.from(exported.odtBase64, 'base64');
  assert.equal(roundtrip.extractZipEntryText(odtBuf, 'mimetype'), roundtrip.ODT_MIME);
  const contentXml = roundtrip.extractZipEntryText(odtBuf, 'content.xml');
  assert.ok(contentXml && contentXml.includes('Principal Distributed Systems Engineer'));
  assert.ok(contentXml.includes('Architected multi-region consensus engine handling 120k writes/sec.'));

  const fromOdt = roundtrip.prepareMasterImport({ odtBase64: exported.odtBase64 }, SAMPLE_MASTER);
  assert.equal(fromOdt.ok, true);
  assert.equal(fromOdt.changed, false);
  assert.deepEqual(fromOdt.resume, SAMPLE_MASTER.resume);

  const fromText = roundtrip.prepareMasterImport({ text: exported.text }, SAMPLE_MASTER);
  assert.equal(fromText.ok, true);
  assert.equal(fromText.changed, false);
  assert.deepEqual(fromText.resume, SAMPLE_MASTER.resume);
});

test('prepareMasterImport applies edited bullets and summary from both text and .odt while preserving role anchors', () => {
  const exported = roundtrip.exportMasterResume(SAMPLE_MASTER);
  const editedText = exported.text
    .replace(
      'Reduced tail latency by 42% through lock-free ring buffers.',
      'Reduced p99 tail latency by 55% through lock-free ring buffers and batching.',
    )
    .replace(
      'Built high-reliability storage and compute systems across three generations.',
      'Built high-reliability storage, consensus, and compute systems across three generations.',
    );
  const imported = roundtrip.prepareMasterImport({ text: editedText }, SAMPLE_MASTER);
  assert.equal(imported.ok, true);
  assert.equal(imported.changed, true);
  assert.equal(
    imported.resume.summary,
    'Built high-reliability storage, consensus, and compute systems across three generations.',
  );
  assert.equal(
    imported.resume.experience[0].bullets[1],
    'Reduced p99 tail latency by 55% through lock-free ring buffers and batching.',
  );
  assert.equal(imported.resume.experience[0].title, 'Principal Engineer');
  assert.equal(imported.resume.experience[0].org, 'Horizon Systems');
  assert.deepEqual(imported.resume.skills, SAMPLE_MASTER.resume.skills);

  const editedOdtBuf = roundtrip.resumeToOdtBuffer(imported.resume, SAMPLE_MASTER.meta);
  const fromEditedOdt = roundtrip.prepareMasterImport(
    { odtBase64: editedOdtBuf.toString('base64') },
    SAMPLE_MASTER,
  );
  assert.equal(fromEditedOdt.ok, true);
  assert.equal(fromEditedOdt.changed, true);
  assert.equal(
    fromEditedOdt.resume.experience[0].bullets[1],
    'Reduced p99 tail latency by 55% through lock-free ring buffers and batching.',
  );
});

test('compiled local-export and local-import HTTP routes enforce auth and persist versioned master updates', async () => {
  let stored = JSON.parse(JSON.stringify(SAMPLE_MASTER));
  const calls = [];
  const { modules } = loadCompiledModules(
    { routes: 'routes/career-local-roundtrip-routes.js' },
    {
      './career-engine-dispatch': {
        runCareerCliAwait: async (_pool, userSub, args, env) => {
          calls.push({ userSub, args, env });
          if (args[0] === 'resume' && args[1] === 'base') {
            return { ok: true, out: JSON.stringify(stored), err: '' };
          }
          if (args[0] === 'resume' && args[1] === 'base-save') {
            const payload = JSON.parse(env.CH_RESUME_DOC);
            stored = { meta: stored.meta, resume: payload.resume };
            return {
              ok: true,
              out: JSON.stringify({
                ok: true,
                changed: true,
                changelog: ['experience[0].bullets[1]: updated local edit'],
              }),
              err: '',
            };
          }
          return { ok: false, out: '', err: 'unexpected command' };
        },
      },
    },
  );
  const router = createRouter();
  modules.routes.registerCareerLocalRoundtripRoutes(router, { pool: {} });
  const sessions = { 'session=olive': 'olive' };
  const { server, baseUrl } = await startServer(router, (headers) => sessions[headers.cookie]);
  try {
    const unauth = await fetch(`${baseUrl}/api/career-hunter/resume/local-export`);
    assert.equal(unauth.status, 401);

    const expRes = await fetch(`${baseUrl}/api/career-hunter/resume/local-export`, {
      headers: { cookie: 'session=olive' },
    });
    assert.equal(expRes.status, 200);
    const expBody = await expRes.json();
    assert.equal(expBody.ok, true);
    assert.equal(expBody.itemId, 'master');
    assert.equal(expBody.format, 'odt');
    assert.ok(expBody.text.includes('Horizon Systems'));

    const updatedText = expBody.text.replace(
      'Reduced tail latency by 42% through lock-free ring buffers.',
      'Reduced tail latency by 60% in local Writer session.',
    );
    const impRes = await fetch(`${baseUrl}/api/career-hunter/resume/local-import`, {
      method: 'POST',
      headers: { cookie: 'session=olive', 'content-type': 'application/json' },
      body: JSON.stringify({ text: updatedText }),
    });
    assert.equal(impRes.status, 200);
    const impBody = await impRes.json();
    assert.equal(impBody.ok, true);
    assert.equal(impBody.changed, true);
    assert.deepEqual(impBody.changelog, ['experience[0].bullets[1]: updated local edit']);
    assert.ok(impBody.previousText.includes('Reduced tail latency by 42%'));
    assert.ok(impBody.importedText.includes('Reduced tail latency by 60% in local Writer session.'));
    assert.equal(
      stored.resume.experience[0].bullets[1],
      'Reduced tail latency by 60% in local Writer session.',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
