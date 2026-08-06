#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Enforce a complete app-route auth/machine-write inventory and source/compiled route parity for SEC-06.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Replace the formatting-dependent route scanner with a fail-closed parser for the runtime loader's flat routes schema.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Parse the runtime requiresAi route flag so CORE-05 service-only readiness mounts remain inside the reviewed machine-route ledger; preserve the three reviewed pre-source legacy route modules when those packages gain a smoke source.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AUTH_MODES = new Set(['oidc', 'service', 'service-or-oidc', 'operator', 'public']);
const ROUTE_FIELDS = new Set(['module', 'factory', 'mountPath', 'auth', 'requiresAuth', 'requiresContext', 'requiresAi']);
const MACHINE_WRITE = /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_"`]|DELETE\s+FROM|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|VIEW)|TRUNCATE)\b/i;
const REVIEWED_LEGACY_COMPILED_ONLY = new Set([
  'dnd/routes/dnd-routes.js',
  'game-show/routes/game-show-routes.js',
  'hello-oshal/routes/hello.js',
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
  return { module: route.module, factory: route.factory, mountPath: route.mountPath, auth };
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
      }
      const writeClass = bodies.some((body) => MACHINE_WRITE.test(body)) ? 'machine-write' : 'no-sql-write';
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
