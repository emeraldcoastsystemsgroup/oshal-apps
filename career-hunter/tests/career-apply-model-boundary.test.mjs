/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the staged Apply rail against re-registering controller-private profile, queue, email, outcome, or trace verbs as model tools.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
const persona = readFileSync(new URL('../personas/career-hunter.yaml', import.meta.url), 'utf8');
const LEGACY_APPLY_TOOLS = [
  'career_profile', 'apply_next', 'apply_claim', 'apply_record', 'email_code', 'apply_trace',
];

/** Return one top-level YAML mapping body from this manifest's stable indentation shape. */
function topLevelBody(source, key, nextKey) {
  const match = source.match(new RegExp(`^${key}:\\r?\\n([\\s\\S]*?)(?=^${nextKey}:)`, 'm'));
  assert.ok(match, `${key} block is missing`);
  return match[1];
}

/** Return first-level mapping keys or sequence names from a bounded YAML body. */
function declaredNames(body, sequence) {
  const pattern = sequence ? /^ {2}- name:\s*([^\s#]+)/gm : /^ {2}([a-z][a-z0-9_-]*):/gm;
  return [...body.matchAll(pattern)].map((match) => match[1]);
}

test('the package manifest does not expose controller-private Apply CLI verbs', () => {
  const toolsBody = topLevelBody(manifest, 'tools', 'ui');
  const toolNames = declaredNames(toolsBody, true);
  assert.ok(toolNames.includes('career_database'), 'tool parser did not find ordinary Career tools');
  for (const name of LEGACY_APPLY_TOOLS) {
    assert.ok(!toolNames.includes(name), `${name} must not be registered as a model tool`);
  }
  assert.doesNotMatch(toolsBody, /\/app\/scripts\/oshal-apply\.js/);
});

test('the Career persona cannot authorize any removed Apply tool', () => {
  const authBody = topLevelBody(persona, 'authorizations', 'perspective');
  const authorizations = declaredNames(authBody, false);
  assert.ok(authorizations.includes('career_database'), 'authorization parser found no Career tools');
  for (const name of LEGACY_APPLY_TOOLS) {
    assert.ok(!authorizations.includes(name), `${name} must remain outside model authorization`);
  }
  assert.match(persona, /controller stages approved work[\s\S]*records trusted outcomes/i);
});
