/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Lane QUANTLIB1: grade a shelf's fixed questions the way production recalls it, hybrid, with the same local embedding model the kernel is configured with (OSHAL_RAG_EMBEDDINGS: Ollama qwen3-embedding:0.6b on loopback). Not a gate test: it needs that local model. Writes a receipt with every question's top three.
 */
// Usage: node print-ingest/shelves/eval-hybrid.mjs <shelf-dir> <receipt.json> [--ollama=http://127.0.0.1:11434] [--model=qwen3-embedding:0.6b]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readShelf } = require('./shelf-check.cjs');
const { stored, hybrid, lexical, unit, grade } = require('./shelf-retrieval.cjs');

const [dir, receiptPath] = process.argv.slice(2);
const option = (name, fallback) => (process.argv.find((arg) => arg.startsWith(`--${name}=`)) || `=${fallback}`).split('=').slice(1).join('=');
const ollama = option('ollama', 'http://127.0.0.1:11434');
const model = option('model', 'qwen3-embedding:0.6b');
if (!dir || !receiptPath) {
  console.error('usage: node eval-hybrid.mjs <shelf-dir> <receipt.json> [--ollama=URL] [--model=NAME]');
  process.exit(2);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(ollama)) {
  console.error('the embedding model must be a loopback Ollama, as the kernel requires');
  process.exit(2);
}

async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 8) {
    const response = await fetch(`${ollama}/api/embed`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: texts.slice(i, i + 8), truncate: false, keep_alive: '5m' }),
    });
    if (!response.ok) throw new Error(`embedding request answered ${response.status}`);
    const body = await response.json();
    if (body.model !== model || body.embeddings.length !== Math.min(8, texts.length - i)) throw new Error('unexpected embedding reply');
    out.push(...body.embeddings.map(unit));
  }
  return out;
}

const shelf = readShelf(dir);
const works = new Map(shelf.works.map((work) => [work.id, work]));
const passages = shelf.documents.map(stored);
const { questions } = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
const tags = await (await fetch(`${ollama}/api/tags`)).json();
const installed = tags.models.find((row) => row.name === model);
if (!installed) throw new Error(`${model} is not installed in ${ollama}`);
const started = Date.now();
const vectors = await embed(passages.map((passage) => passage.text));
const asked = await embed(questions.map((row) => row.question));
const byQuestion = new Map(questions.map((row, index) => [row.question, asked[index]]));
const hybridGrade = grade(questions, works, passages, (question) => hybrid(passages, vectors, byQuestion.get(question), question, 3));
const lexicalGrade = grade(questions, works, passages, (question) => lexical(passages, question, 3));
const receipt = {
  shelf: shelf.shelf.collection, model, digest: installed.digest, passages: passages.length, questions: questions.length,
  hybrid: { passed: hybridGrade.passed, misses: hybridGrade.misses }, lexical: { passed: lexicalGrade.passed, misses: lexicalGrade.misses },
  seconds: Math.round((Date.now() - started) / 1000), rows: hybridGrade.rows,
};
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 1)}\n`);
console.log(`hybrid ${hybridGrade.passed}/${questions.length}, lexical ${lexicalGrade.passed}/${questions.length} (${passages.length} passages, ${receipt.seconds} s); receipt ${receiptPath}`);
process.exitCode = hybridGrade.passed === questions.length ? 0 : 1;
