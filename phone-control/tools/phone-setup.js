/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0, Connect a device: your computers from the kernel, and on the one you choose, Set up this computer (the bridge installed in your account there with every file's sha256 checked, adb 30 or newer, and the iPhone keyboard started, replacing the earlier test keyboard only when you press Replace the earlier test keyboard), Pair an Android phone (adb pair, then connect), Pair an iPhone (a two-minute Bluetooth pairing window) and Remove from this computer. Every result shown is what the computer answered.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: one primary at a time: Download oshal Node while you have no computer, then Set up this computer, or Replace the earlier test keyboard while that is the next step; Pair and Pair an iPhone are plain buttons.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.2: the setup table shows Part and State; when it was read is said once under it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0, every press answers: Use this computer is never a silent disabled button; on a computer that is not connected, has control off, takes no commands or runs Windows or macOS it says why under the table and what to do on that computer. A press while another step runs says which step, in the card that was pressed; Connect a TV (Fire TV / Android TV) over network adb; Remove forgets a Bluetooth pairing on that computer.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: Connect sheet flow with OS-ordered oshal Node download label, 3 upright steps (Install · Sign in · Press Allow), 5s auto-refresh for 2 minutes under Waiting for your computer…, hidden empty computer headers, setup-mirror / Start mirroring / Stop mirroring for UxPlay AirPlay iPhone screen mirroring, primary progression from Set up this computer to Pair, and in-page Remove confirmations without native confirm dialogs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: Fire TV / Android TV Wi-Fi subnet scanner (adb-scan-tv), end-to-end SHA-256 verified oshal TV APK staging & installation (stage-chunk + adb-install-apk), copyable push script, #connect-tv deep-link focus, and integrated Connection Troubleshooting Concierge with 1-click fixes.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: surface #deviceKindGuide (iPhone vs Android clarity), pairAndroid host-scoped adb-connect ignoring already-connected Fire TVs, and prefill the phone IP into #connectAddress with main Wireless debugging port prompt when mDNS discovery is unavailable on the subnet.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: auto-probe the first usable Linux computer on startup, auto-register connected ADB TVs and phones into Phones & TVs, and pass serverUrl + minted joinCode to adb-install-apk for zero-touch TV provisioning.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.5.4: while the iPhone pairing window is open the page reads it every 2 s and asks about each device waiting to pair (Allow / Reject, renderPairingQuestion); a device paired before oshal asked shows Keep instead of Add.
 */

import { bridgeMatches, bridgeSupport, computerStanding } from '/api/phone-control/ui/computer-link.js';
import { mountConnectConcierge } from '/api/phone-control/ui/phone-concierge.js';
import { keepBleDevice, mountRdpAndTvBle, renderPairingQuestion, resolveCompanionApk, stageCompanionApk } from '/api/phone-control/ui/phone-rdp.js';

const PAIR_WINDOW_SECONDS = 120;
const WAIT_POLL_MS = 5000;
const WAIT_LIMIT_MS = 120000;
const TV_AUTH_POLLS = 10;
const STEP_BUTTONS = [
  'setUp', 'removeBridge', 'confirmRemoveBridge', 'pairSend', 'connectSend', 'pushAndroidApkBtn',
  'pairIphone', 'toggleMirrorSetup', 'replaceEarlier', 'scanTvBtn', 'tvSend',
  'tvConnectOnlyBtn', 'pushTvApkBtn', 'pairTvBleBtn', 'rdpConnectBtn', 'rdpProbeBtn', 'confirmRemoveBle'
];

/** @description OS-ordered download label offering the visitor's system first. @param {string} [hint] Platform hint. @returns {string} Button label. */
export function downloadNodeLabel(hint = '') {
  const raw = String(hint || globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
  if (/win/i.test(raw)) return 'Download oshal Node for Windows, macOS or Linux';
  if (/mac|iphone|ipad|ipod/i.test(raw)) return 'Download oshal Node for macOS, Linux or Windows';
  return 'Download oshal Node for Linux, macOS or Windows';
}

/** @description Mount the Connect sheet inside Phone & Device Control. @param {object} app The page. @returns {void} */
export function mountSetup(app) {
  const $ = app.byId;
  const ctx = {
    app,
    $,
    view: {
      node: null, busy: '', windowTimer: null, tvBleTimer: null, waitTimer: null, waitUntil: 0,
      wasConnectOpen: false, pendingBle: null, lastProblem: null,
      discoveredTvs: [], tvApk: null, downloadsAvailable: null, tvFocusedOnce: false
    },
    say: (id, text) => { $(id).textContent = text; },
    nodeName: () => app.computer(ctx.view.node)?.name || 'that computer',
    bridge: (verb, args, limit) => app.computers.bridge(ctx.view.node, verb, args, limit)
  };
  ctx.concierge = mountConnectConcierge(ctx);
  ctx.fail = (where, step, replyOrMsg, code = 'refused') => {
    const msg = typeof replyOrMsg === 'string' ? replyOrMsg : (replyOrMsg?.message || 'Step did not succeed.');
    const errCode = typeof replyOrMsg === 'object' && replyOrMsg?.error ? replyOrMsg.error : code;
    ctx.say(where, msg);
    ctx.concierge.flagProblem(step, errCode, msg);
  };
  ctx.run = (step, where, label) => runSetupStep(ctx, step, where, label);
  ctx.remember = (action, summary, reply) => app.remember({
    computerNodeId: ctx.view.node, action, summary, ok: Boolean(reply.ok),
    exitCode: reply.exitCode ?? null, error: reply.ok ? null : reply.message || reply.error
  });
  ctx.readStatus = () => readComputerStatus(ctx);
  ctx.install = (where = 'setupStatus') => ensureInstalledBridge(ctx, where);
  ctx.runConnectAction = (kind) => runConciergeConnectAction(ctx, kind);
  ctx.rdp = mountRdpAndTvBle(ctx, (c, p, a, n, f) => saveAndOpenPhone(c, p, a, n, f), openBleRemoveDialog);
  wireSetupHandlers(ctx);
  refreshTvPushScript(ctx);
  app.onChange(() => {
    renderComputers(ctx);
    if (!ctx.view.node && app.state.loadedOnce && !ctx.view.autoProbedOnce) {
      const candidate = app.state.computerList.find((c) => computerStanding(c).usable && bridgeSupport(c).ok);
      if (candidate && app.state.reports.has(String(candidate.id))) {
        ctx.view.autoProbedOnce = true;
        chooseComputer(ctx, candidate.id, false);
      }
    }
    syncTvDeepLink(ctx);
  });
}

function phoneToolsSummary(report) {
  if (!report?.report?.version) return 'Not set up';
  const r = report.report;
  const parts = [
    `Bridge ${r.version}`,
    r.adb?.ready ? 'Android ready' : 'no Android tools',
    r.ble?.registered ? 'iPhone keyboard on' : r.bluetooth?.ready ? 'Bluetooth ready' : 'no Bluetooth',
    r.mirror?.running ? 'AirPlay mirroring on' : r.mirror?.ready ? 'AirPlay ready' : 'no AirPlay'
  ];
  return parts.join(' · ');
}

function stopWaitPoll(ctx) {
  if (ctx.view.waitTimer) {
    clearInterval(ctx.view.waitTimer);
    ctx.view.waitTimer = null;
  }
  ctx.view.waitUntil = 0;
}

function syncWaitPoll(ctx) {
  const { app, view, say } = ctx;
  const shouldWait = app.state.connectOpen && app.state.loadedOnce && !app.state.computerList.length && !app.state.computersRefused;
  if (!shouldWait) { stopWaitPoll(ctx); return; }
  if (view.waitTimer) return;
  view.waitUntil = Date.now() + WAIT_LIMIT_MS;
  say('waitingForComputer', 'Waiting for your computer…');
  view.waitTimer = setInterval(() => {
    if (!app.state.connectOpen || app.state.computerList.length || app.state.computersRefused) {
      stopWaitPoll(ctx);
      return;
    }
    if (Date.now() >= view.waitUntil) {
      stopWaitPoll(ctx);
      say('waitingForComputer', 'Still waiting for your computer. Open Add a device again once oshal Node is signed in.');
      return;
    }
    if (document.visibilityState !== 'hidden') void app.load();
  }, WAIT_POLL_MS);
}

function syncTvDeepLink(ctx) {
  if (!ctx.app.state.connectOpen) { ctx.view.tvFocusedOnce = false; return; }
  void probeDownloadsCatalog(ctx);
  if (location.hash !== '#connect-tv' || ctx.view.tvFocusedOnce || !ctx.app.state.loadedOnce) return;
  ctx.view.tvFocusedOnce = true;
  if (!ctx.view.node) {
    const candidate = ctx.app.state.computerList.find((c) => computerStanding(c).usable && bridgeSupport(c).ok);
    if (candidate) chooseComputer(ctx, candidate.id, false);
  }
  if (!ctx.$('tvCard').hidden) {
    ctx.$('tvCard').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    ctx.$('tvAddress').focus?.();
  }
}

function buildComputerRow(ctx, computer) {
  const standing = computerStanding(computer);
  const row = document.createElement('tr');
  row.className = String(ctx.view.node) === String(computer.id) ? 'pc-row-selected' : '';
  const cells = [
    computer.name || `Computer ${String(computer.id).slice(0, 8)}`,
    standing.text,
    phoneToolsSummary(ctx.app.state.reports.get(String(computer.id)))
  ];
  for (const text of cells) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.append(cell);
  }
  const cell = document.createElement('td');
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'ks-btn ks-btn-sm';
  choose.textContent = 'Use this computer';
  choose.setAttribute('aria-describedby', 'computersStatus');
  choose.addEventListener('click', () => chooseComputer(ctx, computer.id));
  cell.append(choose);
  row.append(cell);
  return row;
}

function renderComputers(ctx) {
  const { app, $, view } = ctx;
  const body = $('computersBody');
  const head = $('computersHead');
  const wrap = $('computersTableWrap');
  const empty = $('computersEmpty');
  const refused = $('computersRefusedMsg');
  if (app.state.connectOpen && !view.wasConnectOpen) stopWaitPoll(ctx);
  view.wasConnectOpen = app.state.connectOpen;
  if (!app.state.loadedOnce) {
    head.hidden = true; wrap.hidden = true; empty.hidden = true; refused.hidden = true;
    return;
  }
  if (app.state.computersRefused) {
    stopWaitPoll(ctx);
    body.textContent = '';
    head.hidden = true; wrap.hidden = true; empty.hidden = true; refused.hidden = false;
    refused.textContent = app.state.computersRefused;
    return;
  }
  refused.hidden = true;
  const hasComputers = app.state.computerList.length > 0;
  $('downloadNode').classList.toggle('ks-btn-primary', !hasComputers);
  head.hidden = !hasComputers;
  wrap.hidden = !hasComputers;
  empty.hidden = hasComputers;
  if (!hasComputers) { body.textContent = ''; syncWaitPoll(ctx); return; }
  stopWaitPoll(ctx);
  body.replaceChildren(...app.state.computerList.map((item) => buildComputerRow(ctx, item)));
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

function showCards(ctx, visible) {
  for (const card of ['setupCard', 'deviceKindGuide', 'androidCard', 'tvCard', 'iphoneCard']) ctx.$(card).hidden = !visible;
}

function chooseComputer(ctx, id, scrollToSetup = true) {
  const { app, $, view, say } = ctx;
  const computer = app.computer(id);
  const standing = computerStanding(computer);
  const support = bridgeSupport(computer);
  const refusal = !computer ? 'That computer is no longer in your list. Reload this page.' : !standing.usable ? standing.fix : !support.ok ? support.text : '';
  if (refusal) {
    view.node = null;
    showCards(ctx, false);
    renderComputers(ctx);
    ctx.fail('computersStatus', 'choose-computer', refusal, 'computer_unusable');
    return;
  }
  ctx.concierge.clearProblem();
  view.node = String(id);
  $('removeBridgeConfirm').hidden = true;
  $('setupHeading').textContent = `Set up ${computer.name || 'this computer'}`;
  showCards(ctx, true);
  say('computersStatus', `Using ${computer.name || 'this computer'}. Set it up below, then connect a phone or a TV.`);
  renderComputers(ctx);
  renderReport(ctx);
  if (scrollToSetup) $('setupCard').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  void ctx.run(() => ctx.readStatus(), 'setupStatus', 'Reading that computer');
}

function refusalWords(ctx, error) {
  if (error?.status === 404) return 'That computer is not in your list any more. Reload this page.';
  if (error?.status === 504 || /timed? ?out|did not answer/i.test(error?.message || '')) {
    return `${ctx.nodeName()} did not answer in time. Check that oshal Node is open and signed in on it, then press again.`;
  }
  return error?.message || 'It did not work.';
}

async function runSetupStep(ctx, step, where = 'setupStatus', label = 'A setup step') {
  const { $, view, say, nodeName } = ctx;
  if (view.busy) {
    say(where, `${view.busy} is still running on ${nodeName()}. Press again when it finishes.`);
    return;
  }
  view.busy = label;
  for (const id of STEP_BUTTONS) $(id).setAttribute('aria-busy', 'true');
  try {
    await step();
  } catch (error) {
    ctx.fail(where, label, refusalWords(ctx, error), 'step_exception');
  } finally {
    view.busy = '';
    for (const id of STEP_BUTTONS) $(id).removeAttribute('aria-busy');
  }
}

async function readComputerStatus(ctx) {
  const reply = await ctx.bridge('status', {}, 45000);
  if (!reply.ok) {
    ctx.fail('setupStatus', 'status', reply);
    renderReport(ctx);
    return reply;
  }
  await ctx.app.keepReport(ctx.view.node, reply);
  renderReport(ctx);
  renderAdb(ctx, reply.adb?.devices || []);
  for (const dev of reply.adb?.devices || []) {
    if (dev.state !== 'device' || ctx.app.state.phones.some((p) => p.address === dev.serial)) continue;
    const isTvDev = String(dev.serial || '').endsWith(':5555') || /^AFT/i.test(dev.model || '');
    const name = dev.model ? String(dev.model) : (isTvDev ? `TV at ${dev.serial}` : dev.serial);
    const saved = await ctx.app.records.savePhone({
      platform: 'android', computerNodeId: ctx.view.node, address: dev.serial, name, form: isTvDev ? 'tv' : 'phone'
    }).catch(() => null);
    if (saved?.device) {
      ctx.app.state.phones = [saved.device, ...ctx.app.state.phones.filter((item) => item.id !== saved.device.id)];
    }
  }
  if (reply.ble) {
    renderBle(ctx, reply.ble.phones || []);
    ctx.rdp.renderTvBle(reply.ble.phones || []);
  }
  refreshTvPushScript(ctx);
  ctx.app.emit();
  return reply;
}

function renderReport(ctx) {
  const { app, $, view } = ctx;
  const saved = app.state.reports.get(view.node);
  const r = saved?.report;
  const when = saved ? new Date(saved.reportedAt).toLocaleTimeString() : '';
  $('setupReadAt').textContent = r ? `Read from that computer at ${when}.` : '';
  $('toggleMirrorSetup').textContent = r?.mirror?.running ? 'Stop mirroring' : 'Start mirroring';
  if (!r) {
    $('setupBody').replaceChildren(emptyRow(2, 'phone-control is not set up on this computer yet.'));
    $('replaceRow').hidden = true;
    $('setUp').classList.toggle('ks-btn-primary', true);
    $('pairSend').classList.toggle('ks-btn-primary', false);
    return;
  }
  const rows = [
    ['Phone bridge', `Version ${r.version} installed in your account`],
    ['Android tools', r.adb?.ready ? `Android tools ready (adb ${r.adb.version})` : r.adb?.message || 'adb is not set up'],
    ['Bluetooth', r.bluetooth?.ready ? `Bluetooth ready (${r.bluetooth.adapter?.name || r.bluetooth.adapter?.address}, BlueZ ${r.bluetooth.bluez || '?'})` : r.bluetooth?.message || 'Not read'],
    ['iPhone keyboard', r.ble ? `${r.ble.registered && r.ble.advertising ? 'On as OSHAL-KB' : 'Starting'}${r.ble.reportSecurity ? `, reports ${r.ble.reportSecurity}` : ''}`
      : r.earlierKeyboard ? `The earlier test keyboard (process ${r.earlierKeyboard.pid}) is running` : 'Off'],
    ['iPhone screen (AirPlay)', r.mirror?.message || 'Not set up'],
    ['Screen pictures', r.ffmpeg ? 'ffmpeg found: small pictures' : 'No ffmpeg: full-size pictures, slow']
  ];
  $('setupBody').replaceChildren(...rows.map(([part, state]) => {
    const row = document.createElement('tr');
    for (const text of [part, state]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
    return row;
  }));
  const replace = Boolean(r.earlierKeyboard && !r.ble);
  const readyForPhone = Boolean(r.adb?.ready) && !replace;
  $('replaceRow').hidden = !replace;
  $('setUp').classList.toggle('ks-btn-primary', !replace && !readyForPhone);
  $('pairSend').classList.toggle('ks-btn-primary', readyForPhone);
}

async function ensureInstalledBridge(ctx, where) {
  ctx.say(where, 'Checking the phone bridge on that computer…');
  const manifest = await ctx.app.records.manifest();
  let version = await ctx.bridge('version', {}, 30000);
  if (bridgeMatches(version, manifest)) return true;
  ctx.say(where, `Installing phone bridge ${manifest.version}…`);
  const installed = await ctx.app.computers.install(ctx.view.node, manifest);
  await ctx.remember('set up', `Install phone bridge ${manifest.version}`, installed);
  if (!installed.ok) { ctx.fail(where, 'install-bridge', installed); return false; }
  version = await ctx.bridge('version', {}, 30000);
  if (!bridgeMatches(version, manifest)) {
    ctx.fail(where, 'install-bridge', 'The bridge on that computer does not match this version of phone-control (sha256 differs). Nothing else was started.', 'sha256_mismatch');
    return false;
  }
  return true;
}

async function setUpComputer(ctx, replaceEarlier = false) {
  if (!(await ctx.install('setupStatus'))) return;
  ctx.say('setupStatus', 'Getting Android tools (adb) on that computer…');
  const adb = await ctx.bridge('setup-adb', {}, 300000);
  await ctx.remember('set up', 'Android tools', adb);
  ctx.say('setupStatus', 'Getting AirPlay screen mirroring (UxPlay) on that computer…');
  const mirror = await ctx.bridge('setup-mirror', {}, 300000);
  await ctx.remember('set up', 'AirPlay screen mirroring (UxPlay)', mirror);
  const status = await ctx.readStatus();
  if (status.bluetooth?.ready) {
    ctx.say('setupStatus', replaceEarlier ? 'Replacing the earlier test keyboard…' : 'Starting the iPhone keyboard…');
    const ensured = await ctx.bridge('ensure', replaceEarlier ? { replaceEarlier: true } : {}, 60000);
    await ctx.remember('set up', replaceEarlier ? 'Replace the earlier test keyboard' : 'Start the iPhone keyboard', ensured);
    await ctx.readStatus();
    if (!ensured.ok) { ctx.fail('setupStatus', 'ble_ensure', ensured); return; }
  }
  const done = [
    adb.ok ? 'Android tools ready' : `Android tools: ${adb.message}`,
    mirror.ok ? 'AirPlay mirroring ready' : `AirPlay mirroring: ${mirror.message}`,
    status.bluetooth?.ready ? 'Bluetooth ready' : status.bluetooth?.message || ''
  ];
  ctx.say('setupStatus', done.filter(Boolean).map((line) => line.replace(/\.+$/, '')).join('. ') + '.');
  if (!adb.ok || !mirror.ok) ctx.concierge.flagProblem('setup', adb.ok ? mirror.error : adb.error, ctx.$('setupStatus').textContent);
  else ctx.concierge.clearProblem();
}

async function removeBridgeFromComputer(ctx) {
  const reply = await ctx.bridge('uninstall', {}, 60000);
  await ctx.remember('remove', 'Remove from this computer', reply);
  ctx.say('setupStatus', reply.ok ? 'Removed from this computer.' : reply.message);
  if (reply.ok) {
    await ctx.app.keepReport(ctx.view.node, { removed: true });
    renderReport(ctx);
    renderComputers(ctx);
  }
}

async function saveAndOpenPhone(ctx, platform, address, name, form = 'phone') {
  const saved = await ctx.app.records.savePhone({ platform, computerNodeId: ctx.view.node, address, name, form });
  ctx.app.state.phones = [saved.device, ...ctx.app.state.phones.filter((item) => item.id !== saved.device.id)];
  ctx.app.closeConnect(true);
  ctx.app.select({ kind: 'phone', id: saved.device.id }, true);
  return saved.device;
}

async function addAndroid(ctx, serial) {
  const info = await ctx.bridge('adb-info', { serial }, 30000);
  const name = info.ok && info.model ? `${info.manufacturer ? `${info.manufacturer} ` : ''}${info.model}` : serial;
  const device = await saveAndOpenPhone(ctx, 'android', serial, name);
  ctx.say('androidStatus', `${device.name} added.`);
}

function parseHostFromIpPort(address) {
  const idx = address.lastIndexOf(':');
  return idx > 0 ? address.slice(0, idx).trim() : '';
}

function matchingPairedAndroid(devices, hostIp) {
  if (!hostIp) return null;
  return (devices || []).find((device) =>
    device.state === 'device'
    && device.serial.startsWith(`${hostIp}:`)
    && !device.serial.endsWith(':5555')
    && !/^AFT/i.test(device.model || '')) || null;
}

function resolveAndroidConnectArgs(rawInput, pairAddress = '', hostIp = '') {
  const raw = String(rawInput || '').trim();
  if (raw && raw !== pairAddress) {
    if (raw.endsWith(':')) return { host: raw.slice(0, -1).trim() };
    return raw.includes(':') ? { address: raw } : { host: raw };
  }
  return hostIp ? { host: hostIp } : {};
}

async function pairAndroid(ctx) {
  const address = ctx.$('pairAddress').value.trim();
  const code = ctx.$('pairCode').value.trim();
  const hostIp = parseHostFromIpPort(address);
  if (!(await ctx.install('androidStatus'))) return;
  ctx.say('androidStatus', 'Pairing…');
  const paired = await ctx.bridge('adb-pair', { address, code }, 60000);
  await ctx.remember('pair', `Pair Android at ${address}`, paired);
  if (!paired.ok) { ctx.fail('androidStatus', 'android-pair', paired); return; }
  ctx.say('androidStatus', 'Paired. Connecting…');
  const settleMs = Math.max(25, Number(globalThis.__PC_PAIR_SETTLE_MS) || 1200);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const seen = await ctx.readStatus();
  const wireless = matchingPairedAndroid(seen.adb?.devices, hostIp);
  if (wireless) { ctx.concierge.clearProblem(); await addAndroid(ctx, wireless.serial); return; }
  const typedConnect = ctx.$('connectAddress').value.trim();
  const connected = await ctx.bridge('adb-connect', resolveAndroidConnectArgs(typedConnect, address, hostIp), 40000);
  await ctx.remember('connect', `Connect Android${hostIp ? ` at ${hostIp}` : ' (found on this network)'}`, connected);
  if (connected.ok) { ctx.concierge.clearProblem(); await addAndroid(ctx, connected.serial); return; }
  if (hostIp && (!typedConnect || typedConnect === address)) {
    ctx.$('connectAddress').value = `${hostIp}:`;
    ctx.$('connectAddress').focus?.();
  }
  const prompt = hostIp
    ? `Paired! Now enter the main IP & Port shown at the top of the Wireless debugging screen (${hostIp}:_____) into Connect address and press Connect.`
    : `${connected.message} Enter the main IP & Port shown at the top of the Wireless debugging screen and press Connect.`;
  ctx.fail('androidStatus', 'android-connect', prompt, connected.error);
}

async function connectAndroid(ctx) {
  const raw = ctx.$('connectAddress').value.trim();
  if (!(await ctx.install('androidStatus'))) return;
  ctx.say('androidStatus', 'Connecting…');
  const connected = await ctx.bridge('adb-connect', resolveAndroidConnectArgs(raw), 40000);
  await ctx.remember('connect', `Connect Android${raw ? ` at ${raw}` : ''}`, connected);
  if (!connected.ok) { ctx.fail('androidStatus', 'android-connect', connected); return; }
  ctx.concierge.clearProblem();
  await addAndroid(ctx, connected.serial);
  await ctx.readStatus();
}

async function probeDownloadsCatalog(ctx) {
  const localApk = ctx.view.node ? ctx.app.state.reports.get(ctx.view.node)?.report?.tvApk || null : null;
  if (ctx.view.downloadsAvailable !== null) return ctx.view.tvApk || (localApk ? { ...localApk, local: true } : null);
  const apk = await resolveCompanionApk(localApk, false);
  ctx.view.tvApk = apk;
  ctx.view.downloadsAvailable = Boolean(apk);
  refreshTvPushScript(ctx);
  return apk;
}

function refreshTvPushScript(ctx) {
  const rawAddr = ctx.$('tvAddress')?.value?.trim() || '<tv-ip>';
  const serial = rawAddr.includes(':') ? rawAddr : `${rawAddr}:5555`;
  const localApk = ctx.view.node ? ctx.app.state.reports.get(ctx.view.node)?.report?.tvApk || null : null;
  const apk = ctx.view.tvApk || localApk;
  const origin = globalThis.location?.origin || 'https://your-oshal-host';
  const fileName = apk?.file || 'oshal-firetv.apk';
  const url = apk?.url ? `${origin}${apk.url}` : `${origin}/api/devices/downloads/${encodeURIComponent(fileName)}`;
  const shaLine = apk?.sha256 ? `echo "${apk.sha256}  oshal-firetv.apk" | sha256sum -c -` : 'sha256sum oshal-firetv.apk';
  ctx.$('tvPushScript').textContent = [
    `curl -fSL -o oshal-firetv.apk "${url}"`,
    shaLine,
    `adb connect ${serial}`,
    `adb -s ${serial} install -r oshal-firetv.apk`,
    `adb -s ${serial} shell monkey -p com.oshal.remote -c android.intent.category.LEANBACK_LAUNCHER 1`
  ].join(' &&\n');
}

async function scanTvs(ctx) {
  if (!(await ctx.install('tvStatus'))) return;
  ctx.say('tvStatus', 'Scanning your Wi-Fi for Fire TVs and Android TVs on port 5555…');
  const reply = await ctx.bridge('adb-scan-tv', {}, 35000);
  await ctx.remember('scan tv', 'Scan Wi-Fi for Fire TVs', reply);
  if (!reply.ok) { ctx.fail('tvStatus', 'tv_scan', reply); return; }
  const candidates = Array.isArray(reply.candidates) ? reply.candidates : [];
  ctx.view.discoveredTvs = candidates;
  const host = ctx.$('tvCandidates');
  host.replaceChildren(...candidates.map((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-btn ks-btn-sm';
    const label = item.model ? `${item.host}:${item.port} · ${item.model}` : `${item.host}:${item.port}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      ctx.$('tvAddress').value = item.host;
      refreshTvPushScript(ctx);
      ctx.say('tvStatus', `Selected ${item.host}. Press Load oshal TV.`);
    });
    return btn;
  }));
  host.hidden = !candidates.length;
  if (!candidates.length) {
    ctx.fail('tvStatus', 'tv_scan', 'No TV answered on port 5555 yet. Turn ADB Debugging ON under Settings → My Fire TV → Developer Options, or type its IP.', 'no_tv_found');
    return;
  }
  ctx.concierge.clearProblem();
  ctx.$('tvAddress').value = candidates[0].host;
  refreshTvPushScript(ctx);
  ctx.say('tvStatus', `Found ${candidates.length} TV${candidates.length === 1 ? '' : 's'} on Wi-Fi. Press Load oshal TV.`);
}

async function waitForTvAuthorized(ctx, address, serial, initialReply) {
  const checkNeedsAllow = async (connReply) => {
    if (connReply?.error === 'device_unauthorized') return true;
    const devs = await ctx.bridge('adb-devices', {}, 15000).catch(() => null);
    const match = (devs?.devices || []).find((d) => d.serial === serial);
    return match?.state === 'unauthorized';
  };
  if (!(await checkNeedsAllow(initialReply))) return true;
  const pollMs = Math.max(25, Number(globalThis.__PC_TV_POLL_MS) || 3000);
  for (let attempt = 1; attempt <= TV_AUTH_POLLS; attempt += 1) {
    ctx.say('tvStatus', `Look at your TV and tap Allow USB debugging using your Fire TV phone remote… (${attempt}/${TV_AUTH_POLLS})`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const retry = await ctx.bridge('adb-connect-tv', { address }, 25000);
    if (retry.ok && !(await checkNeedsAllow(retry))) return true;
  }
  ctx.fail('tvStatus', 'tv_auth', 'Still waiting for Allow USB debugging on your TV. Tap Allow using your Fire TV phone remote, then press Load oshal TV again.', 'device_unauthorized');
  return false;
}

async function finishSaveTv(ctx, serial, installedApk) {
  ctx.concierge.clearProblem();
  const info = await ctx.bridge('adb-info', { serial }, 30000);
  const name = info.ok && info.model ? `${info.manufacturer ? `${info.manufacturer} ` : ''}${info.model}` : `TV at ${serial}`;
  const device = await saveAndOpenPhone(ctx, 'android', serial, name, 'tv');
  ctx.say('tvStatus', installedApk ? `Installed and opened oshal TV on ${device.name}.` : `${device.name} connected.`);
  await ctx.readStatus();
}

function stageVerifiedApk(ctx, apk) {
  return stageCompanionApk({ apk, bridge: ctx.bridge, nodeName: ctx.nodeName(), onProgress: (m) => ctx.say('tvStatus', m) });
}

async function connectTvOnly(ctx) {
  const address = ctx.$('tvAddress').value.trim();
  if (!address) {
    ctx.fail('tvStatus', 'tv_connect', "Press Find TVs on Wi-Fi or type the TV's IP address first (Settings → My Fire TV → About → Network).", 'missing_tv_address');
    return;
  }
  if (!(await ctx.install('tvStatus'))) return;
  ctx.say('tvStatus', `Connecting to the TV at ${address}…`);
  const connected = await ctx.bridge('adb-connect-tv', { address }, 40000);
  await ctx.remember('connect', `Connect TV at ${address}`, connected);
  if (!connected.ok && connected.error !== 'device_unauthorized') { ctx.fail('tvStatus', 'tv_connect', connected); return; }
  const serial = connected.serial || (address.includes(':') ? address : `${address}:5555`);
  if (!(await waitForTvAuthorized(ctx, address, serial, connected))) return;
  await finishSaveTv(ctx, serial, false);
}

async function loadTvOneStep(ctx, requireApk = false) {
  const address = ctx.$('tvAddress').value.trim();
  if (!address) {
    ctx.fail('tvStatus', 'tv_apk', "Press Find TVs on Wi-Fi or enter the Fire Stick IP address first (Settings → My Fire TV → About → Network).", 'missing_tv_address');
    return;
  }
  if (!(await ctx.install('tvStatus'))) return;
  if (!ctx.app.state.reports.get(ctx.view.node)?.report) await ctx.readStatus();
  ctx.view.downloadsAvailable = null;
  const apk = await probeDownloadsCatalog(ctx);
  if (!apk && requireApk) {
    ctx.fail('tvStatus', 'tv_apk', 'No signed Fire TV .apk is staged on this server or computer yet. Press Connect only to control the TV over Wi-Fi now, or use Copy push script.', 'no_tv_apk');
    return;
  }
  ctx.say('tvStatus', `Connecting to ${address}… If your TV prompts Allow USB debugging?, tap Allow using your Fire TV phone remote.`);
  const connected = await ctx.bridge('adb-connect-tv', { address }, 40000);
  await ctx.remember('connect', `Connect TV at ${address}`, connected);
  if (!connected.ok && connected.error !== 'device_unauthorized') { ctx.fail('tvStatus', 'tv_apk', connected); return; }
  const serial = connected.serial || (address.includes(':') ? address : `${address}:5555`);
  if (!(await waitForTvAuthorized(ctx, address, serial, connected))) return;
  if (!apk) { await finishSaveTv(ctx, serial, false); return; }
  let staged = await stageVerifiedApk(ctx, apk);
  const serverUrl = globalThis.location?.origin || 'https://oshal.agenticfederal.us';
  const installPayload = {
    serial, stageId: staged.stageId, sha256: staged.sha256,
    launchPackage: 'com.oshal.remote', serverUrl
  };
  ctx.say('tvStatus', `Installing and launching oshal TV on ${serial}…`);
  let installed = await ctx.bridge('adb-install-apk', installPayload, 180000);
  if (!installed.ok && installed.error === 'device_unauthorized') {
    if (!(await waitForTvAuthorized(ctx, address, serial, installed))) return;
    staged = await stageVerifiedApk(ctx, apk);
    installed = await ctx.bridge('adb-install-apk', { ...installPayload, stageId: staged.stageId, sha256: staged.sha256 }, 180000);
  }
  await ctx.remember('install apk', `Push oshal TV app to ${serial}`, installed);
  if (!installed.ok) { ctx.fail('tvStatus', 'tv_apk', installed); return; }
  await finishSaveTv(ctx, serial, true);
}

function actionCell(enabled, onPress, label = 'Add') {
  const cell = document.createElement('td');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ks-btn ks-btn-sm';
  button.textContent = label;
  button.disabled = !enabled;
  button.addEventListener('click', onPress);
  cell.append(button);
  return cell;
}

function renderAdb(ctx, devices) {
  const body = ctx.$('adbBody');
  if (!devices.length) { body.replaceChildren(emptyRow(3, 'No Android phone on this computer yet.')); return; }
  body.replaceChildren(...devices.map((device) => {
    const row = document.createElement('tr');
    for (const text of [device.model ? `${device.model} (${device.serial})` : device.serial, device.state]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    row.append(actionCell(device.state === 'device', () => ctx.run(() => addAndroid(ctx, device.serial), 'androidStatus', 'Adding the phone')));
    return row;
  }));
}

function openBleRemoveDialog(ctx, phone) {
  ctx.view.pendingBle = phone;
  ctx.$('removeBleTitle').textContent = `Remove ${phone.name}?`;
  ctx.$('removeBleBody').textContent = `Remove ${phone.name} from ${ctx.nodeName()}? It stops working with this computer until paired again.`;
  const dialog = ctx.$('removeBleDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeBleRemoveDialog(ctx) {
  ctx.view.pendingBle = null;
  const dialog = ctx.$('removeBleDialog');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

async function confirmRemoveBle(ctx) {
  const phone = ctx.view.pendingBle;
  closeBleRemoveDialog(ctx);
  if (!phone) return;
  const removed = await ctx.bridge('ble-remove', { address: phone.address }, 30000);
  await ctx.remember('remove', `Remove the Bluetooth pairing of ${phone.name}`, removed);
  if (!removed.ok) { ctx.fail('iphoneStatus', 'ble_remove', removed); return; }
  const matches = ctx.app.state.phones.filter(
    (item) => item.platform === 'ios' && item.address === phone.address && item.computerNodeId === ctx.view.node
  );
  for (const record of matches) {
    await ctx.app.records.removePhone(record.id);
    ctx.app.state.phones = ctx.app.state.phones.filter((item) => item.id !== record.id);
  }
  ctx.say('iphoneStatus', `${phone.name} was removed from ${ctx.nodeName()}.`);
  await ctx.readStatus();
}

function renderBle(ctx, phones) {
  const body = ctx.$('bleBody');
  if (!phones.length) { body.replaceChildren(emptyRow(4, 'No iPhone paired with this computer yet.')); return; }
  body.replaceChildren(...phones.map((phone) => {
    const row = document.createElement('tr');
    const before = phone.paired && phone.allowed === false;
    const state = `${phone.paired ? 'paired' : 'not paired'}, ${phone.connected ? 'connected' : 'not connected'}${before ? ', paired before oshal asked' : ''}`;
    for (const text of [`${phone.name} (${phone.address})`, state]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    row.append(before
      ? actionCell(true, () => ctx.run(() => keepBleDevice(ctx, 'iphoneStatus', phone), 'iphoneStatus', 'Keeping the device'), 'Keep')
      : actionCell(phone.paired, () => ctx.run(async () => {
        const device = await saveAndOpenPhone(ctx, 'ios', phone.address, phone.name);
        ctx.say('iphoneStatus', `${device.name} added.`);
      }, 'iphoneStatus', 'Adding the iPhone')));
    row.append(actionCell(phone.paired, () => openBleRemoveDialog(ctx, phone), 'Remove'));
    return row;
  }));
}

async function pairIphone(ctx) {
  if (!(await ctx.install('iphoneStatus'))) return;
  const started = await ctx.bridge('ensure', {}, 60000);
  if (!started.ok) {
    await ctx.remember('pair', 'Pair an iPhone', started);
    ctx.fail('iphoneStatus', 'iphone-pair', started);
    await ctx.readStatus();
    return;
  }
  const opened = await ctx.bridge('ble-pair-window', { seconds: PAIR_WINDOW_SECONDS }, 30000);
  await ctx.remember('pair', 'Open the iPhone pairing window', opened);
  if (!opened.ok) { ctx.fail('iphoneStatus', 'iphone-pair', opened); return; }
  ctx.concierge.clearProblem();
  const until = Date.now() + PAIR_WINDOW_SECONDS * 1000;
  clearInterval(ctx.view.windowTimer);
  ctx.view.windowTimer = setInterval(() => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    ctx.say('iphoneStatus', left
      ? `On the iPhone: Settings → Bluetooth, tap OSHAL-KB under Other Devices, then Pair. ${left} s left.`
      : 'The pairing window closed.');
    if (!left) { clearInterval(ctx.view.windowTimer); renderPairingQuestion(ctx, 'iphoneStatus', []); }
    if (left && left % 2 === 0 && !ctx.view.busy) {
      void ctx.bridge('ble-devices', {}, 20000).then((reply) => {
        if (!reply.ok) return;
        renderBle(ctx, reply.phones);
        renderPairingQuestion(ctx, 'iphoneStatus', reply.pairing || []);
      });
    }
  }, 1000);
}

async function toggleMirrorFromSetup(ctx) {
  if (!(await ctx.install('iphoneStatus'))) return;
  const saved = ctx.app.state.reports.get(ctx.view.node)?.report;
  if (saved?.mirror?.running) {
    const stopped = await ctx.bridge('mirror-stop', {}, 30000);
    await ctx.remember('mirror', 'Stop iPhone screen mirroring', stopped);
    ctx.say('iphoneStatus', stopped.ok ? 'Screen mirroring stopped.' : stopped.message);
    await ctx.readStatus();
    return;
  }
  ctx.say('iphoneStatus', 'Starting AirPlay receiver…');
  let started = await ctx.bridge('mirror-start', {}, 45000);
  if (!started.ok && started.error === 'no_uxplay') {
    ctx.say('iphoneStatus', 'Setting up UxPlay on that computer…');
    const setup = await ctx.bridge('setup-mirror', {}, 300000);
    await ctx.remember('set up', 'AirPlay screen mirroring (UxPlay)', setup);
    if (!setup.ok) { ctx.fail('iphoneStatus', 'mirror_setup', setup); return; }
    started = await ctx.bridge('mirror-start', {}, 45000);
  }
  await ctx.remember('mirror', 'Start iPhone screen mirroring', started);
  if (!started.ok) { ctx.fail('iphoneStatus', 'mirror_start', started); return; }
  ctx.concierge.clearProblem();
  ctx.say('iphoneStatus', `AirPlay receiver is on as ${started.receiverName}. On the iPhone, open Control Center → Screen Mirroring → ${started.receiverName} on the same Wi-Fi.`);
  await ctx.readStatus();
}

function runConciergeConnectAction(ctx, kind) {
  if (kind === 'connect_rdp') {
    void ctx.run(() => ctx.rdp.connectRdp(), 'rdpStatus', 'Connecting RDP');
    return;
  }
  if (!ctx.view.node) {
    ctx.say('computersStatus', 'Press Use this computer on a connected Linux computer first.');
    return;
  }
  if (kind === 'scan_tvs') void ctx.run(() => scanTvs(ctx), 'tvStatus', 'Scanning Wi-Fi for TVs');
  else if (kind === 'connect_tv') void ctx.run(() => loadTvOneStep(ctx, false), 'tvStatus', 'Loading oshal TV');
  else if (kind === 'push_tv_apk') void ctx.run(() => loadTvOneStep(ctx, true), 'tvStatus', 'Loading oshal TV');
  else if (kind === 'pair_tv_ble') void ctx.run(() => ctx.rdp.pairTvBle(), 'tvBleStatus', 'Opening TV Bluetooth pairing');
  else if (kind === 'probe_rdp') void ctx.run(() => ctx.rdp.probeRdp(), 'rdpStatus', 'Checking RDP port');
  else if (kind === 'open_ble_window') void ctx.run(() => pairIphone(ctx), 'iphoneStatus', 'Opening the pairing window');
  else if (kind === 'setup_adb') void ctx.run(() => setUpComputer(ctx, false), 'setupStatus', 'Set up');
  else if (kind === 'setup_mirror') void ctx.run(() => toggleMirrorFromSetup(ctx), 'iphoneStatus', 'Screen mirroring');
  else if (kind === 'check_computer') void ctx.run(() => ctx.readStatus(), 'setupStatus', 'Reading that computer');
}

function wireSetupHandlers(ctx) {
  const { $ } = ctx;
  $('downloadNode').textContent = downloadNodeLabel();
  $('setUp').addEventListener('click', () => ctx.run(() => setUpComputer(ctx, false), 'setupStatus', 'Set up'));
  $('replaceEarlier').addEventListener('click', () => ctx.run(() => setUpComputer(ctx, true), 'setupStatus', 'Set up'));
  $('removeBridge').addEventListener('click', () => { $('removeBridgeConfirm').hidden = false; });
  $('cancelRemoveBridge').addEventListener('click', () => { $('removeBridgeConfirm').hidden = true; });
  $('confirmRemoveBridge').addEventListener('click', () => {
    $('removeBridgeConfirm').hidden = true;
    void ctx.run(() => removeBridgeFromComputer(ctx), 'setupStatus', 'Remove from this computer');
  });
  $('pairForm').addEventListener('submit', (event) => { event.preventDefault(); void ctx.run(() => pairAndroid(ctx), 'androidStatus', 'Pairing'); });
  $('connectForm').addEventListener('submit', (event) => { event.preventDefault(); void ctx.run(() => connectAndroid(ctx), 'androidStatus', 'Connecting'); });
  $('scanTvBtn').addEventListener('click', () => void ctx.run(() => scanTvs(ctx), 'tvStatus', 'Scanning Wi-Fi for TVs'));
  $('tvForm').addEventListener('submit', (event) => { event.preventDefault(); void ctx.run(() => loadTvOneStep(ctx, false), 'tvStatus', 'Loading oshal TV'); });
  $('tvConnectOnlyBtn').addEventListener('click', () => void ctx.run(() => connectTvOnly(ctx), 'tvStatus', 'Connecting the TV'));
  $('pushTvApkBtn').addEventListener('click', () => void ctx.run(() => loadTvOneStep(ctx, true), 'tvStatus', 'Loading oshal TV'));
  $('tvAddress').addEventListener('input', () => refreshTvPushScript(ctx));
  $('copyTvScriptBtn').addEventListener('click', async () => {
    refreshTvPushScript(ctx);
    try {
      await navigator.clipboard?.writeText?.($('tvPushScript').textContent);
      ctx.say('tvStatus', 'Copied TV push script to clipboard.');
    } catch {
      ctx.say('tvStatus', 'Select and copy the push script from the box above.');
    }
  });
  $('pairIphone').addEventListener('click', () => ctx.run(() => pairIphone(ctx), 'iphoneStatus', 'Opening the pairing window'));
  $('toggleMirrorSetup').addEventListener('click', () => ctx.run(() => toggleMirrorFromSetup(ctx), 'iphoneStatus', 'Screen mirroring'));
  $('cancelRemoveBle').addEventListener('click', () => closeBleRemoveDialog(ctx));
  $('confirmRemoveBle').addEventListener('click', () => void ctx.run(() => confirmRemoveBle(ctx), 'iphoneStatus', 'Removing a pairing'));
}
