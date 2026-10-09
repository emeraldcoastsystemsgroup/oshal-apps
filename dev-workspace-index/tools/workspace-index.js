/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Deterministic local-checkout documentation index with bounded chunks, explicit exclusions, identifier refusal and generated counts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Make the indexer usable on the real checkout and turn its exclusion list into a guard: include/exclude now come from the devWorkspaceIndex block of oshal-app.yaml (workspace-manifest.js) instead of hardcoded copies; content rules moved to workspace-guard.js (secret families equal to the publish gate, concrete identifier shapes, optional local patterns) after the old prose-matching pattern skipped 128 of 256 files; every emitted chunk is rescanned after the build and any hit exits non-zero; skips are counted per rule; the default output is the package's own data/ file the route reads; a named --notes-dir root (off unless named) and an explicit --include-collaborate lift implement the local-notes option; --verify rescans an existing index file.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('./workspace-guard');
const { readDeclaredManifest } = require('./workspace-manifest');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join('data', 'dev-workspace-index.json');
const COLLABORATE = 'COLLABORATE.md';
const MAX_FILE_BYTES = 1_000_000;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 120;
const TEXT_FILE = /\.(?:md|markdown|txt)$/i;

function parseArgs(argv) {
  const args = { root: process.cwd(), output: null, include: null, notesDir: null, includeCollaborate: false, localPatterns: null, verify: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--root') args.root = argv[++i];
    else if (value === '--output') args.output = argv[++i];
    else if (value === '--include') args.include = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (value === '--notes-dir') args.notesDir = argv[++i];
    else if (value === '--include-collaborate') args.includeCollaborate = true;
    else if (value === '--local-patterns') args.localPatterns = argv[++i];
    else if (value === '--verify') args.verify = argv[++i];
    else if (value === '--help') args.help = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.output) args.output = path.join(PACKAGE_DIR, DEFAULT_OUTPUT);
  return args;
}

/** A path is excluded when any segment is a declared excluded segment or starts with `.env`. */
function excludedSegment(relativePath, exclude, lift = null) {
  if (lift && relativePath === lift) return null;
  const hit = relativePath.split(/[\\/]/).find((segment) => exclude.includes(segment) || segment.startsWith('.env'));
  return hit ? 'excluded path' : null;
}

function walk(root, relative = '') {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => walk(root, path.join(relative, entry.name)));
}

function expandRoots(root, roots) {
  return [...new Set(roots.flatMap((entry) => walk(root, entry).filter((file) => TEXT_FILE.test(file))))]
    .sort((a, b) => a.localeCompare(b));
}

function chunks(text) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const result = [];
  for (let start = 0; start < clean.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    result.push(clean.slice(start, start + CHUNK_SIZE));
    if (start + CHUNK_SIZE >= clean.length) break;
  }
  return result;
}

function titleFor(relativePath, text) {
  const heading = text.split(/\r?\n/).find((line) => /^#\s+/.test(line));
  return heading ? heading.replace(/^#\s+/, '').trim().slice(0, 160) : path.basename(relativePath);
}

function readCandidate(fullPath) {
  try {
    if (fs.statSync(fullPath).size > MAX_FILE_BYTES) return { skip: 'file too large' };
    return { text: fs.readFileSync(fullPath, 'utf8') };
  } catch {
    return { skip: 'unreadable' };
  }
}

function toDocument(source, relativePath, text) {
  const normalizedPath = `${source.prefix}${relativePath.replaceAll(path.sep, '/')}`;
  const digest = crypto.createHash('sha256').update(`${normalizedPath}\0${text}`).digest('hex').slice(0, 16);
  const docId = `dev-workspace:${digest}`;
  const title = titleFor(relativePath, text);
  return {
    doc_id: docId,
    path: normalizedPath,
    title,
    source: source.kind,
    chunks: chunks(text).map((chunk, index) => ({
      chunk_id: `${digest}:${index}`,
      text: chunk,
      metadata: { doc_id: docId, path: normalizedPath, title, source: source.kind },
    })),
  };
}

/** The roots one build walks: the checkout, and the local notes directory only when named. */
function sources({ absoluteRoot, include, notesDir, includeCollaborate, declared }) {
  const roots = include.slice();
  if (includeCollaborate && !roots.includes(COLLABORATE)) roots.push(COLLABORATE);
  const list = [{ kind: 'checkout', root: absoluteRoot, prefix: '', roots, lift: includeCollaborate ? COLLABORATE : null }];
  if (notesDir) {
    const notesRoot = path.resolve(notesDir);
    if (!fs.existsSync(notesRoot) || !fs.statSync(notesRoot).isDirectory()) throw new Error(`--notes-dir is not a directory: ${notesRoot}`);
    list.push({ kind: 'local-notes', root: notesRoot, prefix: `${declared.localNotesPrefix}/`, roots: ['.'], lift: null });
  }
  return list;
}

function indexSource(source, declared, rules, documents, skipped) {
  for (const relativePath of expandRoots(source.root, source.roots)) {
    const reason = excludedSegment(relativePath, declared.exclude, source.lift);
    if (reason) { skipped.push({ path: `${source.prefix}${relativePath.replaceAll(path.sep, '/')}`, reason }); continue; }
    const candidate = readCandidate(path.join(source.root, relativePath));
    const rule = candidate.skip || guard.violatedRule(candidate.text, rules);
    if (rule) { skipped.push({ path: `${source.prefix}${relativePath.replaceAll(path.sep, '/')}`, reason: rule }); continue; }
    documents.push(toDocument(source, relativePath, candidate.text));
  }
}

function countByRule(skipped) {
  return skipped.reduce((acc, entry) => ({ ...acc, [entry.reason]: (acc[entry.reason] || 0) + 1 }), {});
}

/**
 * @description Build the developer workspace index from a local checkout. Every include/exclude
 * decision comes from the manifest declared in oshal-app.yaml; every content decision comes from
 * workspace-guard.js; the finished index is rescanned before it is returned.
 * @param {{root: string, include?: string[]|null, notesDir?: string|null, includeCollaborate?: boolean, localPatterns?: string|null, packageDir?: string}} options Build options.
 * @returns {object} The index with generated counts, per-rule skip counts and the effective manifest.
 */
function buildIndex({ root, include = null, notesDir = null, includeCollaborate = false, localPatterns = null, packageDir = PACKAGE_DIR }) {
  const absoluteRoot = path.resolve(root);
  const declared = readDeclaredManifest(packageDir);
  const effectiveInclude = include && include.length ? include.slice() : declared.include.slice();
  const rules = guard.buildRules({ checkoutRoot: absoluteRoot, localPatternsFile: localPatterns });
  const documents = [];
  const skipped = [];
  for (const source of sources({ absoluteRoot, include: effectiveInclude, notesDir, includeCollaborate, declared })) {
    indexSource(source, declared, rules, documents, skipped);
  }
  const index = {
    version: 2,
    generated_at: new Date().toISOString(),
    root: absoluteRoot,
    collection: declared.collection,
    manifest: {
      collection: declared.collection, include: effectiveInclude, exclude: declared.exclude.slice(),
      local_notes: notesDir ? declared.localNotesPrefix : null, include_collaborate: includeCollaborate,
      max_file_bytes: MAX_FILE_BYTES, chunk_size: CHUNK_SIZE, chunk_overlap: CHUNK_OVERLAP,
      secret_rules: rules.secret.map((rule) => rule.id), identifier_rules: rules.identifier.map((rule) => rule.id),
      local_identifier_rules: rules.local.count,
    },
    counts: { documents: documents.length, chunks: documents.reduce((sum, doc) => sum + doc.chunks.length, 0), skipped: skipped.length, skippedByRule: countByRule(skipped) },
    documents,
    skipped,
  };
  return guard.assertIndexClean(index, rules);
}

/**
 * @description Rescan an already written index file with the current rules.
 * @param {string} file Index JSON path.
 * @param {{root?: string, localPatterns?: string|null}} options Checkout used to locate local patterns.
 * @returns {object} The clean index; throws with `.hits` when guarded content is found.
 */
function verifyIndexFile(file, { root, localPatterns = null } = {}) {
  const index = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const rules = guard.buildRules({ checkoutRoot: root ? path.resolve(root) : index.root, localPatternsFile: localPatterns });
  return guard.assertIndexClean(index, rules);
}

function writeIndex(index, output) {
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return target;
}

function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node tools/workspace-index.js --root <checkout> [--output <json>] [--include a,b] [--notes-dir <dir>] [--include-collaborate] [--local-patterns <file>]');
    console.log('       node tools/workspace-index.js --verify <index.json> [--root <checkout>]');
    return 0;
  }
  if (args.verify) {
    const index = verifyIndexFile(args.verify, { root: args.root, localPatterns: args.localPatterns });
    console.log(JSON.stringify({ verified: path.resolve(args.verify), ...index.counts }, null, 2));
    return 0;
  }
  const index = buildIndex(args);
  const output = writeIndex(index, args.output);
  console.log(JSON.stringify({ output, ...index.counts, local_identifier_rules: index.manifest.local_identifier_rules }, null, 2));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error && error.code === 'DEV_WORKSPACE_GUARD') console.error(JSON.stringify({ error: error.code, hits: error.hits }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = { CHUNK_OVERLAP, CHUNK_SIZE, DEFAULT_OUTPUT, MAX_FILE_BYTES, PACKAGE_DIR, buildIndex, chunks, excludedSegment, parseArgs, runCli, verifyIndexFile, writeIndex };
