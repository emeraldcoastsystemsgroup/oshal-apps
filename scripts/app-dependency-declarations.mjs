/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-17 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Find the cross-package edges a store package actually has, so a package that reaches another package has to say so. Nothing enforced declaring before this: marketplace.json's dependency block is GENERATED from the manifest, so a package that declares nothing produces a mirror that says nothing and `gen-catalog-dependencies.mjs --check` reports "current". A catalog check can therefore never stand in for this, which is why it is a detector plus a test rather than another --check flag. It keys on each package's DECLARED mountPath prefixes, not on its name: intelligent-trades mounts at /api/trading and sat-ops at /api/sat, and a name-keyed sweep misses both.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Directories that never hold a package's shipped code. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'output', '.next', 'coverage', 'venv', '__pycache__']);

/**
 * File types that can MAKE a cross-package call. A `.md` note or a `.json` data record can name
 * another package's mount in prose without ever calling it (venture-plan's ventures/*.json
 * describes a prop's control door), so naming is not evidence outside these types.
 */
const CALLABLE = /[.](ts|tsx|js|jsx|cjs|mjs|html)$/;

/** A line that only talks about a path. Trimmed first, so an indented YAML comment counts. */
const COMMENT = /^(#|\*|\/\/|\/\*|<!--)/;

/** @description Normalize a path to forward slashes so evidence reads the same on every platform. */
export function norm(p) { return p.split(path.sep).join('/'); }

/**
 * @description Every catalog package, with the directory it lives in.
 * @param {string} root Store checkout root.
 * @returns {{ names: string[], dirByName: Map<string,string>, nameByDir: Map<string,string> }}
 */
export function packages(root) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'marketplace.json'), 'utf8'));
  return {
    names: catalog.apps.map((a) => a.name),
    dirByName: new Map(catalog.apps.map((a) => [a.name, a.source.path])),
    nameByDir: new Map(catalog.apps.map((a) => [a.source.path, a.name])),
  };
}

/**
 * @description The `/api/<segment>` prefix each package OWNS, read from its manifest's mountPath
 * declarations rather than assumed from its name. A prefix two packages claim is ambiguous and is
 * dropped: an ambiguous prefix would attribute a call to whichever package sorted first.
 * @param {string} root Store checkout root.
 * @returns {{ prefixes: Array<[string,string]>, ambiguous: Array<[string,string[]]> }}
 */
export function mountPrefixes(root) {
  const { names, dirByName } = packages(root);
  const owners = new Map();
  for (const name of names) {
    const manifest = path.join(root, dirByName.get(name), 'oshal-app.yaml');
    if (!fs.existsSync(manifest)) continue;
    const text = fs.readFileSync(manifest, 'utf8');
    const claimed = new Set(['/api/' + name]);
    for (const m of text.matchAll(/^\s*mountPath:\s*(\S+)/gm)) {
      const seg = m[1].replace(/['"]/g, '').split('/').filter(Boolean);
      if (seg[0] === 'api' && seg[1]) claimed.add('/api/' + seg[1]);
    }
    for (const prefix of claimed) {
      if (!owners.has(prefix)) owners.set(prefix, new Set());
      owners.get(prefix).add(name);
    }
  }
  return {
    prefixes: [...owners].filter(([, o]) => o.size === 1).map(([p, o]) => [p, [...o][0]]),
    ambiguous: [...owners].filter(([, o]) => o.size > 1).map(([p, o]) => [p, [...o]]),
  };
}

/** @description Every file under a directory whose extension can hold a call. */
function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, out); }
    else if (CALLABLE.test(e.name)) out.push(full);
  }
  return out;
}

/** @description 1-based line number of a byte offset, and that line's trimmed text. */
function at(text, index) {
  const before = text.slice(0, index).split('\n');
  return { line: before.length, text: (text.split('\n')[before.length - 1] || '').trim() };
}

/**
 * Every way a module specifier is written. The bare side-effect form (`import './x';`) is here
 * because leaving it out was a real hole: a mutation that added one to a package went undetected.
 */
const SPECIFIER = /(?:\bfrom|\brequire\(|\bimport\(|^\s*import)\s*['"]([^'"]+)['"]/gm;

/** @description The edges one file's imports prove: a relative path that leaves the package. */
function importEdges(pkg, pkgRoot, file, rel, text, nameByDir, root, found) {
  for (const m of [...text.matchAll(SPECIFIER)].filter((x) => x[1].startsWith('.'))) {
    const resolved = path.resolve(path.dirname(file), m[1]);
    if (!path.relative(pkgRoot, resolved).startsWith('..')) continue;
    const other = nameByDir.get(norm(path.relative(root, resolved)).split('/')[0]);
    if (!other || other === pkg) continue;
    found.push({ pkg, other, shape: 'relative-import', file: rel, ...at(text, m.index), evidence: m[1] });
  }
}

/** @description The edges one file's bare specifiers prove: `require('<sibling>/...')`. */
function bareEdges(pkg, rel, text, names, found) {
  for (const m of [...text.matchAll(SPECIFIER)].filter((x) => /^[A-Za-z@]/.test(x[1]))) {
    const head = m[1].split('/')[0];
    if (!names.includes(head) || head === pkg) continue;
    found.push({ pkg, other: head, shape: 'bare-sibling-import', file: rel, ...at(text, m.index), evidence: m[1] });
  }
}

/** @description The edges one file's `/api/<other>` references prove. */
function mountEdges(pkg, rel, text, prefixes, isManifest, found) {
  for (const m of text.matchAll(/\/api\/[A-Za-z0-9_-]+/g)) {
    const hit = prefixes.find(([prefix]) => m[0] === prefix);
    if (!hit || hit[1] === pkg) continue;
    const where = at(text, m.index);
    if (COMMENT.test(where.text)) continue;
    if (isManifest && !/iframeUrl\s*:/.test(where.text)) continue;
    found.push({ pkg, other: hit[1], shape: isManifest ? 'manifest-iframe' : 'mount-reference', file: rel, ...where, evidence: m[0] });
  }
}

/**
 * @description Every cross-package edge the store's code proves, by the four mechanically
 * detectable shapes: a relative import that leaves the package, a bare import of a sibling
 * package, a reference to another package's mount from a file that can call it, and an
 * `iframeUrl:` in a manifest pointing at another package's mount. An `integrations.offers` target
 * is NOT here and never should be - the framework resolves an offer whose target is inactive to
 * state:'unavailable', so it degrades rather than breaks.
 * @param {string} root Store checkout root.
 * @returns {Array<{pkg:string,other:string,shape:string,file:string,line:number,text:string,evidence:string}>}
 */
export function findEdges(root) {
  const { names, dirByName, nameByDir } = packages(root);
  const { prefixes } = mountPrefixes(root);
  prefixes.sort((a, b) => b[0].length - a[0].length);
  const found = [];
  for (const pkg of names) {
    const pkgRoot = path.join(root, dirByName.get(pkg));
    if (!fs.existsSync(pkgRoot)) continue;
    const files = walk(pkgRoot);
    const manifest = path.join(pkgRoot, 'oshal-app.yaml');
    if (fs.existsSync(manifest)) files.push(manifest);
    for (const file of files) {
      const rel = norm(path.relative(pkgRoot, file));
      // A test drives a boundary with a fixture; it is not the shipped call.
      if (/^tests?\//.test(rel)) continue;
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const isManifest = rel === 'oshal-app.yaml';
      if (!isManifest) {
        importEdges(pkg, pkgRoot, file, rel, text, nameByDir, root, found);
        bareEdges(pkg, rel, text, names, found);
      }
      mountEdges(pkg, rel, text, prefixes, isManifest, found);
    }
  }
  return found;
}

/**
 * @description The edges a package has but does not declare in either dependency tier.
 * @param {string} root Store checkout root.
 * @param {(text:string,label:string)=>{dependencies:object|null,problems:string[]}} read The
 *  store's own manifest reader - the one marketplace.json is generated with, never a second parse.
 * @returns {Array<{pkg:string,other:string,proofs:object[]}>} One row per undeclared edge.
 */
export function undeclaredEdges(root, read) {
  const { dirByName } = packages(root);
  const byPair = new Map();
  for (const edge of findEdges(root)) {
    const key = edge.pkg + ' ' + edge.other;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(edge);
  }
  const missing = [];
  for (const [key, proofs] of byPair) {
    const [pkg, other] = key.split(' ');
    const manifest = path.join(root, dirByName.get(pkg), 'oshal-app.yaml');
    const { dependencies } = read(fs.readFileSync(manifest, 'utf8'), pkg + '/oshal-app.yaml');
    const declared = [
      ...(dependencies?.required?.apps ?? []), ...(dependencies?.optional?.apps ?? []), ...(dependencies?.apps ?? []),
    ];
    if (!declared.includes(other)) missing.push({ pkg, other, proofs });
  }
  return missing.sort((a, b) => (a.pkg + a.other).localeCompare(b.pkg + b.other));
}

/** @description One human-readable line per proof, for a failure message that can be acted on. */
export function describe(rows) {
  return rows.map(({ pkg, other, proofs }) => `${pkg} -> ${other}\n`
    + proofs.slice(0, 4).map((p) => `      ${p.shape}  ${pkg}/${p.file}:${p.line}  ${p.evidence}`).join('\n')).join('\n  ');
}
