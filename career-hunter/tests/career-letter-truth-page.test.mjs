/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter ... lies about my level of expertise on c# ... the cover letter is not acceptable"): the shipped Prepare application page (tools/career-application.js with tools/career-job-actions.js), opened on step 2 · Review documents over the job read GET /jobs/:id answers for a packet the engine's claims check judged (application.claims, lib/career-letter-claims.js). A letter that needs the person's review shows the notice that names the problems, says so beside the title and offers I checked the cover letter in place of Continue to send; asked for step 3 · Send, the page stays on the review. A fixed letter lists what Career took out and sends as before; a packet the check never saw reads as before. Red on store main dd5cd9ed, green with 1.68.5. Same VM harness as tests/career-resume-current-role-page.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ACTIONS = read('../tools/career-job-actions.js');
const PAGE = read('../tools/career-application.js');
const REVIEW = 'Your cover letter needs your review before you send it. The cover letter claimed “expert C#”; your records do not state that level. Career took it out.';
const FIXED = 'Career checked these documents against your records. The cover letter named Rust; your records do not mention it. Career took it out.';

/** A prepared job as the job read answers it, with what the claims check did. */
const prepared = (claims) => ({ id: 81, title: 'Senior Controls Engineer', company: 'Target Utilities', location: 'Remote', status: 'generated',
  url: 'https://jobs.example.com/apply/81', has_resume: true, has_cover: true, board: { phase: 'ready', requestId: 'r-1', completedAt: '2026-11-16T21:01:00Z' },
  application: { failed: false, busy: false, needsGeneration: false, documentsOutdated: false, missingRoles: [], rolesNotice: '', claims,
    canRestoreDocuments: false, draft: { revision: 1, guidance: '', experienceIds: [] } } });

/** The least of a page element the application page touches before and while it draws. */
const element = () => ({ innerHTML: '', textContent: '', className: '', setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });

/** The shipped page opened on one job and step over fixture answers. @returns {Promise<string>} What it drew. */
async function opened(job, step = 'documents') {
  const root = element(), line = element();
  const answers = { '/api/career-hunter/jobs/81': { job }, '/api/career-hunter/experience-bank': { entries: [], revision: 1 }, '/api/career-hunter/resume/state': { hasResume: true } };
  const context = vm.createContext({ URL, URLSearchParams, setTimeout, clearTimeout,
    location: { search: `?application=81&step=${step}`, pathname: '/api/career-hunter/board-native' }, history: { replaceState() {} },
    document: { title: '', getElementById: (id) => ({ application: root, message: line })[id] || null, querySelectorAll: () => [] },
    addEventListener() {},
    fetch: async (url) => ({ ok: url in answers, status: url in answers ? 200 : 404, json: async () => answers[url] || {} }) });
  context.window = context;
  vm.runInContext(ACTIONS, context);
  vm.runInContext(PAGE, context);
  for (let turn = 0; turn < 50 && !root.innerHTML; turn++) await new Promise((resolve) => setImmediate(resolve));
  return root.innerHTML;
}

const NEEDS = { status: 'needs_review', needsReview: true, problems: [], notice: REVIEW, fixed: '', digest: 'a'.repeat(64) };

test('a cover letter that needs review names its problems and is never one press from sending', async () => {
  const html = await opened(prepared(NEEDS));
  const notice = html.match(/<div class="notice error" id="claimsReview" role="alert">([^<]*)<\/div>/);
  assert.ok(notice, 'the page shows the notice: ' + html.slice(0, 400));
  assert.equal(notice[1], REVIEW + ' Edit documents to change the wording, or press I checked the cover letter once it says only what is true.');
  assert.match(html, /data-action="claims-checked" >I checked the cover letter<\/button>/, 'the filled button is I checked the cover letter');
  assert.doesNotMatch(html, /data-action="send"/, 'Continue to send is not offered');
  assert.match(html, /data-action="edit" >Edit documents<\/button>/);
  assert.match(html, /id="applicationState">Cover letter needs your review</);
  const asked = await opened(prepared(NEEDS), 'review');
  assert.match(asked, /id="claimsReview"/, 'asked for step 3 · Send, the page shows the review');
  assert.doesNotMatch(asked, /Open the employer’s form|data-action="applied"/, 'no way to send is drawn');
});

test('a fixed letter lists what Career took out and sends as before; an unchecked packet reads as before', async () => {
  const html = await opened(prepared({ status: 'fixed', needsReview: false, problems: [], notice: '', fixed: FIXED, digest: 'b'.repeat(64) }));
  assert.match(html, new RegExp(`<p class="hint" id="claimsFixed">${FIXED}</p>`));
  assert.match(html, /data-action="send" >Continue to send<\/button>/);
  assert.match(html, /id="applicationState">Documents ready to review</);
  const before = await opened(prepared(null));
  assert.doesNotMatch(before, /claimsReview|claimsFixed/);
  assert.match(before, /data-action="send" >Continue to send<\/button>/);
});
