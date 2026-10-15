/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Regression for the gift hand-off that showed raw ISO stamps ("Imported 2026-10-12T00:05:21.344Z Saved AI parent brief from 2026-10-12T04:05:19.784Z"): the compiled home summary writes the import and brief dates as "Oct 12, 2026 00:05 UTC" in the item detail and in the hand-off notes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The hand-off notes carried the saved brief's raw Markdown flattened into one line ('## Top interests - **Aerospace & Physics**: ...'); the compiled summary now states it as plain sentences.
 *
 * Runs the COMPILED routes/home-summary.js with only express stubbed and a stub pool.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Build the GET / handler from the compiled module and call it as a signed-in owner. */
async function summary(rows) {
  let handler;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'routes', 'home-summary.js'), 'utf8'))(
    (name) => { assert.equal(name, 'express'); return { Router: () => ({ get: (_p, h) => { handler = h; } }) }; }, module, module.exports);
  let n = 0;
  module.exports.createHomeSummaryRoutes({ pool: { query: async () => (n++ === 0 ? { rows: [{ imports: '1', watched: '42', briefs: '1' }] } : { rows }) } });
  const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ oidc: { isAuthenticated: () => true, user: { sub: 'alice' } } }, res);
  return res;
}

test('the hand-off notes and detail carry readable dates, never ISO stamps', async () => {
  const res = await summary([{ uploaded_at: '2026-10-12T00:05:21.344Z', brief_at: '2026-10-12T04:05:19.784Z', excerpt: 'Loves space and trains.', total_watched: 42 }]);
  assert.equal(res.statusCode, 200);
  const item = res.body.items.find((i) => i.text === 'Kid Lens history');
  assert.equal(item.detail, 'Imported Oct 12, 2026 00:05 UTC');
  const notes = item.actions[0].context.notes;
  assert.match(notes, /^Imported Oct 12, 2026 00:05 UTC Saved AI parent brief from Oct 12, 2026 04:05 UTC: Loves space and trains\./);
  assert.doesNotMatch(JSON.stringify(res.body.items), ISO);
  assert.deepEqual(item.actions.map((a) => a.integration), ['plan-gift', 'prepare-document']);
});

test('an unreadable stored date says so instead of printing a stamp', async () => {
  const res = await summary([{ uploaded_at: 'not a date', brief_at: null, excerpt: null, total_watched: 0 }]);
  const item = res.body.items.find((i) => i.text === 'Kid Lens history');
  assert.equal(item.detail, 'Imported date unavailable');
});

test('the hand-off notes state a Markdown brief as plain sentences', async () => {
  const brief = '## Top interests\n- **Aerospace & Physics**: Your child watched rocket launches\n- *Trains*: [model railways](https://example.test)\n\n## Gift ideas\n1. A `telescope` kit';
  const res = await summary([{ uploaded_at: '2026-10-12T00:05:21.344Z', brief_at: '2026-10-12T04:05:19.784Z', excerpt: brief, total_watched: 42 }]);
  const notes = res.body.items.find((i) => i.text === 'Kid Lens history').actions[0].context.notes;
  assert.match(notes, /Saved AI parent brief from Oct 12, 2026 04:05 UTC: Top interests: Aerospace & Physics: Your child watched rocket launches\. Trains: model railways\. Gift ideas: A telescope kit\. Review interests/);
  assert.doesNotMatch(notes, /##|\*\*|`|\]\(|^- /m, 'no Markdown marks reach the draft');
});
