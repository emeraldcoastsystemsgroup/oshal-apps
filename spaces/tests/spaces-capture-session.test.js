/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-169 L7, store half: the capture session reaches the upload. The two surfaces' own inline scripts run here against stand-ins for the browser (elements that record their listeners, a recording fetch, a FormData that keeps its fields, a storage that can be made to refuse). The guided capture page remembers the id of the session its telemetry carries, when the capture starts and again when it ends. The upload page names that session on the walk-through upload and on the import, forgets it once an upload has carried it, keeps it when the upload fails, and sends no session when the remembered one is older than two hours, unreadable, or the storage refuses. What the route does with the field is proven in tests/capture-anchor.core.test.js. Dependency-free `node --test` suite, matching the store CI contract.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const SESSION_KEY = 'oshal-spaces-capture-session';
const SESSION = '0b6f6c1a-52a5-4d0b-9a36-6f4e2f0c9d11';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** The inline script of a surface that mentions `marker`. */
function inlineScript(file, marker) {
  const html = fs.readFileSync(path.join(TOOLS, file), 'utf8');
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1] || '')).map((m) => m[2]);
  const found = scripts.filter((code) => code.includes(marker));
  assert.equal(found.length, 1, `${file} has exactly one inline script mentioning ${marker}`);
  return found[0];
}

/** An element stand-in: records listeners, holds a value and files, and accepts everything else. */
function element(id) {
  const listeners = {};
  return {
    id, listeners, value: '', files: [], textContent: '', innerHTML: '', disabled: false, style: {}, src: '', srcObject: null,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getAttribute() { return null; },
    reset() { this.value = ''; this.files = []; },
    focus() {},
  };
}

/** A document stand-in whose elements are made on first use and kept. */
function documentOf() {
  const elements = new Map();
  return {
    elements,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
  };
}

/** A localStorage stand-in; `refuse` makes every call throw, as a browser that blocks storage does. */
function storageOf(initial = {}, refuse = false) {
  const values = new Map(Object.entries(initial));
  const guard = () => { if (refuse) throw new Error('storage refused'); };
  return {
    values,
    getItem(key) { guard(); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { guard(); values.set(key, String(value)); },
    removeItem(key) { guard(); values.delete(key); },
  };
}

/** A FormData stand-in that keeps what was appended. */
class RecordingFormData {
  constructor() { this.fields = []; }
  append(name, value) { this.fields.push([name, value]); }
  get(name) { const hit = this.fields.find(([n]) => n === name); return hit ? hit[1] : undefined; }
}

/** Let every pending promise callback run. */
const settle = () => new Promise((done) => setImmediate(done));

/**
 * @description Run the upload page's main script against the stand-ins.
 * @param storage - The localStorage stand-in.
 * @param answer - What a POST answers: a JSON body, or an Error for a failed upload.
 * @returns The document, the recorded requests and the storage.
 */
function openUploadPage(storage, answer) {
  const document = documentOf();
  const requests = [];
  const fetchStub = (url, opts = {}) => {
    requests.push({ url, method: opts.method || 'GET', body: opts.body });
    if ((opts.method || 'GET') === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scans: [] }) });
    if (answer instanceof Error) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: answer.message }) });
    return Promise.resolve({ ok: true, status: 201, json: async () => answer });
  };
  const timers = { setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {} };
  new Function('window', 'document', 'fetch', 'FormData', 'localStorage', 'setInterval', 'setTimeout', 'clearTimeout',
    inlineScript('spaces.html', 'upload-form'))({}, document, fetchStub, RecordingFormData, storage,
    timers.setInterval, timers.setTimeout, timers.clearTimeout);
  return { document, requests, storage };
}

/** Choose a file on a form's input and submit the form. */
async function submit(page, formId, inputId, filename) {
  page.document.getElementById(inputId).files = [{ name: filename }];
  await page.document.getElementById(formId).listeners.submit({ preventDefault() {} });
  await settle();
  return page.requests.filter((r) => r.method === 'POST');
}

const remembered = (ageMs) => ({ [SESSION_KEY]: JSON.stringify({ id: SESSION, at: Date.now() - ageMs }) });
const SCAN = { id: 'scan-1', title: 'Workshop', status: 'queued' };

test('the walk-through upload names the remembered capture session and then forgets it', async () => {
  const page = openUploadPage(storageOf(remembered(60_000)), { scan: SCAN, anchor: { anchored: true, anchorId: 'a-1', placeId: null } });
  const [post] = await submit(page, 'upload-form', 'video', 'walk.mp4');
  assert.equal(post.url, '/api/spaces/scans');
  assert.equal(post.body.get('captureSessionId'), SESSION);
  assert.equal(post.body.get('video').name, 'walk.mp4');
  assert.equal(page.storage.values.has(SESSION_KEY), false, 'the session was forgotten once an upload carried it');
  assert.match(page.document.getElementById('toast').textContent, /anchored to where it was captured/);
});

test('the import names the remembered capture session the same way', async () => {
  const page = openUploadPage(storageOf(remembered(60_000)), { scan: SCAN, anchor: { anchored: false, reason: 'no_capture_gps' } });
  const [post] = await submit(page, 'import-form', 'model', 'room.splat');
  assert.equal(post.url, '/api/spaces/scans/import');
  assert.equal(post.body.get('captureSessionId'), SESSION);
  assert.equal(page.storage.values.has(SESSION_KEY), false);
  assert.match(page.document.getElementById('toast').textContent, /no GPS fix in the capture/);
});

test('a failed upload keeps the session for the retry', async () => {
  const page = openUploadPage(storageOf(remembered(60_000)), new Error('failed to start scan'));
  const [post] = await submit(page, 'upload-form', 'video', 'walk.mp4');
  assert.equal(post.body.get('captureSessionId'), SESSION);
  assert.equal(page.storage.values.has(SESSION_KEY), true);
  assert.match(page.document.getElementById('toast').textContent, /Upload failed/);
});

test('no session is sent when the remembered one is too old, unreadable, or the storage refuses', async () => {
  const cases = [
    storageOf(remembered(TWO_HOURS_MS + 60_000)),
    storageOf({ [SESSION_KEY]: '{ not json' }),
    storageOf({ [SESSION_KEY]: JSON.stringify({ id: 42, at: 'yesterday' }) }),
    storageOf({}),
    storageOf(remembered(60_000), true),
  ];
  for (const storage of cases) {
    const page = openUploadPage(storage, { scan: SCAN, anchor: { anchored: false, reason: 'no_capture_session' } });
    const [post] = await submit(page, 'upload-form', 'video', 'walk.mp4');
    assert.equal(post.body.get('captureSessionId'), undefined);
    assert.equal(post.body.get('video').name, 'walk.mp4', 'the upload still went');
    assert.match(page.document.getElementById('toast').textContent, /Reconstruction started — this runs in the background/);
  }
});

/**
 * @description Run the guided capture page's script against the stand-ins and start the capture.
 * @param storage - The localStorage stand-in.
 * @returns The document, the recorded requests, the telemetry tick and the location the page navigates.
 */
async function openCapturePage(storage) {
  const document = documentOf();
  const requests = [];
  const ticks = [];
  const location = { search: '?target=room', href: '/api/spaces/capture?target=room' };
  const plan = { steps: [
    { kind: 'capture', title: 'Walk the room', instruction: 'Walk one lap', seconds: 30 },
    { kind: 'closure', title: 'Close the loop', instruction: 'Return to the start', seconds: 10 },
  ] };
  const fetchStub = (url, opts = {}) => {
    requests.push({ url, method: opts.method || 'GET', body: opts.body });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ plan }) });
  };
  const navigator = { mediaDevices: { getUserMedia: async () => ({}) }, geolocation: { watchPosition() {} } };
  new Function('window', 'document', 'fetch', 'localStorage', 'location', 'navigator', 'crypto', 'performance', 'setInterval', 'URLSearchParams',
    inlineScript('spaces-capture.html', 'capture-telemetry'))({ addEventListener() {} }, document, fetchStub, storage, location,
    navigator, { randomUUID: () => SESSION }, { now: () => 0 }, (fn) => { ticks.push(fn); return 0; }, URLSearchParams);
  await document.getElementById('start').listeners.click();
  await settle();
  return { document, requests, ticks, location, storage };
}

test('the capture page remembers the session its telemetry carries, at the start and at the end', async () => {
  const page = await openCapturePage(storageOf());
  const atStart = JSON.parse(page.storage.values.get(SESSION_KEY));
  assert.equal(atStart.id, SESSION);
  assert.ok(Date.now() - atStart.at < 5000);
  page.ticks[0]();
  const posted = page.requests.find((r) => r.url === '/api/spaces/capture-telemetry');
  assert.equal(JSON.parse(posted.body).sessionId, SESSION, 'the remembered id is the one the telemetry carries');
  page.storage.values.delete(SESSION_KEY);
  page.document.getElementById('next').listeners.click();
  page.document.getElementById('next').listeners.click();
  assert.equal(JSON.parse(page.storage.values.get(SESSION_KEY)).id, SESSION, 'remembered again when the capture ends');
  assert.equal(page.location.href, '/cockpit/?app=spaces');
});

test('the capture page still runs when the storage refuses', async () => {
  const page = await openCapturePage(storageOf({}, true));
  page.ticks[0]();
  assert.ok(page.requests.some((r) => r.url === '/api/spaces/capture-telemetry'), 'telemetry still posts');
  page.document.getElementById('next').listeners.click();
  page.document.getElementById('next').listeners.click();
  assert.equal(page.location.href, '/cockpit/?app=spaces');
});
