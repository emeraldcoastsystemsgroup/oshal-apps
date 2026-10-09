/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Enumerate every literal route Venture Plan registers (router.get/post/put/delete/patch in src-routes/*.ts, mapped to the manifest mounts that serve it through each mount module's import closure), read authorization.yaml's http, jobs and bots bindings and the manifest's bots and schedules without a YAML library, and mirror the kernel's two-step HTTP binding match: the longest-mount-relative path (core application-authorization-runtime.ts guard) and resolveOperationPermissions' segment grammar (core policy.ts: same segment count, a literal equals, a :param takes any non-empty segment but "." and "..", and only exactly one matching binding binds). Shared by the bare guard (tests/venture-catalog-bindings.test.js) and the kernel suite (tests/venture-catalog-kernel.core.spec.mjs), which runs the REAL matcher over the same enumeration and requires this mirror to agree.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The package root (tests/helpers/ is two levels down). */
const PKG = path.resolve(__dirname, '..', '..');
/** One Express route registration with a string-literal path; whitespace may follow the paren. */
const ROUTE_CALL = /\brouter\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]*)\2/g;
/** A sibling module import or require, in any line layout. */
const RELATIVE_IMPORT = /(?:from\s*|require\()\s*(['"])(\.\/[^'"]+)\1/g;

/**
 * @description Every literal route registered in one src-routes source.
 * @param {string} file - Absolute path of a src-routes/*.ts file.
 * @returns {Array<{file: string, method: string, pattern: string}>} Uppercased method and the Express pattern.
 */
function literalRoutesIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const routes = [];
  for (const match of text.matchAll(ROUTE_CALL)) {
    routes.push({ file: path.relative(PKG, file).replace(/\\/g, '/'), method: match[1].toUpperCase(), pattern: match[3] });
  }
  return routes;
}

/** @description Absolute paths of every src-routes/*.ts source, sorted. @returns {string[]} The sources. */
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
      const target = path.resolve(path.dirname(file), match[2].replace(/\.js$/, '') + '.ts');
      if (!seen.has(target)) stack.push(target);
    }
  }
  return [...seen].sort();
}

/**
 * @description One top-level block of a YAML document, cut at the next column-0 key.
 * @param {string} text - The document. @param {string} key - The top-level key.
 * @returns {string} The block body (empty when the key is absent).
 */
function topLevelBlock(text, key) {
  const start = text.search(new RegExp(`^${key}:\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = text.slice(start + key.length + 1);
  const end = rest.search(/^[a-zA-Z]/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** @description The manifest text. @returns {string} oshal-app.yaml. */
function manifestText() {
  return fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
}

/**
 * @description The manifest's route entries (module and mountPath per entry), in manifest order.
 * @returns {Array<{module: string, mountPath: string}>} The mounts.
 */
function manifestMounts() {
  const block = topLevelBlock(manifestText(), 'routes');
  if (!block) throw new Error('oshal-app.yaml has no routes: list');
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
 * @description The manifest's bot agent ids, in manifest order.
 * @returns {string[]} The agentIds of the `bots:` block.
 */
function manifestAgentIds() {
  const block = topLevelBlock(manifestText(), 'bots');
  return [...block.matchAll(/^\s*-\s*agentId:\s*(\S+)/gm)].map((match) => match[1]);
}

/**
 * @description The manifest's service-route schedules: local id, runsAs and the flow-list requires.
 * @returns {Array<{id: string, runsAs: string|null, requires: string[]|null}>} In manifest order.
 */
function manifestSchedules() {
  const block = topLevelBlock(manifestText(), 'schedules');
  const schedules = [];
  for (const line of block.split(/\r?\n/)) {
    const id = /^\s*-\s*id:\s*(\S+)/.exec(line);
    if (id) { schedules.push({ id: id[1], runsAs: null, requires: null }); continue; }
    const current = schedules[schedules.length - 1];
    const runsAs = /^\s+runsAs:\s*(\S+)/.exec(line);
    const requires = /^\s+requires:\s*\[([^\]]*)\]/.exec(line);
    if (current && runsAs) current.runsAs = runsAs[1];
    if (current && requires) current.requires = requires[1].split(',').map((item) => item.trim()).filter(Boolean);
  }
  return schedules;
}

/** @description The package name from the manifest. @returns {string} The `name:` scalar. */
function manifestName() {
  const match = /^name:\s*(\S+)/m.exec(manifestText());
  if (!match) throw new Error('oshal-app.yaml has no name');
  return match[1];
}

/**
 * @description Every literal route under every mount that serves it.
 * @returns {Array<{mount: string, module: string, file: string, method: string, pattern: string}>} The served routes.
 */
function mountedRoutes() {
  const out = [];
  for (const { module, mountPath } of manifestMounts()) {
    const entry = path.join(PKG, 'src-routes', path.basename(module, '.js') + '.ts');
    if (!fs.existsSync(entry)) throw new Error(`manifest module ${module} has no src-routes source at ${entry}`);
    for (const file of importClosure(entry)) for (const route of literalRoutesIn(file)) out.push({ mount: mountPath, module, ...route });
  }
  return out;
}

/**
 * @description A request path that exercises one Express pattern: each :param becomes a plain segment.
 * @param {string} pattern - The Express route pattern. @returns {string} A mount-relative request path.
 */
function sampleRequest(pattern) {
  return pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (_m, offset) => `p${offset}`);
}

/** @description The authorization catalog text. @returns {string} authorization.yaml. */
function catalogText() {
  return fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8');
}

/**
 * @description One `bindings.<kind>` list of authorization.yaml, read from its flow entries without a
 * YAML library; refuses an entry it cannot read rather than skipping it.
 * @param {'http'|'jobs'|'bots'} kind - The binding kind.
 * @returns {Array<{id: string, method?: string, path?: string, allOf: string[]}>} The bindings.
 */
function catalogBindings(kind) {
  const text = catalogText();
  const start = text.search(new RegExp(`^  ${kind}:\\s*$`, 'm'));
  if (start < 0) throw new Error(`authorization.yaml has no bindings.${kind} section`);
  const rest = text.slice(start + kind.length + 3);
  const end = rest.search(/^ {0,2}[a-zA-Z]/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  const shape = kind === 'http'
    ? /^\s*-\s*\{\s*id:\s*([^,\s]+),\s*method:\s*([A-Z]+),\s*path:\s*([^,\s]+),\s*allOf:\s*\[([^\]]*)\]\s*\}\s*$/
    : /^\s*-\s*\{\s*id:\s*([^,\s]+),\s*allOf:\s*\[([^\]]*)\]\s*\}\s*$/;
  const bindings = [];
  for (const line of block.split(/\r?\n/)) {
    if (!/^\s*-/.test(line)) continue;
    const entry = shape.exec(line);
    if (!entry) throw new Error(`unreadable ${kind} binding line (only flow entries are read): ${line.trim()}`);
    const allOf = entry[kind === 'http' ? 4 : 2].split(',').map((item) => item.trim()).filter(Boolean);
    bindings.push(kind === 'http' ? { id: entry[1], method: entry[2], path: entry[3], allOf } : { id: entry[1], allOf });
  }
  if (!bindings.length) throw new Error(`authorization.yaml bindings.${kind} is empty`);
  return bindings;
}

/**
 * @description The catalog's permissions with their effects, and each role's granted permission names.
 * @returns {{permissions: Record<string, {resource: string, effect: string, minimumTier: string}>, roles: Record<string, string[]>}} The vocabulary.
 */
function catalogVocabulary() {
  const text = catalogText();
  const permissions = {};
  for (const match of topLevelBlock(text, 'permissions').matchAll(/^ {2}([A-Za-z][A-Za-z0-9_.-]*):\s*\{\s*resource:\s*(\S+),\s*effect:\s*(\S+),\s*minimumTier:\s*(\S+)\s*\}/gm)) {
    permissions[match[1]] = { resource: match[2], effect: match[3], minimumTier: match[4] };
  }
  const roles = {};
  let current = null;
  for (const line of topLevelBlock(text, 'roles').split(/\r?\n/)) {
    const role = /^ {2}([A-Za-z][A-Za-z0-9_.-]*):\s*$/.exec(line);
    if (role) { current = role[1]; roles[current] = []; continue; }
    const grant = /^\s*-\s*\{\s*permission:\s*([^,\s]+),/.exec(line);
    if (current && grant) roles[current].push(grant[1]);
  }
  return { permissions, roles };
}

/**
 * @description The path the kernel authorizes: the request path relative to the longest mount
 * that prefixes it (application-authorization-runtime.ts), or the whole path when none does.
 * @param {string} requestPath - The controller-level request path, no query string.
 * @param {string[]} mountPaths - The package's registered mounts.
 * @returns {string} The relative path.
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
 * @param {Array<object>} [bindings] - Catalog http bindings; defaults to authorization.yaml's.
 * @returns {Array<object>} Each route with request, relative path and matching bindings.
 */
function resolvedRoutes(mountPaths, bindings) {
  const mounts = mountPaths ?? manifestMounts().map((entry) => entry.mountPath);
  const http = bindings ?? catalogBindings('http');
  return mountedRoutes().map((route) => {
    const sample = sampleRequest(route.pattern);
    const request = sample === '/' ? route.mount : `${route.mount}${sample}`;
    const relative = kernelRelativePath(request, mounts);
    return { ...route, request, relative, matches: matchBindings(http, mounts, route.method, relative) };
  });
}

module.exports = { PKG, catalogBindings, catalogVocabulary, importClosure, kernelRelativePath, literalRoutesIn,
  manifestAgentIds, manifestMounts, manifestName, manifestSchedules, matchBindings, mountedRoutes, resolvedRoutes,
  routeSources, sampleRequest };
