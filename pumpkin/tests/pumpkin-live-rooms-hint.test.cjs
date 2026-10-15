/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Regression for the Say/Ask status that contradicted itself ("no projector is listening on Main ... Live projector rooms right now: Main"): the hint lists only rooms a screen is attached to (listeners > 0), never the current room.
 *
 * Runs the shipped otherWatchedRoomsHint() out of tools/pumpkin-app.html in a VM, so the bytes the
 * browser runs are the bytes under test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'pumpkin-app.html'), 'utf8');

/** Pull one top-level `function name(...){...}` out of the page by brace matching. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined in pumpkin-app.html`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

const ctx = {};
vm.runInNewContext(`${extractFunction(html, 'otherWatchedRoomsHint')}; this.fn = otherWatchedRoomsHint;`, ctx);
const hint = ctx.fn;

test('the room this remote just registered (live, zero listeners) is not offered as a live room', () => {
  const text = hint([{ room: 'main', label: 'Main', live: true, listeners: 0 }], 'main');
  assert.doesNotMatch(text, /Main/);
  assert.match(text, /No projector screen is connected to any room/);
});

test('the current room is excluded even when a screen is attached to it', () => {
  const text = hint([{ room: 'main', label: 'Main', live: true, listeners: 1 }], 'main');
  assert.doesNotMatch(text, /Main/);
});

test('a different room with a screen attached is named so a room-name mismatch is visible', () => {
  const text = hint([
    { room: 'main', label: 'Main', live: true, listeners: 0 },
    { room: 'front-porch', label: 'Front Porch', live: true, listeners: 2 },
    { room: 'garage', label: 'Garage', live: true, listeners: 0 },
  ], 'main');
  assert.match(text, /different room/);
  assert.match(text, /“Front Porch” \(front-porch\)/);
  assert.doesNotMatch(text, /Garage|Main/);
});

test('a missing or malformed rooms list reads as no screen connected', () => {
  assert.match(hint(undefined, 'main'), /No projector screen is connected/);
  assert.match(hint([null], 'main'), /No projector screen is connected/);
});

test('withLiveRooms uses the hint and no longer lists rooms by registration liveness alone', () => {
  const fn = extractFunction(html, 'withLiveRooms');
  assert.match(fn, /otherWatchedRoomsHint\(j\.rooms,S\.room\)/);
  assert.doesNotMatch(fn, /r\.live/);
});
