/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run season surface proof against the sibling framework and fixture-owned PostgreSQL/Chromium.
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
  test: { include: ['tests/video-season-browser.spec.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 120000 },
};
