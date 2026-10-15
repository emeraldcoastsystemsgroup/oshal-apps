/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: the Forge drafted a receipt bot whose persona asked for "a short table of items
 *   grouped by category" and then ended "You answer in plain prose.". The draft rule (personas/codex-packer.yaml, The draft,
 *   item 2) told every drafted persona to say it answers in plain prose. It must carry the Output answer's format instead.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the operator's first message stated the task in one sentence and the Forge's first turn
 *   asked "What is the single thing this bot does?" anyway. The interview rule counts an answer already given and asks the first
 *   step still unanswered. The Forge never answers a step itself (a live check of the first wording filled all eight in).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 11: after "reads a pasted meeting transcript" the Forge asked "What is the input?",
 *   because the persona's own example said that sentence answers step 1 only and step 2 (Input) comes next. The example now
 *   says one sentence answers Task, Input and Output and the next question is Success, and no example asks for an input
 *   the operator already named.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: the first reply again asked what a ticket gives the bot after "a pasted
 *   meeting transcript". Every interview reply now writes "Known so far" lines named by step before "Next:" the first step
 *   with no line.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'codex-packer.yaml'), 'utf8');
const draftRule = persona.slice(persona.indexOf('## The draft'), persona.indexOf('## Answering'));

test('a drafted persona carries the format the operator gave, not a blanket plain-prose line', () => {
  assert.ok(draftRule.length > 0, 'the persona has The draft section before Answering');
  assert.doesNotMatch(draftRule, /what it cannot do, and that it answers in plain prose/);
  assert.match(draftRule, /the answer's format exactly as the\s+operator gave it in step 3/);
  assert.match(draftRule, /a bot asked for a table must not be told to answer in plain prose/);
});

test('the Forge itself still answers its own conversation in plain prose', () => {
  assert.match(persona.slice(persona.indexOf('## Answering')), /Answer in plain prose: short sentences/);
});

test('the interview counts an answer the operator already gave and asks the first unanswered step (sweep 10, 11)', () => {
  const interview = persona.slice(persona.indexOf('## The interview'), persona.indexOf('2. Input:')).replace(/\s+/g, ' ');
  assert.match(interview, /An answer the operator already gave counts, whenever they gave it/);
  assert.doesNotMatch(interview, /answers step 1, so restate it as the Task and ask step 2/, 'the example must not ask for an input the operator named (sweep 11)');
  assert.match(interview, /one sentence can answer several steps/);
  assert.match(interview, /answers step 1 \(Task: list a meeting's action items\), step 2 \(Input: a pasted transcript - the word "pasted" is the input\) and step 3 \(Output: each action item with its owner and due date\), so restate those three and ask step 4 \(Success\)/);
  assert.match(interview, /Before asking a step, check every message for its answer/);
  assert.match(interview, /ask the first step that is still unanswered, as one question/);
  assert.match(interview, /Never ask a step the operator has already answered/);
  assert.match(interview, /Never answer a step yourself: a step the operator has not answered is asked, not assumed/);
  assert.match(interview, /"reads a transcript and lists its action items" is one job/);
});

test('every interview reply shows the answered steps by name before it asks the next one (sweep 13)', () => {
  const interview = persona.slice(persona.indexOf('## The interview'), persona.indexOf('1. Task:')).replace(/\s+/g, ' ');
  assert.match(interview, /Every interview reply has exactly this shape/);
  assert.match(interview, /Known so far: one short line per step the operator's own words answer, in step order, each starting with the step's name \("Task: \.\.\.", "Input: \.\.\.", "Output: \.\.\."\)/);
  assert.match(interview, /Next: the first step that has no line above, asked as one question/);
  assert.match(interview, /Write the Known lines before you choose the question: a step with a Known line is never asked/);
  assert.doesNotMatch(interview, /After each answer, restate it in one sentence/, 'the free-form restatement is replaced by the Known lines');
});
