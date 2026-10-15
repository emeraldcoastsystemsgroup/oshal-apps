/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | 'Prepare a post' hand-off notes: the page's own 'marketing:selected-brief' listener (and the code it calls), run as written against a campaign shaped like a live one, must hand the receiver readable prose (drafted copy, product, audience, key messages, brief) within 2000 characters, never the stored record as JSON or a JSON string cut mid-value. The previous listener sent JSON.stringify({product,icp,messageMap}).slice(0,2000), which Switchboard showed as raw truncated JSON.
 *
 * Dependency-free `node --test`: reads tools/marketing-engine.html, no browser, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'marketing-engine.html'), 'utf8');

/** The listener and, when present, the notes code beside it, exactly as the page ships them. */
function pageCode() {
  const start = html.indexOf("document.addEventListener('marketing:selected-brief'");
  assert.ok(start > 0, 'the page registers the marketing:selected-brief listener');
  const end = html.includes('// handoff-notes:end') ? html.indexOf('// handoff-notes:end') : html.indexOf('});', start) + 3;
  return html.slice(start, end);
}

/** Run the page's listener for one open campaign and return the context it hands over. */
function contextFor(campaign, items = []) {
  const listeners = [];
  const document = { addEventListener: (name, fn) => listeners.push({ name, fn }) };
  const state = { campaigns: [campaign], openCamp: campaign.campaign_id };
  const contentFor = (id) => items.filter((it) => it.campaign_id === id);
  new Function('document', 'state', 'contentFor', pageCode())(document, state, contentFor);
  const event = { detail: {} };
  listeners.find((l) => l.name === 'marketing:selected-brief').fn(event);
  return event.detail.context;
}

const segment = (n) => ({
  name: `Segment ${n}`, who: `Students managing a tight monthly allowance, group ${n}.`,
  messageAngles: [`Simplicity: 'Track your coffee, save your semester' ${n}`, `Control: 'See where it goes' ${n}`],
  painPoints: ['Running out of money before the end of the semester'.repeat(3)],
  wateringHoles: ['Reddit r/college'], objections: ['Privacy concerns'],
});
const live = {
  campaign_id: 'c1', name: 'sweep3-campaign', product: 'Budget buddy',
  icp: { competitors: [{ name: 'YNAB', positioning: 'Subscription budgeting.'.repeat(20) }], keywords: ['budgeting app for students', 'expense tracker'],
    noData: ['x'.repeat(400)], segments: [segment(1), segment(2), segment(3)] },
  message_map: { brief: 'Budgeting app for college students.' },
};

test('the notes are prose naming product, audience, key messages and brief, not the record as JSON', () => {
  const ctx = contextFor(live);
  assert.equal(ctx.title, 'sweep3-campaign');
  assert.throws(() => JSON.parse(ctx.notes), 'the notes are not a JSON document');
  assert.doesNotMatch(ctx.notes, /[{}]|"\w+":/, 'no JSON braces or quoted keys');
  assert.match(ctx.notes, /^Product: Budget buddy$/m);
  assert.match(ctx.notes, /Audience:\n- Segment 1: Students managing/);
  assert.match(ctx.notes, /Key messages:\n- Simplicity: 'Track your coffee, save your semester' 1/);
  assert.match(ctx.notes, /^Brief: Budgeting app for college students\.$/m);
  assert.match(ctx.notes, /^Keywords: budgeting app for students, expense tracker$/m);
  assert.ok(ctx.notes.length <= 2000);
});

test('drafted copy leads the notes when the campaign has some', () => {
  const ctx = contextFor(live, [{ campaign_id: 'c1', channel: 'linkedin', body: 'Your semester, on budget. Try Budget buddy.' }, { campaign_id: 'other', body: 'not this one' }]);
  assert.match(ctx.notes, /^Drafted copy \(linkedin\):\nYour semester, on budget\. Try Budget buddy\./);
  assert.doesNotMatch(ctx.notes, /not this one/);
});

test('a long brief is clipped at a word boundary within 2000 characters', () => {
  const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
  const ctx = contextFor({ ...live, message_map: { brief: words } });
  assert.ok(ctx.notes.length <= 2000, `length ${ctx.notes.length}`);
  assert.match(ctx.notes, /word\d+…$/, 'ends on a whole word with an ellipsis');
});

test('a campaign with no ICP or message map still hands over a readable product line', () => {
  const ctx = contextFor({ campaign_id: 'c2', name: 'bare', product: 'Widget', icp: {}, message_map: {} });
  assert.equal(ctx.notes, 'Product: Widget');
});
