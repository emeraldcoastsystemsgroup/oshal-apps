/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "i cant submit any resimes untill this is taken care of"): the shipped Prepare application page (tools/career-application.js with tools/career-job-actions.js), opened over the job read GET /jobs/:id answers for a résumé prepared before the check that leaves the current role out (application.missingRoles and rolesNotice, lib/career-application-draft.js). The page opens on step 1 · Tailor with the notice naming the role and Generate résumé & cover letter, says so beside the title, and opens no later step; a job with no missing role reads as before. Red on store main d28c8c02, green with 1.67.3. Same VM harness as tests/career-preparation-notice.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ACTIONS = read('../tools/career-job-actions.js');
const PAGE = read('../tools/career-application.js');
const NOTICE = 'This résumé leaves out your current role: Co-Founder / Principal at Harbor Light Systems.';

/** A prepared job as the job read answers it; `left` is what the draft view found the résumé leaves out. */
const prepared = (left) => ({ id: 81, title: 'Platform Director', company: 'Target Co', location: 'Remote', status: 'generated',
  url: 'https://jobs.example.com/apply/81', has_resume: true, has_cover: true, board: { phase: 'ready', requestId: 'r-1', completedAt: '2026-11-16T17:01:00Z' },
  application: { failed: false, busy: false, needsGeneration: left.length > 0, documentsOutdated: false, missingRoles: left,
    rolesNotice: left.length ? NOTICE : '', canRestoreDocuments: false, draft: { revision: 1, guidance: '', experienceIds: [] } } });

/** The least of a page element the application page touches before and while it draws. */
const element = () => ({ innerHTML: '', textContent: '', className: '', setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });

/** The shipped page opened on one job over fixture answers. @param {object} job @returns {Promise<string>} What it drew. */
async function opened(job) {
  const root = element(), line = element();
  const answers = { '/api/career-hunter/jobs/81': { job }, '/api/career-hunter/experience-bank': { entries: [], revision: 1 }, '/api/career-hunter/resume/state': { hasResume: true } };
  const context = vm.createContext({ URL, URLSearchParams, setTimeout, clearTimeout,
    location: { search: '?application=81&step=documents', pathname: '/api/career-hunter/board-native' }, history: { replaceState() {} },
    document: { title: '', getElementById: (id) => ({ application: root, message: line })[id] || null, querySelectorAll: () => [] },
    addEventListener() {},
    fetch: async (url) => ({ ok: url in answers, status: url in answers ? 200 : 404, json: async () => answers[url] || {} }) });
  context.window = context;
  vm.runInContext(ACTIONS, context);
  vm.runInContext(PAGE, context);
  for (let turn = 0; turn < 50 && !root.innerHTML; turn++) await new Promise((resolve) => setImmediate(resolve));
  return root.innerHTML;
}

test('a prepared résumé that leaves the current role out opens on Tailor, names the role and offers Generate', async () => {
  const html = await opened(prepared([{ title: 'Co-Founder / Principal', org: 'Harbor Light Systems', current: true }]));
  const notice = html.match(/<div class="notice error" id="rolesLeftOut" role="alert">([^<]*)<\/div>/);
  assert.ok(notice, 'the page shows the notice: ' + html.slice(0, 400));
  assert.equal(notice[1], NOTICE + ' Press Generate résumé &amp; cover letter to make a résumé that includes it, before you submit.');
  assert.match(html, /<li aria-current="step">1 · Tailor<\/li>/, 'asked for Review documents, the page stays on step 1 · Tailor');
  assert.match(html, /data-action="generate" >Generate résumé & cover letter<\/button>/, 'the one filled button is Generate résumé & cover letter');
  assert.match(html, /id="applicationState">Résumé leaves out your work history · generate it again</);
  assert.doesNotMatch(html, /Review and approve|data-action="approve"/, 'no step past Tailor is drawn');
});

test('a prepared résumé that carries every required role reads as before', async () => {
  const html = await opened(prepared([]));
  assert.doesNotMatch(html, /rolesLeftOut|leaves out/);
  assert.match(html, /id="applicationState">Documents ready to review</);
});
