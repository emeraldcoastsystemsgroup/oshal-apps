#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the store-wide fail-closed encryption-key guard: scan every installable package's runtime files for the retired public key and any direct SESSION_SECRET string fallback.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Close syntax bypasses by rejecting dot or bracket SESSION_SECRET nullish/OR coalescing regardless of whether the fallback is empty, indirect, or computed.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_EXTENSIONS = new Set([
  '.cjs', '.html', '.js', '.json', '.jsx', '.mjs', '.py', '.sh', '.sql', '.ts', '.tsx', '.yaml', '.yml',
]);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '__pycache__']);
const RETIRED_PUBLIC_KEY = ['oshal', 'dev', 'secret'].join('-');
const SESSION_SECRET_COALESCING = /process\s*\.\s*env(?:\s*\.\s*SESSION_SECRET|\s*\[\s*(['"`])SESSION_SECRET\1\s*\])\s*(?:\|\||\?\?)/g;

/** Return the one-based line containing a byte offset. */
function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

/** Yield runtime-text files below one package without following dependency/cache directories. */
function* runtimeFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* runtimeFiles(full);
    else if (entry.isFile() && RUNTIME_EXTENSIONS.has(extname(entry.name).toLowerCase())) yield full;
  }
}

/**
 * @description Scan every top-level installable package for public at-rest key fallbacks. A package
 * is discovered by its `oshal-app.yaml`, matching the store installer rather than a hand-maintained
 * allow-list, so newly added packages enter the security boundary automatically.
 * @param {string} rootInput Store repository root.
 * @returns {Array<{file: string, line: number, kind: string}>} Every forbidden fallback location.
 */
export function findPublicSecretFallbacks(rootInput) {
  const root = resolve(rootInput);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`not a directory: ${root}`);
  const packageDirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => join(root, entry.name));
  if (!packageDirs.length) throw new Error(`no installable packages found under ${root}`);

  const findings = [];
  for (const packageDir of packageDirs) {
    for (const file of runtimeFiles(packageDir)) {
      const text = readFileSync(file, 'utf8');
      const seen = new Set();
      let offset = text.indexOf(RETIRED_PUBLIC_KEY);
      while (offset >= 0) {
        findings.push({ file: relative(root, file), line: lineAt(text, offset), kind: 'retired-public-key' });
        seen.add(offset);
        offset = text.indexOf(RETIRED_PUBLIC_KEY, offset + 1);
      }
      SESSION_SECRET_COALESCING.lastIndex = 0;
      for (const match of text.matchAll(SESSION_SECRET_COALESCING)) {
        const matchOffset = match.index ?? 0;
        if (!seen.has(matchOffset)) {
          findings.push({ file: relative(root, file), line: lineAt(text, matchOffset), kind: 'session-secret-coalescing' });
        }
      }
    }
  }
  return findings;
}

/** Execute the repository gate and return its process exit code. */
function main() {
  const root = resolve(process.argv[2] || process.cwd());
  let findings;
  try {
    findings = findPublicSecretFallbacks(root);
  } catch (err) {
    console.error(`app secret fallback guard could not scan: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (findings.length) {
    console.error(`Public SESSION_SECRET fallback guard FAILED — ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`  ${finding.file}:${finding.line} [${finding.kind}]`);
    return 1;
  }
  console.log('Public SESSION_SECRET fallback guard clean across every installable package.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
