#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.2 (lane QUANTLIB1): the blue proof of 1.62.0 showed bot-fast recall three passages on every library question and cite a shelf work on 3 of 8. This replays a trading-concierge library turn to the local model one request at a time, so persona wordings can be measured before a release: the system text is assembled the way the kernel assembles a concierge turn (the contract, the model's class from crates/inference/src/model_instructions.rs, the persona's perspective, the concierge and person rules, the fenced facts, the three passages hybrid recall picks with the kernel's local embedding model, the tools with the tool-call format and the state-question rule), the tool loop runs the quant's own explain table and answers every other tool with an empty reading, and the final reply is graded with the live proof's citation grade (quant-library-questions.mjs) against the works recall gave it; a source line that names a shelf work recall did not give is counted as invented. The kernel's own texts are read from a kernel checkout; the facts blocks are made-up stand-ins for a new test person. --regrade grades a saved receipt again without asking the model. Not a gate test: it needs the local model and the embedding model.
 * -----------------------------------------------------------------------------
 *
 * usage: node trading/tests/live/quant-library-botfast-replay.mjs <out folder> [--persona=<persona.yaml>]... [--tries=3]
 *          [--only=1,4] [--kernel=<kernel checkout>] [--model-url=http://127.0.0.1:8000/v1] [--model=bot-fast]
 *          [--ollama=http://127.0.0.1:11434] [--max-tokens=2048]
 *        node trading/tests/live/quant-library-botfast-replay.mjs <out folder> --regrade=<replay.json>
 * Each --persona is one variant (default: this package's persona). Writes replay.json (0600) with every reply.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { LIBRARY, citedWork, citation } from './quant-library-questions.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const trading = path.resolve(here, '../..'), store = path.resolve(trading, '..');
const yaml = require(require.resolve('js-yaml', { paths: [here, path.join(store, 'scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [process.env.OSHAL_FRAMEWORK] : [])] }));
const { readShelf } = require('../../../print-ingest/shelves/shelf-check.cjs');
const { stored, hybrid, unit } = require('../../../print-ingest/shelves/shelf-retrieval.cjs');
const { findConcept } = require('../../routes/quant/lab-concepts.js');

const SHELF = path.join(store, 'print-ingest/shelves/quant-library');
const STEP_LIMIT = 6;
const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));

/** @description A Rust string constant's value, as the compiler reads it (line continuations, escapes). @param {string} source File text. @param {string} name Constant. @returns {string} Value. */
export function rustConst(source, name) {
  const start = source.search(new RegExp(`const ${name}: &str = "`));
  if (start < 0) throw new Error(`the kernel source has no ${name}`);
  let index = source.indexOf('"', start) + 1, out = '';
  for (; index < source.length && source[index] !== '"'; index += 1) {
    if (source[index] !== '\\') { out += source[index]; continue; }
    const next = source[index + 1];
    if (next === '\n') { index += 1; while (/\s/.test(source[index + 1])) index += 1; continue; }
    out += { n: '\n', t: '\t', '"': '"', '\\': '\\' }[next] ?? next;
    index += 1;
  }
  return out;
}

/** @description The kernel's own texts this replay assembles, read from a checkout. @param {string} kernel Checkout. @returns {object} Texts. */
function kernelTexts(kernel) {
  const read = (file) => fs.readFileSync(path.join(kernel, file), 'utf8');
  const concierge = read('crates/api/src/concierge_context.rs');
  return {
    contract: rustConst(read('crates/inference/src/assembly.rs'), 'SYSTEM_CONTRACT'),
    localQwen: rustConst(read('crates/inference/src/model_instructions.rs'), 'LOCAL_QWEN'),
    conciergeRule: rustConst(concierge, 'CONCIERGE_RULE'),
    personRule: rustConst(concierge, 'PERSON_RULE'),
    applicationHeader: rustConst(concierge, 'APPLICATION_HEADER'),
    stateRule: rustConst(read('crates/oshald/src/turn_prompt.rs'), 'STATE_QUESTION_RULE'),
  };
}

/** @description JSON with keys in order, compact, as serde_json writes a Value. @param {*} value Value. @returns {string} Text. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** @description Content inside the kernel's fence. @param {string} source Provenance. @param {string} content Content. @returns {string} Fenced text. */
const fenced = (source, content) => `<<untrusted source="${source}">>\n${content}\n<<end untrusted>>`;

/** @description Twelve of the package's tools, ranked by the question's words (the kernel's switch keeps twelve). @param {object} manifest Trades manifest. @param {string} question Message. @returns {string[]} Prompt entries. */
function toolEntries(manifest, question) {
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  const ranked = manifest.tools.filter((tool) => tool.defaultAuthMode !== 'off' && tool.enabled !== false)
    .map((tool, order) => ({ tool, order, score: words.filter((word) => `${tool.name} ${tool.description} ${(tool.routingTags || []).join(' ')}`.toLowerCase().includes(word)).length + (/quant/.test(tool.name) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 12);
  return ranked.map(({ tool }) => `- \`${tool.name}\`: ${String(tool.description || tool.displayName).trim()} (schema: ${canonical(tool.inputSchema || { type: 'object' })})`);
}

/** @description The fenced facts a new test person's Trades concierge turn carries (made-up stand-ins). @param {object} texts Kernel texts. @param {object} manifest Manifest. @returns {string[]} Blocks. */
function factBlocks(texts, manifest) {
  const person = 'SIGNED-IN PERSON - the oshal person asking in this session:\n- Display name: Quant Library Reader\n- Sign-in name: qlib-reader-replay\n- Email on this oshal account: none saved on this oshal account';
  const application = [texts.applicationHeader, `- Application: ${manifest.displayName} (key ${manifest.name})`, `- Opens in the cockpit at: /cockpit/?app=${manifest.name}`,
    '- Suite: AI Finance (ai-finance)', `- What it does: ${String(manifest.description).trim().slice(0, 600)}`, '- Connections: Charles Schwab (not connected)'].join('\n');
  const summary = 'APPLICATION HOME SUMMARY - what Intelligent Trades\' Home shows this person now:\n- Connected accounts: 0\n- Paper accounts: 0\n- Watchlist symbols: 0';
  const installed = 'INSTALLED APPLICATIONS - the applications this person may open:\n- Intelligent Trades (intelligent-trades)\n- Print Inbox (print-ingest)\n- Jarvis (jarvis)\n- World (world)';
  return [fenced('signed-in person', person), fenced('current application', application), fenced('application home summary', summary), fenced('installed applications', installed)];
}

/** @description The system text a bot-fast concierge turn carries. @param {object} parts Texts, persona, manifest, passages, question. @returns {string} System text. */
function systemText({ texts, persona, manifest, passages, question }) {
  const recall = fenced('current authorized native recall', passages.map((text) => `["print-ingest" | "quant-library"]\n${text}`).join('\n\n'));
  const tools = `You have access to the following tools:\n${toolEntries(manifest, question).join('\n')}\n\nTo execute a tool, emit a tool call block:\n\`\`\`tool_call\n{"tool": "<tool_name>", "arguments": {...}}\n\`\`\`\n\n${texts.stateRule}`;
  const slots = [['persona', persona], ['task', `${texts.conciergeRule}\n\n${texts.personRule}`], ['recalled', [...factBlocks(texts, manifest), recall].join('\n')], ['tools', tools]];
  const rest = slots.map(([name, content]) => `\n### ${name}\n${content.split('\n### ').join('\n')}`).join('');
  return `${texts.contract}\n\n### instructions for this model\n${texts.localQwen}\n${rest}`;
}

/** @description The tool call a reply makes, read the way the kernel reads one (a ```tool_call fence first, then a ```json fence or a bare object); null for an answer. @param {string} reply Reply. @returns {{tool: string, args: object}|null} Call. */
function toolCall(reply) {
  const blocks = [/```tool_call\s*\n?([\s\S]*?)```/.exec(reply), /```json\s*\n?([\s\S]*?)```/i.exec(reply), /^\s*(\{[\s\S]*\})\s*$/.exec(reply),
    /^\s*tool_call\s*\n(\{[\s\S]*\})\s*(?:```)?\s*$/.exec(reply)];
  for (const match of blocks.filter(Boolean)) {
    try {
      const call = JSON.parse(match[1].trim());
      const tool = call.tool || call.name;
      if (tool) return { tool, args: call.arguments || call.input || call.parameters || {} };
    } catch { /* not a call: the next shape is tried */ }
  }
  return null;
}

/** @description What a tool returns in the replay: the explain table as the route serves it; an empty reading otherwise. @param {{tool: string, args: object}} call Call. @returns {string} Observation. */
function observe(call) {
  if (call.tool === 'trading_quant_explain') {
    const found = findConcept(call.args.concept);
    const body = found.concept ? { ok: true, concept: found.concept } : { ok: false, message: 'No single concept matches; name one of these.', suggestions: found.suggestions };
    return `Observation from ${call.tool}:\n${canonical({ status: 200, body })}`;
  }
  return `Observation from ${call.tool}:\n${canonical({ status: 200, body: { ok: false, message: 'Nothing is recorded for this person yet.' } })}`;
}

/** @description One completion from the local model. @param {object} model {url, name, maxTokens}. @param {object[]} messages Messages. @returns {Promise<{text: string, finish: string}>} Reply. */
async function complete(model, messages) {
  const response = await fetch(`${model.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.name, messages, max_tokens: model.maxTokens }) });
  if (!response.ok) throw new Error(`the model answered ${response.status}`);
  const body = await response.json();
  return { text: String(body.choices[0].message.content || ''), finish: body.choices[0].finish_reason };
}

/** @description One turn: the model's calls run through the replay's tools until it answers. @param {object} model Model. @param {string} system System text. @param {string} question Message. @returns {Promise<object>} The turn. */
async function turn(model, system, question) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: question }], tools = [];
  for (let step = 0; step <= STEP_LIMIT; step += 1) {
    const reply = await complete(model, messages);
    const call = toolCall(reply.text);
    if (!call || step === STEP_LIMIT) return { tools, reply: reply.text, finish: reply.finish };
    tools.push(call.tool);
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: observe(call) });
  }
  return { tools, reply: '', finish: 'step-limit' };
}

/** @description Unit embeddings from the loopback Ollama the kernel is configured with, cached in the out folder. @param {object} config {ollama, model, cache}. @param {string[]} texts Texts. @returns {Promise<number[][]>} Vectors. */
async function embed(config, texts) {
  const cache = fs.existsSync(config.cache) ? JSON.parse(fs.readFileSync(config.cache, 'utf8')) : {};
  const missing = [...new Set(texts.filter((text) => !cache[text]))];
  for (let i = 0; i < missing.length; i += 8) {
    const response = await fetch(`${config.ollama}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, input: missing.slice(i, i + 8), truncate: false, keep_alive: '5m' }) });
    if (!response.ok) throw new Error(`the embedding model answered ${response.status}`);
    (await response.json()).embeddings.forEach((vector, j) => { cache[missing[i + j]] = unit(vector); });
  }
  if (missing.length) fs.writeFileSync(config.cache, JSON.stringify(cache), { mode: 0o600 });
  return texts.map((text) => cache[text]);
}

/** @description The three passages hybrid recall picks for each library question. @param {object} config Embedding config. @param {object[]} questions Questions. @returns {Promise<object[][]>} Passages per question. */
async function recallAll(config, questions) {
  const shelf = readShelf(SHELF);
  const passages = shelf.documents.map(stored);
  const vectors = await embed(config, passages.map((passage) => passage.text));
  const asked = await embed(config, questions.map((item) => item.q));
  return questions.map((item, index) => hybrid(passages, vectors, asked[index], item.q, 3).map((hit) => passages[hit.index]));
}

/** @description The replay's settings from its arguments; refuses a model or embedding address that is not loopback. @param {string[]} argv Arguments. @returns {object} Settings. */
function settings(argv) {
  const flags = (name) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  const one = (name, fallback) => flags(name).pop() || fallback;
  const out = argv.find((a) => !a.startsWith('--'));
  if (!out) throw new Error('usage: <out folder> [--persona=<yaml>]... [--tries=3] [--only=1,4] [--kernel=<checkout>] [--model-url=URL] [--model=bot-fast]');
  const model = { url: one('model-url', 'http://127.0.0.1:8000/v1').replace(/\/$/, ''), name: one('model', 'bot-fast'), maxTokens: Number(one('max-tokens', '2048')) };
  const ollama = one('ollama', 'http://127.0.0.1:11434');
  for (const address of [model.url, ollama]) if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(address)) throw new Error('the model and the embedding model must be on loopback');
  const personas = flags('persona').length ? flags('persona') : [path.join(trading, 'personas/trading-concierge.yaml')];
  return { out, model, personas, tries: Number(one('tries', '3')), only: flags('only').length ? new Set(one('only').split(',').map(Number)) : null,
    kernel: one('kernel', path.join(os.homedir(), 'Documents/projects/oshal-kernel')), embedding: { ollama, model: one('embedding-model', 'qwen3-embedding:0.6b'), cache: path.join(out, 'vectors.json') } };
}

/**
 * @description One reply's grade against what recall gave it: the recalled work it cites (title and author, a summary
 *   said as one); the shelf works it names by title and author that recall did not give it (`named`: knowledge, not
 *   wrong in itself; a Wikipedia article's title is the idea's own name, so those are not counted), and those among
 *   them it puts on a source line as if the library had given them (`invented`); and what it holds of each recalled work.
 * @param {object} run Shared state (works, byId).
 * @param {object[]} passages The recalled passages.
 * @param {{ideas: number[]}} item The question.
 * @param {string} reply The final reply.
 * @returns {{cited: string|null, named: string[], invented: string[], held: object}} The grade.
 */
function graded(run, passages, item, reply) {
  const recalledIds = new Set(passages.map((p) => p.work));
  const work = citedWork(reply, item.ideas, run.works.filter((w) => recalledIds.has(w.id)));
  const names = (text, w) => { const held = citation(text, w); return held.title && held.author; };
  const others = run.works.filter((w) => !recalledIds.has(w.id) && w.authors[0] !== 'Wikipedia contributors');
  const named = others.filter((w) => names(reply, w)).map((w) => w.id);
  const sourceLines = reply.split('\n').filter((line) => /\bsources?\b/i.test(line));
  const invented = others.filter((w) => sourceLines.some((line) => names(line, w))).map((w) => w.id);
  const held = Object.fromEntries([...recalledIds].map((id) => [id, citation(reply, run.byId.get(id))]));
  return { cited: work && work.id, named, invented, held };
}

/** @description One persona variant over the chosen questions and tries. @param {object} run Shared state. @param {string} file Persona file. @returns {Promise<object>} Results. */
async function variant(run, file) {
  const persona = String(yaml.load(fs.readFileSync(file, 'utf8')).perspective);
  const result = { persona: file, cited: 0, invented: 0, turns: 0, questions: [] };
  for (const [index, item] of LIBRARY.entries()) {
    if (run.only && !run.only.has(index + 1)) continue;
    const passages = run.recalled[index];
    const system = systemText({ texts: run.texts, persona, manifest: run.manifest, passages: passages.map((p) => p.text), question: item.q });
    if (index === 0 || (run.only && index + 1 === Math.min(...run.only))) fs.writeFileSync(path.join(run.out, `system-${path.basename(file, '.yaml')}.txt`), system, { mode: 0o600 });
    const row = { n: index + 1, recalled: passages.map((p) => p.work), tries: [] };
    for (let attempt = 0; attempt < run.tries; attempt += 1) {
      const started = Date.now(), done = await turn(run.model, system, item.q);
      const grade = graded(run, passages, item, done.reply);
      row.tries.push({ seconds: Math.round((Date.now() - started) / 1000), tools: done.tools, finish: done.finish, ...grade, reply: done.reply.slice(0, 6000) });
      result.turns += 1; result.cited += grade.cited ? 1 : 0; result.invented += grade.invented.length ? 1 : 0;
      say('turn', { persona: path.basename(file), n: index + 1, attempt: attempt + 1, cited: grade.cited, invented: grade.invented, tools: done.tools, finish: done.finish });
    }
    result.questions.push(row);
  }
  return result;
}

/** @description Each variant's totals, one line each. @param {object[]} variants Results. */
function summarize(variants) {
  for (const row of variants) {
    say('variant', { persona: row.persona, cited: `${row.cited}/${row.turns}`, invented: row.invented,
      byQuestion: row.questions.map((q) => `${q.n}:${q.tries.filter((t) => t.cited).length}/${q.tries.length}`).join(' ') });
  }
}

/** @description Grade a saved receipt's replies again with the current grade, without asking the model. @param {object} run Shared state. @param {string} file Receipt. @returns {object[]} Variants. */
function regrade(run, file) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  return saved.variants.map((row) => {
    const questions = row.questions.map((q) => ({ ...q, tries: q.tries.map((t) => ({ ...t, ...graded(run, q.recalled.map((work) => ({ work })), LIBRARY[q.n - 1], t.reply) })) }));
    const tries = questions.flatMap((q) => q.tries);
    return { persona: row.persona, turns: tries.length, cited: tries.filter((t) => t.cited).length, invented: tries.filter((t) => t.invented.length).length, questions };
  });
}

async function main(argv) {
  const config = settings(argv);
  const works = JSON.parse(fs.readFileSync(path.join(SHELF, 'works.json'), 'utf8'));
  const base = { ...config, works, byId: new Map(works.map((w) => [w.id, w])) };
  const again = (argv.find((a) => a.startsWith('--regrade=')) || '').slice('--regrade='.length);
  if (again) { summarize(regrade(base, again)); return 0; }
  fs.mkdirSync(config.out, { recursive: true, mode: 0o700 });
  const manifest = yaml.load(fs.readFileSync(path.join(trading, 'oshal-app.yaml'), 'utf8'));
  const run = { ...base, texts: kernelTexts(config.kernel), manifest, recalled: await recallAll(config.embedding, LIBRARY) };
  const receipt = { startedAt: new Date().toISOString(), model: config.model, tries: config.tries, variants: [] };
  for (const file of config.personas) {
    receipt.variants.push(await variant(run, file));
    fs.writeFileSync(path.join(config.out, 'replay.json'), JSON.stringify({ ...receipt, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }
  summarize(receipt.variants);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(`quant-library-botfast-replay: ${String(error && error.message || error)}`); process.exitCode = 1; });
