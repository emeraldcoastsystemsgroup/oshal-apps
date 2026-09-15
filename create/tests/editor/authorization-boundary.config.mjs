/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run actual core policy/mounter integration only with an explicitly supplied core checkout.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include disposable two-client PostgreSQL concurrency proof under the same registered core-authorization recipe.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include the brand kit's role and binding proof under the same real core runtime.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const core = process.env.OSHAL_CORE_ROOT;
if (!core) throw new Error('OSHAL_CORE_ROOT must name the core checkout');
const dependencies = resolve(core, 'node_modules');
export default {
  root: dirname(fileURLToPath(import.meta.url)),
  resolve: { alias: { '@': resolve(core, 'src'),
    ...Object.fromEntries(['express', 'multer', 'sharp', 'js-yaml'].map(name => [name, resolve(dependencies, name)])),
    vitest: resolve(dependencies, 'vitest/dist/index.js'),
  } },
  test: { include: ['authorization-boundary.spec.ts', 'project-concurrency.spec.ts', 'brand-authorization.spec.ts'], environment: 'node', testTimeout: 15000, hookTimeout: 30000 },
};
