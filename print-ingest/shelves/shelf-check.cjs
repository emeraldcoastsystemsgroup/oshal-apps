/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Lane QUANTLIB1: one check for every shelf Print files into the engine's knowledge rail (the quant library first). A full text needs a licence that allows commercial reuse, read on its official page at build time (CC BY, CC BY-SA, CC0, public domain); a NonCommercial or NoDerivatives work, or a copyrighted classic, is a record plus a summary in our own words. Every passage starts with its citation line and stays inside one kernel chunk (450 words; the kernel cuts at 500), and a shelf fits one collection's quota. The loader refuses a shelf that fails it; the tests prove it refuses.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Licences under which a full text may be stored and served to a commercial installation. */
const ALLOWING = /^(CC BY \d|CC BY-SA \d|CC0 \d|Public Domain)/;
/** Licence names that never allow a stored full text here. */
const RESTRICTED = /\b(NC|ND)\b|NonCommercial|NoDerivatives|not openly licensed/i;
const MAX_WORDS = 450;
const MAX_PASSAGES = 2048;
/** One collection is one stored row of at most 8 MiB including its vectors (~6.8 KB a passage beside its text). */
const MAX_BYTES = 7 * 1024 * 1024;
const IDEAS = 50;

/**
 * @description Read a shelf folder as the loader and the tests see it.
 * @param {string} dir - The shelf folder (shelf.json, works.json, documents.jsonl).
 * @returns {{shelf: object, works: object[], documents: object[]}} The shelf.
 */
function readShelf(dir) {
  const json = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const documents = fs.readFileSync(path.join(dir, 'documents.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { shelf: json('shelf.json'), works: json('works.json'), documents };
}

function words(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/**
 * @description Problems with one work's record and licence.
 * @param {object} work - A works.json row.
 * @returns {string[]} What is wrong, empty when the record holds.
 */
function workProblems(work) {
  const out = [];
  const name = work.id || '(no id)';
  if (!work.title || !Array.isArray(work.authors) || !work.authors.length || !Number.isInteger(work.year) || !work.venue) {
    out.push(`${name}: title, authors, year and venue are required`);
  }
  if (!/^https?:\/\//.test(work.link || '')) out.push(`${name}: a public link is required`);
  const licence = work.licence || {};
  if (work.kind === 'full-text') {
    if (!ALLOWING.test(licence.name || '') || RESTRICTED.test(licence.name || '') || licence.allowsFullText !== true) {
      out.push(`${name}: full text needs an allowing licence (CC BY, CC BY-SA, CC0, public domain), not ${licence.name}`);
    }
    if (!/^https:\/\/creativecommons\.org\//.test(licence.url || '') || !licence.evidence) {
      out.push(`${name}: a full text records its licence URL and where it was read`);
    }
  } else if (work.kind === 'summary') {
    if (licence.allowsFullText !== false || !licence.name) out.push(`${name}: a summary names its licence and stores no text`);
  } else {
    out.push(`${name}: kind must be full-text or summary`);
  }
  if (!Array.isArray(work.ideas) || !work.ideas.length || work.ideas.some((i) => !Number.isInteger(i) || i < 1 || i > IDEAS)) {
    out.push(`${name}: ideas must name the fifty ideas it explains`);
  }
  return out;
}

/**
 * @description Problems with one passage against its work.
 * @param {object} doc - A documents.jsonl row.
 * @param {object|undefined} work - Its work.
 * @returns {string[]} What is wrong.
 */
function documentProblems(doc, work) {
  if (!work) return [`${doc.id}: names no work on the shelf`];
  const out = [];
  const text = String(doc.text || '');
  if (words(text) > MAX_WORDS || words(text) !== doc.words) out.push(`${doc.id}: ${words(text)} words, over one kernel chunk or miscounted`);
  if (!text.startsWith('QUANT LIBRARY | ')) out.push(`${doc.id}: does not start with its citation line`);
  const line = text.split('\n')[0];
  for (const part of [work.title, work.licence.name, work.link, String(work.year)]) {
    if (!line.includes(part)) out.push(`${doc.id}: its citation line lacks ${part}`);
  }
  if (doc.licence !== work.licence.name || doc.kind !== work.kind) out.push(`${doc.id}: licence or kind differs from its work`);
  const marker = work.kind === 'summary' ? 'SUMMARY in our own words (not the work\'s text)' : 'FULL TEXT excerpt';
  if (!line.includes(marker)) out.push(`${doc.id}: its citation line must say ${marker}`);
  return out;
}

/**
 * @description Every problem with a shelf; the loader files nothing while any remains.
 * @param {{shelf: object, works: object[], documents: object[]}} input - The shelf.
 * @returns {string[]} Problems, empty when the shelf may be filed.
 */
function checkShelf({ shelf, works, documents }) {
  const out = [];
  if (shelf.owner !== 'print-ingest' || !/^[a-z0-9.-]+$/.test(shelf.collection || '')) out.push('shelf: Print must own a named collection');
  if (shelf.destination !== `bot:${(shelf.audience || {}).agentId}`) out.push('shelf: destination must be its audience bot');
  const byId = new Map();
  for (const work of works) {
    if (byId.has(work.id)) out.push(`${work.id}: repeated`);
    byId.set(work.id, work);
    out.push(...workProblems(work));
  }
  const seen = new Set();
  for (const doc of documents) {
    if (seen.has(doc.id)) out.push(`${doc.id}: repeated`);
    seen.add(doc.id);
    out.push(...documentProblems(doc, byId.get(doc.work)));
  }
  for (const work of works) if (!documents.some((doc) => doc.work === work.id)) out.push(`${work.id}: has no passage`);
  const bytes = documents.reduce((sum, doc) => sum + Buffer.byteLength(doc.text) + 6800, 0);
  if (documents.length > MAX_PASSAGES || bytes > MAX_BYTES) out.push(`shelf: ${documents.length} passages, ~${bytes} bytes exceed one collection`);
  const covered = new Set(works.flatMap((work) => work.ideas));
  for (let idea = 1; idea <= IDEAS; idea += 1) if (!covered.has(idea)) out.push(`idea ${idea}: no work explains it`);
  return out;
}

module.exports = { ALLOWING, RESTRICTED, MAX_WORDS, readShelf, checkShelf, workProblems, documentProblems, words };
