/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 12:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | README apps table is GENERATED, never hand-typed: rewrite the block between the apps-table markers in README.md from marketplace.json (itself mirrored from the package manifests). The old hand-typed table listed 7 of 43 packages and carried versions three releases stale.
 * 2026-07-31 13:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | CRLF tolerance: emit the block in the checkout's own line endings. With core.autocrlf=true a Windows working copy holds CRLF and the LF-only block made --check permanently red right after a pull (same class as the dnd build-handshake CRLF bug).
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com  | Pair generation with the catalog-integrity CI gate: the dynamic package count and every rendered row are release-blocking only after marketplace-to-manifest parity passes.
 *
 * Usage: node scripts/gen-readme-apps-table.mjs        (rewrites README.md in place)
 *        node scripts/gen-readme-apps-table.mjs --check (exit 1 if README is stale)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(repo, 'README.md');
const BEGIN = '<!-- apps-table:begin (generated - run `node scripts/gen-readme-apps-table.mjs`; do not edit by hand) -->';
const END = '<!-- apps-table:end -->';

const SUITE_ORDER = ['ai-productivity', 'ai-knowledge', 'ai-finance', 'ai-creative', 'ai-home', 'ai-engineering'];
const SUITE_LABEL = {
  'ai-productivity': 'AI Productivity',
  'ai-knowledge': 'AI Knowledge',
  'ai-finance': 'AI Finance',
  'ai-creative': 'AI Creative',
  'ai-home': 'AI Home & Lifestyle',
  'ai-engineering': 'AI Engineering',
};

/**
 * @description First sentence of a catalog description, pipe-escaped for a Markdown table cell.
 * @param {string} desc The full catalog description.
 * @returns {string} The first sentence (or the whole text when no sentence break exists).
 */
function firstSentence(desc) {
  const flat = desc.split(/\s+/).join(' ');
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : flat).replace(/\|/g, '\\|');
}

const mp = JSON.parse(fs.readFileSync(path.join(repo, 'marketplace.json'), 'utf8'));
const unknown = mp.apps.filter((a) => !SUITE_ORDER.includes(a.suite));
if (unknown.length) {
  console.error(`apps with unknown suite: ${unknown.map((a) => a.name).join(', ')}`);
  process.exit(1);
}

const lines = [BEGIN, '', `All **${mp.apps.length} packages**, shelved by ADR-097 suite. Versions and status come from`, '[`marketplace.json`](marketplace.json), which mirrors each package\'s `oshal-app.yaml`.'];
for (const suite of SUITE_ORDER) {
  const group = mp.apps.filter((a) => a.suite === suite).sort((x, y) => x.name.localeCompare(y.name));
  if (!group.length) continue;
  lines.push('', `### ${SUITE_LABEL[suite]}`, '', '| App | Folder | Version | Status | What it is |', '|---|---|---|---|---|');
  for (const a of group) {
    const folder = a.source.path;
    lines.push(`| **${a.displayName}** | [\`${folder}/\`](${folder}/) | ${a.version} | ${a.status} | ${firstSentence(a.description)} |`);
  }
}
lines.push('', END);

// Honor the checkout's line endings: with core.autocrlf=true a Windows working copy holds
// CRLF, and an LF-only block would make --check permanently red there (the dnd
// build-handshake spec hit this exact class of bug — CRLF-tolerance is load-bearing).
const readme = fs.readFileSync(readmePath, 'utf8');
const eol = readme.includes('\r\n') ? '\r\n' : '\n';
const block = lines.join(eol);
const beginIdx = readme.indexOf(BEGIN);
const endIdx = readme.indexOf(END);
if (beginIdx === -1 || endIdx === -1) {
  console.error('README.md is missing the apps-table markers');
  process.exit(1);
}
const next = readme.slice(0, beginIdx) + block + readme.slice(endIdx + END.length);

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md apps table is stale - run: node scripts/gen-readme-apps-table.mjs');
    process.exit(1);
  }
  console.log('README.md apps table is current');
} else {
  fs.writeFileSync(readmePath, next);
  console.log(`README.md apps table regenerated (${mp.apps.length} apps)`);
}
