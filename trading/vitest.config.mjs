/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the package's own vitest config (ADR-134 PR3): maps the @/ framework alias to an oshal checkout (OSHAL_FRAMEWORK env, defaulting to a sibling ../../oshal) so the spec-header invocation "run from the package root with the framework checkout on the vitest alias path" is a real, documented command. Plain .mjs with only node builtins — the package's node_modules carries no vitest/config to import from.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const framework = process.env.OSHAL_FRAMEWORK || path.resolve(here, '../../oshal');

export default {
  resolve: { alias: { '@': path.join(framework, 'src') } },
  test: { include: ['tests/**/*.spec.ts'], environment: 'node', globals: true },
};
