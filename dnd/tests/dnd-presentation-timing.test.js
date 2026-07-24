/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove captions render synchronously and presentation deadlines do not await slow or failed natural narration.
 * 2026-07-22 01:03:46 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove queued narration cannot replace the caption still being spoken and appears when its own audio starts.
 * 2026-07-22 10:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove tactical callers may await natural playback after their minimum reading window without exceeding a hard presentation deadline.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Require stateful presentation to remain pending until active natural narration settles.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-runtime.js'), 'utf8');
const start = source.indexOf('let capTimer = null');
const end = source.indexOf('function boardPoint(event)', start);
const captionSource = source.slice(start, end);

/** @description Return a promise whose settlement is controlled by the test. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** @description Build the minimal caption element used by the runtime excerpt. */
function captionElement() {
  const classes = new Set(['hidden']);
  return {
    textContent: '', title: '', tabIndex: -1,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    setAttribute() {},
  };
}

/** @description Execute only the production caption and bounded presentation functions. */
function fixture(speech) {
  const element = captionElement(), waits = [], settled = [];
  const context = vm.createContext({
    Date, Math, Promise, setTimeout, clearTimeout,
    $: () => element,
    speak: () => speech.promise,
    waitMs: (ms) => { waits.push(ms); return Promise.resolve(); },
  });
  vm.runInContext(`${captionSource}\n;globalThis.api = { presentPhase };`, context);
  return { api: context.api, element, waits, settled };
}

/** @description Keep each requested wait pending until the test releases it. */
function boundedFixture(speech) {
  const element = captionElement(), waits = [], settled = [];
  const context = vm.createContext({
    Date, Math, Promise, setTimeout, clearTimeout, $: () => element,
    speak: () => speech.promise,
    waitMs: (ms) => {
      const gate = deferred(); waits.push({ ms, gate }); return gate.promise;
    },
  });
  vm.runInContext(`${captionSource}\n;globalThis.api = { presentPhase };`, context);
  return { api: context.api, element, waits, settled };
}

/** @description Execute the caption lifecycle while retaining each queued speech hook. */
function queuedFixture() {
  const element = captionElement(), jobs = [];
  const context = vm.createContext({
    Date, Math, Promise, setTimeout, clearTimeout,
    $: () => element,
    speak: (text, priority, lifecycle) => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      jobs.push({ text, priority, lifecycle, resolve });
      return promise;
    },
    waitMs: () => Promise.resolve(),
  });
  vm.runInContext(`${captionSource}\n;globalThis.api = { speakCaption };`, context);
  return { api: context.api, element, jobs };
}

test('caption appears immediately and presentation waits for its natural voice', async () => {
  const speech = deferred(), view = fixture(speech);
  const run = view.api.presentPhase('Bram, it is your turn.', 1800, true, (status) => view.settled.push(status));
  let finished = false; run.then(() => { finished = true; });
  assert.equal(view.element.textContent, 'Bram, it is your turn.');
  assert.equal(view.element.classList.contains('show'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.deepEqual(view.waits, [1800]);
  assert.deepEqual(view.settled, []);
  speech.resolve('done');
  assert.equal(await run, 'done');
  assert.deepEqual(view.settled, ['done']);
});

test('failed natural voice releases presentation as unavailable', async () => {
  const speech = deferred(), view = fixture(speech);
  const run = view.api.presentPhase('The road opens before you.', 1600, true, (status) => view.settled.push(status));
  speech.reject(new Error('provider offline'));
  assert.equal(await run, 'unavailable');
  assert.deepEqual(view.settled, ['unavailable']);
  assert.equal(view.element.textContent, 'The road opens before you.');
});

test('bounded tactical presentation waits for speech after its reading minimum', async () => {
  const speech = deferred(), view = boundedFixture(speech);
  const run = view.api.presentPhase('Archer targets Della.', 2600, false,
    (status) => view.settled.push(status), 14600);
  assert.deepEqual(view.waits.map((wait) => wait.ms), [2600]);
  view.waits[0].gate.resolve(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(view.waits.map((wait) => wait.ms), [2600, 12000]);
  speech.resolve('done');
  assert.equal(await run, 'done');
  assert.deepEqual(view.settled, ['done']);
});

test('tactical presentation does not advance past narration at its reading deadline', async () => {
  const speech = deferred(), view = boundedFixture(speech);
  const run = view.api.presentPhase('Cutter rolls now.', 2600, false, null, 14600);
  let finished = false; run.then(() => { finished = true; });
  view.waits[0].gate.resolve(); await new Promise((resolve) => setImmediate(resolve));
  view.waits[1].gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  speech.resolve('done');
  assert.equal(await run, 'done');
});

test('queued natural narration keeps spoken words visible until the next line starts', async () => {
  const view = queuedFixture();
  const first = view.api.speakCaption('First line is still being spoken.', false);
  const second = view.api.speakCaption('Second line is waiting for its voice.', false);
  assert.equal(view.element.textContent, 'First line is still being spoken.');
  assert.equal(view.jobs.length, 2);

  view.jobs[0].lifecycle.onStart();
  assert.equal(view.element.textContent, 'First line is still being spoken.');
  view.jobs[0].lifecycle.onDone('done'); view.jobs[0].resolve('done');
  assert.equal(view.element.textContent, 'First line is still being spoken.');

  view.jobs[1].lifecycle.onStart();
  assert.equal(view.element.textContent, 'Second line is waiting for its voice.');
  view.jobs[1].lifecycle.onDone('done'); view.jobs[1].resolve('done');
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
});
