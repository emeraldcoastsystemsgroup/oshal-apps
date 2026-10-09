/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real FFmpeg boundary for export jobs: run tests/video-edit-export.engine.mjs inside the local runtime image and require its complete TAP summary. The host has no FFmpeg of its own; no encode or decode here is simulated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInEngine } from './video-edit-engine.fixture.mjs';

test('the compiled export runner renders, decodes, cancels and cleans up with the runtime image\'s real FFmpeg', () => {
  const run = runInEngine('tests/video-edit-export.engine.mjs', { minimumTests: 3, timeoutMs: 420000 });
  assert.equal(run.counts.pass, run.counts.tests);
  console.log(JSON.stringify({ engine: 'video-edit-export', image: run.image, container: run.container, inner: run.counts }));
});
