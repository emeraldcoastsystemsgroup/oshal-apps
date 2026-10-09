/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the fantasy-football cross-user isolation spec against an explicit framework checkout (its @/ sources, express and disposable PostgreSQL fixture); no package-local node_modules and no deployment database.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const framework = resolve(
  process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || join(here, '../../../oshal'),
);

export default {
  root: resolve(here, '..'),
  resolve: {
    alias: {
      '@': join(framework, 'src'),
      '@test-fixtures': join(framework, 'tests/helpers'),
      express: join(framework, 'node_modules/express/index.js'),
    },
  },
  test: { include: ['tests/*.spec.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 180000 },
};
