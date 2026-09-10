/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the package's own vitest config (ADR-134 PR3): maps the @/ framework alias to an oshal checkout (OSHAL_FRAMEWORK env, defaulting to a sibling ../../oshal) so the spec-header invocation "run from the package root with the framework checkout on the vitest alias path" is a real, documented command. Plain .mjs with only node builtins — the package's node_modules carries no vitest/config to import from.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The alias map becomes an ARRAY so a second, exactly-anchored entry can be added without widening the first: /^express$/ points at the framework's own express, which is what lets a spec import a package route module and drive its REAL router (the package tree has no node_modules of its own, so a runtime `import ... from 'express'` in src-routes/ could not resolve and the autopilot's schedule payload could only ever be pinned as text). An object-form 'express' key would have matched express-openid-connect too - the regex is the point.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const framework = process.env.OSHAL_FRAMEWORK || path.resolve(here, '../../oshal');

export default {
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.join(framework, 'src') + '/' },
      { find: /^express$/, replacement: path.join(framework, 'node_modules/express/index.js') },
    ],
  },
  test: { include: ['tests/**/*.spec.ts'], environment: 'node', globals: true },
};
