/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-prove the store rating ledger gate over fixture stores: a valid package writes a ledger and README section that --check accepts; a hand-typed ledger number, a hand-edited README section, an unrated package (without --allow-unrated), each malformed block shape and a non-standard YAML form all go red; a version bump alone stays green (the ledger carries no version, so other lanes' bumps never stale it); --write refuses to touch anything while a block is malformed; a package with no README gets one.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | T0 is accepted only for a generation-only feature (generation local or hosted), matching the core loader (oshal #911).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, readRating, LEDGER_FILE, SECTION_START } from './ai-usage-ledger.mjs';

const RATED = [
  'rating:',
  '  memoryMb: { low: 64, high: 256, basis: declared }',
  '  features:',
  '    - id: daily-digest',
  '      unit: daily digest',
  '      tier: T3',
  '      generation: none',
  '      degrade: reduced',
  '      reducedEdition: T2 summary over signals ranked in code',
  '',
].join('\n');

function fixture(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rating-ledger-'));
  for (const [name, body, readme] of packages) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'oshal-app.yaml'), `name: ${name}\ndisplayName: ${name.toUpperCase()}\nversion: 1.0.0\nsuite: ai-productivity\n${body}`);
    if (readme !== undefined) fs.writeFileSync(path.join(root, name, 'README.md'), readme);
  }
  return root;
}

function withFixture(packages, fn) {
  const root = fixture(packages);
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const edit = (root, file, from, to) => {
  const target = path.join(root, file);
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(from, to));
};

test('a rated package writes a ledger and README section that --check accepts', () => {
  withFixture([['mail', RATED, '# Mail\n\nWhat it does.\n'], ['clock', 'rating:\n  memoryMb: { low: 32, high: 128 }\n  features: []   # no model\n', '# Clock\n']], (root) => {
    assert.deepEqual(run({ mode: 'write', root }), []);
    const ledger = fs.readFileSync(path.join(root, LEDGER_FILE), 'utf8');
    assert.match(ledger, /Coverage: 2 packages, 2 rated, 0 unrated\./);
    assert.match(ledger, /\| mail \| 64 \/ 256 \(declared\) \| daily-digest \| daily digest \| T3 \| none \| reduced: T2 summary over signals ranked in code \| not yet measured \| none recorded \|/);
    assert.match(ledger, /\| clock \| 32 \/ 128 \(declared\) \| none \(T0, no model in the loop\) \|/);
    assert.doesNotMatch(ledger, /\d{4}-\d{2}-\d{2}/);
    const readme = fs.readFileSync(path.join(root, 'mail', 'README.md'), 'utf8');
    assert.match(readme, /^# Mail\n\nWhat it does\.\n\n<!-- oshal-rating:start -->\n## Models and requirements/);
    assert.match(readme, /Container memory, MiB low \/ high: \*\*64 \/ 256 \(declared\)\*\*/);
    assert.match(fs.readFileSync(path.join(root, 'clock', 'README.md'), 'utf8'), /No model in the loop \(T0\)/);
    assert.deepEqual(run({ mode: 'check', root }), []);
    assert.deepEqual(run({ mode: 'write', root }), []);
    assert.equal(fs.readFileSync(path.join(root, 'mail', 'README.md'), 'utf8'), readme, 'a second write is a no-op');
  });
});

test('a version bump alone keeps the gate green (other lanes never need to regenerate)', () => {
  withFixture([['mail', RATED, '# Mail\n']], (root) => {
    run({ mode: 'write', root });
    edit(root, 'mail/oshal-app.yaml', 'version: 1.0.0', 'version: 1.0.1');
    assert.deepEqual(run({ mode: 'check', root }), []);
  });
});

test('--check goes RED on a hand-typed ledger number', () => {
  withFixture([['mail', RATED, '# Mail\n']], (root) => {
    run({ mode: 'write', root });
    edit(root, LEDGER_FILE, '64 / 256', '64 / 4096');
    assert.match(run({ mode: 'check', root }).join('\n'), /AI-USAGE-LEDGER\.md is stale/);
  });
});

test('--check goes RED on a hand-edited README section and on a rating change not regenerated', () => {
  withFixture([['mail', RATED, '# Mail\n']], (root) => {
    run({ mode: 'write', root });
    edit(root, 'mail/README.md', '| T3 |', '| T1 |');
    assert.match(run({ mode: 'check', root }).join('\n'), /mail\/README\.md rating section is stale/);
    run({ mode: 'write', root });
    edit(root, 'mail/oshal-app.yaml', 'tier: T3', 'tier: T2');
    const problems = run({ mode: 'check', root }).join('\n');
    assert.match(problems, /AI-USAGE-LEDGER\.md is stale/);
    assert.match(problems, /mail\/README\.md rating section is stale/);
  });
});

test('an unrated package fails --check unless --allow-unrated, and is listed', () => {
  withFixture([['mail', RATED, '# Mail\n'], ['bare', '', '# Bare\n']], (root) => {
    run({ mode: 'write', root });
    assert.match(fs.readFileSync(path.join(root, LEDGER_FILE), 'utf8'), /Unrated: bare\./);
    assert.match(run({ mode: 'check', root }).join('\n'), /unrated package\(s\): bare/);
    assert.deepEqual(run({ mode: 'check', root, allowUnrated: true }), []);
    assert.ok(!fs.readFileSync(path.join(root, 'bare', 'README.md'), 'utf8').includes(SECTION_START));
  });
});

test('a package with no README gets one carrying the section', () => {
  withFixture([['mail', RATED]], (root) => {
    assert.deepEqual(run({ mode: 'write', root }), []);
    assert.match(fs.readFileSync(path.join(root, 'mail', 'README.md'), 'utf8'), /^# MAIL\n\n<!-- oshal-rating:start -->/);
    assert.deepEqual(run({ mode: 'check', root }), []);
  });
});

const MALFORMED = [
  ['unknown tier', RATED.replace('tier: T3', 'tier: T5'), /tier "T5" is not one of/],
  ['T0 with no generation backend', RATED.replace('tier: T3', 'tier: T0'), /tier T0 is declared only for a generation-only feature/],
  ['unknown generation', RATED.replace('generation: none', 'generation: cloud'), /generation "cloud"/],
  ['unknown degrade', RATED.replace('degrade: reduced', 'degrade: fallback'), /degrade "fallback"/],
  ['reduced without text', RATED.replace('      reducedEdition: T2 summary over signals ranked in code\n', ''), /requires reducedEdition/],
  ['low above high', RATED.replace('low: 64, high: 256', 'low: 512, high: 256'), /low \(512\) must not exceed high \(256\)/],
  ['bytes typed as MiB', RATED.replace('high: 256', 'high: 268435456'), /the unit is MiB, not bytes/],
  ['unknown basis', RATED.replace('basis: declared', 'basis: guessed'), /basis "guessed"/],
  ['typed token count', RATED.replace('      generation: none', '      tokensPerUnit: 900\n      generation: none'), /unknown field tokensPerUnit/],
  ['unknown rating key', RATED.replace('  features:', '  tokens: 5\n  features:'), /rating has unknown field tokens/],
  ['duplicate id', `${RATED}    - id: daily-digest\n      unit: x\n      tier: T1\n      generation: none\n      degrade: disable\n`, /declared twice/],
  ['block-style memory', RATED.replace('  memoryMb: { low: 64, high: 256, basis: declared }', '  memoryMb:\n    low: 64\n    high: 256'), /standard form/],
  ['flow-style features', 'rating:\n  memoryMb: { low: 1, high: 1 }\n  features: [{ id: a }]\n', /standard form/],
  ['missing memory', 'rating:\n  features: []\n', /rating needs memoryMb/],
];

for (const [label, body, message] of MALFORMED) {
  test(`REJECTS ${label}`, () => {
    const { rating, problems } = readRating(`name: x\n${body}`, 'x/oshal-app.yaml');
    assert.equal(rating, null);
    assert.match(problems.join('\n'), message);
  });
}

test('T0 is accepted for a generation-only feature', () => {
  const body = RATED.replace('tier: T3', 'tier: T0').replace('generation: none', 'generation: hosted');
  const { rating, problems } = readRating(`name: x\n${body}`, 'x/oshal-app.yaml');
  assert.deepEqual(problems, []);
  assert.equal(rating.features[0].tier, 'T0');
});

test('--write refuses to touch anything while a block is malformed', () => {
  withFixture([['mail', RATED, '# Mail\n']], (root) => {
    run({ mode: 'write', root });
    const before = fs.readFileSync(path.join(root, 'mail', 'README.md'), 'utf8');
    edit(root, 'mail/oshal-app.yaml', 'tier: T3', 'tier: T9');
    assert.match(run({ mode: 'write', root }).join('\n'), /tier "T9"/);
    assert.equal(fs.readFileSync(path.join(root, 'mail', 'README.md'), 'utf8'), before, 'the section was not stripped');
  });
});
