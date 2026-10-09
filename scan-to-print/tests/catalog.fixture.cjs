/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.7.0 (the scene-studio 0.2.0 guard, adapted): read the package's ADR-149 catalog (authorization.yaml), its manifest mounts, tools, bots and accepted artifacts, and every literal route each mount's factory registers, without a YAML library (the catalog is flow one-liners by design), and mirror the kernel's HTTP binding match: the request path relative to the longest mount that owns it (core application-authorization-runtime.ts guard) and the segment rule of resolveOperationPermissions (same segment count; a literal equals; a :param takes any non-empty segment but "." and ".."; exactly one match binds). Two mounts share one module here (the person's routes and the print service), so each mount takes the sources of ITS factory: the print service router is service-routes.ts alone, and the person's router is everything the module reaches except it. Unreadable lines are refused, never skipped.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_CALL = /\brouter\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]*)\2/g;
const RELATIVE_IMPORT = /(?:from\s*|require\()\s*(['"])(\.\/[^'"]+|\.\.\/[^'"]+)\1/g;
const SERVICE_ROUTER = path.join(PKG, 'src-routes', 'service-routes.ts');

/** @description A YAML block's lines (from `key:` at `indent` to the next line at that indent or less). @returns {string[]} */
function block(text, key, indent = 0) {
  const lines = text.split(/\r?\n/);
  const pad = ' '.repeat(indent);
  const start = lines.findIndex((line) => line === `${pad}${key}:`);
  if (start < 0) throw new Error(`no ${key}: block at indent ${indent}`);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(`${pad} `) && !line.trim().startsWith('#')) break;
    out.push(line);
  }
  return out;
}

/** @description The flow-list entries under one block, each line read by `re`; an unreadable entry is refused. @returns {RegExpExecArray[]} */
function entries(lines, re, what) {
  return lines.filter((line) => /^\s*-\s/.test(line)).map((line) => {
    const match = re.exec(line);
    if (!match) throw new Error(`unreadable ${what} line: ${line.trim()}`);
    return match;
  });
}

const list = (text) => text.split(',').map((item) => item.trim()).filter(Boolean);

/**
 * @description The catalog: permissions, the maker role's grants, and the http, tools, bots and artifactActions bindings.
 * @returns {{ permissions: object, grants: Array<{permission: string, scope: string}>, http: object[], tools: object[], bots: object[], artifactActions: object[] }}
 */
function readCatalog() {
  const text = fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8');
  const permissions = {};
  for (const line of block(text, 'permissions').filter((l) => l.trim() && !l.trim().startsWith('#'))) {
    const m = /^ {2}([a-z][a-z.]*): \{ resource: (\w+), effect: (\w+), minimumTier: (\w+) \}$/.exec(line);
    if (!m) throw new Error(`unreadable permission line: ${line.trim()}`);
    permissions[m[1]] = { resource: m[2], effect: m[3], minimumTier: m[4] };
  }
  const grants = entries(block(text, 'grants', 4), /^ {6}- \{ permission: ([a-z.]+), scope: (\w+) \}$/, 'grant').map((m) => ({ permission: m[1], scope: m[2] }));
  const bindings = block(text, 'bindings');
  const sub = (key) => block(bindings.join('\n'), key, 2);
  const http = entries(sub('http'), /^ {4}- \{ id: ([a-z0-9-]+), method: ([A-Z]+), path: (\/\S*), allOf: \[([^\]]*)\] \}$/, 'http binding')
    .map((m) => ({ id: m[1], method: m[2], path: m[3], allOf: list(m[4]) }));
  const named = (key) => entries(sub(key), /^ {4}- \{ id: ([a-z0-9-]+), allOf: \[([^\]]*)\] \}$/, `${key} binding`).map((m) => ({ id: m[1], allOf: list(m[2]) }));
  return { permissions, grants, http, tools: named('tools'), bots: named('bots'), artifactActions: named('artifactActions') };
}

/** @description The manifest's mounts (module, factory, path), tool names, bot agent ids and accepted artifact ids. @returns {{ mounts: object[], tools: string[], bots: string[], accepts: string[] }} */
function readManifest() {
  const text = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const mounts = [];
  for (const line of block(text, 'routes')) {
    const module = /^ {2}- module: (\S+)$/.exec(line);
    const factory = /^ {4}factory: (\S+)$/.exec(line);
    const mount = /^ {4}mountPath: (\S+)$/.exec(line);
    if (module) mounts.push({ module: module[1], factory: null, mountPath: null });
    if (factory) mounts[mounts.length - 1].factory = factory[1];
    if (mount) mounts[mounts.length - 1].mountPath = mount[1];
  }
  const tools = block(text, 'tools').map((line) => /^ {2}- name: ([a-z0-9-]+)$/.exec(line)?.[1]).filter(Boolean);
  const bots = block(text, 'bots').map((line) => /^ {2}- agentId: ([0-9a-f-]+)$/.exec(line)?.[1]).filter(Boolean);
  const accepts = block(block(text, 'artifacts').join('\n'), 'accepts', 2).map((line) => /^ {4}- id: ([a-z0-9-]+)$/.exec(line)?.[1]).filter(Boolean);
  return { mounts, tools, bots, accepts };
}

/** @description The src-routes sources one module reaches through relative imports, itself included. @param {string} entry @returns {string[]} */
function importClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) stack.push(path.resolve(path.dirname(file), `${m[2].replace(/\.js$/, '')}.ts`));
  }
  return [...seen].sort();
}

/** @description The sources whose routes one mount serves: the print service router alone, or the module's closure without it. @returns {string[]} */
function mountSources({ module, factory }) {
  if (factory === 'createScanToPrintServiceRoutes') return [SERVICE_ROUTER];
  const entry = path.join(PKG, 'src-routes', `${path.basename(module, '.js')}.ts`);
  if (!fs.existsSync(entry)) throw new Error(`manifest module ${module} has no source`);
  return importClosure(entry).filter((file) => file !== SERVICE_ROUTER);
}

/** @description The surface scripts the person's router serves under /assets (SURFACE_SCRIPTS in scan-to-print-routes.ts). @returns {string[]} */
function surfaceScripts() {
  const source = fs.readFileSync(path.join(PKG, 'src-routes', 'scan-to-print-routes.ts'), 'utf8');
  const m = /const SURFACE_SCRIPTS = \[([^\]]*)\]/.exec(source);
  if (!m || !/assets\.get\(`\/\$\{file\}`/.test(source) || !/router\.use\('\/assets', assets\)/.test(source)) throw new Error('the /assets surface scripts are no longer read the way this guard expects');
  return list(m[1]).map((item) => item.replace(/^'|'$/g, ''));
}

/**
 * @description Every literal route under every manifest mount that serves it, with a sample request (:param -> a plain segment).
 * @returns {Array<{ mount: string, file: string, method: string, pattern: string, request: string }>}
 */
function mountedRoutes() {
  const out = [];
  for (const mount of readManifest().mounts) {
    for (const file of mountSources(mount)) {
      const rel = path.relative(PKG, file);
      for (const m of fs.readFileSync(file, 'utf8').matchAll(ROUTE_CALL)) out.push({ mount: mount.mountPath, file: rel, method: m[1].toUpperCase(), pattern: m[3] });
      if (path.basename(file) === 'scan-to-print-routes.ts' && mount.factory === 'createScanToPrintRoutes') {
        for (const script of surfaceScripts()) out.push({ mount: mount.mountPath, file: rel, method: 'GET', pattern: `/assets/${script}` });
      }
    }
  }
  return out.map((row) => {
    const sample = row.pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (_m, offset) => `p${offset}`);
    return { ...row, request: sample === '/' ? row.mount : `${row.mount}${sample}` };
  });
}

/** @description The path the kernel authorizes: relative to the longest mount that owns the request. @param {string} request @param {string[]} mounts @returns {string} */
function relativeToMount(request, mounts) {
  const mount = [...mounts].sort((a, b) => b.length - a.length).find((prefix) => request === prefix || request.startsWith(`${prefix}/`));
  return mount ? request.slice(mount.length) || '/' : request;
}

/** @description The bindings the kernel's segment rule matches for one method and relative path. @returns {object[]} */
function matchBindings(http, method, relative) {
  const actual = relative.split('/');
  return http.filter((binding) => binding.method === method && binding.path.split('/').length === actual.length
    && binding.path.split('/').every((part, i) => part === actual[i] || (part.startsWith(':') && Boolean(actual[i]) && actual[i] !== '.' && actual[i] !== '..')));
}

module.exports = { PKG, readCatalog, readManifest, mountedRoutes, relativeToMount, matchBindings, importClosure };
