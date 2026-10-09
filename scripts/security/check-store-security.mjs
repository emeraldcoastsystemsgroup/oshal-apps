#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Enforce a complete app-route auth/machine-write inventory and source/compiled route parity for SEC-06.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Replace the formatting-dependent route scanner with a fail-closed parser for the runtime loader's flat routes schema.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Parse the runtime requiresAi route flag so CORE-05 service-only readiness mounts remain inside the reviewed machine-route ledger; preserve the three reviewed pre-source legacy route modules when those packages gain a smoke source.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Recognize the known completed-task writer call without claiming generic transitive write analysis.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Inventory signed public callback verifier declarations and require their named export instead of treating the field as unknown or silently ignoring it.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Name the two existing hand-written compiled-only routes whose packages acquired an independent readiness source; keep both inside route/auth/write inventory.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Carry the existing bounded anonymous read declaration so whole-store package audits can inventory the published Vids manifest without weakening unknown-field refusal.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Accept core ADR-175's `node` route mode (a package node rail authenticated by a device-bound node credential) in the manifest auth vocabulary.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AUTH_MODES = new Set(['oidc', 'service', 'service-or-oidc', 'operator', 'public', 'node']);
const ROUTE_FIELDS = new Set(['module', 'factory', 'mountPath', 'auth', 'requiresAuth', 'requiresContext', 'requiresAi', 'callbackVerifier']);
const MACHINE_WRITE = /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_"`]|DELETE\s+FROM|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|VIEW)|TRUNCATE)\b/i;
const COMPLETED_TASK_WRITE = /\bsaveCompletedBriefing\s*\(/;
const REVIEWED_LEGACY_COMPILED_ONLY = new Set([
  'calling-assistant/routes/routes.js',
  'dev-workspace-index/routes/dev-workspace.js',
  'dnd/routes/dnd-routes.js',
  'game-show/routes/game-show-routes.js',
  'hello-oshal/routes/hello.js',
  'social/routes/linkedin-content-queue.js',
]);

/** @description Add stable manifest and line context to a fail-closed route parse error. */
function routeParseError(manifestPath, lineNumber, message) {
  return new Error(`${manifestPath}:${lineNumber}: ${message}`);
}

/** @description Remove a YAML comment while respecting the quoted scalar subset used by routes. */
function stripYamlComment(value, manifestPath, lineNumber) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote && character === quote) {
      if (quote === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quote = null;
      continue;
    }
    if (!quote && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (!quote && character === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }
  if (quote) throw routeParseError(manifestPath, lineNumber, 'unterminated quoted route scalar');
  return value.trim();
}

/** @description Parse a non-empty string or boolean from the supported flat route schema. */
function routeScalar(raw, field, manifestPath, lineNumber) {
  const value = stripYamlComment(raw, manifestPath, lineNumber);
  if (!value) throw routeParseError(manifestPath, lineNumber, `route field ${field} is empty`);
  if (field === 'requiresAuth' || field === 'requiresContext' || field === 'requiresAi') {
    if (value !== 'true' && value !== 'false') {
      throw routeParseError(manifestPath, lineNumber, `route field ${field} must be true or false`);
    }
    return value === 'true';
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw routeParseError(manifestPath, lineNumber, `invalid quoted route field ${field}`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      throw routeParseError(manifestPath, lineNumber, `invalid quoted route field ${field}`);
    }
    try {
      return JSON.parse(value);
    } catch {
      throw routeParseError(manifestPath, lineNumber, `invalid quoted route field ${field}`);
    }
  }
  if (/^[\[{&*!|>]/.test(value)) {
    throw routeParseError(manifestPath, lineNumber, `route field ${field} uses unsupported YAML syntax`);
  }
  return value;
}

/** @description Store one unique known route field from either block or flow YAML. */
function assignRouteField(route, field, raw, manifestPath, lineNumber) {
  if (!ROUTE_FIELDS.has(field)) {
    throw routeParseError(manifestPath, lineNumber, `unsupported route field ${field}`);
  }
  if (Object.hasOwn(route, field)) {
    throw routeParseError(manifestPath, lineNumber, `duplicate route field ${field}`);
  }
  route[field] = routeScalar(raw, field, manifestPath, lineNumber);
}

/** @description Split a flat YAML flow mapping without treating quoted commas as separators. */
function flowPairs(body, manifestPath, lineNumber) {
  const pairs = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote && character === quote) {
      if (quote === "'" && body[index + 1] === "'") {
        index += 1;
        continue;
      }
      quote = null;
    } else if (!quote && (character === "'" || character === '"')) quote = character;
    else if (!quote && character === ',') {
      pairs.push(body.slice(start, index));
      start = index + 1;
    }
  }
  if (quote) throw routeParseError(manifestPath, lineNumber, 'unterminated quote in route flow mapping');
  pairs.push(body.slice(start));
  return pairs;
}

/** @description Parse one flat `{ field: value }` route declaration. */
function parseFlowRoute(body, manifestPath, lineNumber) {
  const route = {};
  for (const pair of flowPairs(body, manifestPath, lineNumber)) {
    const field = /^\s*([A-Za-z][A-Za-z0-9]*):\s*(.+?)\s*$/.exec(pair);
    if (!field) throw routeParseError(manifestPath, lineNumber, 'malformed route flow mapping');
    assignRouteField(route, field[1], field[2], manifestPath, lineNumber);
  }
  return route;
}

/** @description Validate and normalize one route exactly as the runtime auth resolver does. */
function normalizeRoute(route, manifestPath, routeNumber) {
  const at = `${manifestPath}: routes[${routeNumber}]`;
  for (const field of ['module', 'factory', 'mountPath']) {
    if (typeof route[field] !== 'string' || !route[field].trim()) throw new Error(`${at} is missing ${field}`);
  }
  if (!route.mountPath.startsWith('/')) throw new Error(`${at} mountPath must start with /`);
  if (route.auth === undefined && route.requiresAuth === undefined) throw new Error(`${at} is missing auth`);
  if (route.auth !== undefined && !AUTH_MODES.has(route.auth)) {
    throw new Error(`${at} has unsupported auth ${route.auth}`);
  }
  if (route.auth !== undefined && route.requiresAuth !== undefined) {
    const contradictory = (route.auth === 'public') !== (route.requiresAuth === false);
    if (contradictory) throw new Error(`${at} has contradictory auth and requiresAuth`);
  }
  const auth = route.auth ?? (route.requiresAuth === false ? 'public' : 'oidc');
  if (route.callbackVerifier !== undefined && (auth !== 'public'
    || typeof route.callbackVerifier !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(route.callbackVerifier))) {
    throw new Error(`${at} callbackVerifier requires a public route and a named factory`);
  }
  if (route.anonymousRoutes && (auth !== 'public' || route.callbackVerifier)) throw new Error(`${at} anonymousRoutes requires public auth without a callback verifier`);
  return { module: route.module, factory: route.factory, mountPath: route.mountPath, auth,
    ...(route.callbackVerifier ? { callbackVerifier: route.callbackVerifier } : {}),
    ...(route.anonymousRoutes ? { anonymousRoutes: route.anonymousRoutes } : {}) };
}

/** @description Parse the existing nested named-read syntax without accepting arbitrary nested route fields.
 * @param lines Manifest lines. @param start Declaration line. @param indent Field indentation.
 * @param manifestPath Source diagnostic identity. @returns Parsed reads and last consumed line. */
function parseAnonymousReadBlock(lines, start, indent, manifestPath) {
  const routes = [];
  let current = null, itemIndent = null, index = start + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const depth = /^ */.exec(line)[0].length;
    if (depth <= indent) break;
    const item = /^ +-\s+([A-Za-z]+):\s*(.+?)\s*$/.exec(line);
    if (item) {
      if (itemIndent !== null && depth !== itemIndent) throw routeParseError(manifestPath, index + 1, 'inconsistent anonymous read indentation');
      itemIndent = depth;
      if (current) routes.push(normalizeAnonymousRead(current, manifestPath, index + 1));
      current = {};
    } else if (!current || depth !== itemIndent + 2) throw routeParseError(manifestPath, index + 1, 'malformed anonymous read mapping');
    const field = item ?? /^ +([A-Za-z]+):\s*(.+?)\s*$/.exec(line);
    if (!field || !['method', 'path'].includes(field[1]) || Object.hasOwn(current, field[1])) {
      throw routeParseError(manifestPath, index + 1, 'unknown or duplicate anonymous read field');
    }
    current[field[1]] = routeScalar(field[2], field[1], manifestPath, index + 1);
  }
  if (current) routes.push(normalizeAnonymousRead(current, manifestPath, index));
  if (!routes.length || routes.length > 32 || new Set(routes.map(row => row.method + ' ' + row.path)).size !== routes.length) {
    throw routeParseError(manifestPath, start + 1, 'anonymous reads must be a bounded nonempty list without duplicates');
  }
  return { routes, end: index - 1 };
}
/** @description Retain the runtime contract's exact named GET/HEAD read shape in the inventory parser.
 * @param row Parsed mapping. @param manifestPath Source identity. @param line Diagnostic line.
 * @returns Closed named read mapping; malformed syntax throws. */
function normalizeAnonymousRead(row, manifestPath, line) {
  const parts = typeof row.path === 'string' && row.path.length <= 256 && row.path.startsWith('/') ? row.path.slice(1).split('/') : [];
  const literal = part => /^[A-Za-z0-9_-][A-Za-z0-9._~-]*$/.test(part);
  const parameter = part => /^:[A-Za-z][A-Za-z0-9_]*$/.test(part);
  if (!['GET', 'HEAD'].includes(row.method) || !parts.length || !parts.every(part => literal(part) || parameter(part))
    || !parts.some(literal) || new Set(parts.filter(parameter)).size !== parts.filter(parameter).length) {
    throw routeParseError(manifestPath, line, 'anonymous read requires GET/HEAD and a canonical named path');
  }
  return { method: row.method, path: row.path };
}

/**
 * @description Parse the runtime loader's flat manifest `routes` schema without a repository-level
 * dependency install. Field order and indentation width may vary, as valid YAML permits, but every
 * route line must remain in the deliberately small mapping/sequence subset. Unsupported syntax,
 * duplicate keys, empty blocks, and partial declarations fail closed instead of returning `[]`.
 */
export function parseManifestRoutes(source, manifestPath) {
  if (typeof source !== 'string' || !source.trim() || !source.split(/\r?\n/).some((line) => line.trim() && !line.trimStart().startsWith('#'))) {
    throw new Error(`${manifestPath}: manifest is empty`);
  }
  if (source.includes('\0')) throw new Error(`${manifestPath}: manifest contains a NUL byte`);
  if (/^ *\t|^\t/m.test(source)) throw new Error(`${manifestPath}: tabs are not valid route indentation`);

  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rootMappings = lines.filter((line) => /^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line));
  if (rootMappings.length === 0) throw new Error(`${manifestPath}: manifest is not a top-level mapping`);
  const routeKeys = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^routes\s*:/.test(line));
  if (routeKeys.length === 0) return [];
  if (routeKeys.length > 1) throw new Error(`${manifestPath}: manifest declares routes more than once`);

  const { line: header, index: start } = routeKeys[0];
  const headerMatch = /^routes\s*:\s*(.*?)\s*$/.exec(header);
  if (!headerMatch) throw routeParseError(manifestPath, start + 1, 'malformed routes mapping');
  const headerValue = stripYamlComment(headerMatch[1], manifestPath, start + 1);
  if (headerValue && headerValue !== '[]') {
    throw routeParseError(manifestPath, start + 1, 'routes must be [] or a block sequence');
  }

  const routes = [];
  let current = null;
  let itemIndent = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) {
        throw routeParseError(manifestPath, index + 1, 'manifest contains malformed top-level YAML');
      }
      break;
    }
    if (headerValue === '[]') {
      throw routeParseError(manifestPath, index + 1, 'routes: [] cannot contain nested declarations');
    }

    const indentation = /^ +/.exec(line)?.[0].length ?? 0;
    const item = /^ +-\s+(.+?)\s*$/.exec(line);
    if (item) {
      if (itemIndent === null) itemIndent = indentation;
      else if (indentation !== itemIndent) {
        throw routeParseError(manifestPath, index + 1, `route items use inconsistent indentation (${itemIndent} and ${indentation})`);
      }
      if (current) routes.push(normalizeRoute(current, manifestPath, routes.length));
      const body = item[1];
      if (body.startsWith('{')) {
        if (!body.endsWith('}')) throw routeParseError(manifestPath, index + 1, 'unterminated route flow mapping');
        routes.push(normalizeRoute(parseFlowRoute(body.slice(1, -1), manifestPath, index + 1), manifestPath, routes.length));
        current = null;
      } else {
        const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.+?)\s*$/.exec(body);
        if (!field) throw routeParseError(manifestPath, index + 1, 'route item must begin with a field mapping');
        current = {};
        assignRouteField(current, field[1], field[2], manifestPath, index + 1);
      }
      continue;
    }

    if (!current || itemIndent === null || indentation <= itemIndent) {
      throw routeParseError(manifestPath, index + 1, 'route continuation is not nested under a sequence item');
    }
    if (/^ +anonymousRoutes:\s*(?:#.*)?$/.test(line)) {
      if (current.anonymousRoutes !== undefined) throw routeParseError(manifestPath, index + 1, 'duplicate anonymousRoutes');
      const block = parseAnonymousReadBlock(lines, index, indentation, manifestPath);
      current.anonymousRoutes = block.routes; index = block.end; continue;
    }
    const field = /^\s+([A-Za-z][A-Za-z0-9]*):\s*(.+?)\s*$/.exec(line);
    if (!field) throw routeParseError(manifestPath, index + 1, 'malformed route field mapping');
    assignRouteField(current, field[1], field[2], manifestPath, index + 1);
  }
  if (current) routes.push(normalizeRoute(current, manifestPath, routes.length));
  if (headerValue === '[]') return [];
  if (routes.length === 0) throw new Error(`${manifestPath}: routes must be [] or a non-empty block sequence`);
  return routes;
}

/** @description Discover installable store packages from the same manifest boundary as the loader. */
function packageDirs(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
}

/** @description Recursively list files with a requested suffix. */
function filesWithSuffix(root, suffix) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesWithSuffix(candidate, suffix));
    else if (entry.name.endsWith(suffix)) out.push(candidate);
  }
  return out.sort();
}

/** @description Refuse traversal or absolute manifest module paths before reading package code. */
function containedModule(packageDir, modulePath) {
  const full = resolve(packageDir, modulePath);
  const rel = relative(packageDir, full);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(modulePath) === modulePath) {
    throw new Error(`${packageDir}: route module escapes its package: ${modulePath}`);
  }
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`Compiled route module is missing: ${full}`);
  return full;
}

/**
 * @description Map a compiled route to source without pretending three reviewed pre-source modules
 * appeared when their packages gained the independent CORE-05 smoke source.
 */
function sourceFor(packageDir, modulePath) {
  const sourceRoot = join(packageDir, 'src-routes');
  if (!existsSync(sourceRoot) || !modulePath.startsWith('routes/')) return null;
  const source = join(sourceRoot, modulePath.slice('routes/'.length).replace(/\.js$/, '.ts'));
  if (existsSync(source)) return source;
  const legacyKey = `${basename(packageDir)}/${modulePath.replaceAll('\\', '/')}`;
  return REVIEWED_LEGACY_COMPILED_ONLY.has(legacyKey) ? null : source;
}

/**
 * @description Every package-local module a route module pulls in, transitively. A route that
 * delegates its SQL to a sibling module writes just as much as one that inlines it, so the write
 * classification has to read what the route actually reaches. Bounded to the package's own
 * routes/ and src-routes/ directories: a framework import is not a package file and is never read.
 * @param packageDir - The package root.
 * @param entry - Absolute path of the route module (compiled or source).
 * @returns Absolute paths of the local modules it imports, transitively, excluding the entry.
 */
function localImportClosure(packageDir, entry) {
  const roots = [join(packageDir, 'routes'), join(packageDir, 'src-routes')];
  const seen = new Set([entry]);
  const out = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    let body;
    try { body = readFileSync(file, 'utf8'); } catch { continue; }
    const specifiers = [...body.matchAll(/(?:require\(|from\s*)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      const base = resolve(dirname(file), specifier);
      const candidates = [base, `${base}.js`, `${base}.ts`];
      const target = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      if (!target) continue;
      const inPackage = roots.some((root) => !relative(root, target).startsWith('..'));
      if (!inPackage || seen.has(target)) continue;
      seen.add(target);
      out.push(target);
      queue.push(target);
    }
  }
  return out;
}

/** @description Verify every source route has a compiled counterpart and valid JavaScript syntax. */
function assertCompiledParity(packageDir) {
  const sourceRoot = join(packageDir, 'src-routes');
  if (!existsSync(sourceRoot)) return;
  for (const source of filesWithSuffix(sourceRoot, '.ts').filter((file) => !file.endsWith('.d.ts'))) {
    const rel = relative(sourceRoot, source).replace(/\.ts$/, '.js');
    const compiled = join(packageDir, 'routes', rel);
    if (!existsSync(compiled)) throw new Error(`Source route has no compiled peer: ${source}`);
  }
  for (const compiled of filesWithSuffix(join(packageDir, 'routes'), '.js')) {
    const result = spawnSync(process.execPath, ['--check', compiled], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Compiled route does not parse: ${compiled}\n${result.stderr}`);
  }
}

/** @description Build the stable route/auth/write ledger from every package manifest and module. */
export function routeInventory(root = process.cwd()) {
  const inventory = [];
  for (const packageName of packageDirs(root)) {
    const packageDir = join(root, packageName);
    assertCompiledParity(packageDir);
    const manifestPath = join(packageDir, 'oshal-app.yaml');
    const routes = parseManifestRoutes(readFileSync(manifestPath, 'utf8'), manifestPath);
    for (const route of routes) {
      const compiled = containedModule(packageDir, route.module);
      const source = sourceFor(packageDir, route.module);
      if (source && !existsSync(source)) throw new Error(`Manifest route has no source peer: ${source}`);
      const bodies = [readFileSync(compiled, 'utf8')];
      if (source) bodies.push(readFileSync(source, 'utf8'));
      for (const body of bodies) {
        if (!new RegExp(`\\b${route.factory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body)) {
          throw new Error(`${packageName}/${route.module} does not define ${route.factory}`);
        }
        if (route.callbackVerifier && !new RegExp(`\\b${route.callbackVerifier}\\b`).test(body)) {
          throw new Error(`${packageName}/${route.module} does not define callback verifier ${route.callbackVerifier}`);
        }
      }
      // The factory assertion above reads the ENTRY bodies only; the write class reads everything
      // the route reaches inside its own package, so splitting a large route module into siblings
      // cannot silently downgrade machine-write to no-sql-write.
      const reached = [compiled, ...(source ? [source] : [])]
        .flatMap((file) => localImportClosure(packageDir, file))
        .map((file) => readFileSync(file, 'utf8'));
      const writeClass = [...bodies, ...reached].some((body) => MACHINE_WRITE.test(body) || COMPLETED_TASK_WRITE.test(body)) ? 'machine-write' : 'no-sql-write';
      inventory.push([packageName, route.module, route.factory, route.mountPath, route.auth, writeClass].join('|'));
    }
  }
  return inventory.sort();
}

/** @description Compare the discovered inventory to the reviewed, versioned snapshot. */
function assertInventory(root, actual) {
  const ledgerPath = join(root, 'scripts', 'security', 'store-route-inventory.json');
  if (!existsSync(ledgerPath)) throw new Error(`Reviewed route inventory is missing: ${ledgerPath}`);
  const document = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const expected = document.routes ?? [];
  const added = actual.filter((entry) => !expected.includes(entry));
  const stale = expected.filter((entry) => !actual.includes(entry));
  if (added.length || stale.length) {
    throw new Error(`Store security inventory drifted; added=${JSON.stringify(added)}, stale=${JSON.stringify(stale)}`);
  }
  if (actual.length < 20) throw new Error(`Only ${actual.length} store routes discovered; parser likely regressed`);
}

/** @description Run or print the store inventory without ever rewriting its reviewed snapshot. */
export function main(argv = process.argv.slice(2)) {
  const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? process.cwd());
  const inventory = routeInventory(root);
  if (argv.includes('--print')) console.log(JSON.stringify({ schemaVersion: 1, routes: inventory }, null, 2));
  else {
    assertInventory(root, inventory);
    console.log(`Store security inventory passed: ${inventory.length} routes`);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
