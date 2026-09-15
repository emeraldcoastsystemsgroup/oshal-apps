/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The transport catalog and the link budget: the free-space intercept at 2.4 GHz, the closed-form range inverting the margin exactly, ESP-NOW's design range at 10 dB near 344 m and LoRa's an order of magnitude longer, the ok flag following the required margin, the comparison table in catalog order, and the pure-engine guarantee (no framework require anywhere under routes/engine).
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Regression guard for the provenance correction: ESP-NOW encrypts at most 17 of its 20 peers, long-range mode is 4 dB (not 9) more sensitive, both rows quote Espressif's open-field test, the Wi-Fi rows sit at the IEEE minimums, LoRa's per-hop latency is the 330 ms time on air.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_DIR = path.resolve(__dirname, '..', 'routes', 'engine');
const e = require(path.join(ENGINE_DIR, 'index.js'));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('the catalog carries seven transports with complete radio numbers', () => {
  assert.equal(e.TRANSPORTS.length, 7);
  for (const t of e.TRANSPORTS) {
    for (const key of ['freqMhz', 'txPowerDbm', 'antennaGainDbi', 'sensitivityDbm', 'fadeMarginDb', 'maxFrameBytes', 'throughputKbps', 'latencyMs', 'maxPeers']) assert.ok(Number.isFinite(t[key]), `${t.id}.${key}`);
    assert.ok(t.source.length > 10, `${t.id} names its source`);
    assert.ok(['p2p', 'star', 'mesh'].includes(t.topology));
    assert.ok(['native', 'application', 'awkward'].includes(t.multiHop));
  }
  assert.equal(e.findTransport('esp-now').id, 'esp-now');
  assert.equal(e.findTransport('carrier-pigeon'), null);
});

test('the catalog carries the vendor facts, not stronger ones', () => {
  const esp = e.findTransport('esp-now');
  const lr = e.findTransport('esp-now-lr');
  assert.equal(esp.maxPeers, 20);
  assert.ok(esp.notes.some((n) => /at most 17 encrypted/.test(n)), 'ESP-NOW encrypts at most 17 peers, not 20');
  assert.ok(esp.notes.some((n) => /150 m/.test(n) && /300 m/.test(n)), 'the ESP-NOW row quotes Espressif\'s own field test');
  assert.equal(esp.sensitivityDbm - lr.sensitivityDbm, 4, 'long-range mode is about 4 dB more sensitive than 802.11b, per Espressif');
  assert.ok(lr.notes.some((n) => /450 m/.test(n) && /900 m/.test(n)));
  assert.equal(e.findTransport('wifi-direct').sensitivityDbm, -82, 'the IEEE minimum for 20 MHz MCS0');
  assert.equal(e.findTransport('wifi-mesh').sensitivityDbm, -82, 'the IEEE minimum at 6 Mbps');
  assert.equal(e.findTransport('lora-915').latencyMs, 330, 'a 50-byte SF9 frame is on the air about 330 ms');
  for (const t of e.TRANSPORTS) assert.doesNotMatch(t.source, /1000-node/, 'no unsourced capacity claims');
});

test('the free-space intercept and the closed-form range invert each other', () => {
  assert.ok(Math.abs(e.interceptDb(2437) - 40.2) < 0.1, `2.4 GHz intercept ${e.interceptDb(2437)}`);
  assert.ok(Math.abs(e.interceptDb(915) - 31.7) < 0.1, `915 MHz intercept ${e.interceptDb(915)}`);
  const t = e.findTransport('esp-now');
  for (const margin of [0, 5, 10, 20]) {
    const d = e.rangeAtMarginM(t, margin);
    assert.ok(Math.abs(e.marginDb(t, d) - margin) < 1e-6, `margin at the solved range for ${margin} dB`);
  }
  assert.ok(e.rangeAtMarginM(t, 0) > e.rangeAtMarginM(t, 10), 'more margin, less range');
  assert.ok(e.rangeAtMarginM(t, 10, 2.0) > e.rangeAtMarginM(t, 10, 2.7), 'a harsher exponent shortens the hop');
});

test('ESP-NOW sizes to a few hundred metres at 10 dB and LoRa to kilometres', () => {
  const esp = e.rangeAtMarginM(e.findTransport('esp-now'), 10);
  assert.ok(esp > 330 && esp < 360, `esp-now design range ${esp}`);
  const lr = e.rangeAtMarginM(e.findTransport('esp-now-lr'), 10);
  assert.ok(lr > 2 * esp, `long-range mode ${lr} vs ${esp}`);
  const lora = e.rangeAtMarginM(e.findTransport('lora-915'), 10);
  assert.ok(lora > 10 * esp, `lora ${lora}`);
  const wifi = e.rangeAtMarginM(e.findTransport('wifi-direct'), 10);
  assert.ok(wifi < esp, `wifi direct ${wifi} is the short one`);
});

test('a link budget reports ok exactly when the margin meets the requirement', () => {
  const t = e.findTransport('esp-now');
  const design = e.rangeAtMarginM(t, 10);
  const inside = e.linkBudget(t, design * 0.9, 10);
  const outside = e.linkBudget(t, design * 1.1, 10);
  assert.equal(inside.ok, true);
  assert.equal(outside.ok, false);
  assert.ok(inside.marginDb > 10 && outside.marginDb < 10);
  assert.equal(inside.designRangeM, Math.round(design));
  assert.ok(inside.hardRangeM > inside.designRangeM);
  assert.equal(inside.pathLossDb, Math.round(e.pathLossDb(t, design * 0.9) * 10) / 10);
  const table = e.compareTransports(500, 10);
  assert.deepEqual(table.map((b) => b.transport), e.TRANSPORTS.map((t) => t.id));
  assert.equal(table.find((b) => b.transport === 'lora-915').ok, true);
  assert.equal(table.find((b) => b.transport === 'wifi-direct').ok, false);
});

test('the compiled engine imports no framework module', () => {
  const offenders = walk(ENGINE_DIR).filter((f) => f.endsWith('.js') && /require\(["']@\//.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
