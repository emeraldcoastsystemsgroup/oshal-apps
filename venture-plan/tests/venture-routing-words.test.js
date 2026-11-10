/**
 * Guard for the words Jarvis routes to Venture Plan by.
 *
 * UX audit 2026-11-05 (jarvis--jarvis-home): "In one short sentence, what workspace tools can you coordinate here?"
 * asked on the Jarvis page was answered by the Venture BOM Analyst ("all I can do is draft bill-of-materials
 * assumptions"). Production logged `jarvis_handoff_owner app=venture-plan score=4` and `jarvis_handoff_implied`: the
 * kernel scored two of this package's words. "one" came from the BOM phrase "cost to make one" (the kernel scores every
 * word of a phrase on its own), and "tools" met the operations keyword "tooling" (the kernel reads "tooling" as
 * "tool"). One keyword plus a second scored word is a strong claim, so the kernel handed the turn over.
 *
 * The words now are "unit cost" and "mold tooling". This suite checks the declaration with the kernel's own matching
 * rules (crates/api/src/jarvis_routing.rs `normalize`, `meaningful`, `forms`, `Ask::claim`), copied here because the
 * store cannot run the kernel. The real boundary is checked live: the same question on the installed kernel stays
 * with Jarvis (decision file jarvis--jarvis-home.json, "proof").
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: a general question about the workspace claims no Venture Plan bot; the manifest and persona words agree; no one-word keyword reads as an everyday assistant word and no phrase carries a number word; the venture questions still claim the package.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.5.4: the BOM, market, and operations analyst personas scope their JSON output contract to run prompts carrying "Schema:" and answer conversational questions without "Schema:" in plain sentences.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(PKG, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));

/** The kernel's filler words (jarvis_routing.rs STOP_WORDS): they never route. */
const STOP = new Set(('the and for with that this from into inside your their then than when where while must should did '
  + 'were have had will can get got make what how who whom whose which why need more want please help show tell give user '
  + 'task you our ours yours are was not but all any its has').split(' '));
/** Words a person uses about the assistant itself, which no Venture Plan keyword may read as. */
const ASSISTANT_WORDS = ['tool', 'tools', 'list', 'use', 'app', 'apps', 'work', 'workspace', 'coordinate', 'time', 'today', 'one'];
/** Number words: inside a phrase each scores alone, so "cost to make one" claimed "in one sentence". */
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'ten', 'hundred', 'first', 'second'];

const normalize = (text) => text.toLowerCase().split(/[^\p{L}\p{N}']+/u).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean).join(' ');
const meaningful = (word) => word.length > 2 && !STOP.has(word) && !STOP.has(word.split("'")[0]);

/** A word and its plausible base forms, as the kernel's `forms` builds them. */
function forms(word) {
  const out = new Set([word]);
  const base = (suffix) => (word.endsWith(suffix) && word.length - suffix.length >= 3 ? word.slice(0, -suffix.length) : null);
  if (base('ies')) out.add(`${base('ies')}y`);
  for (const suffix of ['es', 's']) if (base(suffix)) out.add(base(suffix));
  for (const suffix of ['ing', 'ed']) {
    const stem = base(suffix);
    if (!stem) continue;
    out.add(stem); out.add(`${stem}e`);
    if (stem.length >= 4 && stem.at(-1) === stem.at(-2)) out.add(stem.slice(0, -1));
  }
  return out;
}
const meets = (a, b) => [...forms(a)].some((form) => forms(b).has(form));

/** Each bot's declared words: [manifest routingKeywords, persona routing_keywords]. */
function declared() {
  return manifest.bots.map((bot) => {
    const persona = yaml.load(fs.readFileSync(path.join(PKG, bot.persona), 'utf8')) || {};
    return { name: bot.name, manifest: bot.routingKeywords || [], persona: persona.routing_keywords || [] };
  });
}
const allWords = () => [...new Set(declared().flatMap((bot) => [...bot.manifest, ...bot.persona]).map(normalize))];

/** Whether a request claims the package as the kernel's `Ask::claim` grades it: a phrase verbatim, its name, or a one-word keyword. */
function claims(request) {
  const text = ` ${normalize(request)} `;
  const words = normalize(request).split(' ').filter(meaningful);
  const phrase = allWords().find((k) => k.includes(' ') && k.split(' ').some(meaningful) && text.includes(` ${k} `));
  const named = ['venture plan', 'venture-plan'].some((name) => text.includes(` ${normalize(name)} `));
  const keyword = allWords().find((k) => !k.includes(' ') && meaningful(k) && words.some((w) => meets(w, k)));
  return phrase || (named && 'name') || keyword || null;
}

test('the manifest and each persona declare the same routing words (the kernel reads both)', () => {
  for (const bot of declared()) assert.deepEqual(bot.manifest, bot.persona, bot.name);
});

test('no one-word keyword reads as a word people use about the assistant, and no phrase carries a number word', () => {
  for (const keyword of allWords()) {
    if (!keyword.includes(' ')) {
      for (const word of ASSISTANT_WORDS) assert.ok(!meets(word, keyword), `"${keyword}" meets "${word}"`);
    }
    for (const word of keyword.split(' ')) assert.ok(!NUMBER_WORDS.includes(word), `"${keyword}" carries "${word}"`);
  }
});

test('a general question about the workspace claims no Venture Plan bot', () => {
  for (const request of [
    'In one short sentence, what workspace tools can you coordinate here?',
    'What tools do you have?',
    'List the tools you can use here',
    'In one sentence, tell me what you can do',
  ]) assert.equal(claims(request), null, request);
});

test('the questions Venture Plan answers still claim it', () => {
  for (const [request, by] of [
    ['How much will tooling cost for an injection mold?', 'tooling cost'],
    ['What is the unit cost to make a phone case?', 'unit cost'],
    ['What would it cost to make one of these?', 'what would it cost to make'],
    ['What parts do I need for a bluetooth speaker?', 'what parts'],
    ["What's the landed cost and import duty?", 'landed cost'],
    ['How long is the lead time for mold tooling?', 'lead time'],
  ]) assert.equal(claims(request), by, request);
});

test('each analyst persona scopes its JSON output contract to prompts carrying Schema: and answers conversational questions in plain sentences', () => {
  for (const file of ['personas/venture-bom-analyst.yaml', 'personas/venture-market-analyst.yaml', 'personas/venture-ops-analyst.yaml']) {
    const persona = yaml.load(fs.readFileSync(path.join(PKG, file), 'utf8')) || {};
    const text = String(persona.perspective || '');
    assert.match(text, /`Schema:`/, `${file} names the Schema: prompt marker used by venture-bots.ts`);
    assert.match(text, /conversational question[\s\S]*plain sentences/i, `${file} instructs plain sentences for conversational hand-offs without Schema:`);
    assert.doesNotMatch(text, /^  ## Output contract — emit EXACTLY this JSON and nothing else$/m, `${file} no longer demands raw JSON unconditionally`);
  }
});
