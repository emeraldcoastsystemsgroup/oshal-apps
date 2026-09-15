/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run package authorization against an explicitly supplied real core checkout.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const core = process.env.OSHAL_CORE_ROOT;
if (!core) throw new Error('OSHAL_CORE_ROOT must name the core checkout; no sibling checkout is assumed');
const dependencies = resolve(core, 'node_modules');
export default {
  root: dirname(fileURLToPath(import.meta.url)),
  resolve: { alias: {
    '@': resolve(core, 'src'),
    vitest: resolve(dependencies, 'vitest/dist/index.js'),
    express: resolve(dependencies, 'express'),
    multer: resolve(dependencies, 'multer'),
    sharp: resolve(dependencies, 'sharp'),
    playwright: resolve(dependencies, 'playwright'),
    'js-yaml': resolve(dependencies, 'js-yaml'),
  } },
  test: { include: ['authorization*.spec.ts'], environment: 'node', testTimeout: 30000, hookTimeout: 30000 },
};
