/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 7: asked to explain in three sentences what a review looks at, the worker returned only its quoted sample sentence. The persona's direct-question rule answers the question first and names the where-reviews-start sentence as never a reply on its own; no quoted sample is left to repeat.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the reply ended 'I cannot see your runs from here, and that a review of your own run starts ...', the closing rule's reported speech copied with its 'and that'. The closing sentence is now given whole and grammatical, after the answer, which keeps the asked length.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: asked for three sentences the worker gave four (the closing sentence on top). A set length is
 *   the whole reply's length, and the closing sentence is left out then.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PERSONA = fs.readFileSync(path.join(__dirname, '..', 'personas', 'futures-research-worker.yaml'), 'utf8');
const perspective = PERSONA.slice(PERSONA.indexOf('perspective: |'), PERSONA.indexOf('allowed_tools:'));

test('a direct question is answered first; where reviews start comes last and is never the whole reply', () => {
  const answer = perspective.indexOf('1. The answer to their question');
  const pointer = perspective.indexOf('2. One closing sentence');
  assert.ok(answer > 0 && pointer > answer, 'the answer comes before the pointer to the queue');
  assert.match(perspective, /Part 2 alone is never a reply to a question/);
  assert.match(perspective, /losses, its winning and losing settings/, 'what a review looks at is spelled out to answer from');
  assert.match(perspective, /Keep to the length they asked for/);
});

test('no quoted sample reply is left for the model to repeat word for word', () => {
  assert.doesNotMatch(perspective, /"I review the evidence from a Futures study run\./);
  assert.doesNotMatch(perspective, /along these lines: "/);
});

test('the strict JSON contract for a controller review request is unchanged', () => {
  assert.match(perspective, /return only the strict JSON requested: summary, limitations, evidence, forwardAssessment and nextStudy/);
  assert.match(perspective, /never in JSON or\n {2}a code block/);
});

test('the closing sentence is a whole sentence to write as is, never reported speech (sweep 12)', () => {
  assert.doesNotMatch(perspective, /saying you cannot see their runs from here, and that/);
  const closing = /exactly as written: "([^"]+)"/.exec(perspective);
  assert.ok(closing, 'the closing sentence is quoted whole');
  const sentence = closing[1].replace(/\s+/g, ' ');
  assert.equal(sentence, "I cannot see your runs from here; a review of your own run starts from a Futures study in the Trading app's Futures Research queue.");
  assert.doesNotMatch(sentence, /\band that\b/);
  assert.match(perspective, /three sentences means three full sentences of answer here/);
});

test('a set number of sentences is the whole reply, without the closing sentence (sweep 13)', () => {
  const flat = perspective.replace(/\s+/g, ' ');
  assert.match(flat, /When they ask for a set number of sentences or a set length, the whole reply is that long: give exactly that many sentences of answer and leave out part 2\./);
});
