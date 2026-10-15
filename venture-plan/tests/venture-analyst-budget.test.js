/**
 * Venture Plan - every analyst reply fits its output cap, and the cap fits one native request.
 *
 * On the native kernel a bot turn's reply is capped (2048 tokens by default, package_bot_turn.rs) and one package
 * request lasts 60 s. The unbounded BOM contract produced 10 indented lines and 4 vendors, 3,142 tokens, and the ops
 * contract 2,869, so both replies were cut off before their JSON closed in every live run. This suite reads the REAL
 * prompts the compiled venture-bots.js sends (schema, counts, text lengths), builds the largest reply each contract
 * allows, and proves it (a) parses under the package's own contract parser and (b) fits ANALYST_MAX_OUTPUT_TOKENS by
 * a token estimate that over-counts the local model's tokenizer; and that every analyst call carries that cap.
 *
 * The estimate counts every digit as a token (the local Qwen tokenizer splits numbers digit by digit) and every
 * other character as 1/2.8 of a token. Measured with the served model's /tokenize on 2026-10-11: real minified
 * replies use 2.99 to 3.74 characters per token overall, and this estimate exceeded the true count on each of them
 * (BOM 2,708 vs 2,079; ops 2,747 vs 1,749; market 1,451 vs 912).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The worst-case BOM, market and ops replies fit the explicit output cap, the cap fits the native request, and each analyst call sends it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The market and ops worst cases include the "required" slots (venture-required-inputs) at their largest allowed values, and every slot parses.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | An assumption's unit is the longest unit the parser accepts: an unknown unit now refuses the row, so free text there is no longer a reply the contract allows. The ops worst case carries the two container-fill slots and four free assumptions.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const calls = [];
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _client, agentId, request) => {
      calls.push({ agentId, request });
      return { response: '{}', cost: 0 };
    },
  },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const bots = require(path.join(PKG, 'routes', 'venture-bots.js'));
const contracts = require(path.join(PKG, 'routes', 'venture-bot-contracts.js'));
const required = require(path.join(PKG, 'routes', 'venture-required-inputs.js'));
const { NATIVE_ANALYST_WINDOW_MS } = loadRun();
Module._load = originalLoad;

/** venture-run.js needs more seams; only its constant is read here. */
function loadRun() {
  const quiet = new Proxy({}, { get: () => () => ({}) });
  const saved = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) };
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    if (request.startsWith('./venture-store') || request === './venture-rebaseline') return quiet;
    return saved.call(this, request, ...rest);
  };
  try { return require(path.join(PKG, 'routes', 'venture-run.js')); } finally { Module._load = saved; }
}

/** The local model's slowest output rate seen on this host, tokens per second. */
const SLOWEST_TOKENS_PER_SECOND = 52;
/** The native kernel's package request deadline (crates/host-process/src/host.rs CALL_DEADLINE). */
const NATIVE_REQUEST_MS = 60_000;

const SPEC = { name: 'Garden lantern', ideaText: 'A solar garden lantern with a motion sensor.', spec: { productClass: 'outdoor lighting' } };

/** Over-counting token estimate: each digit one token, any other character 1/2.8 of one. */
function estimateTokens(text) {
  const digits = (text.match(/[0-9]/g) || []).length;
  return digits + (text.length - digits) / 2.8;
}

/** The prompt one analyst call sends, with the request that carried it. */
async function prompt(author) {
  calls.length = 0;
  await author();
  assert.equal(calls.length, 1, 'one bot call per analyst');
  return calls[0];
}

/** Every array of objects the Schema block of a prompt declares, as { name: [[key, type], ...] }. */
function schema(text) {
  const block = text.slice(text.indexOf('Schema:'), text.indexOf('\n\n', text.indexOf('Schema:') + 8));
  const arrays = {};
  for (const m of block.matchAll(/"(\w+)": \[\{([\s\S]*?)\}\]/g)) {
    arrays[m[1]] = [...m[2].matchAll(/"(\w+)": ([^,}\n]+?)(?=,\s*(?:"|\n|')|\s*$|')/g)].map((f) => [f[1], f[2].trim()]);
  }
  return arrays;
}

const L = bots.ANALYST_LIMITS;
const NAMES = new Set(['partName', 'label', 'vendorName', 'name', 'role']);
const DETAILS = new Set(['specText', 'sourceDetail', 'notes']);
const URLS = new Set(['url', 'sourceUrl']);

/** Realistic words, as long as the contract lets this field be. */
function words(length) {
  return 'certified enclosure gasket assembly '.repeat(10).slice(0, length - 1) + 'x';
}

/** The largest value a schema field may carry. Money is 12 digits ($999,999 in micros); other numbers 6. */
function worst(key, type) {
  const options = [...type.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (options.length) return options.sort((a, b) => b.length - a.length)[0];
  if (type.startsWith('string[]')) return [words(L.shortChars), words(L.shortChars)];
  if (key === 'key') return 'landed.freight.container-rate.x'.slice(0, L.shortChars);
  // The unit is a closed set the parser converts (venture-bot-contracts normaliseUnit); its longest member is the worst case.
  if (key === 'unit') return 'usd-micros';
  if (type.startsWith('string')) {
    const n = NAMES.has(key) ? L.nameChars : DETAILS.has(key) ? L.detailChars : URLS.has(key) ? L.urlChars : L.shortChars;
    return words(n);
  }
  if (type.startsWith('number')) return /Micros$|^(valueNum|lowNum|highNum)$/.test(key) ? 999999999999 : 999999;
  if (type.startsWith('boolean')) return false;
  throw new Error(`unknown schema type for ${key}: ${type}`);
}

/** The largest "required" block an analyst may return: every slot at its bound, the longest basis and URL. */
function worstSlots(analyst) {
  return Object.fromEntries(required.slotsFor(analyst).map((s) => [s.slot, {
    value: s.max, low: s.max, high: s.max, confidence: 'medium', basis: words(L.detailChars),
    sourceUrl: `https://${words(L.urlChars - 8)}`,
  }]));
}

/** The largest reply a prompt's contract allows, minified as the contract asks. */
function worstReply(text, counts, slots) {
  const declared = schema(text);
  assert.deepEqual(Object.keys(declared).sort(), Object.keys(counts).sort(), 'the counts cover every array the schema declares');
  const reply = {};
  for (const [name, fields] of Object.entries(declared)) {
    assert.ok(fields.length >= 5, `${name} schema fields were read from the prompt`);
    reply[name] = Array.from({ length: counts[name] }, (_, i) => Object.fromEntries(fields.map(([k, t]) => [k, k === 'ref' ? `P${i + 1}` : worst(k, t)])));
  }
  if (slots) reply.required = worstSlots(slots);
  return JSON.stringify(reply);
}

const ANALYSTS = [
  { who: 'BOM', author: () => bots.authorBom({}, {}, 'alice', SPEC, 5000), parse: contracts.parseBomOutput,
    counts: { bom_lines: L.bom.lines, vendor_candidates: L.bom.vendors }, accepted: (p) => p.rows.length + p.vendors.length },
  { who: 'market', slots: 'market', author: () => bots.authorMarket({}, {}, 'alice', SPEC), parse: contracts.parseAssumptionOutput,
    counts: { assumptions: L.market.assumptions }, accepted: (p) => p.rows.length },
  { who: 'ops', slots: 'ops', author: () => bots.authorOps({}, {}, 'alice', SPEC, { runQtyUnits: 5000, lines: [] }), parse: contracts.parseOpsOutput,
    counts: { assumptions: L.ops.assumptions, schedule_tasks: L.ops.tasks, headcount_roles: L.ops.roles },
    accepted: (p) => p.rows.length + p.tasks.length + p.roles.length },
];

for (const analyst of ANALYSTS) {
  test(`the largest ${analyst.who} reply the contract allows parses and fits the output cap`, async () => {
    const { request } = await prompt(analyst.author);
    assert.equal(request.max_output_tokens, bots.ANALYST_MAX_OUTPUT_TOKENS, 'the call sends its output cap');
    for (const [name, n] of Object.entries(analyst.counts)) {
      assert.match(request.text, new RegExp(`[Aa]t most ${n} ${name}\\b|${n} ${name}\\b`), `the prompt states the ${name} limit`);
    }
    assert.match(request.text, /ONE line, minified/, 'the prompt asks for minified JSON');
    const reply = worstReply(request.text, analyst.counts, analyst.slots);
    const parsed = analyst.parse(reply);
    if (analyst.slots) {
      const slots = required.parseRequiredInputs(JSON.parse(reply), analyst.slots);
      assert.deepEqual(slots.missing, [], 'every slot at its largest allowed value parses');
      assert.equal(slots.rows.length, required.slotsFor(analyst.slots).length);
    }
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.rejected.length, 0, JSON.stringify(parsed.rejected));
    assert.equal(analyst.accepted(parsed), Object.values(analyst.counts).reduce((a, b) => a + b, 0));
    const tokens = estimateTokens(reply);
    assert.ok(tokens <= bots.ANALYST_MAX_OUTPUT_TOKENS,
      `${analyst.who} worst case ~${Math.round(tokens)} tokens exceeds the ${bots.ANALYST_MAX_OUTPUT_TOKENS}-token cap`);
  });
}

test('the output cap fits a native request even at the slowest output rate seen, starting at the latest an analyst may', () => {
  const writing = (bots.ANALYST_MAX_OUTPUT_TOKENS / SLOWEST_TOKENS_PER_SECOND) * 1000;
  assert.ok(NATIVE_ANALYST_WINDOW_MS + writing + 5_000 <= NATIVE_REQUEST_MS,
    `${NATIVE_ANALYST_WINDOW_MS} ms start + ${Math.round(writing)} ms writing + 5 s recording exceeds ${NATIVE_REQUEST_MS} ms`);
});

test('the unbounded shape that was cut off live does not fit the cap: the bound is what makes it fit', async () => {
  const { request } = await prompt(ANALYSTS[0].author);
  const unbounded = worstReply(request.text, { bom_lines: 10, vendor_candidates: 4 });
  assert.ok(estimateTokens(unbounded) > bots.ANALYST_MAX_OUTPUT_TOKENS, 'the live 10-line, 4-vendor shape exceeds the cap');
});
