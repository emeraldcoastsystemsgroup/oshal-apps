/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Resume Studio, grade D). The real tools/career-resume-studio.html in Chromium over a synthetic fixture: with no résumé indexed the page is one empty state whose primary uploads the résumé (POST /resume/upload, field "resume") and then says it is indexing, with no Save anywhere; with a résumé, Save is a secondary button disabled until a change, and a refused save is told beside it in a role=alert with its fix (the 422 the audit hit); the paper stays white with dark ink when the platform's automatic glass marks it in a dark theme; the cross-links live in More.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.51.0: More leads with Master record (everything saved), the read-only page with every role, bullet, skill and history record.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 1 and 12. With no résumé the editor panel, its Send button, the phone's Edit with AI bar and the More button are not shown, at both sizes; they appear once the upload has been read. With a résumé the panel says "This is your main résumé. Each application starts from it.", its heading and example are in plain words with no vendor's product in them, and "MASTER resume", "durable profile" and "reaches in" are gone. When the résumé check gives no answer the editor shows as it did before.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const profile = { resume: { headline: 'Platform engineer', summary: 'Builds systems.', experience: [{ title: 'Engineer', org: 'Example', span: '2020-2024', bullets: ['Shipped it'] }] }, cover: {}, meta: { master: true, name: 'Sample Candidate' } };

/** The Career routes this screen calls; `state` decides whether a résumé exists. */
function career(state) {
  return ({ method, url }) => {
    if (url.pathname === '/api/career-hunter/jobs') return { json: { jobs: [] } };
    if (url.pathname === '/api/career-hunter/resume/doc') return { json: state.indexed ? profile : { resume: {}, cover: {}, meta: { master: true } } };
    if (url.pathname === '/api/career-hunter/resume/state') return state.stateFails ? { status: 503, json: { error: 'unavailable' } } : { json: { hasResume: state.indexed, indexing: state.indexing, ingest: { state: state.indexing ? 'pending' : 'none' } } };
    if (url.pathname === '/api/career-hunter/resume/upload' && method === 'POST') { state.indexing = true; return { status: 202, json: { ok: true } }; }
    if (url.pathname === '/api/career-hunter/resume/save') return { status: 422, json: { error: 'no career profile yet — upload a resume first' } };
    return null;
  };
}

for (const [name, size] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${name}: no résumé is one empty state whose primary uploads it`, async () => {
    const state = { indexed: false, indexing: false };
    const { page, context, calls } = await openScreen(browser, 'career-resume-studio.html', career(state), size);
    try {
      const upload = page.getByRole('button', { name: 'Upload your résumé (PDF or DOCX)' });
      await upload.waitFor();
      assert.equal(await page.locator('#save').isVisible(), false, 'no Save without a résumé');
      assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Upload your résumé (PDF or DOCX)']);
      const nothingToEdit = async (when) => {
        for (const [what, selector] of [['the editor panel', '.chat'], ['its Send button', '#send'], ['its text box', '#msg'], ['the More button', '#moreBtn'], ['the Edit with AI bar', '#aiBar']]) {
          assert.equal(await page.locator(selector).isVisible(), false, `${what} is not shown ${when}`);
        }
        assert.deepEqual(await page.locator('button:visible').allInnerTexts(), when === 'while it is read' ? [] : ['Upload your résumé (PDF or DOCX)'], `the only button ${when}`);
      };
      await nothingToEdit('with no résumé');
      assert.doesNotMatch(await page.locator('.wrap').innerText(), /MASTER|durable profile|reaches in|⋯/, 'the page itself shows no lone ⋯ (the frame\'s own bar has one on a phone)');
      await page.clock.install();
      await page.locator('#resumeFile').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample') });
      await page.getByRole('heading', { name: 'Indexing your résumé…' }).waitFor();
      await nothingToEdit('while it is read');
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/career-hunter/resume/upload');
      assert.ok(post, 'the résumé went to the upload route');
      assert.match(String(post.body), /name="resume"; filename="resume.pdf"/);
      // The résumé has been read: the page's own six-second check finds it, and the editor arrives with it.
      state.indexed = true; state.indexing = false;
      await page.clock.runFor(6500);
      await page.locator('.sheet h1').waitFor();
      await page.locator('#moreBtn').waitFor();
      if (size === PHONE) await page.getByRole('button', { name: 'Edit with AI' }).waitFor();
      else assert.equal(await page.locator('.chat').isVisible(), true, 'the editor panel arrives with the résumé');
    } finally { await context.close(); }
  });
}

test('with a résumé the editor is there and speaks plainly', async () => {
  const state = { indexed: true, indexing: false };
  const { page, context } = await openScreen(browser, 'career-resume-studio.html', career(state), DESKTOP);
  try {
    await page.locator('.sheet h1').waitFor();
    assert.equal(await page.locator('.chat').isVisible(), true);
    assert.equal((await page.locator('.chat header').innerText()).replace(/\s+/g, ' '), 'Résumé editor · tell it what to change');
    await page.locator('#log .msg.sys', { hasText: 'This is your main résumé. Each application starts from it.' }).waitFor();
    const example = await page.locator('#msg').getAttribute('placeholder');
    assert.equal(example, 'e.g. put my team-lead work first; shorten the second bullet');
    assert.equal(await page.locator('#moreBtn').isVisible(), true);
    assert.deepEqual(await page.locator('#pick option').allTextContents(), ['No tailored résumés yet', '⭐ My résumé (master)']);
    assert.doesNotMatch(await page.locator('body').innerText() + example, /MASTER resume|durable profile|reaches in|SAP|DevOps/);
  } finally { await context.close(); }
});

test('phone, with a résumé: Edit with AI opens the editor', async () => {
  const state = { indexed: true, indexing: false };
  const { page, context } = await openScreen(browser, 'career-resume-studio.html', career(state), PHONE);
  try {
    await page.locator('.sheet h1').waitFor();
    await page.getByRole('button', { name: 'Edit with AI' }).tap();
    await page.locator('#send').waitFor();
    assert.equal(await page.locator('.chat').isVisible(), true);
  } finally { await context.close(); }
});

test('when the résumé check gives no answer, an empty master opens with its editor as before', async () => {
  const state = { indexed: false, indexing: false, stateFails: true };
  const { page, context, calls } = await openScreen(browser, 'career-resume-studio.html', career(state), DESKTOP);
  try {
    await page.locator('.chat').waitFor();
    assert.ok(calls.some((c) => c.path === '/api/career-hunter/resume/state'));
    assert.equal(await page.locator('#noProfile').isVisible(), false);
    assert.equal(await page.locator('#send').isVisible(), true);
  } finally { await context.close(); }
});

test('with a résumé: Save is secondary, enabled only by a change, and a refusal is told beside it', async () => {
  const state = { indexed: true, indexing: false };
  const { page, context } = await openScreen(browser, 'career-resume-studio.html', career(state), DESKTOP);
  try {
    await page.locator('.sheet h1').waitFor();
    const save = page.locator('#save');
    assert.equal(await save.isVisible(), true);
    assert.equal(await save.isDisabled(), true, 'nothing to save yet');
    assert.match(await save.getAttribute('class'), /ck-btn/);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('surface-bridge:custom', { detail: { name: 'resume_action', data: { actions: [{ op: 'set_summary', text: 'Edited.' }] } } })));
    assert.equal(await save.isDisabled(), false, 'an edit enables Save');
    await save.click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /Upload your résumé first/);
    assert.equal(await page.locator('nav a:visible').count(), 0, 'no raw links in the toolbar');
    assert.deepEqual(await page.locator('#moreMenu a').allInnerTexts(), ['Master record (everything saved)', 'Additional experience library', 'Prepare & submit']);
    assert.equal(await page.locator('#moreMenu a[data-career-tool="career-master-record"]').getAttribute('href'), '/api/career-hunter/master-record-ui');
  } finally { await context.close(); }
});

test('the paper stays white with dark ink when the platform glass marks it in a dark theme', async () => {
  const state = { indexed: true, indexing: false };
  const { page, context } = await openScreen(browser, 'career-resume-studio.html', career(state), DESKTOP);
  try {
    await page.locator('.sheet h1').waitFor();
    await page.addStyleTag({ content: ':root{--bg-card:rgba(30,32,36,.72)} [data-oshal-glass]{background-image:linear-gradient(145deg,var(--bg-card),transparent)!important;background-color:transparent!important}' });
    assert.equal(await page.locator('#sheet').getAttribute('data-no-glass'), '', 'the paper opts out of the automatic glass');
    await page.locator('#sheet').evaluate((el) => el.setAttribute('data-oshal-glass', ''));
    const paint = await page.locator('#sheet').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage, ink: getComputedStyle(el.querySelector('h1')).color }));
    assert.equal(paint.bg, 'rgb(255, 255, 255)');
    assert.equal(paint.image, 'none');
    assert.equal(paint.ink, 'rgb(20, 32, 46)');
  } finally { await context.close(); }
});
