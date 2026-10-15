/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6 (intelligent-career concierge): the answer exposed internal names to the person, "profile.present is false in your system state" and "I can check career_database". The career-hunter persona the intelligent-career group's rail runs on (intelligent-career/oshal-app.yaml chatBot: career-hunter) must forbid naming tools, fields and context blocks and say how an empty profile is put.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the concierge said the hand-off actions require the target apps to be connected; they open the receiving app with the text filled in. The Speaking section describes a hand-off with no invented connection step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const persona = fs.readFileSync(new URL('../personas/career-hunter.yaml', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../../intelligent-career/oshal-app.yaml', import.meta.url), 'utf8');

test('the intelligent-career rail runs on the career-hunter persona', () => {
  assert.match(rail, /^chatBot: career-hunter$/m);
});

test('the persona forbids naming tools, fields and context blocks to the person', () => {
  const section = persona.slice(persona.indexOf('## Speaking to the person'), persona.indexOf('## Answering (the advisor half)'));
  assert.ok(section.length > 0, 'the persona has a Speaking to the person section before Answering');
  for (const name of ['career_database', 'profile.present', '"system state"', 'On Screen Now']) {
    assert.ok(section.includes(name), `the rule names ${name} as never said`);
  }
  assert.match(section, /You have not saved a résumé in Career yet/);
  assert.match(section, /never which tool you call/);
});

test('a hand-off action is described as what it does, with no invented connection step (sweep 12)', () => {
  const section = persona.slice(persona.indexOf('## Speaking to the person'), persona.indexOf('## Answering (the advisor half)'));
  assert.match(section, /opens the\s+receiving app with the text filled in for the person to edit/);
  assert.match(section, /Never say it needs a connected\s+app or account unless the screen itself says so/);
});
