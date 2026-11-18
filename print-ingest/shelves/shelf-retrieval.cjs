/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Lane QUANTLIB1: a faithful replica of how the engine's knowledge rail ranks a shelf for a bot's turn, so a shelf's retrieval quality is measured before it is filed. Lexical: the kernel's `knowledge::Index` (lower-cased alphanumeric term sets, score = share of the question's terms a passage holds, ties by document id). Hybrid (what production runs with a local embedding model): reciprocal-rank fusion, k = 60, of the lexical top 50 and the cosine top 50 (crates/oshald/src/rag_executor/semantic.rs). The stored text is the kernel chunker's: words joined by single spaces.
 */
'use strict';
const crypto = require('node:crypto');

/**
 * @description The kernel's terms of a text (crates/knowledge/src/retrieval.rs `tokens`).
 * @param {string} text - Any text.
 * @returns {Set<string>} Lower-cased alphanumeric words.
 */
function tokens(text) {
  return new Set(String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((word) => word.toLowerCase()));
}

/**
 * @description A passage as the rail stores it: the kernel's chunker joins the words with single spaces, and Print files
 * it under `print:<sha256 of the filed text>`.
 * @param {{id: string, work: string, text: string}} doc - A shelf passage.
 * @returns {{id: string, work: string, text: string, terms: Set<string>, key: string}} The stored passage.
 */
function stored(doc) {
  const text = doc.text.split(/\s+/).filter(Boolean).join(' ');
  const key = `print:${crypto.createHash('sha256').update(doc.text, 'utf8').digest('hex')}`;
  return { id: doc.id, work: doc.work, text, terms: tokens(text), key };
}

/**
 * @description The kernel's lexical ranking over passages in stored order.
 * @param {object[]} passages - Stored passages.
 * @param {string} question - The person's message.
 * @param {number} limit - How many to keep.
 * @returns {{index: number, score: number}[]} Best first.
 */
function lexical(passages, question, limit) {
  const asked = [...tokens(question)];
  if (!asked.length) return [];
  return passages
    .map((passage, index) => ({ index, key: passage.key, score: asked.filter((term) => passage.terms.has(term)).length / asked.length }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, limit);
}

function cosine(left, right) {
  let dot = 0;
  for (let i = 0; i < left.length; i += 1) dot += left[i] * right[i];
  return dot;
}

/**
 * @description The kernel's hybrid recall: reciprocal-rank fusion of the lexical top 50 and the cosine top 50.
 * @param {object[]} passages - Stored passages.
 * @param {number[][]} vectors - Their unit vectors, same order.
 * @param {number[]} asked - The question's unit vector.
 * @param {string} question - The question.
 * @param {number} limit - How many recall keeps (3 per binding in a bot's turn).
 * @returns {{index: number, score: number}[]} Best first.
 */
function hybrid(passages, vectors, asked, question, limit) {
  const scores = new Map();
  const reciprocal = (rank) => 1 / (60 + rank + 1);
  vectors
    .map((vector, index) => ({ index, cosine: cosine(asked, vector) }))
    .filter((hit) => hit.cosine > 0)
    .sort((a, b) => b.cosine - a.cosine || a.index - b.index)
    .slice(0, 50)
    .forEach((hit, rank) => scores.set(hit.index, reciprocal(rank)));
  lexical(passages, question, 50).forEach((hit, rank) => scores.set(hit.index, (scores.get(hit.index) || 0) + reciprocal(rank)));
  return [...scores.entries()]
    .map(([index, score]) => ({ index, score }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit);
}

/**
 * @description Unit length, as the kernel normalizes every stored and asked vector.
 * @param {number[]} vector - A raw embedding.
 * @returns {number[]} The unit vector.
 */
function unit(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

/**
 * @description Grade questions: each passes when one of its top passages comes from a work that explains its idea.
 * @param {object[]} questions - `{question, ideas}` rows.
 * @param {Map<string, object>} works - Works by id.
 * @param {object[]} passages - Stored passages.
 * @param {(question: string) => {index: number}[]} rank - The ranking to grade, top 3.
 * @returns {{passed: number, misses: object[], rows: object[]}} The grade.
 */
function grade(questions, works, passages, rank) {
  const rows = questions.map((row) => {
    const top = rank(row.question).map((hit) => passages[hit.index]);
    const right = top.filter((passage) => works.get(passage.work).ideas.some((idea) => row.ideas.includes(idea)));
    return { question: row.question, ideas: row.ideas, top: top.map((passage) => passage.id), right: right.length > 0 };
  });
  return { passed: rows.filter((row) => row.right).length, misses: rows.filter((row) => !row.right), rows };
}

module.exports = { tokens, stored, lexical, hybrid, unit, grade };
