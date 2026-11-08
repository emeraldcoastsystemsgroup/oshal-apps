/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Regression guard for phone-control--phone-control-config (MERGE), phone-control--phone-control-execution (FIX-LAYOUT), real UxPlay AirPlay mirroring (replacing RP-PHC-14), and explicit Bluetooth peripheral pairing direction.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: verify zero data-ds-not-yet / data-ds-backlog placeholders remain and all 13 Reference-Product session controls (RP-PHC-01..13) are wired inside #sessionSheet ahead of #endSessionBtn.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: verify AI Office-aligned 340px Controls | Concierge right rail and SVG-icon studio #sessionMirrorBtn label contract.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(PKG, relative), 'utf8');
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|#)/.test(line))
  .join('\n');

const SESSION_FEATURE_IDS = [
  'inputModeBtn',
  'ctrlAltDelBtn',
  'specialKeySelect',
  'filesDrawer',
  'clipboardDrawer',
  'monitorSelect',
  'screenshotBtn',
  'recordClipBtn',
  'qualitySelect',
  'privacyScreenBtn',
  'lockOnEndBtn',
  'chatDrawer',
  'whiteboardDrawer',
  'switchSidesBtn'
];

test('phone-control-config is merged out of ui.static while /config/ui opens the Connect sheet', () => {
  const manifest = read('oshal-app.yaml');
  assert.match(manifest, /toolName:\s*phone-control-execution/);
  assert.doesNotMatch(manifest, /toolName:\s*phone-control-config/);
  const controller = read('tools/phone-control.js');
  assert.match(controller, /location\.pathname\.includes\('\/config\/'\)/);
  assert.match(controller, /app\.openConnect\(true\)/);
});

test('first screen has one Add a device primary, no in-page tabs, and row overflow menu without native confirm', () => {
  const html = read('tools/phone-control.html');
  assert.doesNotMatch(html, /id="tabDevices"|id="tabConnect"/);
  assert.match(html, /<button id="addDeviceBtn"[^>]*class="ks-btn ks-btn-primary">Add a device<\/button>/);
  assert.doesNotMatch(html, /id="railSetUp"/);
  assert.match(html, /id="rowMenu"[^>]*role="menu"/);
  assert.match(html, /id="rowToggleControl"[\s\S]*id="rowRemoveDevice"/);
  assert.match(html, /<dialog id="removePhoneDialog"/);
  assert.match(html, /<dialog id="removeBleDialog"/);

  const stage = read('tools/phone-stage.js');
  assert.match(stage, /pc-row-more/);
  for (const script of [
    'tools/phone-control.js', 'tools/phone-stage.js', 'tools/phone-setup.js', 'tools/phone-rdp.js',
    'tools/phone-concierge.js', 'tools/session-computer.js', 'tools/session-media.js', 'tools/session-collab.js'
  ]) {
    assert.doesNotMatch(stripComments(read(script)), /\bwindow\.(confirm|alert|prompt)\b|\bconfirm\(/);
  }
});

test('Connect sheet orders Set up this computer before Pair an Android phone, hides empty computer headers, and auto-polls 5s/2m', () => {
  const html = read('tools/phone-control.html');
  assert.match(html, /id="connectSheet"[^>]*data-ds-sheet/);
  const setupIdx = html.indexOf('id="setupCard"');
  const androidIdx = html.indexOf('id="androidCard"');
  assert.ok(setupIdx > 0 && androidIdx > setupIdx, 'Set up this computer precedes Pair an Android phone');

  assert.match(html, /<ol id="installSteps" class="pc-steps">\s*<li>Install<\/li>\s*<li>Sign in<\/li>\s*<li>Press Allow<\/li>\s*<\/ol>/);
  assert.match(html, /id="waitingForComputer"[^>]*>Waiting for your computer…<\/p>/);
  assert.match(html, /<thead id="computersHead" hidden>/);
  const connectSlice = html.slice(html.indexOf('id="connectSheet"'));
  assert.doesNotMatch(connectSlice, />Refresh</i);

  const setup = read('tools/phone-setup.js');
  assert.match(setup, /WAIT_POLL_MS = 5000/);
  assert.match(setup, /WAIT_LIMIT_MS = 120000/);
  assert.match(setup, /head\.hidden = !hasComputers/);
  assert.match(setup, /\$\('pairSend'\)\.classList\.toggle\('ks-btn-primary', readyForPhone\)/);

  const fnSource = setup
    .replace(/^import[^\n]+\n/gm, '')
    .replace(/export function mountSetup[\s\S]*$/, '')
    .replace(/export function downloadNodeLabel/, 'function downloadNodeLabel');
  const sandbox = { navigator: { platform: 'Linux x86_64' } };
  vm.runInNewContext(`${fnSource}\nglobalThis.fn = downloadNodeLabel;`, sandbox);
  assert.equal(sandbox.fn('Win32'), 'Download oshal Node for Windows, macOS or Linux');
  assert.equal(sandbox.fn('MacIntel'), 'Download oshal Node for macOS, Linux or Windows');
  assert.equal(sandbox.fn('Linux x86_64'), 'Download oshal Node for Linux, macOS or Windows');
});

test('session view separates Android bottom bar, 48px Session sheet handle, ships all 13 session controls with zero planned placeholders, End session last, and desktop 340px pane', () => {
  const html = stripComments(read('tools/phone-control.html'));
  const css = read('tools/phone-control.css');
  const controller = read('tools/phone-control.js');

  const navSlice = html.slice(html.indexOf('id="androidNavBar"'), html.indexOf('id="stageStatus"'));
  assert.match(navSlice, /data-key="BACK"[^>]*>Back<\/button>/);
  assert.match(navSlice, /data-key="HOME"[^>]*>Home<\/button>/);
  assert.match(navSlice, /data-key="RECENTS"[^>]*>Recent apps<\/button>/);

  const controlSlice = html.slice(html.indexOf('id="controlBar"'), html.indexOf('id="pointerPad"'));
  assert.doesNotMatch(controlSlice, /data-key="BACK"|data-key="RECENTS"/);

  assert.match(html, /id="sessionHandleBtn"[^>]*aria-controls="sessionSheet"/);
  assert.match(css, /\.pc-session-handle\s*\{[^}]*width:\s*48px;\s*height:\s*48px/);
  assert.match(css, /\.pc-stage\s*\{[^}]*min-height:\s*90%/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*340px/);
  assert.doesNotMatch(css, /border-style:\s*dashed/);

  assert.doesNotMatch(html, /data-ds-not-yet|data-ds-backlog|RP-PHC-/, 'zero planned placeholders remain');
  const sheetSlice = html.slice(html.indexOf('id="sessionSheet"'), html.indexOf('id="connectScrim"'));
  const endIdx = sheetSlice.indexOf('id="endSessionBtn"');
  assert.ok(endIdx > 0, 'End session button exists in sessionSheet');
  for (const id of SESSION_FEATURE_IDS) {
    const idx = sheetSlice.indexOf(`id="${id}"`);
    assert.ok(idx > 0 && idx < endIdx, `#${id} appears inside #sessionSheet before #endSessionBtn`);
  }
  assert.match(html, /id="sessionToolbar"[\s\S]*id="sessionControlsBtn"[^>]*aria-label="More options"[^>]*>⋯<\/button>/);
  assert.match(html, /id="deviceFrame"[^>]*tabindex="0"/);
  assert.match(html, /id="sessionToolbar"[\s\S]*id="endSessionTopBtn"[^>]*aria-label="End session"[^>]*>✕<\/button>/);
  assert.match(html, /id="workOnIt"[^>]*class="ks-btn ks-btn-primary"|class="ks-btn ks-btn-primary"\s+id="workOnIt"/);
  assert.match(controller, /data-oshal-assistant-hidden/);
  assert.match(controller, /oshal:assistant-visibility/);
  assert.match(controller, /view === 'session'[\s\S]*app\.closeSessionSheet\?\.\(true\)/);
});

test('iPhone card ships real Start mirroring replacing RP-PHC-14, explicit Bluetooth peripheral pairing guidance, and lowercase oshal Node', () => {
  const html = stripComments(read('tools/phone-control.html'));
  assert.doesNotMatch(html, /RP-PHC-14/, 'RP-PHC-14 is shipped as real AirPlay mirroring');
  assert.match(html, /id="toggleMirrorSetup"[^>]*>Start mirroring<\/button>/);
  assert.match(html, /id="sessionMirrorBtn"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span id="sessionMirrorLabel">Start mirroring<\/span><\/button>/);
  assert.match(html, /Bluetooth keyboard peripheral[\s\S]*Settings → Bluetooth → OSHAL-KB/);
  for (const file of [
    'oshal-app.yaml', 'README.md', 'personas/device-concierge.yaml',
    'tools/phone-control.html', 'tools/phone-control.js', 'tools/phone-stage.js', 'tools/phone-concierge.js',
    'tools/phone-setup.js', 'tools/phone-rdp.js', 'tools/session-computer.js', 'tools/session-media.js', 'tools/session-collab.js'
  ]) {
    assert.doesNotMatch(stripComments(read(file)), /OSHAL Node/, `${file} still says OSHAL Node`);
  }
  assert.match(html, /OSHAL-KB/);
  assert.match(html, /Fire TV phone remote app/);
  assert.match(html, /id="tvSend"[^>]*>Load oshal TV<\/button>/);
  assert.match(html, /id="rdpCard"[\s\S]*id="rdpSetupScript"/);
});
