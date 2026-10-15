/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 7: the campaign card showed its MESSAGE MAP as raw JSON ('{ "brief": "sweep7 test campaign..." }') and Draft content's brief box started empty although the campaign has a brief. Runs the page's own recordFieldsHtml/humanKey/campaignBrief (the record-fields block of tools/marketing-engine.html): records render as labelled, escaped fields with no JSON punctuation, the card uses them, and the dialog starts from message_map.brief.
 *
 * Dependency-free `node --test`: reads tools/marketing-engine.html, no browser, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'marketing-engine.html'), 'utf8');
const block = html.slice(html.indexOf('// record-fields:start'), html.indexOf('// record-fields:end'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const { recordFieldsHtml, campaignBrief } = new Function('esc', `${block}\nreturn { recordFieldsHtml, humanKey, campaignBrief };`)(esc);

test('the message map reads as labelled fields, not JSON', () => {
  const out = recordFieldsHtml({ brief: 'sweep7 test campaign for <students>', keyMessages: ['Save time', 'Own your data'], proof_points: [{ claim: 'Fast', source: 'bench' }] }, 0);
  assert.match(out, /<dt>Brief<\/dt><dd>sweep7 test campaign for &lt;students&gt;<\/dd>/);
  assert.match(out, /<dt>Key Messages<\/dt><dd><ul class="rf"><li>Save time<\/li><li>Own your data<\/li><\/ul><\/dd>/);
  assert.match(out, /<dt>Proof points<\/dt><dd><div class="rf-item"><dl class="rf"><dt>Claim<\/dt><dd>Fast<\/dd>/);
  assert.doesNotMatch(out, /[{}]|"brief"|":/, 'no JSON punctuation reaches the card');
});

test('empty and deep values say so instead of breaking', () => {
  assert.equal(recordFieldsHtml({}, 0), '<span class="rf-none">—</span>');
  assert.match(recordFieldsHtml({ a: { b: { c: { d: { e: { f: 1 } } } } } }, 0), /…/);
  assert.match(recordFieldsHtml({ icp: [] }, 0), /<dt>ICP<\/dt><dd><span class="rf-none">—<\/span>/);
});

test('the campaign card uses the fields for the ICP card and the message map', () => {
  assert.match(html, /recordFieldsHtml\(c\.message_map, 0\)/);
  assert.match(html, /recordFieldsHtml\(c\.icp, 0\)/);
  assert.doesNotMatch(html, /JSON\.stringify\(c\.message_map/);
  assert.doesNotMatch(html, /JSON\.stringify\(c\.icp/);
});

test('Draft content starts from the campaign brief', () => {
  assert.equal(campaignBrief({ message_map: { brief: '  Budgeting app for college students. ' } }), 'Budgeting app for college students.');
  assert.equal(campaignBrief({ message_map: { brief: { nested: true } } }), '');
  assert.equal(campaignBrief({}), '');
  assert.match(html, /\$\("dfBrief"\)\.value=campaignBrief\(camp\);/);
});
