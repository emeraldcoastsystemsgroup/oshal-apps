/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run Video's catalog proof against the ACTUAL core authorization runtime and route mounter of an explicitly supplied core checkout (OSHAL_CORE_ROOT); nothing is resolved from a sibling guess.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const core = process.env.OSHAL_CORE_ROOT;
if (!core) throw new Error('OSHAL_CORE_ROOT must name the core checkout');
const dependencies = resolve(core, 'node_modules');
export default {
  root: dirname(fileURLToPath(import.meta.url)),
  resolve: { alias: { '@': resolve(core, 'src'),
    ...Object.fromEntries(['express', 'multer', 'js-yaml', 'pg'].map(name => [name, resolve(dependencies, name)])),
    vitest: resolve(dependencies, 'vitest/dist/index.js'),
  } },
  test: { include: ['video-editor-authorization.spec.ts'], environment: 'node', testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
};
