/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise package publication against the explicit framework and disposable PostgreSQL, using real multipart and Chromium.
 */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../../../oshal'));
export default {
  root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  resolve: { alias: {
    '@': join(framework, 'src'), '@test-fixtures': join(framework, 'tests/helpers'),
    express: join(framework, 'node_modules/express/index.js'),
    multer: join(framework, 'node_modules/multer/index.js'),
    playwright: join(framework, 'node_modules/playwright/index.mjs'),
  } },
  test: { include: ['tests/*.spec.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 120000 },
};
