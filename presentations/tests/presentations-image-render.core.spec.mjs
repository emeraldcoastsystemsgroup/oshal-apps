/**
 * A slide's #image: directive through the REAL deck engine: the studio's new "Add image"
 * control writes an inline data URI, and this proves the kernel's own renderer embeds those
 * bytes in the produced .pptx (real-boundary guard for the 2.15.0 design row — a draft-only
 * image that never reached the file would be a mock surface).
 *
 * Real code on the boundary this proves: core's presentation-generation source (renderPptx,
 * resolveSlideImages, layout auto-select), compiled from the framework checkout. Only the
 * logger and the SSRF guard (no network is wanted here) are seams.
 *
 * Run: OSHAL_FRAMEWORK=<framework checkout> node --test tests/presentations-image-render.core.spec.mjs
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.15.0: an outline slide carrying `#image: data:image/png;base64,…` + `#caption:` renders to a .pptx whose archive holds the image bytes as real media; a slide with a forced `#layout:` keeps rendering; a non-image data URI is dropped, not embedded, and the deck still renders.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.16.0 document mode: the SAME `#image:` data URI through the real renderDocx lands the authored bytes in the .docx archive's word/media, and the directive lines never leak into the document text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { frameworkFixture, presentationEngine } from './framework-fixture.mjs';

const quiet = { error() {}, warn() {}, info() {}, debug() {}, child() { return quiet; } };
const frameworkRoot = frameworkFixture();
const engine = presentationEngine(frameworkRoot, {
  '@/shared/logger': { createChildLogger: () => quiet },
  '@/shared/security/ssrf-guard': { isPrivateIp: () => false, assertPublicHttpUrl: async () => { throw new Error('no network in this spec'); } },
});
const frameworkRequire = createRequire(join(frameworkRoot, 'package.json'));
const JSZip = frameworkRequire('jszip');

// A real 1x1 PNG — the content sniffer must accept it by its bytes.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Every media payload in the archive, so an authored image is told apart from theme decor. */
async function mediaBytes(deck) {
  const zip = await JSZip.loadAsync(deck);
  const names = Object.keys(zip.files).filter((name) => name.startsWith('ppt/media/'));
  return { zip, payloads: await Promise.all(names.map((name) => zip.files[name].async('nodebuffer'))) };
}
const AUTHORED = Buffer.from(PNG.split(',')[1], 'base64');

test('an #image: data URI from the design row is embedded in the produced .pptx as real media', async () => {
  const deck = await engine.renderPptx('Design row proof', [
    { title: 'Photo slide', content: `#image: ${PNG}\n#caption: Team photo\nOne supporting point\nAnother point` },
    { title: 'Forced layout', content: '#layout: statement\nOne big line' },
  ], {});
  assert.ok(Buffer.isBuffer(deck) && deck.length > 0);
  const { zip, payloads } = await mediaBytes(deck);
  assert.ok(payloads.some((bytes) => bytes.equals(AUTHORED)), 'the authored image bytes are in the archive, beyond any theme decor');
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.ok(slides.length >= 3, 'cover + both outline slides are real slides');
});

test('the document design row is honest: the #image: data URI is embedded in the produced .docx', async () => {
  const file = await engine.renderDocx('Report proof', [
    { title: 'Findings', content: `#image: ${PNG}\nThe pump is worn\nReplace the seal` },
  ], {});
  assert.ok(Buffer.isBuffer(file) && file.length > 0);
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
  const payloads = await Promise.all(names.map((name) => zip.files[name].async('nodebuffer')));
  assert.ok(payloads.some((bytes) => bytes.equals(AUTHORED)), 'the authored image bytes are in the document archive');
  const body = await zip.files['word/document.xml'].async('string');
  assert.ok(body.includes('The pump is worn'), 'the prose is in the document');
  assert.ok(!body.includes('#image'), 'the directive line never leaks into the document text');
});

test('a data URI that is not image bytes is dropped by the sniffer and the deck still renders', async () => {
  const bad = Buffer.from('<html>error page</html>');
  const deck = await engine.renderPptx('Sniffer proof', [
    { title: 'Bad image', content: `#image: data:image/png;base64,${bad.toString('base64')}\nStill a point` },
  ], {});
  const { payloads } = await mediaBytes(deck);
  assert.ok(!payloads.some((bytes) => bytes.equals(bad) || bytes.equals(AUTHORED)), 'no fake image is embedded; the layout degrades to typography');
});
