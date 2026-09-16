#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard: no tracked text file may carry model attribution. The operator's standing directive is that work identifies the LANE, never a model - not in files, commit messages or PR bodies. The core trunk has carried this guard since the 2026-09-12 history scrub (tests/unit/no-model-attribution.spec.ts + the publish-gate push check); this repo carried neither, so recurrence here was invisible until someone grepped, and it recurred: the tracked COLLABORATE.md accumulated 161 entry lines whose byline names a model, and four source headers name a model in the Change Log AUTHOR column. Matched on the SHAPE of an attribution (a trailer, a tool footer, a Change Log author column, a coordination-log byline), never on the bare identifier - "claude-code" is a harness type in this product, ANTHROPIC_API_KEY is a real env var, CLAUDE.md is a filename, claude-sonnet-4-6 is a model id in persona YAML, and career-hunter's us_cities.tsv carries the real towns of Claude, Texas and Haiku, Hawaii. Gating on the identifier would flag all of those and the guard would be switched off by the first person it annoyed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A text file larger than this is not prose a human wrote; skip rather than read it. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Never text; skipped by extension so the walk does not read images and archives. */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.zip', '.gz', '.tgz', '.woff', '.woff2',
  '.ttf', '.eot', '.pptx', '.docx', '.xlsx', '.mp3', '.mp4', '.wav', '.bin', '.exe', '.dll', '.jar',
  '.ply', '.stl', '.glb', '.onnx', '.wasm',
]);

/** A coordination log: the one file whose entry bylines must name a lane and never a model. */
const COORDINATION_LOG = /(^|\/)COLLABORATE[^/]*\.md$/i;

/**
 * Every rule matches an attribution SHAPE. The vendor's own vocabulary is deliberately not a rule:
 * this product ships a `claude-code` harness type, an ANTHROPIC_API_KEY env var and Anthropic model
 * ids in persona YAML, and all of those are correct content.
 *
 * - trailer:        a `*-by:` trailer whose value names the vendor or the model. The house identity
 *                   `Co-authored-by: oshal maintainers <maintainer@emeraldcoastsystemsgroup.com>`
 *                   names neither and is unaffected.
 * - vendorNoReply:  the vendor no-reply address, in any subdomain spelling.
 * - toolFooter:     the "generated with <model>" tool footer, link or no link.
 * - changeLogAuthor: a Change Log row whose AUTHOR column names a model. Anchored on the row shape
 *                   (comment marker, sequence or date, pipe, author cell, pipe) so an ordinary
 *                   markdown table that happens to mention the vendor in its first cell is not a hit.
 * - logByline:      COORDINATION LOGS ONLY - an entry header (a markdown heading, or a line opening
 *                   with a bracketed timestamp) whose author slot or byline parenthetical names a
 *                   model. Scoped to the log because everywhere else a leading `#` is a shell or
 *                   Python comment and the same shape is ordinary prose.
 */
export const RULES = [
  {
    name: 'trailer',
    scope: 'all',
    pattern: /^[ \t]*[a-z]+(?:[-_ ][a-z]+)*[-_ ]by[ \t]*:[^\n]*\b(?:claude|anthropic)\b/i,
    say: 'a co-author/assisted-by trailer naming a model',
  },
  {
    name: 'vendorNoReply',
    scope: 'all',
    pattern: /no-?reply@(?:[a-z0-9-]+\.)*anthropic\.com/i,
    say: 'the vendor no-reply address',
  },
  {
    name: 'toolFooter',
    scope: 'all',
    pattern: /generated[ \t]+(?:with|by|using|via)[^\n\w]*claude/i,
    say: 'a "generated with" model-tool footer',
  },
  {
    name: 'changeLogAuthor',
    scope: 'all',
    pattern: /^[ \t]*(?:\*|#|\/\/|--|;)?[ \t]*(?:\d{1,4}|\d{4}-\d{2}-\d{2}(?:[ \t]+[\d:]+)?)[ \t]*\|[^|\n]*\b(?:claude|anthropic|opus|sonnet|haiku|fable)\b[^|\n]*\|/i,
    say: 'a Change Log AUTHOR column naming a model (it is always maintainer@emeraldcoastsystemsgroup.com)',
  },
  {
    name: 'logByline',
    scope: 'coordination-log',
    pattern: /^[ \t]*(?:#{1,6}[ \t]+|\[[^\]\n]{0,60}\][ \t]*)(?:(?:@[\w.+-]+|lane[ \t]+[a-z0-9]+|[0-9~][\w:~./+-]*|utc|cdt|cst|edt|est|gmt)[ \t]*[-–—]?[ \t]*)*(?:claude|anthropic)\b/i,
    say: 'a coordination-log entry whose author slot names a model (identify the LANE)',
  },
  {
    name: 'logBylineParenthetical',
    scope: 'coordination-log',
    pattern: /^[ \t]*(?:#{1,6}[ \t]+|\[[^\]\n]{0,60}\][ \t]*)[^\n]*\([^)\n]{0,90}\b(?:claude|anthropic|opus|sonnet|haiku|fable)\b[^)\n]{0,90}\)/i,
    say: 'a coordination-log entry whose byline parenthetical names a model (identify the LANE)',
  },
];

/**
 * @description Enumerate the files to scan: tracked files when git metadata exists, else a full
 * walk that skips dependency and VCS directories (the shape an exported snapshot is checked in).
 * @param root - Directory to enumerate.
 * @returns Root-relative paths with forward slashes.
 */
export function listFiles(root) {
  if (existsSync(join(root, '.git'))) {
    const out = execFileSync('git', ['-C', root, 'ls-files'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean);
  }
  const files = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.venv') continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), relPath);
      else files.push(relPath);
    }
  };
  walk(root, '');
  return files;
}

/**
 * @description Report every attribution-shaped line in one file's text.
 * @param rel - Root-relative path, used to decide whether the coordination-log rules apply.
 * @param text - The file's decoded content.
 * @returns One finding per matching line.
 */
export function findInText(rel, text) {
  const isLog = COORDINATION_LOG.test(rel);
  const findings = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/claude|anthropic|opus|sonnet|haiku|fable/i.test(line)) continue;
    for (const rule of RULES) {
      if (rule.scope === 'coordination-log' && !isLog) continue;
      if (!rule.pattern.test(line)) continue;
      findings.push({ file: rel, line: index + 1, rule: rule.name, say: rule.say, text: line.trim().slice(0, 160) });
      break;
    }
  }
  return findings;
}

/**
 * @description Scan every text file under a root for model attribution.
 * @param root - Checkout or fixture directory.
 * @returns Findings, empty when the tree carries none.
 */
export function findAttribution(root) {
  const findings = [];
  for (const rel of listFiles(root)) {
    if (BINARY_EXT.has(extname(rel).toLowerCase())) continue;
    const abs = join(root, rel);
    const stat = statSync(abs, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.size > MAX_TEXT_BYTES) continue;
    const bytes = readFileSync(abs);
    if (bytes.subarray(0, 8000).includes(0)) continue; // binary without a listed extension
    findings.push(...findInText(rel, bytes.toString('utf8')));
  }
  return findings;
}

/**
 * @description Summarise findings as the lines a human should act on.
 * @param findings - Output of findAttribution.
 * @returns A printable report.
 */
export function formatFindings(findings) {
  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }
  const out = [];
  for (const [file, hits] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`  ${file}: ${hits.length} line(s)`);
    for (const hit of hits.slice(0, 5)) out.push(`      ${hit.line}: [${hit.rule}] ${hit.text}`);
    if (hits.length > 5) out.push(`      … ${hits.length - 5} more`);
  }
  return out.join('\n');
}

/**
 * @description CLI entry point: fail closed when the tree carries model attribution.
 * @param root - Checkout to scan; defaults to the working directory.
 * @returns Nothing; throws when the tree is dirty.
 */
export function main(root = process.cwd()) {
  const findings = findAttribution(resolve(root));
  if (findings.length === 0) {
    console.log('No model attribution in tracked files.');
    return;
  }
  throw new Error(
    `Model attribution in ${new Set(findings.map((f) => f.file)).size} tracked file(s), `
    + `${findings.length} line(s):\n${formatFindings(findings)}\n`
    + '  Work identifies the LANE, never a model (operator directive). Rewrite the byline or the\n'
    + '  Change Log AUTHOR column; never narrow this guard to the file that tripped it.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
