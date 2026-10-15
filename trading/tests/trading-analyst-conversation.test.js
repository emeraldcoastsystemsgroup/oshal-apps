/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | trading-analyst answers Jarvis hand-offs in the conversation as well as decision tickets. Its persona told it to answer EVERYTHING with one json decision block, so "how did our stocks do last week?" came back as {"action":"hold",...} and Jarvis read it out as "there is code on screen". The json contract is now scoped to tasks that supply a decision contract, conversation gets prose from the desk's own read tools, and those tools are authorized. Run: node --test tests/trading-analyst-conversation.test.js
 * 2 | maintainer@emeraldcoastsystemsgroup.com | "Last week" needs the period read the Performance tile already uses: the new trading_performance tool reads GET /api/trading/performance for a closed set of periods and is authorized for the bot.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Jarvis routes "how did our stocks do last week?" to this bot only on a strong claim: one keyword ('stock') was too weak, so the persona declares possessive portfolio phrases.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A question that names a ticker ("Should I buy NVDA?") is still conversation: live, the analyst answered in prose and then appended a json decision object. The persona says so in words and forbids the appended template, and the facts are spoken in plain words, never by their key names.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Live after 4, "Should I buy NVDA right now?" came back in prose but about the bot's instructions: "According to my rules ... I cannot generate the required decision tree ... share it in the Intelligent Trades screen (`/api/trading/`)". The persona forbids quoting its rules, the contract or a decision tree, and any URL or route path, and names screens by title.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The Intelligent Trades concierge opened on futures-research-analyst: the manifest declared no chatBot, so the cockpit took the first declared bot, which answers a conversation with a json futures study. The manifest declares chatBot: trading-analyst, a bot it declares, and Jarvis's money words (finance, net worth, budget) stay Finance's, not the desk's.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: a plain question got "Decision: HOLD | Reasoning: ... | Confidence: 1". The decision tree is scoped to a decision task in the opening, and a conversational answer carries no decision labels, verdict or confidence.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'trading-analyst.yaml'), 'utf8');
const authorizations = persona.split('\nauthorizations:\n')[1].split('\n\n')[0];
const perspective = persona.split('\nperspective: |\n')[1];

test('the json decision block is required only when the task supplies a decision contract', () => {
  assert.doesNotMatch(perspective, /Your structured decision IS the deliverable\. Answer with exactly one fenced/);
  assert.match(perspective, /When the task hands you signals and a decision contract, your structured decision IS the\s+deliverable/);
});

test('a conversational question is answered in prose, never as a json decision', () => {
  assert.match(perspective, /When a person asks you a question in conversation/);
  assert.match(perspective, /Never answer a conversational question with a json\s+decision block/);
});

test('every read tool the conversational answer names is authorized for the bot', () => {
  for (const tool of ['trading_status', 'trading_positions', 'trading_book_facts', 'trading_performance']) {
    assert.match(perspective, new RegExp(tool));
    assert.match(authorizations, new RegExp(`^  ${tool}: "auto"$`, 'm'), `${tool} is not authorized`);
  }
});

test('the performance tool reads the owner-scoped Performance route for a closed set of periods', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = manifest.split('\n  - name: trading_performance\n')[1].split('\n  - name: ')[0];
  assert.match(block, /apiEndpoint: "GET \/api\/trading\/performance\?period=\{input\.period\}"/);
  assert.match(block, /requiresApproval: false/);
  assert.match(block, /enum: \["1W", "1M", "3M", "1Y"\]/);
});

test('portfolio questions carry a declared phrase so Jarvis routes them here with a strong claim', () => {
  const keywords = persona.split('\nrouting_keywords:\n')[1].split('\n\n')[0];
  for (const phrase of ['my stocks', 'our stocks', 'my portfolio', 'our portfolio', 'stock performance', 'paper book']) {
    assert.match(keywords, new RegExp(`^  - ${phrase}$`, 'm'), `${phrase} is not a routing phrase`);
  }
});

test('a question naming a ticker is conversation: no appended json decision, no fact key names', () => {
  assert.match(perspective, /"Should I buy NVDA\?"/);
  assert.match(perspective, /never append a json block, a decision template or\s+a decision object/);
  assert.match(perspective, /never by their key\s+names \(no "paper\.present"/);
});

test('the analyst talks to the person, not about its instructions or routes', () => {
  assert.match(perspective, /never quote your rules, the decision\s+contract or a "decision tree", and never give a URL or route path/);
  assert.match(perspective, /name a screen by its title\s+\(the Research tab of Intelligent Trades\)/);
});

test('the app concierge is the conversational analyst, and money words stay with Finance', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /^chatBot: trading-analyst$/m);
  assert.match(manifest, /^  - agentId: [0-9a-f-]+\n    name: trading-analyst$/m, 'chatBot names a bot this app declares');
  const keywords = persona.split('\nrouting_keywords:\n')[1].split('\n\n')[0];
  for (const word of ['finance', 'finances', 'my finance', 'my money', 'net worth', 'budget', 'spending', 'my accounts']) {
    assert.doesNotMatch(keywords, new RegExp(`^  - ${word}$`, 'm'), `${word} belongs to Finance`);
  }
});

test('a conversational answer carries no decision form, and the decision tree belongs to a decision task (sweep 12)', () => {
  assert.match(perspective, /A conversational answer has no decision form in any shape: no "Decision:", "Reasoning:" or\s+"Confidence:" line, no HOLD, BUY or SELL verdict and no confidence number/);
  const opening = perspective.slice(0, perspective.indexOf('## Rules'));
  assert.match(opening, /A person's\s+question in conversation is answered in plain sentences/);
  assert.match(opening, /for that task only, you decide whether a signal warrants a trade/);
});
