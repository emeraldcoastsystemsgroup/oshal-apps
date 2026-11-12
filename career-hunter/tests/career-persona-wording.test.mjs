/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6 (intelligent-career concierge): the answer exposed internal names to the person, "profile.present is false in your system state" and "I can check career_database". The career-hunter persona the intelligent-career group's rail runs on (intelligent-career/oshal-app.yaml chatBot: career-hunter) must forbid naming tools, fields and context blocks and say how an empty profile is put.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the concierge said the hand-off actions require the target apps to be connected; they open the receiving app with the text filled in. The Speaking section describes a hand-off with no invented connection step.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The master record (1.51.0): live 2026-11-09 the Chat rail's "give me everything" turn wrote 6,077 tokens into the chat and was cut at 125 s. A request for the whole record is answered with the counts and the Master record page link, never the whole record pasted; the link is the one the reader serves and opens a registered tile, the tool is read-only and on career.read. No routing words carry the master record (Roger, 2026-11-09: intelligent routing, not keyword routing).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Intelligent Career 1.1.12: the group's rail runs on career-concierge, Career's own concierge since 1.57.0.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the persona, the tile and the description call the page Download my data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const persona = fs.readFileSync(new URL('../personas/career-hunter.yaml', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../../intelligent-career/oshal-app.yaml', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../authorization.yaml', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../lib/career-master-record.js', import.meta.url), 'utf8');

test('the intelligent-career rail runs on Career\'s own concierge, which speaks by career-hunter\'s rules', () => {
  // Since career-hunter 1.57.0 (T9) Career's concierge is career-concierge, carrying career-hunter's speaking rules word for
  // word (career-create-concierge.test.mjs); the group must name it or the kernel refuses to activate the group.
  assert.match(rail, /^chatBot: career-concierge$/m);
  assert.match(manifest, /^chatBot: career-concierge$/m);
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

test('a request for the whole record is answered with the counts and the Master record link, never the record pasted', () => {
  assert.match(persona, /^  career_master_record: "auto"/m, 'the read-only tool runs without asking');
  const rule = persona.slice(persona.indexOf('When the person asks for their whole record'), persona.indexOf('For master resume work'));
  assert.match(rule, /read career_master_record page 1 and answer with its\s+counts and the link to the Download my data page/);
  assert.match(rule, /Never paste the whole record\s+into the chat/);
  assert.match(rule, /Download saves all of it as one file and Print is in More/);
  const link = '/cockpit/?app=career-hunter&screen=career-master-record';
  assert.ok(rule.includes(`(${link})`), 'the persona gives the page link');
  assert.ok(reader.includes(`const LINK = '${link}';`), 'the same link the reader serves on every page');
  assert.match(manifest, /- toolName: career-master-record\n\s+label: Download my data\n\s+icon: [^\n]+\n\s+iframeUrl: \/api\/career-hunter\/master-record-ui/);
  assert.match(catalog, /- \{ id: career_master_record, allOf: \[career\.read\] \}/);
  assert.match(catalog, /- \{ id: master-record-read, method: GET, path: \/master-record, allOf: \[career\.read\] \}/);
});

test('no routing words carry the master record (Roger, 2026-11-09: intelligent routing, not keyword routing)', () => {
  const words = [...(manifest.match(/routingKeywords: \[([^\]]*)\]/)?.[1] || '').split(','),
    ...persona.slice(persona.indexOf('routing_keywords:')).split('\n').slice(1).filter((line) => /^\s+- /.test(line))].map((w) => w.replace(/^\s*-\s*/, '').trim().toLowerCase());
  assert.ok(words.length > 5, `the routing words are read (read ${words.length})`);
  for (const phrase of ['master record', 'every bullet', 'all my bullets', 'every skill', 'addendum']) {
    assert.equal(words.some((word) => word.includes(phrase)), false, `${phrase} is not a routing word`);
  }
  assert.match(manifest, /The Download my data page lists every role, bullet, skill and history record Career keeps for you, with Download and Print\./,
    'the description says it in one plain product sentence');
});
