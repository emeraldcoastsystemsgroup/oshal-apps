/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Tutor as the app consumer of core's shared response renderer, in real Chromium over a loopback fixture: the ACTUAL package page (tools/tutor-chat.html, its education.css and lm-voice.js) with the renderer bundled from the framework checkout's source and a scripted /api/education/tutor-chat that answers with the renderer's own SHARED_UNTRUSTED_RESPONSE conformance vector. The Tutor must render the vector's expected block sequence (the same one Jarvis and the chat bubble produce in core), keep the hostile gallery/download as escaped fallbacks with no request to the hostile host, keep its grounding badge and read-aloud control outside the replaceable region, and stay readable as escaped text when the bundle is unavailable. It is the runnable proof the live-port education-e2e case could not be; no database, provider, model or external traffic.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express, playwright, esbuild and the renderer source.
 * Not part of the bare-checkout store-CI glob (tests/*.test.cjs); the framework-coupled gate discovers
 * it by its .core.spec.mjs name. Run locally:
 *   OSHAL_CORE_DIR=<framework checkout> node --test tests/tutor-renderer.core.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
const coreRequire = createRequire(path.join(CORE, 'package.json'));
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const RENDERER_ENTRY = path.join(CORE, 'src', 'shared', 'ui', 'response-renderer', 'index.ts');
const DANGEROUS = 'a, img, form, input, script, iframe, button, object, embed';

/** The renderer exactly as a browser receives it, built from the framework checkout's source. */
function rendererBundle() {
  const { buildSync } = coreRequire('esbuild');
  return buildSync({ entryPoints: [RENDERER_ENTRY], bundle: true, format: 'esm', platform: 'browser', write: false }).outputFiles[0].text;
}

/**
 * Serve the actual Tutor page and its package assets plus the renderer bundle; answer the tutor
 * endpoint with whatever reply the test sets. Every POST is recorded.
 */
async function startFixture() {
  const express = coreRequire('express');
  const bundle = rendererBundle();
  const state = { reply: '', bundleAvailable: true, posts: [] };
  const app = express();
  app.use(express.json());
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/api/education/tutor', (_req, res) => res.sendFile(path.join(TOOLS, 'tutor-chat.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/lm-voice.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-voice.js')));
  app.use('/shared/ui', express.static(path.join(CORE, 'src', 'shared', 'ui')));
  app.use('/cockpit', express.static(path.join(CORE, 'src', 'pages', 'cockpit')));
  app.get('/dist/response-renderer.js', (_req, res) => {
    if (!state.bundleAvailable) { res.status(404).end(); return; }
    res.type('application/javascript').send(bundle);
  });
  app.post('/api/education/tutor-chat', (req, res) => {
    state.posts.push(req.body);
    res.json({ response: state.reply, grounded: true, sources: [{ n: 1, text: 'Approved class material about fractions' }] });
  });
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((err) => (err ? reject(err) : resolve())); }),
  };
}

let f, browser, vector;
const offOrigin = [];

/** Open the Tutor, ask once, and return the newest tutor message plus the page. */
async function askTutor() {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === f.origin) return route.continue();
    offOrigin.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${f.origin}/api/education/tutor?classId=class-fixture`);
  await page.fill('#input', 'Can you check my fraction work?');
  await page.click('#sendBtn');
  const answer = page.locator('#messages .msg.tutor').last();
  await answer.waitFor();
  return { context, page, answer, errors };
}

/** Normalize the top-level shared-renderer blocks exactly as core's surface guard does. */
function blockSequence(content) {
  return content.evaluate((root) => {
    const roles = ['markdown', 'code', 'mermaid', 'chart', 'table', 'map', 'doc', 'gallery', 'download'];
    return Array.from(root.querySelectorAll('.rr-block'))
      .filter((el) => !el.parentElement || !el.parentElement.closest('.rr-block'))
      .map((el) => ({
        role: el.classList.contains('rr-fallback') ? 'fallback' : (roles.find((name) => el.classList.contains(`rr-${name}`)) || 'unknown'),
        kind: el.getAttribute('data-oshal-kind'),
      }));
  });
}

test.before(async () => {
  f = await startFixture();
  browser = await coreRequire('playwright').chromium.launch();
  // Read the vector from the very bundle the Tutor imports, so this proof cannot drift from core.
  const page = await browser.newPage();
  await page.goto(`${f.origin}/api/education/education.css`);
  vector = await page.evaluate(async () => {
    const mod = await import('/dist/response-renderer.js');
    const { text, hostileHost, expectedBlocks } = mod.SHARED_UNTRUSTED_RESPONSE;
    return { text, hostileHost, expectedBlocks: expectedBlocks.map((block) => ({ ...block })) };
  });
  await page.close();
});
test.after(async () => { await browser?.close(); await f?.close(); });

test('the Tutor renders core\'s shared untrusted reply to the shared block sequence with every hostile block inert', async () => {
  f.state.reply = vector.text;
  f.state.bundleAvailable = true;
  offOrigin.length = 0;
  const { context, answer, errors } = await askTutor();
  const content = answer.locator('.tutor-content');
  await content.locator('.rr-doc').waitFor();
  assert.deepEqual(await blockSequence(content), vector.expectedBlocks, 'the same block sequence Jarvis and the chat bubble render');
  assert.equal(await content.locator(DANGEROUS).count(), 0, 'no link, image, form, input, script, frame or button in the rendered reply');
  assert.match(await content.locator('[data-oshal-kind="gallery"]').innerText(), new RegExp(`${vector.hostileHost.replace('.', '\\.')}/beacon\\.png`), 'the hostile URL is visible as text');
  assert.equal(await content.locator('.rr-doc-title').innerText(), 'Shared renderer note');
  assert.equal(await answer.locator('.read-btn').count(), 1, 'read-aloud stays on the message');
  assert.match(await answer.innerText(), /Grounded in your class textbook/, 'the grounding badge stays on the message');
  assert.equal(f.state.posts.length, 1, 'one tutor turn');
  assert.equal(f.state.posts[0].classId, 'class-fixture');
  assert.deepEqual(offOrigin.filter((url) => new URL(url).hostname === vector.hostileHost), [], 'no request to the hostile host');
  assert.deepEqual(offOrigin, [], 'no off-origin request at all');
  assert.deepEqual(errors, []);
  await context.close();
});

test('without the renderer bundle the reply stays readable escaped text with nothing live', async () => {
  f.state.reply = vector.text;
  f.state.bundleAvailable = false;
  f.state.posts.length = 0;
  offOrigin.length = 0;
  const { context, answer } = await askTutor();
  const content = answer.locator('.tutor-content');
  await content.getByText('Shared renderer note', { exact: false }).first().waitFor();
  assert.equal(await content.locator('.rr-block').count(), 0, 'the shared renderer never ran');
  assert.equal(await content.locator('a, img, form, input, script, iframe').count(), 0);
  assert.equal(await answer.locator('.read-btn').count(), 1);
  assert.deepEqual(offOrigin, []);
  await context.close();
});
