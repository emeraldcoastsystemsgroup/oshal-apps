/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweeps 5 and 6: Career Settings showed '○ Default LLM not connected' directly under "Job scoring and résumé/cover writing use your default OSHAL LLM ... no separate key needed here", while the installation's model answered every scoring run and the concierge. The pill read only a per-person anthropic row (career-settings-routes getSettingsState). The shipped modelState (cut out of tools/career-settings.html and run) reports the installation's active model, from the kernel's GET /api/providers/access, as ready; the page reads that endpoint beside /settings/state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../tools/career-settings.html', import.meta.url), 'utf8');

function modelState() {
  const a = html.indexOf('/* model-state:start */');
  const b = html.indexOf('/* model-state:end */');
  assert.ok(a > 0 && b > a, 'modelState is marked in the page');
  return new Function(html.slice(a, b) + '\nreturn modelState;')();
}

test('an active installation model is ready without a per-person Claude row', () => {
  const m = modelState()({ anthropicConnected: false, firecrawlSet: false },
    { hasActive: true, health: 'not_checked', providers: [{ id: 'vllm', active: true, model: 'bot-fast' }] });
  assert.deepEqual(m, { ok: true, text: "● Default LLM ready: this installation's AI model" });
});

test('a per-person Claude connection still reads as ready', () => {
  assert.equal(modelState()({ anthropicConnected: true }, null).ok, true);
});

test('no active model on the installation, and an unreadable check, are named as what they are', () => {
  assert.deepEqual(modelState()({ anthropicConnected: false }, { hasActive: false, providers: [] }),
    { ok: false, text: '○ No AI model is set up on this installation yet' });
  assert.deepEqual(modelState()({}, null), { ok: false, text: '○ Could not check the AI model right now' });
});

test('the page reads the kernel provider access beside its own state, and no longer says "not connected"', () => {
  assert.match(html, /fetch\('\/api\/providers\/access'/);
  assert.doesNotMatch(html, /Default LLM not connected/);
  assert.doesNotMatch(html, /default OSHAL LLM<\/b> \(Claude\)/, 'the installation model is not always Claude');
});
