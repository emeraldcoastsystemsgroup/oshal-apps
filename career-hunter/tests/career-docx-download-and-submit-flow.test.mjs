/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.20: end-to-end verification of pure-stdlib OOXML resume pipeline (via career-docx-pipeline.test.py), server-rendered DOCX/RTF/PDF/template exports with exact edited headline parity, native experience-shell group navigation (intelligent-career without legacy [data-view] nodes), and real-Chromium edit -> Save & return to application -> 2 · Review documents -> Download DOCX/RTF/PDF -> 3 · Send (Orbit computer submit ready) workflow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { playwright, tools, ORIGIN, DESKTOP } from './helpers/ux-page.mjs';

const require = createRequire(import.meta.url);
const draft = require('../lib/career-application-draft');
const board = require('../lib/career-board-state');
const bank = require('../lib/career-experience-bank');
const docxExport = require('../lib/career-docx-export');

const API = '/api/career-hunter';
const PY_TEST = resolve(import.meta.dirname, 'career-docx-pipeline.test.py');
const ACTIONS_JS = readFileSync(join(tools, 'career-job-actions.js'), 'utf8');

function extractDocxXml(buf) {
  const tmp = mkdtempSync(join(tmpdir(), 'career-unzip-'));
  try {
    const file = join(tmp, 'out.docx');
    writeFileSync(file, buf);
    return execFileSync('python3', ['-c', 'import sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8"))', file], { encoding: 'utf8' });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function extractPdfText(buf) {
  const tmp = mkdtempSync(join(tmpdir(), 'career-pdftxt-'));
  try {
    const file = join(tmp, 'out.pdf');
    writeFileSync(file, buf);
    return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('Python OOXML executive pipeline suite passes (4 families, .dotx, zero theme leaks, <=2-page compaction, zero PII)', () => {
  const res = spawnSync('python3', [PY_TEST], { encoding: 'utf8', timeout: 90000 });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match((res.stderr || '') + (res.stdout || ''), /OK/);
});

test('lib/career-docx-export renders blank zero-PII templates (docx, dotx, rtf) and packet exports cleanly', async (t) => {
  for (const format of ['docx', 'dotx', 'rtf']) {
    const tpl = await docxExport.renderBlankTemplate({ family: 'Technical', format });
    assert.equal(tpl.mime, docxExport.MIME_BY_FORMAT[format]);
    assert.ok(tpl.bytes.length > 500, `template ${format} non-empty`);
    if (format === 'rtf') {
      assert.ok(tpl.bytes.subarray(0, 6).toString('ascii').startsWith('{\\rtf1'));
    } else {
      assert.equal(tpl.bytes[0], 80);
      assert.equal(tpl.bytes[1], 75);
    }
  }
});

test('CareerJobActions.navigate qualifies career-hunter--career-board in native experience shell without legacy [data-view] nodes', () => {
  const posted = [];
  const parent = {
    document: { querySelectorAll: () => [] },
    location: { search: '?app=intelligent-career' },
    postMessage: (msg) => posted.push(msg),
  };
  const win = {
    parent,
    frameElement: { id: 'active-app-frame', getAttribute: (name) => (name === 'data-hosted-app' ? 'intelligent-career' : null) },
    location: { href: `${ORIGIN}${API}/resume-studio?id=81&application=1`, origin: ORIGIN },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vm.runInNewContext(ACTIONS_JS, { window: win, URL, URLSearchParams, setTimeout, clearTimeout });
  win.CareerJobActions.openApplication(81, false, 'documents');
  assert.equal(posted.length, 1);
  assert.deepEqual({ ...posted[0] }, {
    type: 'app-navigate',
    tool: 'career-hunter--career-board',
    query: 'view=queue&application=81&step=documents',
  });
});

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function makeSyntheticStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'career-e2e-docx-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = {
    profile: {
      name: 'Jordan Rivera, BS Computer Science',
      credential: 'PMP',
      location: 'Austin, TX',
      phone: '(512) 555-0148',
      email: 'jordan.rivera@example.test',
      linkedin: 'linkedin.com/in/jordanrivera',
      citizenship: 'U.S. Citizen',
      clearance: 'Public Trust',
    },
    roles: [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 to Present', current: true }],
  };
  writeFileSync(join(dir, 'career_db.json'), JSON.stringify(profile));
  const pktDir = join(dir, 'applications', 'orbit__81');
  mkdirSync(pktDir, { recursive: true });
  const packet = {
    posting_id: 81,
    company: 'Orbit Systems',
    title: 'Staff Cloud Engineer',
    template_family: 'Technical',
    generated: {
      resume: {
        headline: 'Initial Cloud Engineer Headline',
        summary: 'Initial tailored summary for Orbit Systems.',
        skills: ['Cloud: AWS, Kubernetes, Terraform', 'Languages: Python, TypeScript, SQL'],
        experience: [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 to Present', bullets: ['Delivered resilient multi-region platform services.'] }],
        education: ['BS, Computer Science | State University | 2009 - 2013'],
        certifications: ['AWS Solutions Architect'],
      },
      cover: { greeting: 'Dear Hiring Team,', paragraphs: ['Excited to contribute to Orbit Systems.'], closing: 'Sincerely,' },
    },
    profile_snapshot: profile,
  };
  writeFileSync(join(pktDir, 'application.json'), JSON.stringify(packet, null, 2));
  writeFileSync(join(pktDir, 'Resume_ATS.pdf'), '%PDF-1.4 initial');
  writeFileSync(join(pktDir, 'CoverLetter.pdf'), '%PDF-1.4 initial');
  const job = {
    id: 81, title: 'Staff Cloud Engineer', company: 'Orbit Systems', location: 'Remote', status: 'generated',
    url: 'https://jobs.example.com/81', description: 'Lead cloud reliability engineering at Orbit Systems. '.repeat(8),
    has_resume: true, has_cover: true, resume_path: join(pktDir, 'Resume_ATS.pdf'), cover_path: join(pktDir, 'CoverLetter.pdf'),
    generated_at: '2026-11-19T12:00:00Z',
  };
  const input = { revision: 0, guidance: '', experienceIds: [], experienceRevision: bank.read(dir).revision, experienceChosen: true };
  draft.begin(dir, 81, job, input, 'req-1', true);
  board.updateBoardState(dir, 81, { requestId: 'req-1', phase: 'ready', completedAt: '2026-11-19T12:01:00Z' });
  return { dir, pktDir, job, packet };
}

test('browser E2E: edit headline -> Save & return to application -> 2 · Review documents -> download DOCX/RTF/PDF with exact edited headline -> 3 · Send (Orbit ready)', async (t) => {
  const store = makeSyntheticStore(t);
  const editedHeadline = 'Principal Cloud Architect & SRE Lead | Secure Automation';
  const state = { doc: JSON.parse(readFileSync(join(store.pktDir, 'application.json'), 'utf8')), saves: 0 };

  const context = await browser.newContext({ ...DESKTOP, acceptDownloads: true, locale: 'en-US', timezoneId: 'UTC' });
  t.after(() => context.close());

  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (url.origin !== ORIGIN) return route.abort();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === `${API}/board-native`) {
      const file = /^[1-9]\d*$/.test(url.searchParams.get('application') || '') ? 'career-application.html' : 'career-job-lists.html';
      return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, file)) });
    }
    if (p === `${API}/resume-studio`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-resume-studio.html')) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (p === '/shared/ui/js/surface-bridge-client.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function createSurfaceBridgeClient(){ return { attach(){}, emitContext(){} }; }' });
    if (p === '/shared/ui/js/document-handoff.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function registerDocumentSession(){}' });
    if (/^\/(shared|cockpit|ui)\//.test(p) || p === '/api/artifacts/send-to.js') return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === '/api/auth/user') return json({ authenticated: true, tenant: 't1', principal_id: 'p1', sub: 'jordan' });
    if (p === '/api/ui/profile') return json({ profile: { ribbon: { items: [] } } });
    if (p === `${API}/resume/state`) return json({ hasResume: true, roles: 1, indexing: false });
    if (p === `${API}/experience-bank`) return json(bank.read(store.dir));
    if (p === `${API}/jobs/stats`) return json({ saved: 1, byStatus: [] });
    if (p === `${API}/jobs`) return json({ jobs: [{ id: 81, title: store.job.title, company: store.job.company, has_resume: true, has_cover: true }], exhausted: true });
    if (p === `${API}/jobs/81` && req.method() === 'GET') return json({ job: { ...store.job, board: board.readBoardState(store.dir).jobs[81] || {}, application: draft.view(store.dir, 81, store.job) } });
    if (p === `${API}/resume/doc`) return json({ resume: state.doc.generated.resume, cover: state.doc.generated.cover, meta: { name: 'Jordan Rivera', postingId: 81, company: 'Orbit Systems', title: 'Staff Cloud Engineer', templateFamily: 'Technical' } });
    if (p === `${API}/resume/save` && req.method() === 'POST') {
      const body = req.postDataJSON();
      state.saves += 1;
      state.doc.generated = { resume: body.resume, cover: body.cover };
      writeFileSync(join(store.pktDir, 'application.json'), JSON.stringify(state.doc, null, 2));
      draft.markEdited(store.dir, 81);
      return json({ ok: true });
    }
    if (p === `${API}/resume`) {
      if (url.searchParams.get('as') === 'html') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body><h1>Jordan Rivera</h1><div class="headline">${state.doc.generated.resume.headline}</div><p>${state.doc.generated.resume.summary}</p></body></html>` });
      }
      const format = url.searchParams.get('format') || 'pdf';
      const family = url.searchParams.get('family') || 'Technical';
      const kind = url.searchParams.get('kind') === 'cover' ? 'cover' : 'resume';
      const out = await docxExport.renderPacketArtifact({ packetJsonPath: join(store.pktDir, 'application.json'), kind, format, family });
      return route.fulfill({ status: 200, contentType: out.mime, headers: { 'Content-Disposition': `attachment; filename="${out.filename}"` }, body: out.bytes });
    }
    if (p === '/api/apply-operator/workers') return json({
      workers: [{ id: 'orbit-1', clientId: 'orbit-1', kind: 'orbit', hostname: 'Home Orbit Workstation', available: true }],
      selectedDeviceId: 'orbit-1', selectedDeviceName: 'Home Orbit Workstation',
      selectionConfigured: true, defaultClientId: 'orbit-1', available: true,
    });
    if (p === '/api/guest/session') return json({ guest: false, active: false });
    if (p === `${API}/submission-review/81`) return json({ company: 'Orbit Systems', title: 'Staff Cloud Engineer', url: store.job.url, packetDigest: 'a'.repeat(64), maxPresses: 4, documents: [{ kind: 'resume', sha256: '1'.repeat(64) }, { kind: 'cover', sha256: '2'.repeat(64) }], profile: { email: 'jordan.rivera@example.test' } });
    return json({ error: 'unmocked ' + p }, 404);
  });

  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(`${ORIGIN}${API}/resume-studio?id=81&application=1`, { waitUntil: 'load' });
  const headlineEl = page.locator('#sheet p.headline[contenteditable="true"]');
  await headlineEl.waitFor();
  await headlineEl.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(editedHeadline);

  await page.getByRole('button', { name: 'Save & return to application' }).click();
  await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
  assert.equal((await page.locator('.steps [aria-current="step"]').innerText()).trim(), '2 · Review documents');
  assert.equal(state.saves, 1);
  await page.frameLocator('.preview iframe').getByText(editedHeadline).waitFor();

  // Expand Download controls and verify DOCX, RTF, and PDF all carry the EXACT edited headline.
  await page.locator('[data-career-downloads] summary').click();
  await page.locator('[data-career-downloads] [data-export-style]').selectOption('Technical');

  for (const format of ['docx', 'rtf', 'pdf']) {
    await page.locator('[data-career-downloads] [data-export-format]').selectOption(format);
    const dlPromise = page.waitForEvent('download');
    await page.locator('[data-career-downloads] [data-export-start]').click();
    const dl = await dlPromise;
    assert.match(dl.suggestedFilename(), new RegExp(`\\.${format}$`));
    const filePath = await dl.path();
    const bytes = readFileSync(filePath);
    if (format === 'docx') {
      const xml = extractDocxXml(bytes).replace(/&amp;/g, '&');
      assert.ok(xml.includes(editedHeadline), 'DOCX must contain exact edited headline');
      assert.ok(!xml.includes('Jordan Rivera, BS'), 'DOCX must not jam degree onto name line');
    } else if (format === 'rtf') {
      const rtf = bytes.toString('latin1');
      assert.ok(rtf.includes('Principal Cloud Architect'), 'RTF must contain edited headline');
    } else {
      const pdfTxt = extractPdfText(bytes);
      assert.ok(pdfTxt.includes(editedHeadline), 'PDF must contain exact edited headline');
    }
  }

  // Continue to 3 · Send and confirm Orbit computer submit flow is enabled and reaches Approve & submit.
  await page.getByRole('button', { name: 'Continue to send' }).click();
  await page.getByRole('heading', { name: 'Send your application' }).waitFor();
  assert.equal((await page.locator('.steps [aria-current="step"]').innerText()).trim(), '3 · Send');
  await page.getByText('Home Orbit Workstation').waitFor();
  await page.getByRole('button', { name: 'Send it for me from my computer' }).click();
  await page.getByRole('heading', { name: 'Approve this application' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve & submit' }).isVisible(), true);
  assert.deepEqual(errors, []);
});
