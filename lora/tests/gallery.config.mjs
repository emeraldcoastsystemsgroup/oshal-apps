/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run package gallery acceptance against an explicit framework checkout, using only fixture-owned PostgreSQL and Chromium.
 */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || join(here, '../../../oshal'));
export default {
  root: resolve(here, '..'),
  resolve: { alias: {
    '@': join(framework, 'src'), '@test-fixtures': join(framework, 'tests/helpers'),
    express: join(framework, 'node_modules/express/index.js'),
    playwright: join(framework, 'node_modules/playwright/index.mjs'),
  } },
  test: { include: ['tests/*.spec.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 120000 },
};
