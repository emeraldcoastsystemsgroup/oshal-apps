/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Rides hand-off boundary, driven through the COMPILED route module with an in-memory pool and a recording Uber Rides provider. Pins: a chat turn that sets `book` returns a proposal priced by the deterministic estimate for the named ride type (the first option for an unknown one, no fare for an address that did not resolve) and neither builds the deep link nor writes rides_requests; a turn without a destination proposes nothing; the confirm (POST /request) builds the link once and records it; an anonymous caller is 401 before any query or provider call.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRoutes, authed, anon, call } = require('./rides-routes-harness');

const SAVED_MOCK = process.env.MOCK_OIDC;
test.beforeEach(() => { delete process.env.MOCK_OIDC; });
test.after(() => { if (SAVED_MOCK === undefined) delete process.env.MOCK_OIDC; else process.env.MOCK_OIDC = SAVED_MOCK; });

const chat = (handlers, body) => call(handlers, 'post', '/chat', authed('rider-a', { body }));
const booked = (over = {}) => ({ say: 'Booking that.', pickup: 'my location', dropoff: 'Airport', rideType: 'comfort', showOptions: false, book: true, remember: [], ...over });

test('a chat booking returns a proposal priced by the estimate and hands nothing off', async () => {
  const { handlers, pool, provider } = loadRoutes({ reply: booked() });
  const res = await chat(handlers, { message: 'comfort to the airport, go' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ride, null, 'no hand-off in the chat turn');
  assert.deepEqual(res.body.proposal && {
    actionId: res.body.proposal.actionId, rideType: res.body.proposal.rideType, label: res.body.proposal.label,
    fareLow: res.body.proposal.fareLow, fareHigh: res.body.proposal.fareHigh, dropoff: res.body.proposal.dropoff,
  }, { actionId: 'request_ride', rideType: 'comfort', label: 'Comfort', fareLow: 23, fareHigh: 30, dropoff: 'Airport' });
  assert.match(res.body.proposal.summary, /Open Uber for Comfort from my location to Airport \(estimated \$23-30\)\?/);
  assert.equal(res.body.options.length, 4, 'the options the proposal was priced from come back for the screen');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['estimate'], 'no ride deep link is built');
  assert.equal(pool.tables.requests.length, 0, 'no rides_requests row');
  assert.equal(pool.sql.filter((q) => /rides_requests/.test(q.text)).length, 0);
});

test('an unknown ride type proposes the first priced option rather than inventing one', async () => {
  const { handlers } = loadRoutes({ reply: booked({ rideType: 'helicopter' }) });
  const res = await chat(handlers, { message: 'helicopter please' });
  assert.equal(res.body.proposal.rideType, 'uberx');
  assert.equal(res.body.proposal.fareLow, 18);
  assert.equal(res.body.proposal.fareHigh, 23);
});

test('a booking to an address that did not resolve proposes no fare at all', async () => {
  const { handlers, pool } = loadRoutes({ reply: booked({ dropoff: 'Nowhere Street', rideType: 'uberx' }) });
  const res = await chat(handlers, { message: 'go to nowhere street' });
  assert.equal(res.body.proposal.fareLow, null);
  assert.equal(res.body.proposal.fareHigh, null);
  assert.match(res.body.proposal.summary, /no fare estimate for this route/);
  assert.doesNotMatch(res.body.proposal.summary, /\$/);
  assert.equal(pool.tables.requests.length, 0);
});

test('a booking without a destination proposes nothing and prices nothing', async () => {
  const { handlers, provider } = loadRoutes({ reply: booked({ dropoff: '' }) });
  const res = await chat(handlers, { message: 'book it' });
  assert.equal(res.body.proposal, null);
  assert.equal(res.body.ride, null);
  assert.equal(provider.calls.length, 0);
});

test('a planning turn shows options and carries no proposal', async () => {
  const { handlers } = loadRoutes({ reply: booked({ book: false, showOptions: true }) });
  const res = await chat(handlers, { message: 'how much to the airport' });
  assert.equal(res.body.proposal, null);
  assert.equal(res.body.options.length, 4);
});

test('the confirm (POST /request) builds the link once and records the trip', async () => {
  const { handlers, pool, provider } = loadRoutes();
  const res = await call(handlers, 'post', '/request', authed('rider-a', { body: { pickup: 'my location', dropoff: 'Airport', rideType: 'comfort', fareLow: 23, fareHigh: 30 } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls, [['ride', 'my location', 'Airport', 'comfort']]);
  assert.match(res.body.rideUrl, /^https:\/\/m\.uber\.com\/ul\//);
  assert.equal(pool.tables.requests.length, 1);
  assert.equal(pool.tables.requests[0].deep_link, res.body.rideUrl);
});

test('an anonymous caller is 401 before any query or provider call', async () => {
  const { handlers, pool, provider } = loadRoutes({ reply: booked() });
  for (const [route, req] of [['/chat', anon({ body: { message: 'go' } })], ['/request', anon({ body: { dropoff: 'Airport' } })]]) {
    const res = await call(handlers, 'post', route, req);
    assert.equal(res.statusCode, 401, route);
  }
  assert.equal(pool.sql.length, 0);
  assert.equal(provider.calls.length, 0);
});
