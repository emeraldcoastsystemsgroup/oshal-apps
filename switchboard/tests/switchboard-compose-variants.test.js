/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard: a comms-bot refusal never lands in a variant's text. Live 2026-10-11 the Streams "Draft per-platform variants" wrote "I can't draft the post without the underlying content…" (LinkedIn) and "I cannot publish to Facebook from this environment." (Facebook) into the post variants. Drives the COMPILED POST /compose/variants handler with a recording bot double (the framework @/ modules stubbed, the variant reader real) and checks the Compose and Streams pages handle failed:'bot_declined'. Red on the previous route, which stored the reply verbatim.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The answer shape is plain text with a DECLINED line (the bot refused the JSON format live); the DECLINED line is a decline, a JSON answer is still read.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guard: a post that opens "I can't help but…", "Unable to make it…?" or "I won't share…" is a rewrite. The reader declined them (any "can't/won't/unable to" + help/make/share/post) and Compose told the person the bot had not written the post. Refusals of the drafting task itself (and the help-with-that, request-shaped ones) stay declines.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard: real posts that say "cannot" or "publish" legitimately keep their text. "I cannot publish this without thanking the team: the new board is live.", "I can't write a better post than this one…", "Unable to publish on LinkedIn from your phone? …", a post with a hashtag or a link, a post opening "Declined: …" and a JSON answer with text and no ok came back as failed:'bot_declined' and Compose said the bot had not written the post. Red on d14f9171. The live refusals, against the live placeholder source and against a real one, stay declines.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Guard: a refusal that names the author's topic stays a decline. The reader counted the source's topic words anywhere in the reply, so "I can't write a post about the ticket board without knowing what changed." (BOARD_SOURCE), "I can't write a hiring post from a single word…" ('Hiring'), the placeholder-quoting refusal (SOURCE) and refusals quoting the source's link came back as editable variants. Red on db889468 (every case), green now; posts whose own words carry the topic, a new hashtag or a link stay rewrites.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Guard: every variant prompt (X, LinkedIn and the rest) tells the bot to keep the source's facts, numbers and claims and add none (sweep 7: the LinkedIn variant turned 'fixed the concierge answers' into '15 app layouts. 1 concierge fix.').
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'switchboard-compose-routes.js');

/**
 * @description Load the compiled compose router with a bot double answering per platform.
 * @param {Record<string,string>} replies The bot's reply keyed by platform (from the turn's taskId).
 * @returns {{handler: Function, prompts: string[]}} The POST /variants handler and the prompts the bot saw.
 */
function loadVariants(replies) {
  const prompts = [];
  const handlers = new Map();
  const router = { get() { return router; }, post(p, h) { handlers.set(p, h); return router; }, use() { return router; } };
  const stubs = {
    express: { Router: () => router },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (_ctx, _client, _agent, opts) => {
        prompts.push(opts.text);
        const platform = /variant-([a-z]+)-/.exec(opts.taskId)[1];
        return { response: replies[platform] };
      },
    },
    '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
    '@/features/video-generation': { resolveStoryboardImageProvider: async () => null, recordStoryboardImageCost: async () => {} },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) { return Object.hasOwn(stubs, request) ? stubs[request] : original.call(this, request, ...rest); };
  try {
    delete require.cache[ROUTE_FILE];
    require(ROUTE_FILE).createComposeRoutes({ appPackageDir: PKG, pool: { query: async () => ({ rows: [] }) } });
  } finally {
    Module._load = original;
  }
  return { handler: handlers.get('/variants'), prompts };
}

/** @description Call a handler and collect its answer. @param {Function} handler Route. @param {object} body Body. @returns {Promise<{status:number, body:any}>} Answer. */
async function call(handler, body) {
  const out = { status: 200, body: null };
  const res = { status(code) { out.status = code; return res; }, json(b) { out.body = b; return res; } };
  await handler({ body, oidc: { user: { sub: 'person-1' } } }, res);
  return out;
}

const SOURCE = 'sweep5 test draft - not for publishing.';
const REFUSALS = {
  linkedin: "I can't draft the post without the underlying content. Share the draft or key points and I'll write it.",
  facebook: 'I cannot publish to Facebook from this environment.',
};

test('a plain-text refusal from the bot never becomes a variant text', async () => {
  const { handler, prompts } = loadVariants({ ...REFUSALS, x: 'Test draft.' });
  const r = await call(handler, { text: SOURCE, platforms: ['x', 'linkedin', 'facebook'] });
  assert.equal(r.status, 200);
  const byPlatform = Object.fromEntries(r.body.variants.map((v) => [v.platform, v]));
  for (const platform of ['linkedin', 'facebook']) {
    assert.equal(byPlatform[platform].failed, 'bot_declined');
    assert.equal(byPlatform[platform].text, undefined, `${platform} carries no editable text`);
    assert.equal(byPlatform[platform].notice, REFUSALS[platform]);
  }
  assert.equal(byPlatform.x.text, 'Test draft.');
  assert.equal(byPlatform.x.failed, undefined);
  for (const v of r.body.variants) assert.doesNotMatch(String(v.text ?? ''), /I can(no|')t|cannot publish/);
  assert.ok(prompts.every((p) => p.includes('DECLINED: <one sentence why>')), 'every prompt names the decline line');
});

test('a JSON answer is still read: a rewrite is the text, ok:false is a decline with its reason', async () => {
  const { handler } = loadVariants({
    x: '{"ok": true, "text": "Open work now fits on one phone screen."}',
    linkedin: '```json\n{"ok": false, "reason": "The text has no content to adapt."}\n```',
    facebook: '{"ok": true, "text": "I cannot publish to Facebook from here."}',
  });
  const r = await call(handler, { text: 'We shipped a faster ticket board.', platforms: ['x', 'linkedin', 'facebook'] });
  const byPlatform = Object.fromEntries(r.body.variants.map((v) => [v.platform, v]));
  assert.equal(byPlatform.x.text, 'Open work now fits on one phone screen.');
  assert.deepEqual([byPlatform.linkedin.failed, byPlatform.linkedin.notice, byPlatform.linkedin.text],
    ['bot_declined', 'The text has no content to adapt.', undefined]);
  assert.equal(byPlatform.facebook.failed, 'bot_declined', 'a refusal wrapped as ok:true is still a decline');
  assert.equal(byPlatform.facebook.text, undefined);
});

test('the DECLINED line is a decline with its reason; a plain post is the text', async () => {
  const { handler } = loadVariants({ x: 'DECLINED: The text is a bare placeholder.', linkedin: 'Open work now fits on one phone screen.' });
  const r = await call(handler, { text: SOURCE, platforms: ['x', 'linkedin'] });
  const byPlatform = Object.fromEntries(r.body.variants.map((v) => [v.platform, v]));
  assert.deepEqual([byPlatform.x.failed, byPlatform.x.notice, byPlatform.x.text], ['bot_declined', 'The text is a bare placeholder.', undefined]);
  assert.equal(byPlatform.linkedin.text, 'Open work now fits on one phone screen.');
});

test('a post that opens with "I can\'t believe" is a rewrite, not a decline', async () => {
  const { handler } = loadVariants({ x: "I can't believe how fast the new board is." });
  const r = await call(handler, { text: 'The new board is fast.', platforms: ['x'] });
  assert.equal(r.body.variants[0].text, "I can't believe how fast the new board is.");
});

/** @description Drive one X variant through the compiled route. @param {string} reply The bot's reply. @param {string} [text] The author's text. @returns {Promise<object>} The variant. */
async function oneVariant(reply, text = 'The new board is live.') {
  const { handler } = loadVariants({ x: reply });
  const r = await call(handler, { text, platforms: ['x'] });
  return r.body.variants[0];
}

test('a post that opens like a refusal of something else is a rewrite, not a decline', async () => {
  const posts = [
    "I can't help but smile at how fast the new board loads. #shipping",
    'Unable to make it to DevCon? Watch the replay here.',
    "I won't share every detail yet, but the new board is live.",
    "I can't post a photo of the board yet, but it is live.",
    "Sorry, I can't make it tonight - the new board is live, though.",
    "I cannot create enough hours in the day, so we built a faster board.",
  ];
  for (const post of posts) {
    const v = await oneVariant(post);
    assert.deepEqual([v.failed, v.text], [undefined, post], `a rewrite: ${post}`);
  }
});

test('a refusal of the drafting task itself is still a decline', async () => {
  const refusals = [
    "I can't draft the post without the underlying content.",
    'I cannot publish to LinkedIn from this environment.',
    "Sorry, I can't help with that.",
    "I'm unable to rewrite this text: it is a placeholder.",
    'Unable to write a post from an empty draft.',
    "I won't create content for this request.",
    'I am not able to complete this request.',
  ];
  for (const refusal of refusals) {
    const v = await oneVariant(refusal);
    assert.deepEqual([v.failed, v.text, v.notice], ['bot_declined', undefined, refusal], `a decline: ${refusal}`);
  }
});

const BOARD_SOURCE = 'We shipped the new ticket board today: open work now fits on one phone screen.';

test('a real post that says "cannot" or "publish" legitimately keeps its text', async () => {
  const posts = [
    'I cannot publish this without thanking the team: the new ticket board is live and open work fits on one phone screen.',
    "I can't write a better post than this one: the new ticket board shipped today.",
    "I won't post to LinkedIn about anything else this week. The new ticket board is here.",
    'Unable to publish on LinkedIn from your phone? The new board fixes that.',
    'Unable to write copy that converts? Start with a board your team can read.',
    "I can't draft a single status update without opening five tabs. Not anymore. #productivity",
    'I cannot create content fast enough to keep up, so we built this: https://example.com/board',
    'We cannot wait for you to try it. Publish day is today: the new ticket board is live.',
    'Declined: three vendor pitches. Accepted: one ticket board that fits on a phone.',
  ];
  for (const post of posts) {
    const v = await oneVariant(post, BOARD_SOURCE);
    assert.deepEqual([v.failed, v.text], [undefined, post], `kept as the post: ${post}`);
  }
  const json = await oneVariant('{"text": "I cannot publish this without thanking the team behind the new ticket board."}', BOARD_SOURCE);
  assert.equal(json.text, 'I cannot publish this without thanking the team behind the new ticket board.', 'a JSON text with no ok:false is the post');
});

test('a refusal of the drafting task stays a decline against a real source text too', async () => {
  const refusals = [
    "I can't draft the post without the underlying content. Share the draft or key points and I'll write it.",
    'I cannot publish to Facebook from this environment.',
    "I'm unable to rewrite this text: it is a placeholder.",
    "I can't write a post about the board without more details.",
    'Unable to write a post from an empty draft.',
  ];
  for (const source of [SOURCE, BOARD_SOURCE]) {
    for (const refusal of refusals) {
      const v = await oneVariant(refusal, source);
      assert.deepEqual([v.failed, v.text, v.notice], ['bot_declined', undefined, refusal], `a decline of ${JSON.stringify(source)}: ${refusal}`);
    }
  }
  const sentinel = await oneVariant('DECLINED: The text is a bare placeholder.', SOURCE);
  assert.deepEqual([sentinel.failed, sentinel.notice], ['bot_declined', 'The text is a bare placeholder.']);
});

test('a refusal that names the author\'s topic, quotes the text or quotes its link is still a decline', async () => {
  const cases = [
    [BOARD_SOURCE, "I can't write a post about the ticket board without knowing what changed."],
    [BOARD_SOURCE, "I can't draft this post: I need more details about the ticket board before I write it."],
    ['Hiring', "I can't write a hiring post from a single word. Share the role and location."],
    ['launch', 'I cannot create a post from just the word launch. Tell me what is launching and when.'],
    ['launch', "I can't write a post about launch. Launch of what?"],
    [SOURCE, 'I can\'t draft the post without the underlying content: "sweep5 test draft" is a placeholder.'],
    [SOURCE, 'I cannot publish this: the text says it is not for publishing and is only a sweep5 test.'],
    [SOURCE, 'I can\'t write a post from “sweep5 test draft”.'],
    ['Check out https://example.com/new', "I can't write a post about https://example.com/new without knowing what is on the page."],
    ['Check out https://example.com/new', "I can't write a post from just a link: https://example.com/new"],
  ];
  for (const [source, refusal] of cases) {
    const v = await oneVariant(refusal, source);
    assert.deepEqual([v.failed, v.text, v.notice], ['bot_declined', undefined, refusal], `a decline of ${JSON.stringify(source)}: ${refusal}`);
  }
});

test('a post that opens like a refusal keeps its text when its own words carry the topic, a new hashtag or link', async () => {
  const cases = [
    ['Check out https://example.com/new', "I can't write a better post than this: the new release is out at https://example.com/new"],
    ['Hiring', "I can't write a better hiring post than this: we are hiring two engineers. #hiring"],
    [BOARD_SOURCE, "I can't write a post about the ticket board that does it justice: open work now fits on one phone screen."],
  ];
  for (const [source, post] of cases) {
    const v = await oneVariant(post, source);
    assert.deepEqual([v.failed, v.text], [undefined, post], `kept as the post of ${JSON.stringify(source)}: ${post}`);
  }
});

test('the Compose and Streams pages keep a declined variant out of the editor and say why', () => {
  const compose = fs.readFileSync(path.join(PKG, 'tools', 'switchboard-compose.html'), 'utf8');
  assert.match(compose, /var declined = v\.failed==="bot_declined";/);
  assert.match(compose, /if\(declined\) showRes\(card, false, declinedMessage\(b\.label, v\.notice\)\);/);
  assert.match(compose, /if\(v && v\.failed==="bot_declined"\)\{\s*showRes\(card,false, declinedMessage/);
  const streams = fs.readFileSync(path.join(PKG, 'tools', 'switchboard-streams.html'), 'utf8');
  assert.match(streams, /if\(v\.failed==="bot_declined"\)\{ declined\.push/);
  assert.match(streams, /edErr\("The bot did not write "/);
});

test('every variant prompt keeps the source facts and adds none', async () => {
  const master = 'This week the team fixed the concierge answers and the phone layouts. Thanks to everyone who reported issues.';
  const { handler, prompts } = loadVariants({ x: 'Concierge answers and phone layouts fixed this week.', linkedin: 'This week the team fixed the concierge answers.', facebook: 'Fixed: concierge answers and phone layouts.' });
  const r = await call(handler, { text: master, platforms: ['x', 'linkedin', 'facebook'] });
  assert.equal(r.status, 200);
  assert.equal(prompts.length, 3);
  for (const p of prompts) {
    assert.match(p, /Keep every fact, number, name and claim exactly as the source states it\./);
    assert.match(p, /Add no fact, count, result or claim the source does not make/);
    assert.match(p, /If the source gives no number, the post gives none\./);
    assert.ok(p.endsWith(master), 'the master text is the source the rule refers to');
  }
});
