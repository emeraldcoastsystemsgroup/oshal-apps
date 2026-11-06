/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0, Connect a device: your computers from the kernel, and on the one you choose, Set up this computer (the bridge installed in your account there with every file's sha256 checked, adb 30 or newer, and the iPhone keyboard started, replacing the earlier test keyboard only when you press Replace the earlier test keyboard), Pair an Android phone (adb pair, then connect), Pair an iPhone (a two-minute Bluetooth pairing window) and Remove from this computer. Every result shown is what the computer answered.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: one primary at a time: Download OSHAL Node while you have no computer, then Set up this computer, or Replace the earlier test keyboard while that is the next step; Pair and Pair an iPhone are plain buttons.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.2: the setup table shows Part and State; when it was read is said once under it.
 */

import { bridgeMatches, computerStanding } from '/api/phone-control/ui/computer-link.js';

const PAIR_WINDOW_SECONDS = 120;

/** @description Mount Connect a device. @param {object} app The page. @returns {void} */
export function mountSetup(app) {
  const $ = app.byId;
  const view = { node: null, busy: false, windowTimer: null };
  const say = (id, text) => { $(id).textContent = text; };

  function phoneTools(report) {
    if (!report?.report?.version) return 'Not set up';
    const r = report.report;
    const parts = [`Bridge ${r.version}`, r.adb?.ready ? 'Android ready' : 'no Android tools', r.ble?.registered ? 'iPhone keyboard on' : r.bluetooth?.ready ? 'Bluetooth ready' : 'no Bluetooth'];
    return parts.join(' · ');
  }

  function renderComputers() {
    const body = $('computersBody');
    if (app.state.computersRefused) { body.innerHTML = ''; body.append(emptyRow(4, app.state.computersRefused)); return; }
    $('downloadNode').classList.toggle('ks-btn-primary', !app.state.computerList.length);
    if (!app.state.computerList.length) {
      body.innerHTML = '';
      body.append(emptyRow(4, 'You have no computers connected yet. Press Download OSHAL Node, install it on the computer next to your phone, sign in there and press Allow when it asks whether Jarvis may control it.'));
      return;
    }
    body.replaceChildren(...app.state.computerList.map((computer) => {
      const standing = computerStanding(computer);
      const row = document.createElement('tr');
      row.className = String(view.node) === String(computer.id) ? 'pc-row-selected' : '';
      for (const text of [computer.name || `Computer ${String(computer.id).slice(0, 8)}`, standing.text, phoneTools(app.state.reports.get(String(computer.id)))]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      const cell = document.createElement('td');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'ks-btn ks-btn-sm';
      choose.textContent = 'Use this computer';
      choose.disabled = !standing.usable;
      choose.addEventListener('click', () => chooseComputer(computer.id));
      cell.append(choose);
      row.append(cell);
      return row;
    }));
    app.refreshTables();
  }

  function emptyRow(columns, text) {
    const row = document.createElement('tr');
    row.className = 'ks-empty-row';
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.textContent = text;
    row.append(cell);
    return row;
  }

  function chooseComputer(id) {
    view.node = String(id);
    const computer = app.computer(id);
    $('setupHeading').textContent = `Set up ${computer?.name || 'this computer'}`;
    for (const card of ['setupCard', 'androidCard', 'iphoneCard']) $(card).hidden = false;
    renderComputers();
    renderReport();
    void run(() => readStatus());
  }

  /** One setup step at a time; the buttons say so while one runs. */
  async function run(step) {
    if (view.busy) { say('setupStatus', 'One step is still running on that computer.'); return; }
    view.busy = true;
    for (const id of ['setUp', 'removeBridge', 'pairSend', 'connectSend', 'pairIphone', 'replaceEarlier']) $(id).disabled = true;
    try {
      await step();
    } catch (error) {
      say('setupStatus', error.message);
    } finally {
      view.busy = false;
      for (const id of ['setUp', 'removeBridge', 'pairSend', 'connectSend', 'pairIphone', 'replaceEarlier']) $(id).disabled = false;
    }
  }

  const bridge = (verb, args, limit) => app.computers.bridge(view.node, verb, args, limit);

  async function remember(action, summary, reply) {
    await app.remember({ computerNodeId: view.node, action, summary, ok: Boolean(reply.ok), exitCode: reply.exitCode ?? null,
      error: reply.ok ? null : reply.message || reply.error });
  }

  async function readStatus() {
    const reply = await bridge('status', {}, 45000);
    if (!reply.ok) {
      say('setupStatus', reply.message);
      renderReport();
      return reply;
    }
    await app.keepReport(view.node, reply);
    renderReport();
    renderAdb(reply.adb?.devices || []);
    if (reply.ble) renderBle(reply.ble.phones || []);
    app.emit();
    return reply;
  }

  function renderReport() {
    const saved = app.state.reports.get(view.node);
    const r = saved?.report;
    const when = saved ? new Date(saved.reportedAt).toLocaleTimeString() : '';
    $('setupReadAt').textContent = r ? `Read from that computer at ${when}.` : '';
    if (!r) { $('setupBody').replaceChildren(emptyRow(2, 'phone-control is not set up on this computer yet.')); return; }
    const rows = [
      ['Phone bridge', `Version ${r.version} installed in your account`],
      ['Android tools', r.adb?.ready ? `Android tools ready (adb ${r.adb.version})` : r.adb?.message || 'adb is not set up'],
      ['Bluetooth', r.bluetooth?.ready ? `Bluetooth ready (${r.bluetooth.adapter?.name || r.bluetooth.adapter?.address}, BlueZ ${r.bluetooth.bluez || '?'})` : r.bluetooth?.message || 'Not read'],
      ['iPhone keyboard', r.ble ? `${r.ble.registered && r.ble.advertising ? 'On as OSHAL-KB' : 'Starting'}${r.ble.reportSecurity ? `, reports ${r.ble.reportSecurity}` : ''}`
        : r.earlierKeyboard ? `The earlier test keyboard (process ${r.earlierKeyboard.pid}) is running` : 'Off'],
      ['Screen pictures', r.ffmpeg ? 'ffmpeg found: small pictures' : 'No ffmpeg: full-size pictures, slow']
    ];
    $('setupBody').replaceChildren(...rows.map(([part, state]) => {
      const row = document.createElement('tr');
      for (const text of [part, state]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
      return row;
    }));
    const replace = Boolean(r.earlierKeyboard && !r.ble);
    $('replaceRow').hidden = !replace;
    // One primary: Set up this computer, or Replace the earlier test keyboard while that is the next step.
    $('setUp').classList.toggle('ks-btn-primary', !replace);
  }

  async function install() {
    say('setupStatus', 'Checking the phone bridge on that computer…');
    const manifest = await app.records.manifest();
    let version = await bridge('version', {}, 30000);
    if (bridgeMatches(version, manifest)) return true;
    say('setupStatus', `Installing phone bridge ${manifest.version}…`);
    const installed = await app.computers.install(view.node, manifest);
    await remember('set up', `Install phone bridge ${manifest.version}`, installed);
    if (!installed.ok) { say('setupStatus', installed.message); return false; }
    version = await bridge('version', {}, 30000);
    if (!bridgeMatches(version, manifest)) {
      say('setupStatus', 'The bridge on that computer does not match this version of phone-control (sha256 differs). Nothing else was started.');
      return false;
    }
    return true;
  }

  async function setUp(replaceEarlier = false) {
    if (!(await install())) return;
    say('setupStatus', 'Getting Android tools (adb) on that computer…');
    const adb = await bridge('setup-adb', {}, 300000);
    await remember('set up', 'Android tools', adb);
    const status = await readStatus();
    if (status.bluetooth?.ready) {
      say('setupStatus', replaceEarlier ? 'Replacing the earlier test keyboard…' : 'Starting the iPhone keyboard…');
      const ensured = await bridge('ensure', replaceEarlier ? { replaceEarlier: true } : {}, 60000);
      await remember('set up', replaceEarlier ? 'Replace the earlier test keyboard' : 'Start the iPhone keyboard', ensured);
      await readStatus();
      if (!ensured.ok) { say('setupStatus', ensured.message); return; }
    }
    const done = [adb.ok ? 'Android tools ready' : `Android tools: ${adb.message}`, status.bluetooth?.ready ? 'Bluetooth ready' : status.bluetooth?.message || ''];
    say('setupStatus', done.filter(Boolean).map((line) => line.replace(/\.+$/, '')).join('. ') + '.');
  }

  async function removeBridge() {
    if (!window.confirm('Remove the phone bridge, its adb copy and the iPhone keyboard from this computer? Pairings stay on the phones.')) return;
    const reply = await bridge('uninstall', {}, 60000);
    await remember('remove', 'Remove from this computer', reply);
    say('setupStatus', reply.ok ? 'Removed from this computer.' : reply.message);
    if (reply.ok) { await app.keepReport(view.node, { removed: true }); renderReport(); renderComputers(); }
  }

  async function addPhone(platform, address, name) {
    const saved = await app.records.savePhone({ platform, computerNodeId: view.node, address, name });
    app.state.phones = [saved.device, ...app.state.phones.filter((item) => item.id !== saved.device.id)];
    app.select({ kind: 'phone', id: saved.device.id });
    return saved.device;
  }

  async function addAndroid(serial) {
    const info = await bridge('adb-info', { serial }, 30000);
    const name = info.ok && info.model ? `${info.manufacturer ? `${info.manufacturer} ` : ''}${info.model}` : serial;
    const device = await addPhone('android', serial, name);
    say('androidStatus', `${device.name} is connected. Open Devices to see its screen.`);
  }

  async function pairAndroid() {
    const address = $('pairAddress').value.trim();
    const code = $('pairCode').value.trim();
    say('androidStatus', 'Pairing…');
    const paired = await bridge('adb-pair', { address, code }, 60000);
    await remember('pair', `Pair Android at ${address}`, paired);
    if (!paired.ok) { say('androidStatus', paired.message); return; }
    say('androidStatus', 'Paired. Connecting…');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const seen = await readStatus();
    const wireless = (seen.adb?.devices || []).find((device) => device.state === 'device' && device.wireless);
    if (wireless) { await addAndroid(wireless.serial); return; }
    const connected = await bridge('adb-connect', {}, 40000);
    await remember('connect', 'Connect Android (found on this network)', connected);
    if (connected.ok) { await addAndroid(connected.serial); return; }
    say('androidStatus', `${connected.message} Then press Connect.`);
  }

  async function connectAndroid() {
    const address = $('connectAddress').value.trim();
    say('androidStatus', 'Connecting…');
    const connected = await bridge('adb-connect', address ? { address } : {}, 40000);
    await remember('connect', `Connect Android${address ? ` at ${address}` : ''}`, connected);
    if (!connected.ok) { say('androidStatus', connected.message); return; }
    await addAndroid(connected.serial);
    await readStatus();
  }

  function renderAdb(devices) {
    const body = $('adbBody');
    if (!devices.length) { body.replaceChildren(emptyRow(3, 'No Android phone on this computer yet.')); return; }
    body.replaceChildren(...devices.map((device) => {
      const row = document.createElement('tr');
      for (const text of [device.model ? `${device.model} (${device.serial})` : device.serial, device.state]) {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      }
      row.append(addCell(device.state === 'device', () => run(() => addAndroid(device.serial))));
      return row;
    }));
  }

  function renderBle(phones) {
    const body = $('bleBody');
    if (!phones.length) { body.replaceChildren(emptyRow(3, 'No iPhone paired with this computer yet.')); return; }
    body.replaceChildren(...phones.map((phone) => {
      const row = document.createElement('tr');
      for (const text of [`${phone.name} (${phone.address})`, `${phone.paired ? 'paired' : 'not paired'}, ${phone.connected ? 'connected' : 'not connected'}`]) {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      }
      row.append(addCell(phone.paired, () => run(async () => {
        const device = await addPhone('ios', phone.address, phone.name);
        say('iphoneStatus', `${device.name} added. Open Devices to type on it.`);
      })));
      return row;
    }));
  }

  function addCell(enabled, onAdd) {
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ks-btn ks-btn-sm';
    button.textContent = 'Add';
    button.disabled = !enabled;
    button.addEventListener('click', onAdd);
    cell.append(button);
    return cell;
  }

  async function pairIphone() {
    const started = await bridge('ensure', {}, 60000);
    if (!started.ok) {
      await remember('pair', 'Pair an iPhone', started);
      say('iphoneStatus', started.message);
      await readStatus();
      return;
    }
    const opened = await bridge('ble-pair-window', { seconds: PAIR_WINDOW_SECONDS }, 30000);
    await remember('pair', 'Open the iPhone pairing window', opened);
    if (!opened.ok) { say('iphoneStatus', opened.message); return; }
    const until = Date.now() + PAIR_WINDOW_SECONDS * 1000;
    clearInterval(view.windowTimer);
    view.windowTimer = setInterval(() => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      say('iphoneStatus', left ? `On the iPhone: Settings, Bluetooth, tap OSHAL-KB under Other Devices, then Pair. ${left} s left.` : 'The pairing window closed.');
      if (!left) clearInterval(view.windowTimer);
      if (left && left % 6 === 0 && !view.busy) void bridge('ble-devices', {}, 20000).then((reply) => reply.ok && renderBle(reply.phones));
    }, 1000);
  }

  $('setUp').addEventListener('click', () => run(() => setUp(false)));
  $('replaceEarlier').addEventListener('click', () => run(() => setUp(true)));
  $('removeBridge').addEventListener('click', () => run(removeBridge));
  $('pairForm').addEventListener('submit', (event) => { event.preventDefault(); void run(pairAndroid); });
  $('connectForm').addEventListener('submit', (event) => { event.preventDefault(); void run(connectAndroid); });
  $('pairIphone').addEventListener('click', () => run(pairIphone));
  app.onChange(renderComputers);
}
