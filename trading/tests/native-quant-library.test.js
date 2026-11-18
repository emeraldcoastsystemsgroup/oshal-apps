/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (lane QUANTLIB1; Roger 2026-11-17: "does the quant have finance books and finance research papers loaded in its rag"): the quant reads the quant library through the engine's knowledge rail. Trades (no authorization catalog) imports Print's tenant shelf and the person's own Private to me filings, read only, into trading-concierge, in the exact shape kernel K1 admits and Print exports; the shelf Print files holds real texts and records whose every licence passes the shelf check (a full text without an allowing licence is refused, as are a missing citation line and an over-long passage); the fixed questions bring a passage of the right work into the top three under the kernel's own lexical ranking; and the persona cites what recall brought.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.62.2: one citation grade serves the live proof and the bot-fast replay (tests/live/quant-library-questions.mjs): a reply cites a work when it names its title and one of its authors, and a summary only when it says so; a link alone, an author and a year alone, or a work for another idea do not count, and both callers import it. The persona's source line, filled from every shelf work's own QUANT LIBRARY line, passes that grade; the persona's 1.62.2 library rules are checked word for word (the source line, the summary sentence, the source lines last, only what this turn recalled).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve every library declaration/citation guard and the exact legacy digest while excluding newer quant research from every supported authority version while retaining the original factor module.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const yamlRoots = [__dirname, path.resolve(store, 'scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [path.resolve(process.env.OSHAL_FRAMEWORK)] : [])];
const yaml = require(require.resolve('js-yaml', { paths: yamlRoots }));
const { readShelf, checkShelf } = require('../../print-ingest/shelves/shelf-check.cjs');
const { stored, lexical, grade } = require('../../print-ingest/shelves/shelf-retrieval.cjs');

const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const print = yaml.load(fs.readFileSync(path.join(store, 'print-ingest/oshal-app.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(root, 'personas/trading-concierge.yaml'), 'utf8'));
const shelfDir = path.join(store, 'print-ingest/shelves/quant-library');
const shelf = readShelf(shelfDir);
const BOT = { app: 'intelligent-trades', name: 'trading-concierge' };

test('the trading concierge imports Print\'s quant library and the person\'s own shelf, read only, as K1 admits', () => {
  assert.equal(manifest.name, 'intelligent-trades');
  assert.equal(manifest.authorization, undefined, 'Trades is the tier model: imports only, never an owning binding');
  assert.ok(manifest.uses.includes('rag'), 'uses: rag');
  assert.ok(manifest.dependencies.optional.apps.includes('print-ingest'), 'Print is an optional dependency');
  assert.ok(!manifest.dependencies.required.apps.includes('print-ingest'), 'never required: Trades loads without Print');
  assert.deepEqual(manifest.ragBindings.map((b) => [b.alias, b.collection, b.scope, b.resource]),
    [['quant-library', 'quant-library', 'tenant', 'rag.bot'], ['my-knowledge', 'my-knowledge', 'own', 'rag.private']]);
  const concierge = manifest.bots.find((bot) => bot.name === BOT.name);
  for (const binding of manifest.ragBindings) {
    assert.equal(binding.owner, 'print-ingest', `${binding.alias} is owned by Print, not Trades`);
    assert.deepEqual(binding.bot, BOT, `${binding.alias} feeds only trading-concierge`);
    const exported = print.ragBindings.find((held) => held.collection === binding.collection);
    assert.ok(exported, `Print exports ${binding.collection}`);
    assert.deepEqual([exported.owner, exported.scope, exported.resource], [binding.owner, binding.scope, binding.resource]);
    assert.ok(!exported.bot || (exported.bot.app === BOT.app && exported.bot.name === BOT.name), `${binding.alias}: audience matches`);
  }
  assert.equal(shelf.shelf.audience.agentId, concierge.agentId, 'the shelf names the concierge Trades declares');
  const authority = require('./support/order-authority');
  for (const [version, sources] of Object.entries(authority.preservedLegacy(root))) {
    const files = authority.closure(root, sources);
    assert.deepEqual([...files.keys()].filter((file) => file.startsWith('routes/quant/')).sort(), ['routes/quant/factors.js'], `version ${version} keeps only the original approved factor module; new quant research stays outside`);
    assert.equal(files.has('personas/trading-concierge.yaml'), false, `concierge guidance stays outside version ${version}`);
  }
  assert.ok(!manifest.tools.some((tool) => /library|rag/i.test(tool.name)), 'recall needs no tool: no new search tool');
});

test('Print exports one shelf for the concierge and declares it as an optional dependency and bot import', () => {
  const forConcierge = print.ragBindings.filter((b) => b.bot && b.bot.app === BOT.app && b.bot.name === BOT.name);
  assert.equal(forConcierge.length, 1, 'Print\'s destination id is bot:<agentId>: one shelf per bot');
  assert.deepEqual([forConcierge[0].alias, forConcierge[0].scope, forConcierge[0].resource], ['quant-library', 'tenant', 'rag.bot']);
  assert.ok(print.dependencies.optional.apps.includes('intelligent-trades'));
  assert.ok(print.dependencies.optional.bots.some((bot) => bot.app === BOT.app && bot.name === BOT.name));
  assert.ok(!print.dependencies.required.apps.includes('intelligent-trades'));
});

test('the quant library holds real texts and records, every licence checked, every idea covered', () => {
  assert.deepEqual(checkShelf(shelf), []);
  const full = shelf.works.filter((work) => work.kind === 'full-text');
  const summaries = shelf.works.filter((work) => work.kind === 'summary');
  assert.ok(full.length >= 60 && summaries.length >= 80 && shelf.documents.length >= 400, 'a real library, not a sample');
  for (const work of full) assert.match(work.licence.name, /^(CC BY \d|CC BY-SA \d|CC0 \d)/, work.id);
  const nc = shelf.works.find((work) => work.id === 'openstax-principles-finance-2e');
  assert.equal(nc.kind, 'summary', 'OpenStax Principles of Finance is CC BY-NC-SA: a summary and the link only');
  for (let idea = 1; idea <= 50; idea += 1) {
    const works = new Set(shelf.works.filter((work) => work.ideas.includes(idea)).map((work) => work.id));
    assert.ok(shelf.documents.some((doc) => works.has(doc.work)), `idea ${idea} has a passage`);
  }
  assert.equal(shelf.shelf.destination, `bot:${shelf.shelf.audience.agentId}`);
});

test('the shelf check refuses a full text without an allowing licence, a passage without its citation and an over-long one', () => {
  const copy = JSON.parse(JSON.stringify(shelf));
  const work = copy.works.find((row) => row.kind === 'full-text');
  work.licence = { ...work.licence, name: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', allowsFullText: false };
  assert.ok(checkShelf(copy).some((problem) => problem.startsWith(`${work.id}: full text needs an allowing licence`)));
  const unknown = JSON.parse(JSON.stringify(shelf));
  unknown.works.find((row) => row.id === work.id).licence = { name: 'unknown', url: '', allowsFullText: true };
  assert.ok(checkShelf(unknown).some((problem) => problem.startsWith(`${work.id}: full text needs an allowing licence`)));
  const bare = JSON.parse(JSON.stringify(shelf));
  bare.documents[0].text = bare.documents[0].text.replace(/^QUANT LIBRARY \| /, '');
  assert.ok(checkShelf(bare).some((problem) => problem.includes('does not start with its citation line')));
  const long = JSON.parse(JSON.stringify(shelf));
  long.documents[0].text += ' word'.repeat(460);
  assert.ok(checkShelf(long).some((problem) => problem.includes('over one kernel chunk')));
});

test('each fixed question brings a passage of a work that explains its idea into the top three (kernel lexical ranking)', () => {
  const { questions } = JSON.parse(fs.readFileSync(path.join(shelfDir, 'questions.json'), 'utf8'));
  assert.ok(questions.length >= 30);
  const works = new Map(shelf.works.map((work) => [work.id, work]));
  const passages = shelf.documents.map(stored);
  const result = grade(questions, works, passages, (question) => lexical(passages, question, 3));
  assert.deepEqual(result.misses, [], `${result.passed}/${questions.length}`);
  assert.ok(new Set(questions.flatMap((row) => row.ideas)).size >= 30, 'the questions span the ideas');
});

test('the persona cites what recall brought and keeps the library out of answers it does not bear on', () => {
  const p = persona.perspective;
  assert.match(p, /## The quant library \(cite it\)/);
  assert.match(p, /end your answer with one source line for each passage you used, copied from that passage's own QUANT LIBRARY line, with the title, the authors and the year exactly as the line gives them/);
  assert.match(p, /The source lines are the last lines of the answer: put any offer to run a tool, or any question, before them\./);
  assert.match(p, /After a SUMMARY source line, add: This source is a summary in our own words, not the work's text\. After a FULL TEXT source line, add its licence\./);
  assert.match(p, /an author's name or a year alone is not a citation/);
  assert.match(p, /Write a source line only for a passage in this turn's recall block\. A work you know that is not there may be named in your explanation, never on a source line\./);
  assert.match(p, /Cite only passages recalled in this turn\. Never invent a work, an author, a page, a quotation or a link\./);
  assert.match(p, /Recall brings passages on every turn, also when they do not bear on the question\. Ignore those/);
  assert.match(p, /headed `my-knowledge` comes from the person's own filed documents/);
  assert.ok(!Object.keys(persona.authorizations).some((name) => /library|rag/i.test(name)), 'no library tool is authorized');
});

test('the live proof and the bot-fast replay grade one way: title and author from the passage line, a summary said as one', async () => {
  const { citedWork, surname } = await import('./live/quant-library-questions.mjs');
  const works = shelf.works, kelly = works.find((work) => work.id === 'kelly-1956'), sharpe = works.find((work) => work.id === 'wikipedia-sharpe-ratio');
  assert.equal(kelly.kind, 'summary');
  const summaryLine = `Source: "${kelly.title}" by ${kelly.authors.join(', ')} (${kelly.year}), ${kelly.link} (this source is a summary in our own words, not the work's text)`;
  assert.equal(citedWork(summaryLine, [15], works).id, 'kelly-1956');
  assert.equal(citedWork(summaryLine.replace(/ \(this source is a summary.*\)$/, ''), [15], works), null, 'a summary must be said to be one');
  assert.equal(citedWork('As Kelly showed in 1956, bet the edge over the odds.', [15], works), null, 'an author and a year alone are not a citation');
  assert.equal(citedWork(`See ${kelly.link} (a summary).`, [15], works), null, 'a link alone is not a citation');
  assert.equal(citedWork(summaryLine, [37], works), null, 'a work counts only for the ideas it explains');
  assert.equal(citedWork(`Source: "${sharpe.title}" by Wikipedia contributors (${sharpe.year}), ${sharpe.licence.name}, ${sharpe.link}`, [8], works).id, sharpe.id);
  assert.deepEqual(['John L. Kelly Jr.', 'Marcos López de Prado', 'Wikipedia contributors'].map(surname), ['kelly', 'prado', 'wikipedia']);
  for (const file of ['live/quant-library-live.mjs', 'live/quant-library-botfast-replay.mjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, /from '\.\/quant-library-questions\.mjs'/, `${file} grades with the shared grade`);
    assert.doesNotMatch(source, /function citedWork|const LIBRARY = /, `${file} keeps no grade or question list of its own`);
  }
});

test('the persona\'s source line, filled from any shelf passage\'s own line, passes the shared grade', async () => {
  const { citedWork, plain, surname } = await import('./live/quant-library-questions.mjs');
  const p = persona.perspective;
  const template = /^\s*(Source \(<SUMMARY or FULL TEXT, as the line says>\): "<title>" by <authors> \(<year>\), <link>)$/m.exec(p)[1];
  const summarySentence = /After a SUMMARY source line, add: (This source is a summary[^.]*\.)/.exec(p)[1];
  const first = new Map();
  for (const doc of shelf.documents) if (!first.has(doc.work)) first.set(doc.work, doc.text.split('\n')[0]);
  for (const work of shelf.works) {
    const line = first.get(work.id);
    const [, kind, title, authors, year] = /^QUANT LIBRARY \| (SUMMARY|FULL TEXT)[^|]*\| "(.+?)" by (.+?) \((\d{4})\)/.exec(line);
    const link = /\| Link: (\S+)/.exec(line)[1];
    const filled = template.replace('<SUMMARY or FULL TEXT, as the line says>', kind).replace('<title>', title).replace('<authors>', authors).replace('<year>', year).replace('<link>', link);
    const cited = `${filled}${kind === 'SUMMARY' ? `\n${summarySentence}` : `, ${work.licence.name}`}`;
    assert.equal((citedWork(cited, work.ideas, [work]) || {}).id, work.id, `${work.id}: ${cited}`);
    const titleNamesAuthor = work.authors.some((name) => ` ${plain(title)} `.includes(` ${surname(name)} `));
    if (!titleNamesAuthor) assert.equal(citedWork(filled.replace(` by ${authors}`, '').replace(link, ''), work.ideas, [work]), null, `${work.id}: a title without its authors is not a citation`);
  }
});
