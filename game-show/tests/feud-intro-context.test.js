/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-12 06:10:00 | maintainer@emeraldcoastsystemsgroup.com     | K4 regression: the Family Feud intro prompt carried no board context, so the host narrated 'the Blues taking on the Reds' and a made-up topic while the teams were Team A/B and the question was about freezer items. The intro now carries the scoreboard's team names, the drawn question (or says none is drawn) and the board context the other modes append.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const feud = require('../lib/shows/family-feud');

const SURVEY = { question: 'Name something people keep in the freezer', answers: [
  { text: 'Ice cream', points: 40, aliases: [] }, { text: 'Peas', points: 30, aliases: [] }, { text: 'Ice', points: 20, aliases: [] },
] };

test('the intro names the scoreboard teams and the drawn question, with the board context', () => {
  const ingested = feud.ingestGenerated(feud.initialState({}, [], 1000), SURVEY, 1000);
  assert.equal(ingested.ok !== false, true, JSON.stringify(ingested).slice(0, 200));
  const state = ingested.state || ingested;
  const prompt = feud.spokenPrompt('intro', state, {}, {});
  assert.match(prompt, /^MODE: intro\./);
  assert.match(prompt, /Team A and Team B/);
  assert.match(prompt, /never invented ones/);
  assert.match(prompt, /The first question is "Name something people keep in the freezer"/);
  assert.match(prompt, /Score A:0 B:0/, 'the board context the other modes append is there');
  assert.deepEqual(feud.scoreboard(state).map((t) => t.name), ['Team A', 'Team B'], 'the names match the scoreboard');
});

test('before a question is drawn the intro says so instead of inviting a topic', () => {
  const prompt = feud.spokenPrompt('intro', feud.initialState({}, [], 1000), {}, {});
  assert.match(prompt, /The first question is not drawn yet; do not name a topic\./);
  assert.match(prompt, /Team A and Team B/);
});
