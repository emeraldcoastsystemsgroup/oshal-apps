/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the in-app concierge bubble read "1. **Mushroom Risotto** - Key ingredient ..."
 *   with its asterisks, and the reply opened "I cannot provide that response format." (the persona said no JSON while the chat
 *   route asks for its reply object). Through the COMPILED route: a prose reply and an envelope's say reach the diner (and the
 *   saved conversation) without Markdown marks, list lines and words kept; the persona asks for the route's object and plain words.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRoutes, authed, call } = require('./eats-routes-harness');

const MARKED = '## Ideas\n\n1. **Mushroom Risotto** - Key ingredient: Arborio rice.\n2. __Caprese Salad__ with *fresh* basil.\n- 2 x 3 = 6, a*b stays';

test('a prose reply reaches the diner without Markdown marks, its words and lines kept (sweep 12)', async () => {
  const { handlers } = loadRoutes({ reply: MARKED });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'three mild vegetarian ideas' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'Ideas\n\n1. Mushroom Risotto - Key ingredient: Arborio rice.\n2. Caprese Salad with fresh basil.\n- 2 x 3 = 6, a*b stays');
});

test('an envelope say loses its marks too', async () => {
  const { handlers } = loadRoutes({ reply: { say: 'Try the **Margherita** tonight.' } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'pizza' } }));
  assert.equal(res.body.reply, 'Try the Margherita tonight.');
});

test('the persona answers in the route\'s reply object with plain words', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'eats-concierge.yaml'), 'utf8');
  const served = persona.slice(persona.indexOf('\nperspective:'), persona.indexOf('\nselector_descriptor:'));
  assert.doesNotMatch(served, /no JSON or code block|compact table/, 'nothing tells it to refuse the route\'s object');
  assert.match(served, /answer\s+with exactly that object, your words in its "say" field; never say you cannot use its format/);
  assert.match(served, /no Markdown marks \(no \*\* bold, # headings or tables\)/);
});
