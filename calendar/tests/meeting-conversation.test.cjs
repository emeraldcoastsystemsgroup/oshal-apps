/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A two-step conversation with the calendar concierge (calendar 1.4.0; Roger, 2026-11-14:
 *   "can't cancel or modify existing meeting"): "move my 3 PM with Dana to Thursday at 2" while two 3 PM meetings with Dana are
 *   on the person's Google Calendar. Only the model is scripted, and every answer it gives is built from the real observations
 *   of the declared tools: it finds, sees two that fit, and asks which, naming each by its day and time, with no card and no
 *   write; told "the budget review", it finds again and proposes one change card; the card (the kernel's own card code) names
 *   that meeting before and after; nothing reaches Google until Approve; Approve moves it, keeping its hour; a second Approve
 *   does nothing. The tools run through the stand-in for the kernel's route tools (schema check, rendering, held proposals),
 *   the compiled routes, the stand-in egress and the stand-in Google. Red before: no tool could find or change a meeting.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { world, kernelCards, manifest, ZONE, THU } = require('./fixtures/meeting-world.cjs');
const { dayAhead, ROOT } = require('./fixtures/calendar-modules.cjs');

const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'calendar-concierge.yaml'), 'utf8')).perspective.replace(/\s+/g, ' ');

/**
 * The scripted model: it sees the conversation (the person's words and every tool observation of the turn) and answers
 * with one tool call or one reply. It follows the persona's rule: find first; two that fit, ask which; one, propose its card.
 */
function scriptedModel(conversation) {
  const said = conversation.filter((m) => m.role === 'user').map((m) => m.text), last = conversation.at(-1);
  const wantsMove = /move my 3 PM with Dana to Thursday at 2/i.test(said[0] || '');
  if (!wantsMove) return { reply: 'I can only follow the scripted request.' };
  if (last.role === 'user') return { tool: 'calendar-find-events', input: { from: dayAhead(0), to: dayAhead(9), words: 'Dana', timeZone: ZONE } };
  if (last.role === 'tool' && last.tool === 'calendar-find-events') {
    const fits = last.value.body.meetings.filter((m) => / 3:00 PM /.test(m.local));
    const chosen = said.length > 1 ? fits.filter((m) => m.title.toLowerCase().includes(said.at(-1).replace(/^the /i, '').split(' ')[0].toLowerCase())) : fits;
    if (chosen.length > 1) return { reply: `You have two 3 PM meetings with Dana: ${chosen.map((m) => `${m.title} on ${m.local}`).join(', and ')}. Which one should I move?` };
    const m = chosen[0];
    return { tool: 'calendar-change-google-event', input: { revision: m.revision, title: m.title, start: m.start, timeZone: ZONE, newStart: `${THU}T14:00`, guests: 'Will be told', confirm: true } };
  }
  if (last.role === 'tool' && last.value.proposal) return { reply: `The card for ${last.value.proposal.input.title} moves it to Thursday at 2:00 PM; it changes when you press Approve.` };
  return { reply: `Something went wrong: ${JSON.stringify(last.value).slice(0, 200)}` };
}

/** One turn: the model runs until it replies, each tool call going through the kernel's route tools stand-in. */
async function turn(w, conversation, text) {
  conversation.push({ role: 'user', text });
  let models = 0, tools = 0;
  for (;;) {
    models++;
    const step = scriptedModel(conversation);
    if (step.reply) { conversation.push({ role: 'assistant', text: step.reply }); return { reply: step.reply, models, tools }; }
    tools++;
    const out = await w.tools.use(step.tool, step.input);
    conversation.push({ role: 'tool', tool: step.tool, value: out.observation || out });
    assert.ok(models < 6, 'the turn ends');
  }
}

test('"move my 3 PM with Dana to Thursday at 2" with two that fit: it asks which, then one card, then the change', async () => {
  const TEXT = kernelCards(), w = await world(), conversation = [];
  try {
    assert.match(persona, /When more than one listed meeting fits \(two 3 PM meetings with Dana\), ask which one, naming each with its day and time from "local", and propose nothing until they answer\. Never guess between two\./);
    const first = await turn(w, conversation, 'move my 3 PM with Dana to Thursday at 2');
    assert.match(first.reply, /Coffee with Dana on Tue, .+, 3:00 PM CST/, 'it names the first with its day and time');
    assert.match(first.reply, /Budget review with Dana on Wed, .+, 3:00 PM CST/, 'and the second');
    assert.match(first.reply, /Which one/);
    assert.equal(w.tools.held.size, 0, 'no card while it asks');
    assert.equal(w.api.writes().length, 0, 'nothing is written while it asks');

    const second = await turn(w, conversation, 'the budget review');
    assert.equal(second.tools, 2, 'it finds again, then proposes');
    assert.equal(w.tools.held.size, 1, 'one card');
    const [held] = w.tools.held.values();
    assert.equal(held.tool.name, 'calendar-change-google-event');
    const rows = Object.fromEntries(TEXT.fieldRows(held.input).map((r) => [r.label, r.value]));
    assert.equal(rows.Title, 'Budget review with Dana');
    assert.match(rows.Starts, /^Wed, .+ 3:00\sPM CST$/);
    assert.match(rows['New start'], /^Thu, .+ 2:00\sPM CST$/);
    assert.equal(rows.Guests, 'Will be told');
    assert.match(second.reply, /The card for Budget review with Dana/);
    assert.equal(w.api.writes().length, 0, 'nothing is written before Approve');

    const done = await w.tools.approve(held.id);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const event = w.api.get(w.ids.budget);
    assert.match(event.start.dateTime, new RegExp(`^${THU}T14:00:00-06:00$`));
    assert.match(event.end.dateTime, new RegExp(`^${THU}T15:00:00-06:00$`), 'an hour, as before');
    assert.equal(w.api.get(w.ids.coffee).start.dateTime.slice(11, 16), '15:00', 'the other 3 PM meeting is untouched');
    const proposal = { toolName: held.tool.name, app: 'calendar', label: held.tool.displayName, cardText: held.tool.cardText, mode: 'ask', input: held.input };
    assert.match(TEXT.resultSummary(proposal, done.status, done.body, 'Calendar Preparation').line, /^Changed Budget review with Dana, Thu, .+ 2:00\sPM CST in Calendar Preparation\.$/);
    assert.match((await w.tools.approve(held.id)).refused, /already used/);
    assert.equal(w.api.writes().length, 1, 'a second Approve does nothing twice');
    assert.equal(manifest.tools.find((t) => t.name === 'calendar-find-events').requiresApproval, false);
  } finally { await w.close(); }
});
