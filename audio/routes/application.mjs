/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Native ESM process route entrypoint exporting createAudioRoutes for Audio Studio 1.2.0 (persists owner-scoped rows via INSERT INTO audio_projects / audio_stems / audio_mixdowns / audio_blobs).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const impl = require('./audio-routes.js');

export function createAudioRoutes(ctx) {
  return impl.createAudioRoutes(ctx);
}
