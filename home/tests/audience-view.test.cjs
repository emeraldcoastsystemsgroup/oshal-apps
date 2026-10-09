/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view's schedule text, asserted as behaviour: the head block runs against a stub kit and the fixture's real schedule shape (the trigger is an object), under a fixed US time zone, and every schedule reads the way the full page's loadSchedules writes it - solar event with a signed minute offset, otherwise "at" the cron's local time plus the weekday suffix - never "[object Object]".
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'home';
const PAGE = 'tools/home.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/home"];
const GATE_FILE = 'tools/home.html';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});

/**
 * @description Run the head block against a stub kit and synthetic reads and return the family model, so the
 * schedule text is asserted as what the view paints rather than as a substring of the source.
 * @param {Record<string, object>} reads Route path -> JSON body answered by the stub fetch.
 * @returns {Promise<object>} The model the family audience returns.
 */
async function familyModel(reads) {
  let config = null;
  const kit = { boot: (c) => { config = c; }, when: () => 'soon' };
  const fetchStub = (url) => Promise.resolve({ ok: url in reads, status: url in reads ? 200 : 404, json: () => Promise.resolve(reads[url] || {}) });
  new Function('window', 'fetch', 'alert', 'confirm', block)({ AppView: kit }, fetchStub, () => {}, () => false);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return config.audiences.family({ refresh() {} });
}

test('the family view prints each schedule the way the full page does, never the trigger object', async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const reads = require('./audience-view.fixture.cjs')({ iso: (h) => new Date(Date.now() + h * 36e5).toISOString() }).reads;
    const extra = [
      { id: 's3', label: 'Blinds up', trigger: { kind: 'solar', event: 'sunrise', offsetMin: 20 }, cron: '5 11 * * *', status: 'active' },
      { id: 's4', label: 'Lamp off', trigger: { kind: 'solar', event: 'sunset', offsetMin: 0 }, cron: '0 0 * * *', status: 'active' },
      { id: 's5', label: 'Fan off', trigger: { kind: 'clock', hour: 22, minute: 0, repeat: 'daily', tzOffsetMin: 300 }, cron: '0 3 * * *', status: 'active' },
    ];
    const model = await familyModel({ ...reads, '/api/home/schedules': { schedules: reads['/api/home/schedules'].schedules.concat(extra) } });
    const items = model.sections.find((s) => s.id === 'schedules').items;
    const text = Object.fromEntries(items.map((i) => [i.title, i.text]));
    // Independent of the page's own conversion: the explicit-zone formatter says what 11:30 and 03:00 UTC are on the
    // reader's wall clock today, so a swapped minute/hour or a raw UTC time fails.
    const local = (h, m) => { const n = new Date(); return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' }).format(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), h, m))); };
    assert.equal(text['Porch on at dusk'], 'sunset -15m');
    assert.equal(text['Blinds up'], 'sunrise +20m');
    assert.equal(text['Lamp off'], 'sunset');
    assert.equal(text['Coffee maker on'], 'at ' + local(11, 30) + ' · weekdays');
    assert.equal(text['Fan off'], 'at ' + local(3, 0));
    assert.doesNotMatch(text['Coffee maker on'], /11:30/, 'the UTC cron is converted to the reader\'s wall clock');
    for (const item of items) assert.doesNotMatch(String(item.text), /\[object /, item.title + ' prints text, not an object');
  } finally {
    if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
  }
});
