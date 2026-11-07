/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (movies--movies-concierge): the Movie Concierge printed the raw object
 *   ({"say":…,"show":[]…}) as its reply, because the parse leaned on the framework helper the native kernel shims to {} for
 *   any string. Regression guard over the COMPILED package-local parser and the compiled route's use of it: a fenced
 *   envelope, a prose-wrapped one and a bare one are read; an unreadable envelope is a plain apology; plain prose stays.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseMoviesEnvelope, ENVELOPE_APOLOGY } = require('../routes/movies-envelope.js');

const ENVELOPE = '{"say":"Try Arrival tonight.","show":["movie:329865"],"watchlist":[],"remember":["likes slow sci-fi"]}';

test('a ```json fenced envelope is read, and the reply is its say, not the object', () => {
  const r = parseMoviesEnvelope('```json\n' + ENVELOPE + '\n```');
  assert.equal(r.say, 'Try Arrival tonight.');
  assert.deepEqual(r.show, ['movie:329865']);
  assert.deepEqual(r.remember, ['likes slow sci-fi']);
  assert.doesNotMatch(r.say, /[{}]|"say"/);
});

test('an envelope wrapped in prose is read', () => {
  const r = parseMoviesEnvelope('Here is my answer:\n' + ENVELOPE + '\nEnjoy!');
  assert.equal(r.say, 'Try Arrival tonight.');
  assert.deepEqual(r.show, ['movie:329865']);
});

test('a bare envelope is read, and a brace inside the say does not end it early', () => {
  const r = parseMoviesEnvelope('{"say":"Pick one {or two}","show":["tv:1399"]}');
  assert.equal(r.say, 'Pick one {or two}');
  assert.deepEqual(r.show, ['tv:1399']);
  assert.deepEqual(r.watchlist, []);
});

test('an envelope that cannot be parsed becomes a plain apology, never the raw object', () => {
  for (const broken of ['{"say":"Try Arrival", "show":[', '```json\n{"say": "x", show: []}\n```', '{"show":["movie:1"]}']) {
    const r = parseMoviesEnvelope(broken);
    assert.equal(r.say, ENVELOPE_APOLOGY, broken);
    assert.doesNotMatch(r.say, /"say"|"show"/);
  }
});

test('plain prose stays the reply; an empty reply stays empty so the route says it could not reach the assistant', () => {
  assert.equal(parseMoviesEnvelope('hi there').say, 'hi there');
  assert.equal(parseMoviesEnvelope('   ').say, '');
});

test('the compiled route parses through the package-local module, not the framework helper the native kernel shims', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'routes', 'movies-routes.js'), 'utf8');
  const ts = fs.readFileSync(path.join(__dirname, '..', 'src-routes', 'movies-routes.ts'), 'utf8');
  assert.match(js, /require\("\.\/movies-envelope"\)/);
  assert.doesNotMatch(js, /concierge-envelope/);
  assert.match(ts, /from '\.\/movies-envelope'/);
  assert.doesNotMatch(ts, /concierge-envelope/);
});
