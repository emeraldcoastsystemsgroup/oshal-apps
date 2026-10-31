/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 2: right after "I have noted your peanut allergy" the Eats concierge suggested "a Vegetarian Pad Thai" with no warning. Through the COMPILED chat route with a scripted concierge: a remembered or stated peanut allergy holds the conflicting candidates back from the prompt and the cards while a safe one is still offered; the demo's own reply comes back with an allergy-check line naming Pad Thai and peanuts, saved with the reply; a reply that names the risk itself gets no line; with no restriction nothing is held.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard generic nut allergy phrasing ('I have a nut allergy', 'allergic to nuts', 'tree nuts', 'no nuts' -> peanuts + tree nuts) and recommendations that name the allergen without warning vs explicit warnings.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: the candidates are real restaurants (Google Places), not menu dishes. A restaurant whose name carries the allergen or a dish usually made with it (Pad Thai Kitchen, Peanut Palace) is held back from the prompt, the cards and any proposal; the prompt still states the restrictions as facts so the concierge checks the dishes it names from general knowledge; the check line on the reply is unchanged.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePlaces, loadRoutes, authed, call } = require('./eats-routes-harness');
const ADDRESS = '1 Synthetic Way, Pensacola';
/** Four Thai places near the address, two of them named for peanut dishes. */
const place = (id, name) => ({ id, displayName: { text: name }, formattedAddress: '1 Synthetic St', location: { latitude: 30.43, longitude: -87.21 }, types: ['thai_restaurant', 'restaurant'], primaryTypeDisplayName: { text: 'Thai restaurant' }, rating: 4.5, userRatingCount: 40, delivery: true });
const THAI = [place('ChIJ-padthai', 'Pad Thai Kitchen'), place('ChIJ-peanut', 'Peanut Palace'), place('ChIJ-thai-garden', 'Thai Garden'), place('ChIJ-curry', 'Green Curry House')];
const thaiPlaces = () => fakePlaces({ search: () => ({ places: THAI }) });
/** The demo's own concierge reply (demo sweep 2, d2-3/concierge-a.json), trimmed to its two decisive sentences. */
const DEMO_REPLY = 'I have noted your peanut allergy. While I cannot pull live menu data, I can still suggest a vegetarian dinner idea based on general knowledge. For example, a Vegetarian Pad Thai or a Margherita Pizza with extra vegetables are popular choices.';

test('a remembered peanut allergy holds peanut-named restaurants back from the prompt, the cards and any proposal', async () => {
  const reply = { say: 'Try these.', show: ['ChIJ-padthai', 'ChIJ-peanut', 'ChIJ-thai-garden'], remember: [], order: 'ChIJ-padthai' };
  const { handlers, prompts } = loadRoutes({ places: thaiPlaces(), notes: ['peanut allergy'], reply });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'Suggest a vegetarian dinner from a Thai place', location: ADDRESS } }));
  assert.equal(res.statusCode, 200);
  const candidates = prompts[0].split('CANDIDATES (real, from Google Places')[1].split('DINER PROFILE')[0];
  assert.doesNotMatch(candidates, /ChIJ-padthai|ChIJ-peanut/, 'a peanut-named place is never offered to the concierge');
  assert.match(candidates, /ChIJ-thai-garden/);
  assert.match(candidates, /ChIJ-curry/);
  assert.match(prompts[0], /DINER ALLERGIES AND DIET[\s\S]*- peanuts: avoid dishes with peanuts, such as Pad Thai, satay/);
  assert.match(prompts[0], /HELD BACK BY THE SERVER[^\n]*Pad Thai Kitchen \(peanuts\); Peanut Palace \(peanuts\)/);
  assert.deepEqual(res.body.cards.map((c) => c.placeId), ['ChIJ-thai-garden'], 'the cards show only the place without peanuts in its name');
  assert.equal(res.body.proposal, null, 'a held place is never proposed for a hand-off');
  assert.deepEqual(res.body.allergy.restrictions, ['peanuts', 'a vegetarian diet']);
  assert.deepEqual(res.body.allergy.heldBack.map((h) => h.dish), ['Pad Thai Kitchen', 'Peanut Palace']);
});

test("the demo's Pad Thai reply after a stated peanut allergy comes back with an allergy-check line, saved with the reply", async () => {
  const { handlers, store, prompts } = loadRoutes({ reply: { say: DEMO_REPLY } });
  const message = 'I am allergic to peanuts. Suggest a vegetarian dinner for tonight and tell me what this screen can and cannot do for ordering it.';
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, DEMO_REPLY, "the concierge's words are not rewritten");
  assert.equal(res.body.allergy.check, 'Allergy and diet check: Pad Thai usually contains peanuts (you avoid peanuts). Ask the restaurant before ordering it.');
  assert.match(prompts[0], /DINER ALLERGIES AND DIET/, 'with no address (no search) the prompt still states the allergy as a fact');
  const saved = store().messages.filter((m) => m.role === 'assistant').map((m) => m.content);
  assert.deepEqual(saved, [`${DEMO_REPLY}\n${res.body.allergy.check}`], 'a resumed conversation still shows the check');
});

test('a reply that names the risk in the same sentence gets no check line', async () => {
  const say = 'Pad Thai usually has peanuts, so ask for it without peanuts, or try fresh spring rolls instead.';
  const { handlers } = loadRoutes({ notes: ['allergic to peanuts'], reply: { say } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'dinner ideas?' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.allergy.check, '');
  assert.deepEqual(res.body.allergy.restrictions, ['peanuts']);
});

test('with no restriction nothing is held and the peanut-named places are offered', async () => {
  const { handlers, prompts } = loadRoutes({ places: thaiPlaces(), reply: { say: 'ok', show: ['ChIJ-padthai'], remember: [], order: null } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'thai tonight', location: ADDRESS } }));
  assert.match(prompts[0], /ChIJ-padthai \| Pad Thai Kitchen/);
  assert.deepEqual(res.body.cards.map((c) => c.placeId), ['ChIJ-padthai']);
  assert.deepEqual(res.body.allergy.heldBack, []);
});

test('generic nut phrasing covers peanuts and tree nuts, and recommending an allergen-named dish still gets a check line', async () => {
  const check = require('../routes/allergen-check.js');
  for (const phrase of ['I have a nut allergy', 'allergic to nuts', 'tree nuts', 'no nuts']) {
    assert.deepEqual(check.dinerRestrictions([phrase]).map((r) => r.id), ['peanut', 'tree-nut'], `expected peanut + tree-nut restriction for "${phrase}"`);
  }
  const peanutRestrictions = check.dinerRestrictions(['I have a nut allergy']);
  for (const rec of ['Try the Thai Peanut Noodles.', 'Try the pad see ew with peanut sauce on the side.']) {
    const line = check.allergyCheckLine(check.unwarnedMentions(rec, peanutRestrictions));
    assert.match(line, /^Allergy and diet check: .* usually contains peanuts \(you avoid peanuts\)/, `expected check line for "${rec}"`);
  }
  assert.equal(check.allergyCheckLine(check.unwarnedMentions('Pad Thai usually contains peanuts.', peanutRestrictions)), '', 'explicit warning sentence gets no check line');
});
