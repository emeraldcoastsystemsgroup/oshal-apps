/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 01:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — vitest config for
 *                     |                             | running this package's specs from the package root
 *                     |                             | with the framework checkout on the alias path (the
 *                     |                             | sat-ops/movies "vitest alias path" precedent, made
 *                     |                             | explicit). No imports (a plain config object): the
 *                     |                             | store repo has no node_modules of its own, so
 *                     |                             | `vitest/config` cannot resolve from here — and
 *                     |                             | defineConfig is identity anyway. The inline plugin
 *                     |                             | resolves bare imports (express, pino, …) from the
 *                     |                             | CORE checkout's node_modules as a fallback after
 *                     |                             | vite's own resolution fails.
 *                     |                             | Run:
 *                     |                             |   cd c:/Projects/oshal-apps/aero-lab
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
       * @description Resolve bare package ids from the core checkout's node_modules —
       * runs after vite's own resolver fails (normal-plugin ordering), so it is a pure
       * fallback for the store repo's intentionally-empty node_modules.
       * @param id - The import specifier.
       * @returns An absolute path into core's node_modules, or null to pass.
       */
      resolveId(id: string): string | null {
        if (id.startsWith('.') || id.startsWith('/') || path.isAbsolute(id) || id.startsWith('@/') || id.startsWith('\0')) return null;
        try { return coreRequire.resolve(id); } catch { return null; }
      },
    },
  ],
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    globals: true,
  },
};
