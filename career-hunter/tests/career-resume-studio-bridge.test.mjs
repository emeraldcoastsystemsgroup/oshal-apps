/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the screen-aware Resume Studio: the manifest declares the surface-bridge ops (without them the cockpit relay is fail-closed and the floating assistant sees NOTHING), the surface publishes a capped digest and routes Jarvis's edits through the one existing applyAction, and the guide prompt/parse let the editor hold a conversation instead of only executing commands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(packageRoot, ...p), 'utf8');

const manifest = read('oshal-app.yaml');
const studio = read('tools', 'career-resume-studio.html');
const routesSrc = read('src-routes', 'career-resume-studio-routes.ts');
const routesJs = read('routes', 'career-resume-studio-routes.js');

/**
 * The guide PROMPT only — everything from the reply contract to the end of the action list.
 * Scoping matters: the file's CHANGE LOG quotes the old "one short conversational sentence"
 * wording to explain what changed, so a whole-file doesNotMatch would assert against the history
 * instead of the instruction and pass or fail for the wrong reason.
 */
const promptOf = (src) => {
  const start = src.indexOf('Reply with ONLY a JSON object');
  const end = src.indexOf('set_cover_paragraphs', start);
  assert.ok(start > 0 && end > start, 'could not locate the guide prompt block');
  return src.slice(start, end);
};
const promptSrc = promptOf(routesSrc);
const promptJs = promptOf(routesJs);

test('the manifest declares the surface-bridge ops — without them the relay is fail-closed', () => {
  const block = manifest.match(/^surface:\s*\n\s*ops:\s*\[([^\]]*)\]/m);
  assert.ok(block, 'no `surface: ops:` block — the cockpit relay forwards NOTHING for this app');
  const ops = block[1].split(',').map((s) => s.trim());
  // context = the assistant learns which resume is open; custom = it sends an edit back;
  // notify = it can confirm in the surface.
  for (const op of ['context', 'custom', 'notify']) assert.ok(ops.includes(op), `surface.ops missing ${op}`);
});

test('the studio publishes WHICH resume is open, so the assistant is not blind to the screen', () => {
  assert.match(studio, /createSurfaceBridgeClient\(\{ app: 'career-hunter' \}\)/);
  assert.match(studio, /emitContext\(/);
  assert.match(studio, /surface: 'resume-studio'/);
  // The record id must travel or an edit could land on the wrong resume.
  assert.match(studio, /recordId: String\(state\.postingId\)/);
});

test('the digest is CAPPED under the contract limit — it is a summary, never a document dump', () => {
  assert.match(studio, /text\.length > 3900/, 'resumeDigest does not cap its output');
  // 4000 is the contract's hard cap; going over drops the whole event, so the surface must stay under.
  const cap = Number(studio.match(/text\.length > (\d+)/)[1]);
  assert.ok(cap < 4000, `digest cap ${cap} is not below the contract's 4000`);
});

test('the digest numbers roles and bullets 1-based, matching update_experience.index', () => {
  // An edit Jarvis proposes has to address the role the operator is actually looking at.
  assert.match(studio, /Role \$\{i \+ 1\}/);
  assert.match(studio, /bullet \$\{bi \+ 1\}/);
});

test("Jarvis's edits go through the SAME applyAction as the concierge's — one edit path", () => {
  const handler = studio.match(/surface-bridge:custom[\s\S]*?\n\}\);/);
  assert.ok(handler, 'no surface-bridge:custom listener');
  assert.match(handler[0], /resume_action/);
  assert.match(handler[0], /applyAction\(a\)/);
  assert.match(handler[0], /renderPreview\(\)/);
  // It must re-publish, or the assistant's next turn reasons about a resume it already changed.
  assert.match(handler[0], /publishContext\(\)/);
});

test('the lazily-created assistant panel can ask for a snapshot it arrived too late to receive', () => {
  assert.match(studio, /detail\.name === 'request_context'/);
});

test('the surface DECLARES the custom op name it handles — an invented one is silently dropped', () => {
  // Found live 2026-08-13: told only that custom{name,data} existed, Jarvis emitted
  // `update_master_resume_summary`; the op relayed and delivered fine and this surface ignored it
  // while the user was told "Done". The declared name must be the one the handler matches on.
  const declared = studio.match(/customOps:\s*\[\{\s*\n?\s*name:\s*'([^']+)'/);
  assert.ok(declared, 'the studio publishes no customOps — the assistant will invent a name');
  assert.equal(declared[1], 'resume_action');
  const handler = studio.match(/detail\.name !== '([^']+)'/);
  assert.equal(declared[1], handler[1], 'declared custom op name does not match the handler');
});

test('the declared vocabulary lists the real actions, so the model does not invent ops either', () => {
  const desc = studio.match(/customOps:[\s\S]*?\}\],/)[0];
  for (const op of ['set_summary', 'set_headline', 'update_experience']) {
    assert.ok(desc.includes(op), `customOps description omits ${op}`);
  }
  // update_experience.index is 1-based; saying so is what keeps an edit off the neighbouring role.
  assert.match(desc, /1-based/);
  // The hard-truth rule has to travel with the vocabulary or the assistant can fabricate history.
  assert.match(desc, /never invent an employer/i);
});

test('a resume_action with no recognised op changes nothing', () => {
  const handler = studio.match(/surface-bridge:custom[\s\S]*?\n\}\);/)[0];
  // Only entries carrying a string `op` are applied, and an empty batch returns before rendering.
  assert.match(handler, /typeof a\.op === 'string'/);
  assert.match(handler, /if \(!applied\) return;/);
});

test('the editor is told to TALK, not to emit a receipt', () => {
  for (const prompt of [promptSrc, promptJs]) {
    assert.match(prompt, /what you would say out loud/);
    assert.match(prompt, /HOW TO TALK/);
    // The old contract literally asked for one short sentence, and the model complied exactly.
    assert.doesNotMatch(prompt, /one short conversational sentence/);
    // Contiguous substring on purpose: the sentence spans two array entries in the prompt list.
    assert.match(prompt, /bare "Updated\."/);
  }
});

test('a clarifying question with NO edits is an explicitly valid turn', () => {
  for (const prompt of [promptSrc, promptJs]) {
    assert.match(prompt, /ASK rather than guess/);
    assert.match(prompt, /actions:\[\]/);
  }
});

test('a prose-only reply keeps the model\'s words instead of being replaced by "Updated."', () => {
  for (const src of [routesSrc, routesJs]) {
    // The pre-fix code returned the 'Updated.' default on a no-JSON reply, discarding the answer
    // AND claiming an edit that never happened.
    assert.match(src, /raw \? raw\.slice\(0, 1200\) : reply/);
  }
});

test('the compiled route stays in sync with its source — the deployed artifact is the JS', () => {
  // Both halves of this change must be in routes/, or the running app has the old prompt.
  assert.ok(routesJs.includes('HOW TO TALK') && routesJs.includes('raw.slice(0, 1200)'),
    'routes/career-resume-studio-routes.js is stale — re-run `oshal-app build`');
});

test('the studio still parses', () => {
  // The plain (non-module) script is the studio's own logic. CRLF-safe, and deliberately not the
  // `<script type="module">` bridge bootstrap — `import` is invalid inside new Function().
  const script = studio.match(/<script>\s*\n([\s\S]*?)<\/script>/);
  assert.ok(script, 'could not find the studio script block');
  // eslint-disable-next-line no-new-func
  assert.doesNotThrow(() => new Function(script[1]));
});
