/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — vitest config for running this package's specs
 *                     |                             | from the package root, following the aero-lab precedent. No
 *                     |                             | imports from `vitest/config`: the store repo has no node_modules
 *                     |                             | of its own, so it cannot resolve from here — and defineConfig is
 *                     |                             | identity anyway. The inline plugin resolves bare imports
 *                     |                             | (express, vitest internals) from the CORE checkout's
 *                     |                             | node_modules after vite's own resolution fails. The `@` alias is
 *                     |                             | present for exactly one module — @/shared/logger — which is the
 *                     |                             | only core module this package imports.
 *                     |                             | Run:
 *                     |                             |   cd c:/Projects/oshal-apps/ocean-lab
 *                     |                             |   c:/Projects/oshal/node_modules/.bin/vitest run \
 *                     |                             |     --config tests/vitest.config.ts
 *                     |                             | Override the core checkout with OSHAL_CORE_DIR.
 */

import * as path from 'path';
import { createRequire } from 'module';

const CORE = process.env.OSHAL_CORE_DIR || 'C:/Projects/oshal';
const coreRequire = createRequire(path.join(CORE, 'src', '__resolver__.js'));

export default {
  resolve: { alias: { '@': path.resolve(CORE, 'src') } },
  plugins: [
    {
      name: 'core-node-modules-fallback',
      /**
       * @description Resolve bare package ids from the core checkout's node_modules — runs after
       * vite's own resolver fails (normal-plugin ordering), so it is a pure fallback for the store
       * repo's intentionally-empty node_modules.
       * @param id - The import specifier.
       * @returns An absolute path into core's node_modules, or null to pass.
       */
      resolveId(id: string): string | null {
        if (
          id.startsWith('.') ||
          id.startsWith('/') ||
          path.isAbsolute(id) ||
          id.startsWith('@/') ||
          id.startsWith('\0')
        ) {
          return null;
        }
        try {
          return coreRequire.resolve(id);
        } catch {
          return null;
        }
      },
    },
  ],
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 60_000,
  },
};
