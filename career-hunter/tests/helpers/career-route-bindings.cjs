/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Enumerate every literal route this package registers (router.get/post/put/delete/patch in src-routes/*.ts, mapped to the manifest mounts that serve it through the composition root's import closure) and mirror the kernel's two-step HTTP binding match: the longest-mount-relative path (core src/app/composition/application-authorization-runtime.ts, the requestPath/mount/relative lines of the authorization middleware) and resolveOperationPermissions' segment grammar (core src/features/application-authorization/policy.ts: same segment count, a literal equals, a :param takes any non-empty segment but "." and "..", and only exactly one matching binding binds). The 1.25.1 catalog passed oshal-app validate with GET /companies-admin unbound, because the validator sees the catalog and not the routers; this helper is what the bare guard (tests/career-catalog-route-bindings.test.mjs) and the kernel companion (tests/career-rail-kernel-boundary.core.test.js, which runs the REAL matcher over the same enumeration and requires the mirror to agree) share.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Inspect JavaScript manifest modules and their relative import closure as well as authored TypeScript routes; the native reader registers real tools without HTTP routes and must not disappear from coverage or require an invented TypeScript copy.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The package root (tests/helpers/ is two levels down). */
const PKG = path.resolve(__dirname, '..', '..');
/** How many segments under /board the catalog binds the classic-board wildcard for. */
const WILDCARD_DEPTHS = 4;
/** One Express route registration with a string-literal path; whitespace may follow the paren. */
const ROUTE_CALL = /\brouter\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]*)\2/g;
/** A sibling module import or require, in any line layout. */
const RELATIVE_IMPORT = /(?:from\s*|require\()\s*(['"])(\.\.?\/[^'"]+)\1/g;

/**
 * @description Every literal route registered in one src-routes source.
 * @param {string} file - Absolute path of a src-routes/*.ts file.
 * @returns {Array<{file: string, method: string, pattern: string}>} Uppercased method and the Express pattern.
 */
function literalRoutesIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const routes = [];
  for (const match of text.matchAll(ROUTE_CALL)) routes.push({ file: path.relative(PKG, file).replace(/\\/g, '/'), method: match[1].toUpperCase(), pattern: match[3] });
  return routes;
}

/** @description Absolute paths of every src-routes/*.ts source, sorted. */
function routeSources() {
  const dir = path.join(PKG, 'src-routes');
  return fs.readdirSync(dir).filter((name) => name.endsWith('.ts')).sort().map((name) => path.join(dir, name));
}

/**
 * @description The sibling sources one src-routes file reaches through relative imports, itself
 * included: a manifest module composes the routers it imports, so its closure is what that mount serves.
 * @param {string} entry - Absolute path of the mount's module source.
 * @returns {string[]} Absolute paths, sorted.
 */
function importClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const match of fs.readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const base = path.resolve(path.dirname(file), match[2]);
      const stem = base.replace(/\.(?:[cm]?js|ts)$/, '');
      const target = [stem + '.ts', base, stem + '.js', stem + '.cjs'].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return [...seen].sort();
}

/**
 * @description The manifest's route entries, read from oshal-app.yaml's flat `routes:` list
 * (module and mountPath per entry), without a YAML library.
 * @returns {Array<{module: string, mountPath: string}>} In manifest order.
 */
function manifestMounts() {
  const text = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const start = text.search(/^routes:\s*$/m);
  if (start < 0) throw new Error('oshal-app.yaml has no routes: list');
  const rest = text.slice(start + 'routes:'.length);
  const end = rest.search(/^[a-zA-Z]/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  const entries = [];
  for (const line of block.split(/\r?\n/)) {
    const moduleLine = /^\s*-\s*module:\s*(\S+)/.exec(line);
    const mountLine = /^\s+mountPath:\s*(\S+)/.exec(line);
    if (moduleLine) entries.push({ module: moduleLine[1], mountPath: null });
    else if (mountLine) {
      const entry = entries[entries.length - 1];
      if (!entry || entry.mountPath) throw new Error(`mountPath without a module entry: ${line}`);
      entry.mountPath = mountLine[1];
    }
  }
  const unmounted = entries.filter((entry) => !entry.mountPath);
  if (!entries.length || unmounted.length) throw new Error(`manifest routes without a mountPath: ${JSON.stringify(unmounted)}`);
  return entries;
}

/**
 * @description Every literal route under every mount that serves it.
 * @returns {Array<{mount: string, module: string, file: string, method: string, pattern: string}>}
 */
function mountedRoutes() {
  const out = [];
  for (const { module, mountPath } of manifestMounts()) {
    const actual = path.resolve(PKG, module);
    if (!actual.startsWith(PKG + path.sep)) throw new Error(`manifest module escapes the package: ${module}`);
    const authored = module.startsWith('routes/') ? path.join(PKG, 'src-routes', path.basename(module, '.js') + '.ts') : actual;
    const entry = fs.existsSync(authored) ? authored : actual;
    if (!fs.existsSync(entry)) throw new Error(`manifest module ${module} has no readable source at ${entry}`);
    for (const file of importClosure(entry)) for (const route of literalRoutesIn(file)) out.push({ mount: mountPath, module, ...route });
  }
  return out;
}

/**
 * @description Request paths that exercise one Express pattern: a :param becomes a plain segment,
 * a *wildcard is tried at every depth the catalog binds. Nothing here can match a literal sibling.
 * @param {string} pattern - The Express route pattern.
 * @returns {string[]} Mount-relative request paths.
 */
function sampleRequests(pattern) {
  const wildcard = /\/\*[A-Za-z_][A-Za-z0-9_]*$/.exec(pattern);
  const withParams = (text) => text.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (_m, offset) => `p${offset}`);
  if (!wildcard) return [withParams(pattern)];
  const head = withParams(pattern.slice(0, wildcard.index));
  return Array.from({ length: WILDCARD_DEPTHS }, (_v, depth) => `${head}/${Array.from({ length: depth + 1 }, (_w, i) => `w${i + 1}`).join('/')}`);
}

/**
 * @description The catalog's HTTP bindings, read from authorization.yaml's `bindings.http` flow
 * entries without a YAML library; refuses an entry it cannot read rather than skipping it.
 * @returns {Array<{id: string, method: string, path: string, allOf: string[]}>}
 */
function catalogHttpBindings() {
  const text = fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8');
  const start = text.search(/^  http:\s*$/m);
  if (start < 0) throw new Error('authorization.yaml has no bindings.http section');
  const rest = text.slice(start + '  http:'.length);
  const end = rest.search(/^  [a-zA-Z]/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  const bindings = [];
  for (const line of block.split(/\r?\n/)) {
    if (!/^\s*-/.test(line)) continue;
    const entry = /^\s*-\s*\{\s*id:\s*([^,\s]+),\s*method:\s*([A-Z]+),\s*path:\s*([^,\s]+),\s*allOf:\s*\[([^\]]*)\]\s*\}\s*$/.exec(line);
    if (!entry) throw new Error(`unreadable http binding line (only flow entries are read): ${line.trim()}`);
    bindings.push({ id: entry[1], method: entry[2], path: entry[3], allOf: entry[4].split(',').map((item) => item.trim()).filter(Boolean) });
  }
  if (!bindings.length) throw new Error('authorization.yaml bindings.http is empty');
  return bindings;
}

/**
 * @description The path the kernel authorizes: the request path relative to the longest mount
 * that prefixes it (application-authorization-runtime.ts), or the whole path when none does.
 * @param {string} requestPath - The controller-level request path, no query string.
 * @param {string[]} mountPaths - The package's registered mounts.
 * @returns {string}
 */
function kernelRelativePath(requestPath, mountPaths) {
  const mounts = [...mountPaths].sort((a, b) => b.length - a.length);
  const mount = mounts.find((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`));
  return mount ? requestPath.slice(mount.length) || '/' : requestPath;
}

/**
 * @description The bindings the kernel's matcher (policy.ts resolveOperationPermissions) finds for
 * one relative path: the path itself and every mount-stripped form of it, same segment count, a
 * literal segment equals, a :param takes any non-empty segment except "." and "..".
 * @param {Array<{method: string, path: string}>} bindings - The catalog's http bindings.
 * @param {string[]} mountPaths - The package's registered mounts.
 * @param {string} method - Request method.
 * @param {string} relative - The path from kernelRelativePath.
 * @returns {Array<object>} Every matching binding; the kernel binds only when there is exactly one.
 */
function matchBindings(bindings, mountPaths, method, relative) {
  if (!relative || relative.includes('?') || relative.includes('#') || /[%\\]/.test(relative) || relative.includes('//')) return [];
  const candidates = [relative, ...mountPaths.filter((mount) => relative.startsWith(`${mount}/`) || relative === mount).map((mount) => relative.slice(mount.length) || '/')];
  const upper = method.toUpperCase();
  return bindings.filter((binding) => binding.method === upper && candidates.some((candidate) => {
    const expected = binding.path.split('/'); const actual = candidate.split('/');
    return actual.length === expected.length && expected.every((part, i) => part === actual[i] || (part.startsWith(':') && Boolean(actual[i]) && actual[i] !== '.' && actual[i] !== '..'));
  }));
}

/**
 * @description The mounted routes with their sample requests resolved the way the kernel would.
 * @param {string[]} [mountPaths] - Registered mounts; defaults to the manifest's.
 * @param {Array<object>} [bindings] - Catalog bindings; defaults to authorization.yaml's.
 * @returns {Array<{mount, module, file, method, pattern, request, relative, matches}>}
 */
function resolvedRoutes(mountPaths, bindings) {
  const mounts = mountPaths ?? manifestMounts().map((entry) => entry.mountPath);
  const http = bindings ?? catalogHttpBindings();
  const out = [];
  for (const route of mountedRoutes()) {
    for (const sample of sampleRequests(route.pattern)) {
      const request = sample === '/' ? route.mount : `${route.mount}${sample}`;
      const relative = kernelRelativePath(request, mounts);
      out.push({ ...route, request, relative, matches: matchBindings(http, mounts, route.method, relative) });
    }
  }
  return out;
}

module.exports = { PKG, WILDCARD_DEPTHS, catalogHttpBindings, importClosure, kernelRelativePath, literalRoutesIn, manifestMounts,
  matchBindings, mountedRoutes, resolvedRoutes, routeSources, sampleRequests };
