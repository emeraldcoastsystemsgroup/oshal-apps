/**
 * Resolve store tests against the canonical framework checkout used to compile their route modules.
 * This config intentionally imports no packages so the framework-owned Vitest binary can load it.
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve Chromium and the disposable database fixture for the LoRA gallery acceptance suite.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework-owned multipart parser for Vids artifact publication acceptance.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include purchasing/tests/*.spec.ts. walmart-catalog-policy.spec.ts moved out of core with the purchasing carve (2026-07-18) and ran in no gate since: it imports the TypeScript route source, whose @/ imports only this framework-coupled config resolves, so the bare-checkout purchasing job cannot run it.
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
      multer: join(frameworkRoot, 'node_modules', 'multer', 'index.js'),
      playwright: join(frameworkRoot, 'node_modules', 'playwright', 'index.mjs'),
      '@test-fixtures': join(frameworkRoot, 'tests', 'helpers'),
    },
  },
  test: {
    include: [
      'lora/tests/*.spec.ts',
      'vids/tests/*.spec.ts',
      'purchasing/tests/*.spec.ts',
    ],
  },
};
