// CHANGE LOG
// ----------------------------------------------------------------------------
// SEQ | AUTHOR | DESCRIPTION
// ----------------------------------------------------------------------------
// 1 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.1 regression guard: a person's SmartThings token and saved devices stay in that person's own folder. Until 1.4.1 every write was also copied to the store root and a read fell back to it, so a person with no file of their own read whoever saved last. Drives the compiled helpers against a real temporary store folder.
// ----------------------------------------------------------------------------
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-per-person-'));
process.env.OSHAL_HOME_DATA_DIR = DATA;
const {
  saveSmartThingsToken,
  readSavedSmartThingsToken,
  writeLocalSwarmDevices,
  readLocalSwarmDevices,
  readHostJson,
} = require('../routes/home-local-swarm.js');

const lamp = {
  key: 'hall-lamp', name: 'Hall lamp', room: null, category: 'light', online: true, switch: 'off', level: null,
  temperatureF: null, humidityPct: null, batteryPct: null, capabilities: ['switch'], protocol: 'lan-http', address: '192.0.2.10',
};

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

test("one person never reads another person's SmartThings token", () => {
  saveSmartThingsToken('alice', 'alice-token-0123456789');
  assert.equal(readSavedSmartThingsToken('alice').token, 'alice-token-0123456789');
  assert.equal(readSavedSmartThingsToken('bob'), null, "bob read alice's token");
  assert.ok(!fs.existsSync(path.join(DATA, 'smartthings-token.json')), 'a copy of the token was written at the store root');
});

test("one person never sees another person's saved devices", () => {
  writeLocalSwarmDevices('alice', [lamp]);
  assert.equal(readLocalSwarmDevices('alice').length, 1);
  assert.deepEqual(readLocalSwarmDevices('bob'), [], "bob saw alice's devices");
  assert.ok(!fs.existsSync(path.join(DATA, 'local-devices.json')), 'a copy of the devices was written at the store root');
});

test('a copy an earlier version left at the store root is nobody\'s file', () => {
  const leftover = path.join(DATA, 'smartthings-token.json');
  fs.writeFileSync(leftover, JSON.stringify({ token: 'leftover-token-0123456789', savedAt: '2026-11-08T00:00:00Z' }));
  try {
    assert.equal(readSavedSmartThingsToken('carol'), null, 'a root copy was read as carol\'s token');
  } finally {
    fs.rmSync(leftover, { force: true });
  }
});

test('the host-wide discovery snapshot is still read from the store root', () => {
  fs.writeFileSync(path.join(DATA, 'host-local-discovery.json'), JSON.stringify({ candidates: [{ name: 'Hall lamp' }] }));
  assert.equal(readHostJson('host-local-discovery.json').candidates[0].name, 'Hall lamp');
  assert.equal(readHostJson('absent.json'), null);
});
