/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Both approval-held edit tools and the Motion editor persona say the optional title renames the project and is omitted unless the person asked for a rename. An installed concierge handoff run proposed an ordinary edit whose title was an action heading, which POST /projects/{id}/operations saves as the project's new title (title: body.title ?? base.title).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = readFileSync(new URL('oshal-app.yaml', root), 'utf8');
const persona = readFileSync(new URL('personas/motion-editor.yaml', root), 'utf8');
const RULE = /title renames the whole composition project: omit it unless the person asked to rename the project, and never use it to describe or label the edit\./;

/** One tool's declaration block, from its `- name:` line to the next tool. */
function tool(name) {
  const start = manifest.indexOf(`  - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = manifest.indexOf('\n  - name: ', start + 1);
  return manifest.slice(start, next < 0 ? undefined : next);
}

test('every edit tool that accepts title says it renames the project and is omitted otherwise', () => {
  for (const name of ['motion-apply-edits', 'motion-apply-exact-edits']) {
    const block = tool(name);
    assert.match(block, /\n {8}title:\n/, `${name} still accepts title`);
    assert.match(block.replace(/\s+/g, ' '), RULE, name);
  }
});

test('the Motion editor persona carries the same rule', () => {
  assert.match(persona.replace(/\s+/g, ' '), RULE);
});

test('the operations route keeps the saved title when title is omitted', () => {
  const route = readFileSync(new URL('routes/application.mjs', root), 'utf8');
  assert.match(route, /title:body\.title\?\?base\.title/);
});
