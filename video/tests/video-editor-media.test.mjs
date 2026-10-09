/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real ffprobe boundary for owned media: run tests/video-editor-media.engine.mjs inside the local runtime image and require its complete TAP summary. The host has no FFmpeg of its own; this never substitutes a stand-in for the probe.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The inner suite now also proves the committed acceptance clip; require at least five inner tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInEngine } from './video-edit-engine.fixture.mjs';

test('the compiled upload inspector accepts and refuses real media under the runtime image\'s ffprobe', () => {
  const run = runInEngine('tests/video-editor-media.engine.mjs', { minimumTests: 5 });
  assert.equal(run.counts.pass, run.counts.tests);
  console.log(JSON.stringify({ engine: 'video-editor-media', image: run.image, container: run.container, inner: run.counts }));
});
