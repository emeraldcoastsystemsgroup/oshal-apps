/**
 * Resolve store tests against the canonical framework checkout used to compile their route modules.
 * This config intentionally imports no packages so the framework-owned Vitest binary can load it.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frameworkRoot = resolve(process.env.OSHAL_FRAMEWORK_ROOT || join(here, '..', '..', '..', 'oshal'));

export default {
  resolve: {
    alias: {
      '@': join(frameworkRoot, 'src'),
      express: join(frameworkRoot, 'node_modules', 'express', 'index.js'),
    },
  },
  test: {
    include: [
      'lora/tests/*.spec.ts',
      'vids/tests/*.spec.ts',
    ],
  },
};
