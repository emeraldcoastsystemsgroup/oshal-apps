/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 2: right after "I have noted your peanut allergy" the Eats concierge suggested "a Vegetarian Pad Thai" with no warning. Through the COMPILED chat route with a scripted concierge: a remembered or stated peanut allergy holds Pad Thai and a peanut dish back from the prompt, the cards and the cart while a safe dish is still offered; the demo's own reply comes back with an allergy-check line naming Pad Thai and peanuts, saved with the reply; a reply that names the risk itself gets no line; an allergy in one clause does not restrict a food liked in another; with no restriction Pad Thai is offered as before.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard generic nut allergy phrasing ('I have a nut allergy', 'allergic to nuts', 'tree nuts', 'no nuts' -> peanuts + tree nuts) and recommendations that name the allergen without warning ('Try the Thai Peanut Noodles.', 'Try the pad see ew with peanut sauce on the side.') vs explicit warnings ('Pad Thai usually contains peanuts.').
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeProvider, loadRoutes, authed, call } = require('./eats-routes-harness');

/** A Thai restaurant whose menu carries two peanut dishes and two that are usually peanut-free. */
const THAI = { storeId: 'thai-garden', name: 'Thai Garden', cuisine: 'Thai' };
const DISHES = [['th-padthai', 'Vegetarian Pad Thai', 12.5], ['th-satay', 'Tofu Peanut Satay', 9.0], ['th-rolls', 'Fresh Vegetable Spring Rolls', 6.5], ['th-curry', 'Green Curry with Vegetables', 13.0]];
const thaiProvider = () => fakeProvider({
  search: () => ({ source: 'catalog', items: [{ retailer: 'ubereats', productId: THAI.storeId, title: THAI.name, cuisine: THAI.cuisine, priceFrom: 6.5 }] }),
  menu: () => ({ source: 'catalog', storeId: THAI.storeId, store: THAI.name, items: DISHES.map(([productId, title, price]) => ({ retailer: 'ubereats', productId, storeId: THAI.storeId, title, brand: THAI.name, price })) }),
});
const refuse = () => { throw Object.assign(new Error('Uber Eats provider operation is unavailable in this native runtime'), { status: 503 }); };
const noRailProvider = () => fakeProvider({
  status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Uber Eats', reason: 'no native connector' }),
  search: refuse, menu: refuse, order: refuse,
});
/** The demo's own concierge reply (demo sweep 2, d2-3/concierge-a.json), trimmed to its two decisive sentences. */
const DEMO_REPLY = 'I have noted your peanut allergy. While I cannot pull live menu data, I can still suggest a vegetarian dinner idea based on general knowledge. For example, a Vegetarian Pad Thai or a Margherita Pizza with extra vegetables are popular choices.';

test('a remembered peanut allergy holds peanut dishes back from the prompt, the cards and the cart', async () => {
  const reply = { say: 'Try these.', show: ['th-padthai', 'th-satay', 'th-rolls'], add: [{ productId: 'th-padthai', quantity: 1 }, { productId: 'th-rolls', quantity: 1 }], remember: [], checkout: false };
  const { handlers, prompts } = loadRoutes({ provider: thaiProvider(), notes: ['peanut allergy'], reply });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'Suggest a vegetarian dinner from a Thai place' } }));
  assert.equal(res.statusCode, 200);
  const candidates = prompts[0].split('CANDIDATES (real, from search')[1].split('DINER PROFILE')[0];
  assert.doesNotMatch(candidates, /th-padthai|th-satay/, 'a peanut dish is never offered to the concierge');
  assert.match(candidates, /th-rolls/);
  assert.match(prompts[0], /DINER ALLERGIES AND DIET[\s\S]*- peanuts: avoid dishes with peanuts, such as Pad Thai, satay/);
  assert.match(prompts[0], /HELD BACK BY THE SERVER[^\n]*Vegetarian Pad Thai \(peanuts\); Tofu Peanut Satay \(peanuts\)/);
  assert.deepEqual(res.body.cards.map((c) => c.productId), ['th-rolls'], 'the cards show only the dish without peanuts');
  assert.deepEqual(res.body.added.map((a) => a.productId), ['th-rolls'], 'a held peanut dish is never added to the order');
  assert.deepEqual(res.body.allergy.restrictions, ['peanuts', 'a vegetarian diet']);
  assert.deepEqual(res.body.allergy.heldBack.map((h) => h.dish), ['Vegetarian Pad Thai', 'Tofu Peanut Satay']);
});

test("the demo's Pad Thai reply after a stated peanut allergy comes back with an allergy-check line, saved with the reply", async () => {
  const { handlers, store, prompts } = loadRoutes({ provider: noRailProvider(), reply: { say: DEMO_REPLY } });
  const message = 'I am allergic to peanuts. Suggest a vegetarian dinner for tonight and tell me what this screen can and cannot do for ordering it.';
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, DEMO_REPLY, "the concierge's words are not rewritten");
  assert.equal(res.body.allergy.check, 'Allergy and diet check: Pad Thai usually contains peanuts (you avoid peanuts). Ask the restaurant before ordering it.');
  assert.match(prompts[0], /DINER ALLERGIES AND DIET/, 'with no rail the prompt still states the allergy as a fact');
  const saved = store().messages.filter((m) => m.role === 'assistant').map((m) => m.content);
  assert.deepEqual(saved, [`${DEMO_REPLY}\n${res.body.allergy.check}`], 'a resumed conversation still shows the check');
});

test('a reply that names the risk in the same sentence gets no check line', async () => {
  const say = 'Pad Thai usually has peanuts, so ask for it without peanuts, or try fresh spring rolls instead.';
  const { handlers } = loadRoutes({ provider: noRailProvider(), notes: ['allergic to peanuts'], reply: { say } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'dinner ideas?' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.allergy.check, '');
  assert.deepEqual(res.body.allergy.restrictions, ['peanuts']);
});

test('generic nut phrasing covers peanuts and tree nuts, and recommending an allergen-named dish still gets a check line', async () => {
  const check = require('../routes/allergen-check.js');
  for (const phrase of ['I have a nut allergy', 'allergic to nuts', 'tree nuts', 'no nuts']) {
    assert.deepEqual(
      check.dinerRestrictions([phrase]).map((r) => r.id),
      ['peanut', 'tree-nut'],
      `expected peanut + tree-nut restriction for "${phrase}"`,
    );
  }
  const peanutRestrictions = check.dinerRestrictions(['I have a nut allergy']);
  for (const rec of ['Try the Thai Peanut Noodles.', 'Try the pad see ew with peanut sauce on the side.']) {
    const line = check.allergyCheckLine(check.unwarnedMentions(rec, peanutRestrictions));
    assert.match(line, /^Allergy and diet check: .* usually contains peanuts \(you avoid peanuts\)/, `expected check line for "${rec}"`);
  }
  assert.equal(
    check.allergyCheckLine(check.unwarnedMentions('Pad Thai usually contains peanuts.', peanutRestrictions)),
    '',
    'explicit warning sentence gets no check line',
  );
  const { handlers } = loadRoutes({ provider: noRailProvider(), reply: { say: 'Try the Thai Peanut Noodles.' } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'I have a nut allergy. What should I get?' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.allergy.restrictions, ['peanuts', 'tree nuts']);
  assert.match(res.body.allergy.check, /Allergy and diet check: Peanut usually contains peanuts \(you avoid peanuts\)/);
});

test('an allergy in one clause does not restrict a food liked in another, and no restriction offers Pad Thai as before', async () => {
  const check = require('../routes/allergen-check.js');
  assert.deepEqual(check.dinerRestrictions(["I'm allergic to peanuts, but I love shrimp"]).map((r) => r.id), ['peanut']);
  assert.deepEqual(check.dinerRestrictions(['loves peanut noodles']), [], 'liking a food is not an allergy');
  assert.deepEqual(check.dishConflicts('Peanut-free Pad Thai', check.dinerRestrictions(['peanut allergy'])), [], 'a dish that says it is peanut-free passes');
  const { handlers, prompts } = loadRoutes({ provider: thaiProvider(), reply: { say: 'Pad Thai is a great pick.', show: ['th-padthai'] } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'Thai food please' } }));
  assert.deepEqual(res.body.cards.map((c) => c.productId), ['th-padthai']);
  assert.equal(res.body.allergy.check, '');
  assert.deepEqual(res.body.allergy.heldBack, []);
  assert.doesNotMatch(prompts[0], /DINER ALLERGIES AND DIET/);
});
