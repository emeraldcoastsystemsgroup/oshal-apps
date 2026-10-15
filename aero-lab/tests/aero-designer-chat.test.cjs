/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Draft with AI drafts against the person's own design, through the real compiled
 *   POST /api/aero-lab/chat route and the real surface script. The page posted {message, history} with no design, the route
 *   validated {} into the defaults and told the model the R7 Sweep Winner was the current design (it answered about that preset
 *   with the Tier-1 sketch loaded), a partial draft was filled from those defaults, the reply's deliberation was shown when the
 *   JSON did not parse whole, and a draft lowering battery mass shipped beside advice to raise it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: asked for "a cloudy day at 47N in October", the draft kept day 195
 *   (midsummer). The named site and season reach the prompt as the mission, and a draft that kept another day is held to
 *   the named one with the reply saying so; the persona states what min SOC and usable margin mean.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Review of sweep 6: "May I get a craft ... October" drafted day 135 (May
 *   matched before October in calendar order), "March to October" held the earlier month, and "winter at 35S" was held to
 *   day 355 (southern midsummer). The month the person names is read where it appears, "May" counts only as a date,
 *   two named months hold no day, and seasons follow the hemisphere of the named or current latitude.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: replies said "I have drafted an increase in battery_mass_kg" and "I
 *   have updated the site and season" with draft null, and nothing said no draft came. A reply that claims a draft or change but
 *   carries none, or one that changes nothing, ends with "nothing changed on your sliders"; a dropped draft says why; advice that
 *   claims no change is left as written.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Sweep 11: a draft withheld because it moved latitude against the advice still
 *   said "I have increased battery_mass_kg from 0.4 to 0.7 kg ... The engine will judge this draft." above "No draft was
 *   offered". Whenever no draft is offered, the clauses claiming a change or speaking of the draft are left out and the
 *   advice before them is kept.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: with a claim clause cut out, the clause after it opened a sentence in
 *   lower case ("... the primary lever. the engine will judge ..."). A kept clause that starts a sentence gets its capital.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: "47N in October" on a 47.6 design kept 47.6 and the reply read
 *   "Drafted for 47°N". The status line says the draft keeps 47.6°N inside the named 47°N band.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const AGENT = 'b0ae0000-0000-0000-0000-000000000001';
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...f) => { routes[`${m} ${p}`] = f[f.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const routes = require('../routes/aero-lab-routes.js');
test.after(() => { Module._load = original; });

const TIER1 = { ...routes.DEFAULT_DESIGN, area_m2: 0.52, battery_mass_kg: 0.4, pack_Wh_per_kg: 250, cell_eff: 0.227, latitude_deg: 47.6, day_of_year: 195 };
const adapter = { capabilities: async () => ({ capabilities: { hybrid: false }, bounds: null }), engineStatus: () => ({ present: false }) };

async function chat(body, reply) {
  const prompts = [];
  const ctx = { orchestrator: { processMessage: async (_id, prompt, opts) => { prompts.push({ prompt, opts }); return { response: reply }; } } };
  const router = routes.createAeroLabRoutes({ adapter, ctx });
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; resolve(); return this; } };
  router.routes['POST /chat']({ body, oidc: { user: { sub: 'p1' } } }, res);
  await done;
  return { res, prompts };
}

test('the prompt carries the person\'s design, and a partial draft moves only its own field', async () => {
  const reply = '{"say":"Your Tier-1 sketch needs more battery for the night.","draft":{"battery_mass_kg":0.5},"moves":{"battery_mass_kg":"up"}}';
  const { res, prompts } = await chat({ message: 'What battery mass would make this close?', design: TIER1 }, reply);
  assert.equal(prompts[0].opts.agentId, AGENT);
  assert.ok(prompts[0].prompt.includes(`CURRENT DESIGN: ${JSON.stringify(TIER1)}`), 'the model sees the sliders, not the defaults');
  assert.deepEqual(res.body.changes, [{ field: 'battery_mass_kg', from: 0.4, to: 0.5, move: 'up' }]);
  assert.equal(res.body.draft.area_m2, 0.52, 'an undrafted field keeps the person\'s value');
  assert.equal(res.body.draft.latitude_deg, 47.6);
});

test('without a design the model is told none was sent and no draft is offered', async () => {
  const reply = '{"say":"Raise the battery.","draft":{"battery_mass_kg":0.5},"moves":{"battery_mass_kg":"up"}}';
  const { res, prompts } = await chat({ message: 'help' }, reply);
  assert.ok(!prompts[0].prompt.includes(JSON.stringify(routes.DEFAULT_DESIGN)), 'the defaults are never presented as the current design');
  assert.match(prompts[0].prompt, /CURRENT DESIGN: \(none sent/);
  assert.equal(res.body.draft, null);
  assert.match(res.body.say, /ask from the Aero Lab design form/);
});

test('a draft that moves a field against the stated direction is withheld with the reason', async () => {
  const reply = '{"say":"Increase battery_mass_kg slightly.","draft":{"battery_mass_kg":0.32},"moves":{"battery_mass_kg":"up"}}';
  const { res } = await chat({ message: 'smallest change?', design: TIER1 }, reply);
  assert.equal(res.body.draft, null);
  assert.match(res.body.say, /would move battery_mass_kg down \(0\.4 to 0\.32\) while the advice moves it up/);
  const undeclared = await chat({ message: 'x', design: TIER1 }, '{"say":"ok","draft":{"battery_mass_kg":0.5}}');
  assert.equal(undeclared.res.body.draft, null, 'a change with no declared direction is not offered');
});

test('deliberation around the envelope is never shown', async () => {
  const reply = 'The user wants {closure}. Let me think about the R7 preset... {"say":"Add 0.1 kg of battery.","draft":null}';
  const { res } = await chat({ message: 'x', design: TIER1 }, reply);
  assert.equal(res.body.say, 'Add 0.1 kg of battery.');
  const broken = await chat({ message: 'x', design: TIER1 }, 'Thinking {"say": "unterminated');
  assert.ok(!broken.res.body.say.includes('Thinking'), 'raw reasoning is not the answer');
});

test('the surface sends the sliders and lists only the changed fields', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.js'), 'utf8');
  assert.match(page, /api\('POST', '\/chat', \{ message: msg, history: state\.chat\.slice\(-8\), design: \{ \.\.\.state\.design \} \}\)/);
  assert.match(page, /showDraft\(r\.changes\)/);
  const ts = fs.readFileSync(path.join(__dirname, '..', 'src-routes', 'aero-lab-routes.ts'), 'utf8');
  assert.match(ts, /parseAeroDesignerEnvelope\(raw, hybridOk, caps\?\.bounds \?\? null, currentDesign\)/);
});

test('a named month and latitude are the mission: told to the model and held on the draft', async () => {
  const reply = '{"say":"Your Tier-1 sketch needs more battery.","draft":{"battery_mass_kg":0.694},"moves":{"battery_mass_kg":"up"}}';
  const { res, prompts } = await chat({ message: 'a craft that survives a cloudy day at 47N in October', design: TIER1 }, reply);
  assert.match(prompts[0].prompt, /THE DESIGNER NAMED: October \(day_of_year 288\), latitude 47°N \(latitude_deg 47; a current 47\.x already is\)/);
  assert.equal(res.body.draft.day_of_year, 288, 'the draft is for October, not midsummer');
  assert.equal(res.body.draft.latitude_deg, 47.6, '47.6 already is 47N');
  assert.deepEqual(res.body.changes.map((c) => c.field).sort(), ['battery_mass_kg', 'day_of_year']);
  assert.match(res.body.say, /Set to the site and season you named: day_of_year 288\. Latitude stays 47\.6°N, inside the 47°N you named\./,
    'the reply says the draft keeps 47.6 (sweep 13: "Drafted for 47°N" read as a latitude change)');
  const exact = await chat({ message: 'same craft at 47.6N', design: TIER1 }, reply);
  assert.ok(!/Latitude stays/.test(exact.res.body.say), 'a draft at exactly the named latitude needs no line');
  const kept = await chat({ message: 'same craft at 47N', design: TIER1 }, reply);
  assert.match(kept.res.body.say, /\n\nLatitude stays 47\.6°N, inside the 47°N you named\.$/, 'said even when nothing else is held');
});

test('a named latitude in another band, or the other hemisphere, is held on the draft', async () => {
  const reply = '{"say":"More battery.","draft":{"battery_mass_kg":0.7},"moves":{"battery_mass_kg":"up"}}';
  const north = await chat({ message: 'same craft at 60N', design: TIER1 }, reply);
  assert.equal(north.res.body.draft.latitude_deg, 60);
  const south = await chat({ message: 'same craft at 47S', design: TIER1 }, reply);
  assert.equal(south.res.body.draft.latitude_deg, -47);
});

test('a draft already at the named season is left as the model wrote it', async () => {
  const reply = '{"say":"Day 288 needs more battery.","draft":{"battery_mass_kg":0.7,"day_of_year":288},"moves":{"battery_mass_kg":"up","day_of_year":"up"}}';
  const { res } = await chat({ message: 'what about October?', design: TIER1 }, reply);
  assert.equal(res.body.draft.day_of_year, 288);
  assert.equal(res.body.say, 'Day 288 needs more battery.');
});

test('namedMission reads months, seasons and hemispheres; "may" as a verb is not May', () => {
  assert.deepEqual(routes.namedMission('it may need more battery').words, []);
  assert.equal(routes.namedMission('fly it in May').day_of_year, 135);
  assert.equal(routes.namedMission('a Seattle winter night').day_of_year, 355);
  assert.equal(routes.namedMission('tropics 10.4S at the equinox').latitude_deg, -10.4);
  assert.equal(routes.namedMission('tropics 10.4S at the equinox').day_of_year, 80);
});

test('"May I ..." is not May: the month the person names is the one held', async () => {
  assert.equal(routes.namedMission('May I get a craft that survives winter at 47N?').day_of_year, 355);
  assert.equal(routes.namedMission('May I get a craft that survives a cloudy October day at 47N?').day_of_year, 288);
  assert.equal(routes.namedMission('May we fly it on 3 May?').day_of_year, 135);
  assert.equal(routes.namedMission('fly it May 20').day_of_year, 135);
  assert.equal(routes.namedMission('a cloudy day in october').day_of_year, 288);
  const reply = '{"say":"An October day (day 288) needs more battery.","draft":{"battery_mass_kg":0.7},"moves":{"battery_mass_kg":"up"}}';
  const { res } = await chat({ message: 'May I get a craft that survives a cloudy October day at 47N?', design: { ...TIER1, day_of_year: 90 } }, reply);
  assert.equal(res.body.draft.day_of_year, 288, 'the draft agrees with the reply: October, not May');
});

test('two named months state both and hold no day', async () => {
  const named = routes.namedMission('fly it from March to October');
  assert.equal(named.day_of_year, undefined);
  assert.match(named.words.join(' '), /March \(day_of_year 74\).*October \(day_of_year 288\)/);
  const reply = '{"say":"Spring to autumn needs more battery.","draft":{"battery_mass_kg":0.7},"moves":{"battery_mass_kg":"up"}}';
  const { res, prompts } = await chat({ message: 'fly it from March to October', design: TIER1 }, reply);
  assert.match(prompts[0].prompt, /more than one month/);
  assert.equal(res.body.draft.day_of_year, 195, 'no named day is forced onto the draft');
  assert.ok(!/Set to the site and season you named/.test(res.body.say));
});

test('seasons follow the hemisphere: winter at 35S is day 172, not southern midsummer', async () => {
  const south = routes.namedMission('a winter night at 35S');
  assert.equal(south.day_of_year, 172);
  assert.equal(south.latitude_deg, -35);
  assert.equal(routes.namedMission('summer at 35S').day_of_year, 355);
  assert.equal(routes.namedMission('spring at 35S').day_of_year, 266);
  assert.equal(routes.namedMission('autumn at 35S').day_of_year, 80);
  assert.equal(routes.namedMission('a winter night', -33.9).day_of_year, 172, 'a current southern site flips the season');
  assert.equal(routes.namedMission('a winter night at 47N', -33.9).day_of_year, 355, 'a named northern site wins over the current one');
  assert.equal(routes.namedMission('a winter night').day_of_year, 355);
  const reply = '{"say":"A southern winter night needs more battery.","draft":{"battery_mass_kg":0.7},"moves":{"battery_mass_kg":"up"}}';
  const { res } = await chat({ message: 'a winter night at 35S', design: TIER1 }, reply);
  assert.equal(res.body.draft.day_of_year, 172);
  assert.equal(res.body.draft.latitude_deg, -35);
  const current = await chat({ message: 'what about winter?', design: { ...TIER1, latitude_deg: -33.9 } }, reply);
  assert.equal(current.res.body.draft.day_of_year, 172, 'the route passes the current latitude');
});

test('the persona gives the southern season days', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'aero-designer.yaml'), 'utf8').replace(/\s+/g, ' ');
  assert.match(persona, /in the south \(a negative latitude\) "winter" 172, "summer"\/"midsummer" 355, "spring" 266, "autumn" 80/);
  assert.match(persona, /"May" is a month only as a date \("in May", "3 May"\), never "May I"/);
});

test('the persona states what min SOC and usable margin mean', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'aero-designer.yaml'), 'utf8');
  assert.match(persona, /\*\*usable margin\*\* is the usable energy harvested over the cycle divided by the\s+energy the craft used/);
  assert.match(persona, /It is not a\s+distance between min SOC and 0/);
  assert.match(persona, /A site or season the person names is the mission, not a lever/);
});

test('a reply that claims a draft or change it does not carry says nothing changed on the sliders', async () => {
  for (const reply of [
    '{"say":"I have drafted an increase in battery_mass_kg to 0.7 kg (within bounds).","changes":[],"draft":null}',
    '{"say":"I have updated the site and season to 47°N in October (day 288).","draft":null}',
  ]) {
    const { res } = await chat({ message: 'more battery', design: TIER1 }, reply);
    assert.equal(res.body.draft, null);
    assert.match(res.body.say, /No draft came with this reply, so nothing changed on your sliders\. Ask again for a draft to apply\.$/, reply);
  }
  const same = await chat({ message: 'x', design: TIER1 }, '{"say":"I have set the battery to 0.4 kg.","draft":{"battery_mass_kg":0.4},"moves":{"battery_mass_kg":"up"}}');
  assert.equal(same.res.body.draft, null, 'a draft equal to the sliders changes nothing');
  assert.match(same.res.body.say, /nothing changed on your sliders/);
});

test('a dropped draft says why, and plain advice is left as written', async () => {
  const outside = await chat({ message: 'x', design: TIER1 }, '{"say":"I drafted a huge wing.","draft":{"area_m2":5000},"moves":{"area_m2":"up"}}');
  assert.equal(outside.res.body.draft, null);
  assert.match(outside.res.body.say, /No draft was offered: it did not fit the design form \(design\.area_m2=5000 is outside .*\)\. Nothing changed on your sliders\./);
  const advice = await chat({ message: 'x', design: TIER1 }, '{"say":"A lighter airframe would help most.","draft":null}');
  assert.equal(advice.res.body.say, 'A lighter airframe would help most.', 'advice that claims no change gets no note');
});

test('a withheld draft never keeps the reply\'s claim that it changed something (sweep 11)', async () => {
  const say = 'Drafting for 47°N in October (day 288). The engine\'s latest record suggests ~0.694 kg battery is needed to close; I have increased battery_mass_kg from 0.4 to 0.7 kg. This move stays within the slider bounds (0.1–500 kg). The engine will judge this draft.';
  const reply = JSON.stringify({ say, draft: { battery_mass_kg: 0.7, latitude_deg: 47 }, moves: { battery_mass_kg: 'up', latitude_deg: 'up' } });
  const { res } = await chat({ message: 'a hand-launch craft that survives a cloudy day at 47N in October', design: TIER1 }, reply);
  assert.equal(res.body.draft, null);
  assert.doesNotMatch(res.body.say, /I have increased|This move|judge this draft/);
  assert.match(res.body.say, /^Drafting for 47°N in October \(day 288\)\. The engine's latest record suggests ~0\.694 kg battery is needed to close\.\n\nNo draft was offered: it would move latitude_deg down \(47\.6 to 47\) while the advice moves it up\. Ask again\.$/);
  for (const [body, pattern] of [
    [{ message: 'x' }, /^No draft was offered: ask from the Aero Lab design form/],
    [{ message: 'x', design: TIER1 }, /^No draft came with this reply/],
  ]) {
    const only = await chat(body, JSON.stringify({ say: 'I have increased battery_mass_kg to 0.7 kg.', draft: body.design ? null : { battery_mass_kg: 0.7 }, moves: { battery_mass_kg: 'up' } }));
    assert.match(only.res.body.say, pattern, 'a reply that is only a claim leaves only the note');
    assert.doesNotMatch(only.res.body.say, /I have increased/);
  }
  assert.equal(routes.withoutChangeClaims('Raise the battery. I set it to 0.7 kg.'), 'Raise the battery.');
});

test('a clause kept after a cut change claim starts its sentence with a capital (sweep 12)', () => {
  assert.equal(routes.withoutChangeClaims('Increasing the battery mass is the primary lever. I have increased it to 0.7 kg; the engine will judge if this closes the energy loop.'),
    'Increasing the battery mass is the primary lever. The engine will judge if this closes the energy loop.');
  assert.equal(routes.withoutChangeClaims('I set it to 0.7 kg; battery_mass_kg drives the loop.'), 'battery_mass_kg drives the loop.', 'an identifier stays as written');
  assert.equal(routes.withoutChangeClaims('Raise the battery; I set it to 0.7 kg; the engine judges it.'), 'Raise the battery; the engine judges it.', 'a clause inside a sentence stays lower case');
});
