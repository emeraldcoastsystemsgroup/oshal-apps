/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read the package-owned `devWorkspaceIndex:` block of oshal-app.yaml with a strict two-space subset reader (no YAML runtime, same posture as the store's catalog gates) so the indexer's include/exclude manifest is the one the manifest declares, never a hardcoded copy.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BLOCK_KEY = 'devWorkspaceIndex';
const SCALAR_KEYS = Object.freeze(['collection', 'localNotesPrefix', 'devModeTtlMinutes']);
const LIST_KEYS = Object.freeze(['include', 'exclude']);
const KNOWN_KEYS = Object.freeze([...SCALAR_KEYS, ...LIST_KEYS]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RELATIVE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,255}$/;

function fail(manifestPath, message) {
  throw new Error(`${manifestPath}: ${BLOCK_KEY} ${message}`);
}

/** Strip a trailing ` # comment` and surrounding quotes from a one-line scalar. */
function scalar(raw, manifestPath) {
  const value = raw.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!value || /^[[{&*!|>%@`]/.test(value)) fail(manifestPath, 'uses an unsupported scalar form');
  return value;
}

/** Collect the two-space-indented lines that belong to the block. */
function blockLines(lines, manifestPath) {
  const start = lines.findIndex((line) => new RegExp(`^${BLOCK_KEY}:[ \\t]*(?:#.*)?$`).test(line));
  if (start === -1) fail(manifestPath, 'block is missing');
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    if (/\t/.test(line)) fail(manifestPath, 'block must not contain tabs');
    body.push(line);
  }
  if (!body.length) fail(manifestPath, 'block is empty');
  return body;
}

function parseList(body, cursor, key, manifestPath) {
  const items = [];
  let index = cursor;
  while (index < body.length && /^    - /.test(body[index])) {
    items.push(scalar(body[index].slice(6), manifestPath));
    index += 1;
  }
  if (!items.length) fail(manifestPath, `${key} must list at least one entry`);
  if (new Set(items).size !== items.length) fail(manifestPath, `${key} contains duplicates`);
  return { items, next: index };
}

function parseBlock(body, manifestPath) {
  const declared = {};
  let index = 0;
  while (index < body.length) {
    const match = /^  ([A-Za-z][A-Za-z0-9]*):[ \t]*(.*)$/.exec(body[index]);
    if (!match) fail(manifestPath, `has an unsupported line: ${body[index].trim()}`);
    const [, key, rest] = match;
    if (!KNOWN_KEYS.includes(key)) fail(manifestPath, `has an unknown key: ${key}`);
    if (Object.hasOwn(declared, key)) fail(manifestPath, `repeats ${key}`);
    if (LIST_KEYS.includes(key)) {
      if (rest.replace(/\s+#.*$/, '').trim()) fail(manifestPath, `${key} must be a block list`);
      const list = parseList(body, index + 1, key, manifestPath);
      declared[key] = list.items;
      index = list.next;
      continue;
    }
    declared[key] = scalar(rest, manifestPath);
    index += 1;
  }
  return declared;
}

function validate(declared, manifestPath) {
  for (const key of KNOWN_KEYS) if (!Object.hasOwn(declared, key)) fail(manifestPath, `is missing ${key}`);
  if (!NAME.test(declared.collection)) fail(manifestPath, 'collection must be a stable name');
  if (!NAME.test(declared.localNotesPrefix)) fail(manifestPath, 'localNotesPrefix must be a stable name');
  const ttl = Number(declared.devModeTtlMinutes);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 24 * 60) fail(manifestPath, 'devModeTtlMinutes must be an integer between 1 and 1440');
  for (const entry of declared.include) {
    if (!RELATIVE_PATH.test(entry) || entry.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      fail(manifestPath, `include entry is not a canonical relative path: ${entry}`);
    }
  }
  for (const entry of declared.exclude) {
    if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,127}$/.test(entry) || entry.includes('/')) fail(manifestPath, `exclude entry must be a single path segment: ${entry}`);
  }
  return {
    collection: declared.collection,
    include: declared.include.slice(),
    exclude: declared.exclude.slice(),
    localNotesPrefix: declared.localNotesPrefix,
    devModeTtlMinutes: ttl,
  };
}

/**
 * @description Read and validate the package-owned index manifest declared in oshal-app.yaml.
 * The reader accepts exactly the block shape this package ships (scalars and block lists,
 * two-space indentation) and fails closed on anything else, so a drifted declaration can never
 * silently widen or shrink what the indexer walks.
 * @param {string} packageDir Directory holding oshal-app.yaml.
 * @returns {{collection: string, include: string[], exclude: string[], localNotesPrefix: string, devModeTtlMinutes: number}} The declared manifest.
 */
function readDeclaredManifest(packageDir = path.resolve(__dirname, '..')) {
  const manifestPath = path.join(packageDir, 'oshal-app.yaml');
  const text = fs.readFileSync(manifestPath, 'utf8');
  return validate(parseBlock(blockLines(text.split(/\r?\n/), manifestPath), manifestPath), manifestPath);
}

module.exports = { BLOCK_KEY, readDeclaredManifest };
