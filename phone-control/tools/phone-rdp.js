/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: RDP host setup scripts (Windows PowerShell Admin, Linux GNOME/xrdp, macOS FreeRDP Shadow, Any RDP Host), X.224 rdp-probe verification, live /api/rdp/sessions unified console frame stream + click/drag/keyboard/snapshot/Concierge execution, and optional Fire TV Bluetooth OSHAL-KB pairing helper.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: prevent Android companion APK resolution from falling back to the Fire TV APK, exclude Fire TVs when picking a connected Android phone, launch com.oshal.orbit instead of com.oshal.remote, and host shared AI Office studio stage helpers (device switcher, Controls | Concierge rail tabs, fullscreen stage + HUD, DRM notice, and touch indicator).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: support Swarm-enrolled Android nodes in renderScreenItems and renderDeviceSwitcher.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: mint Swarm join codes for zero-touch APK provisioning, launch com.oshal.remote with serverUrl and joinCode extras, and wire #stagePushApkBtn for one-click stage APK updates.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.5.1: Connect in console stays hidden until an RDP session backend exists (nothing implements /api/rdp/sessions; the page marks the button and its sign-in fields hidden), so the Any RDP Host steps and the Check RDP port refusal no longer send the person to it. The session viewer below is kept for that backend.
 */

import { bytesToBase64, isAndroidNode, isTvNode, sha256Hex, swipeFromDrag, tapPoint, workHref } from '/api/phone-control/ui/computer-link.js';

const PAIR_WINDOW_SECONDS = 120;
const APK_CHUNK_BYTES = 36864;
const RDP_SWIPES = Object.freeze({
  left: { nx1: 0.82, ny1: 0.52, nx2: 0.18, ny2: 0.52 },
  right: { nx1: 0.18, ny1: 0.52, nx2: 0.82, ny2: 0.52 },
  up: { nx1: 0.5, ny1: 0.76, nx2: 0.5, ny2: 0.24 },
  down: { nx1: 0.5, ny1: 0.24, nx2: 0.5, ny2: 0.76 }
});

const RDP_SCRIPTS = Object.freeze({
  windows: [
    '# Run in PowerShell as Administrator on the Windows PC:',
    'Set-ItemProperty -Path "HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0',
    'Set-ItemProperty -Path "HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name "UserAuthentication" -Value 1',
    'Enable-NetFirewallRule -DisplayGroup "Remote Desktop"',
    'Start-Service TermService',
    'Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | ForEach-Object { "RDP ready: $($_.IPAddress):3389" }'
  ].join('\n'),
  linux: [
    '# Run in bash on the Linux desktop (GNOME Remote Desktop or xrdp on TCP 3389):',
    'if command -v grdctl >/dev/null 2>&1; then',
    '  grdctl rdp enable && systemctl --user enable --now gnome-remote-desktop.service',
    'else',
    '  sudo apt-get update && sudo apt-get install -y xrdp && sudo systemctl enable --now xrdp',
    'fi',
    'echo "RDP ready: $(hostname -I | awk \'{print $1}\'):3389"'
  ].join('\n'),
  macos: [
    '# Run in Terminal on macOS (Homebrew FreeRDP shadow server on TCP 3389):',
    'brew install freerdp',
    'echo "RDP target: $(ipconfig getifaddr en0 || ipconfig getifaddr en1):3389"',
    'freerdp-shadow-cli /port:3389 +auth'
  ].join('\n'),
  any: [
    '# Any Windows, Linux, VM or cloud RDP host reachable from your Linux computer:',
    '# 1. Ensure Remote Desktop listens on TCP 3389 (or your custom port) with NLA/TLS enabled.',
    '# 2. Allow TCP 3389 on your LAN or Tailscale/WireGuard subnet.',
    '# 3. Enter the host and port below and press Check RDP port.'
  ].join('\n')
});

const RDP_OS_BUTTONS = Object.freeze([
  ['windows', 'rdpOsWindowsBtn'],
  ['linux', 'rdpOsLinuxBtn'],
  ['macos', 'rdpOsMacBtn'],
  ['any', 'rdpOsAnyBtn']
]);

/** @description Format a readable label for an active RDP session. @param {object} rdp Session record. @returns {string} Label. */
export function rdpLabel(rdp) {
  if (!rdp) return 'RDP desktop';
  const port = rdp.port && Number(rdp.port) !== 3389 ? `:${rdp.port}` : ':3389';
  return `${rdp.username ? `${rdp.username}@` : ''}${rdp.host || 'rdp'}${port}`;
}

/** @description Render the stage header for an active RDP session. @param {object} ctx Stage context. @param {object} rdp Session record. @returns {void} */
export function renderRdpHead(ctx, rdp) {
  const { $, view } = ctx;
  const w = view.frame?.deviceWidth || rdp.width || 1280;
  const h = view.frame?.deviceHeight || rdp.height || 800;
  const state = rdp.connected === false ? 'disconnected' : 'connected';
  $('stageTitle').textContent = rdpLabel(rdp);
  $('stageSub').textContent = `RDP desktop · ${w}×${h} · ${state}`;
  $('appInput').placeholder = 'App name or command';
  if ($('screenImage').hidden) {
    $('screenNote').textContent = rdp.connected === false ? 'RDP session disconnected.' : 'Reading live RDP desktop…';
  }
}

/** @description Poll live PNG frames from /api/rdp/sessions/:id/frame onto #screenImage. @param {object} ctx Stage context. @param {number} generation Session token. @param {Function} showPicture Stage image updater. @returns {Promise<void>} */
export async function rdpLoop(ctx, generation, showPicture) {
  const { app, $, queue, view } = ctx;
  while (generation === view.generation) {
    const rdp = ctx.selectedRdp();
    if (!rdp) return;
    if (document.visibilityState === 'visible' && !app.state.connectOpen) {
      const job = queue.refresh(() => app.rdp.frame(rdp.sessionId));
      if (job) {
        try {
          const frame = await job;
          if (generation !== view.generation) return;
          view.frame = { width: frame.width, height: frame.height, deviceWidth: frame.width, deviceHeight: frame.height };
          showPicture(ctx, frame.blob);
          renderRdpHead(ctx, rdp);
          $('screenNote').textContent = '';
        } catch (error) {
          if (generation !== view.generation) return;
          $('screenNote').textContent = `RDP screen could not be read: ${error.message}`;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, ctx.sessionMedia.computerFrameMs()));
  }
}

/** @description Send a queued input payload to /api/rdp/sessions/:id/input and update status. @param {object} ctx Stage context. @param {object} rdp Session record. @param {object} payload Input body. @param {string} summary Human label. @returns {Promise<object>} Reply. */
export async function sendRdpInput(ctx, rdp, payload, summary) {
  ctx.status(`${summary}…`);
  try {
    const reply = await ctx.app.rdp.input(rdp.sessionId, payload);
    const ok = reply?.ok !== false;
    ctx.status(ok ? `${summary}: done.` : (reply?.message || reply?.error || 'RDP input refused.'));
    return ok ? { ok: true, ...reply } : { ok: false, ...reply };
  } catch (error) {
    ctx.status(error.message);
    return { ok: false, error: 'rdp_refused', message: error.message };
  }
}

/** @description Map a click or drag on #screenImage directly to RDP pixel coordinates. @param {object} ctx Stage context. @param {object} rdp Session record. @param {object} start Pointer-down point. @param {object} end Pointer-up point. @returns {void} */
export function handleRdpPointerUp(ctx, rdp, start, end) {
  ctx.$('deviceFrame').focus({ preventScroll: true });
  const w = ctx.view.frame?.deviceWidth || rdp.width || 1280;
  const h = ctx.view.frame?.deviceHeight || rdp.height || 800;
  const frame = ctx.view.frame || { width: w, height: h, deviceWidth: w, deviceHeight: h };
  try {
    const swipe = swipeFromDrag(start, end, end.box, frame, performance.now() - start.at);
    if (swipe) {
      void ctx.queue.press(() => sendRdpInput(ctx, rdp, {
        action: 'drag', x1: swipe.x1, y1: swipe.y1, x2: swipe.x2, y2: swipe.y2
      }, 'Drag'));
      return;
    }
    const point = tapPoint(end, end.box, frame);
    void ctx.queue.press(() => sendRdpInput(ctx, rdp, {
      action: 'click', x: point.x, y: point.y
    }, `Click at ${point.x}, ${point.y}`));
  } catch (error) {
    ctx.status(error.message);
  }
}

/** @description Render clickable screen-text Tap rows for phones, TVs, and RDP sessions. @param {object} ctx Stage context. @param {{phone?:object,rdp?:object}} target Active target. @param {object} reply Screen items payload. @returns {void} */
export function renderScreenItems(ctx, target, reply) {
  const body = ctx.$('screenTextBody');
  const items = Array.isArray(reply?.items) ? reply.items : [];
  if (!items.length) {
    body.innerHTML = '<tr class="ks-empty-row"><td colspan="4">No words on this screen.</td></tr>';
    return;
  }
  const { phone, rdp, computer } = target;
  body.replaceChildren(...items.map((item) => {
    const row = document.createElement('tr');
    for (const value of [item.text, item.x, item.y]) {
      const cell = document.createElement('td');
      cell.textContent = String(value ?? '');
      if (typeof value === 'number') cell.className = 'ks-num';
      row.append(cell);
    }
    const cell = document.createElement('td');
    const tap = document.createElement('button');
    tap.type = 'button';
    tap.className = 'ks-btn ks-btn-sm';
    tap.textContent = 'Tap';
    tap.addEventListener('click', () => {
      if (rdp) {
        void ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'click', x: item.x, y: item.y }, `Click ${item.text}`));
      } else if (computer) {
        void ctx.queue.press(async () => {
          ctx.status(`Tap ${item.text}…`);
          await ctx.app.computers.run(computer.id, 'mouse.click', { x: item.x, y: item.y, button: 'left', clicks: 1 });
          ctx.scheduleFastFrame(260);
          ctx.status(`Tap ${item.text}: done.`);
        });
      } else if (phone?.platform === 'ios') {
        ctx.press('tap', `Tap ${item.text}`, 'ble-tap', { nx: item.nx, ny: item.ny });
      } else if (phone) {
        ctx.press('tap', `Tap ${item.text}`, 'adb-tap', { x: item.x, y: item.y });
      }
    });
    cell.append(tap);
    row.append(cell);
    return row;
  }));
  const where = rdp ? rdpLabel(rdp) : computer ? (computer.name || 'the device') : phone?.platform === 'ios' ? 'the mirrored iPhone screen' : (reply.package || 'the current app');
  ctx.$('screenTextHelp').textContent = `${items.length} on screen in ${where}${reply.truncated ? ' (the first ones only)' : ''}.`;
  ctx.app.refreshTables();
}

/** @description Read screen words from an active RDP session via snapshot and populate #screenTextBody. @param {object} ctx Stage context. @param {object} rdp Session record. @returns {void} */
export function readRdpScreen(ctx, rdp) {
  void ctx.queue.press(async () => {
    const reply = await sendRdpInput(ctx, rdp, { action: 'snapshot' }, 'Read the screen');
    if (reply.ok) renderScreenItems(ctx, { rdp }, reply);
  });
}

/** @description Load and render recent owner history rows for the active device. @param {object} ctx Stage context. @returns {Promise<void>} */
export async function loadStageHistory(ctx) {
  const phone = ctx.selectedPhone();
  const body = ctx.$('historyBody');
  try {
    const history = await ctx.app.records.history(phone?.id);
    if (!history.length) {
      body.innerHTML = '<tr class="ks-empty-row"><td colspan="4">Nothing sent yet.</td></tr>';
      return;
    }
    body.replaceChildren(...history.map((event) => {
      const row = document.createElement('tr');
      const cells = [new Date(event.createdAt).toLocaleString(), event.action, event.error ? `${event.summary}: ${event.error}` : event.summary];
      for (const value of cells) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      const result = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `ks-pill ${event.ok ? 'tone-ok' : 'tone-warn'}`;
      pill.textContent = event.ok ? 'Worked' : 'Failed';
      result.append(pill);
      row.append(result);
      return row;
    }));
    ctx.app.refreshTables();
  } catch (error) {
    body.innerHTML = '';
    ctx.status(`History could not be read: ${error.message}`);
  }
}

/** @description Execute one in-app Concierge action on an active RDP session. @param {object} ctx Stage context. @param {object} rdp Session record. @param {object} action Sanitized Concierge action. @param {object} state Concierge turn state. @returns {Promise<{reply:object,stepText:string}>} Outcome. */
export async function executeRdpConciergeAction(ctx, rdp, action, state) {
  const w = state.screen?.width || ctx.view.frame?.deviceWidth || rdp.width || 1280;
  const h = state.screen?.height || ctx.view.frame?.deviceHeight || rdp.height || 800;
  if (action.kind === 'read_screen') {
    const reply = await sendRdpInput(ctx, rdp, { action: 'snapshot' }, 'Read RDP screen');
    if (reply.ok) {
      state.screen = { width: w, height: h, items: Array.isArray(reply.items) ? reply.items : [], frameSha256: reply.frameSha256 || String(Date.now()) };
      renderScreenItems(ctx, { rdp }, reply);
    }
    return { reply, stepText: reply.ok ? `Read ${state.screen.items.length} labels on screen` : '' };
  }
  if (action.kind === 'open_app') {
    await sendRdpInput(ctx, rdp, { action: 'key', key: 'Super' }, 'Open launcher');
    const reply = await sendRdpInput(ctx, rdp, { action: 'type', text: action.name, enter: true }, `Open ${action.name}`);
    return { reply, stepText: `Launched ${action.name}` };
  }
  if (action.kind === 'move' || action.kind === 'tap') {
    const x = Number.isFinite(action.x) ? action.x : Math.round(action.nx * w);
    const y = Number.isFinite(action.y) ? action.y : Math.round(action.ny * h);
    const rdpAct = action.kind === 'move' ? 'move' : 'click';
    const reply = await sendRdpInput(ctx, rdp, { action: rdpAct, x, y }, `${action.kind === 'move' ? 'Move to' : 'Click'} ${x}, ${y}`);
    return { reply, stepText: `${action.kind === 'move' ? 'Moved pointer to' : 'Clicked'} ${action.label || `${x}, ${y}`}` };
  }
  if (action.kind === 'drag_icon' || action.kind === 'swipe') {
    const vec = action.kind === 'swipe' ? (RDP_SWIPES[action.direction] || RDP_SWIPES.left) : action;
    const reply = await sendRdpInput(ctx, rdp, {
      action: 'drag', x1: Math.round(vec.nx1 * w), y1: Math.round(vec.ny1 * h),
      x2: Math.round(vec.nx2 * w), y2: Math.round(vec.ny2 * h)
    }, action.label || 'Drag');
    return { reply, stepText: action.label || `Dragged ${action.direction || 'selection'}` };
  }
  if (action.kind === 'type') {
    const reply = await sendRdpInput(ctx, rdp, { action: 'type', text: action.text, enter: Boolean(action.enter) }, `Type ${action.text.length} chars`);
    return { reply, stepText: `Typed "${action.text.slice(0, 28)}"` };
  }
  if (action.kind === 'calibrate_pointer') return { reply: { ok: true }, stepText: 'RDP uses direct pixel coordinates' };
  const reply = await sendRdpInput(ctx, rdp, { action: 'key', key: action.key }, `Press ${action.key}`);
  return { reply, stepText: `Pressed ${action.key}` };
}

function selectRdpOs(ctx, osKey) {
  const { $ } = ctx;
  const chosen = RDP_SCRIPTS[osKey] ? osKey : 'windows';
  for (const [key, btnId] of RDP_OS_BUTTONS) {
    $(btnId).setAttribute('aria-pressed', String(key === chosen));
  }
  $('rdpSetupScript').textContent = RDP_SCRIPTS[chosen];
}

async function connectRdpSession(ctx) {
  const { $, app } = ctx;
  const host = $('rdpHost').value.trim();
  const port = Number($('rdpPort').value) || 3389;
  const username = $('rdpUsername').value.trim();
  const password = $('rdpPassword').value;
  const domain = $('rdpDomain').value.trim();
  if (!host) {
    ctx.fail('rdpStatus', 'rdp_connect', 'Enter the RDP host IP address or hostname first.', 'bad_host');
    return;
  }
  if (!username) {
    ctx.fail('rdpStatus', 'rdp_connect', 'Enter the RDP username to connect in this console.', 'bad_username');
    return;
  }
  ctx.say('rdpStatus', `Connecting to ${username}@${host}:${port}…`);
  const session = await app.rdp.create({
    host, port, username, password, ...(domain ? { domain } : {}), width: 1280, height: 800
  });
  $('rdpPassword').value = '';
  ctx.concierge.clearProblem();
  app.state.rdpSessions = [session, ...app.state.rdpSessions.filter((s) => s.sessionId !== session.sessionId)];
  ctx.say('rdpStatus', `Connected to ${rdpLabel(session)}.`);
  app.closeConnect(true);
  app.select({ kind: 'rdp', id: session.sessionId }, true);
}

async function probeRdpHost(ctx) {
  const { $ } = ctx;
  const rawHost = $('rdpHost').value.trim();
  const port = Number($('rdpPort').value) || 3389;
  $('rdpWorkLink').hidden = true;
  if (!rawHost) {
    ctx.fail('rdpStatus', 'rdp_probe', 'Enter the RDP host IP address or hostname first.', 'bad_host');
    return;
  }
  if (!ctx.view.node) {
    ctx.fail('rdpStatus', 'rdp_probe', 'Press Use this computer above first: the check runs from your Linux computer on the same network as the RDP host.', 'no_computer');
    return;
  }
  if (!(await ctx.install('rdpStatus'))) return;
  ctx.say('rdpStatus', `Checking RDP on ${rawHost}:${port} from ${ctx.nodeName()}…`);
  const reply = await ctx.bridge('rdp-probe', { host: rawHost, port }, 15000);
  await ctx.remember('rdp probe', `Check RDP at ${rawHost}:${port}`, reply);
  if (!reply.ok) { ctx.fail('rdpStatus', 'rdp_probe', reply); return; }
  ctx.concierge.clearProblem();
  const detail = reply.rdpHandshake
    ? `RDP X.224 handshake verified at ${reply.address} (${reply.security || reply.protocol}, ${reply.latencyMs} ms).`
    : `TCP port open at ${reply.address} (${reply.latencyMs} ms).`;
  ctx.say('rdpStatus', detail);
  $('rdpWorkLink').href = `${workHref(ctx.view.node)}&rdp=${encodeURIComponent(reply.address)}`;
  $('rdpWorkLink').hidden = false;
}

async function pairTvBluetooth(ctx, renderBleRows) {
  if (!(await ctx.install('tvBleStatus'))) return;
  const started = await ctx.bridge('ensure', {}, 60000);
  if (!started.ok) {
    await ctx.remember('pair', 'Start Bluetooth keyboard for TV', started);
    ctx.fail('tvBleStatus', 'tv_ble_pair', started);
    await ctx.readStatus();
    return;
  }
  const opened = await ctx.bridge('ble-pair-window', { seconds: PAIR_WINDOW_SECONDS }, 30000);
  await ctx.remember('pair', 'Open TV Bluetooth pairing window', opened);
  if (!opened.ok) { ctx.fail('tvBleStatus', 'tv_ble_pair', opened); return; }
  ctx.concierge.clearProblem();
  const until = Date.now() + PAIR_WINDOW_SECONDS * 1000;
  clearInterval(ctx.view.tvBleTimer);
  ctx.view.tvBleTimer = setInterval(() => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    ctx.say('tvBleStatus', left
      ? `Using your physical Fire TV remote: Settings → Controllers & Bluetooth Devices → Other Bluetooth Devices → Add Bluetooth Devices → OSHAL-KB. ${left} s left.`
      : 'The Bluetooth pairing window closed.');
    if (!left) clearInterval(ctx.view.tvBleTimer);
    if (left && left % 6 === 0 && !ctx.view.busy) {
      void ctx.bridge('ble-devices', {}, 20000).then((r) => r.ok && renderBleRows(r.phones || []));
    }
  }, 1000);
}

function renderTvBleTable(ctx, phones, saveAndOpenPhone, openBleRemoveDialog) {
  const body = ctx.$('tvBleBody');
  if (!phones.length) {
    body.innerHTML = '<tr class="ks-empty-row"><td colspan="4">No Bluetooth TV paired yet.</td></tr>';
    return;
  }
  body.replaceChildren(...phones.map((item) => {
    const row = document.createElement('tr');
    const state = `${item.paired ? 'paired' : 'not paired'}, ${item.connected ? 'connected' : 'not connected'}`;
    for (const text of [`${item.name} (${item.address})`, state]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    const addCell = document.createElement('td');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'ks-btn ks-btn-sm';
    addBtn.textContent = 'Add as TV';
    addBtn.disabled = !item.paired;
    addBtn.addEventListener('click', () => ctx.run(async () => {
      const device = await saveAndOpenPhone(ctx, 'ios', item.address, item.name, 'tv');
      ctx.say('tvBleStatus', `${device.name} added as a Bluetooth TV.`);
    }, 'tvBleStatus', 'Adding Bluetooth TV'));
    addCell.append(addBtn);
    const rmCell = document.createElement('td');
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'ks-btn ks-btn-sm';
    rmBtn.textContent = 'Remove';
    rmBtn.disabled = !item.paired;
    rmBtn.addEventListener('click', () => openBleRemoveDialog(ctx, item));
    rmCell.append(rmBtn);
    row.append(addCell, rmCell);
    return row;
  }));
}

/** @description Resolve the best signed oshal APK from /api/devices/downloads or local bridge host report. @param {object|null} localApk Local APK metadata. @param {boolean} [preferAndroid] Prefer Orbit Android APK over Fire TV APK. @returns {Promise<object|null>} APK descriptor. */
export async function resolveCompanionApk(localApk, preferAndroid = false) {
  try {
    const res = await fetch('/api/devices/downloads', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = await res.json();
      const list = Array.isArray(body?.downloads) ? body.downloads : Array.isArray(body?.files) ? body.files : [];
      const apks = list.filter((d) => /\.apk$/i.test(d?.file || ''));
      if (preferAndroid) {
        const orbit = apks.find((d) => /orbit.*android|android.*orbit/i.test(d.file) && !/firetv|tv/i.test(d.file));
        if (orbit) return orbit;
      } else {
        const picked = apks.find((d) => /firetv|tv/i.test(d.file)) || apks[0] || null;
        if (picked) return picked;
      }
    }
  } catch { /* fall back to local host summary */ }
  if (preferAndroid) {
    const file = String(localApk?.file || '');
    if (!file || /firetv|tv/i.test(file) || !/orbit.*android|android.*orbit/i.test(file)) return null;
    return { ...localApk, local: true, preferAndroid: true };
  }
  return localApk ? { ...localApk, local: true, preferAndroid: false } : null;
}

/** @description Download, SHA-256 verify, and stage an APK onto the Linux bridge computer in 36 KiB chunks. @param {object} opts Staging options. @returns {Promise<{stageId:string,sha256:string}>} Staged descriptor. */
export async function stageCompanionApk({ apk, bridge, nodeName, onProgress }) {
  if (apk.local) return { stageId: 'local', sha256: apk.sha256 };
  const dlUrl = apk.url || `/api/devices/downloads/${encodeURIComponent(apk.file)}`;
  onProgress?.(`Downloading signed ${apk.file}…`);
  const res = await fetch(dlUrl, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not download ${apk.file} (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (apk.sha256 && digest !== apk.sha256) throw new Error(`Downloaded ${apk.file} failed SHA-256 verification.`);
  const total = Math.max(1, Math.ceil(bytes.length / APK_CHUNK_BYTES));
  const stageId = `tvapk-${digest.slice(0, 16)}`;
  for (let index = 0; index < total; index += 1) {
    const slice = bytes.subarray(index * APK_CHUNK_BYTES, (index + 1) * APK_CHUNK_BYTES);
    const pct = Math.round(((index + 1) / total) * 100);
    onProgress?.(`Staging ${apk.file} on ${nodeName} (${pct}%)…`);
    const staged = await bridge('stage-chunk', { id: stageId, index, total, sha256: digest, data: bytesToBase64(slice) }, 45000);
    if (!staged.ok) throw Object.assign(new Error(staged.message || 'APK staging failed.'), { code: staged.error });
  }
  return { stageId, sha256: digest };
}

async function provisionStageAndroidApk(ctx) {
  const phone = ctx.app.state.selected?.kind === 'phone'
    ? ctx.app.state.phones.find((p) => p.id === ctx.app.state.selected.id) || null
    : null;
  if (!phone || phone.platform !== 'android') return;
  const nodeId = phone.computerNodeId || ctx.view.node;
  if (!nodeId) { ctx.$('stageStatus').textContent = 'Select a connected Linux computer first.'; return; }
  ctx.$('stageStatus').textContent = `Preparing Open Swarm APK for ${phone.name}…`;
  const localApk = ctx.app.state.reports.get(nodeId)?.report?.tvApk || null;
  const preferAndroid = phone.form !== 'tv';
  const apk = await resolveCompanionApk(localApk, preferAndroid);
  if (!apk) { ctx.$('stageStatus').textContent = 'No signed Open Swarm APK found on this server.'; return; }
  const bridge = (verb, args, limit) => ctx.app.computers.bridge(nodeId, verb, args, limit);
  const staged = await stageCompanionApk({
    apk, bridge, nodeName: ctx.app.computer(nodeId)?.name || 'computer',
    onProgress: (m) => { ctx.$('stageStatus').textContent = m; }
  });
  const serverUrl = globalThis.location?.origin || 'https://oshal.agenticfederal.us';
  ctx.$('stageStatus').textContent = `Installing Open Swarm APK on ${phone.name} (${phone.address})…`;
  const installed = await bridge('adb-install-apk', {
    serial: phone.address, stageId: staged.stageId, sha256: staged.sha256,
    preferAndroid, launchPackage: 'com.oshal.remote', serverUrl
  }, 180000);
  await ctx.remember('install apk', `Push Open Swarm APK to ${phone.name}`, installed);
  ctx.$('stageStatus').textContent = installed.ok
    ? `Installed and launched Open Swarm on ${phone.name}.`
    : (installed.message || 'APK installation failed.');
}

async function installAndroidCompanionFromConnect(ctx, saveAndOpenPhone) {
  if (!(await ctx.install('androidStatus'))) return;
  const raw = ctx.$('connectAddress').value.trim();
  let serial = '';
  if (raw) {
    const connArgs = raw.endsWith(':') ? { host: raw.slice(0, -1).trim() } : (raw.includes(':') ? { address: raw } : { host: raw });
    ctx.say('androidStatus', `Connecting to ${raw}…`);
    const conn = await ctx.bridge('adb-connect', connArgs, 40000);
    await ctx.remember('connect', `Connect Android at ${raw}`, conn);
    if (!conn.ok) { ctx.fail('androidStatus', 'android_apk', conn); return; }
    serial = conn.serial;
  } else {
    const seen = await ctx.readStatus();
    serial = (seen.adb?.devices || []).find((d) =>
      d.state === 'device' && !String(d.serial || '').endsWith(':5555') && !/^AFT/i.test(d.model || ''))?.serial || '';
  }
  if (!serial) {
    ctx.fail('androidStatus', 'android_apk', 'Connect your Android phone over USB or Wireless debugging first, or enter its Connect address above.', 'no_android_device');
    return;
  }
  const localApk = ctx.app.state.reports.get(ctx.view.node)?.report?.tvApk || null;
  const apk = await resolveCompanionApk(localApk, true);
  if (!apk) {
    ctx.fail('androidStatus', 'android_apk', 'No Android Orbit APK is staged on this server yet — use Connect above to control your Android phone directly over Wireless debugging without any app install.', 'no_companion_apk');
    return;
  }
  const staged = await stageCompanionApk({ apk, bridge: ctx.bridge, nodeName: ctx.nodeName(), onProgress: (m) => ctx.say('androidStatus', m) });
  const serverUrl = globalThis.location?.origin || 'https://oshal.agenticfederal.us';
  ctx.say('androidStatus', `Installing oshal Orbit (${apk.file}) on ${serial}…`);
  const installed = await ctx.bridge('adb-install-apk', {
    serial, stageId: staged.stageId, sha256: staged.sha256, preferAndroid: true,
    launchPackage: 'com.oshal.remote', serverUrl
  }, 180000);
  await ctx.remember('install apk', `Install oshal Orbit on ${serial}`, installed);
  if (!installed.ok) { ctx.fail('androidStatus', 'android_apk', installed); return; }
  ctx.concierge.clearProblem();
  const info = await ctx.bridge('adb-info', { serial }, 30000);
  const name = info.ok && info.model ? `${info.manufacturer ? `${info.manufacturer} ` : ''}${info.model}` : serial;
  const device = await saveAndOpenPhone(ctx, 'android', serial, name);
  ctx.say('androidStatus', `Installed oshal Orbit on ${device.name}.`);
  await ctx.readStatus();
}

/** @description Wire the Connect via RDP card, Android Companion APK push, and optional Fire TV Bluetooth drawer inside #connectSheet. @param {object} ctx Setup context. @param {Function} saveAndOpenPhone Record saver. @param {Function} openBleRemoveDialog BLE remove dialog opener. @returns {object} Controller. */
export function mountRdpAndTvBle(ctx, saveAndOpenPhone, openBleRemoveDialog) {
  const { $ } = ctx;
  selectRdpOs(ctx, 'windows');
  $('rdpOsWindowsBtn').addEventListener('click', () => selectRdpOs(ctx, 'windows'));
  $('rdpOsLinuxBtn').addEventListener('click', () => selectRdpOs(ctx, 'linux'));
  $('rdpOsMacBtn').addEventListener('click', () => selectRdpOs(ctx, 'macos'));
  $('rdpOsAnyBtn').addEventListener('click', () => selectRdpOs(ctx, 'any'));
  $('copyRdpScriptBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText?.($('rdpSetupScript').textContent);
      ctx.say('rdpStatus', 'Copied RDP setup script to clipboard.');
    } catch {
      ctx.say('rdpStatus', 'Select and copy the setup script from the box above.');
    }
  });
  $('rdpConnectBtn').addEventListener('click', () => {
    void ctx.run(() => connectRdpSession(ctx), 'rdpStatus', 'Connecting RDP');
  });
  $('pushAndroidApkBtn').addEventListener('click', () => {
    void ctx.run(() => installAndroidCompanionFromConnect(ctx, saveAndOpenPhone), 'androidStatus', 'Installing oshal Companion');
  });
  $('stagePushApkBtn').addEventListener('click', () => {
    void provisionStageAndroidApk(ctx);
  });
  $('rdpForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void ctx.run(() => probeRdpHost(ctx), 'rdpStatus', 'Checking RDP port');
  });
  const renderBleRows = (phones) => renderTvBleTable(ctx, phones, saveAndOpenPhone, openBleRemoveDialog);
  $('pairTvBleBtn').addEventListener('click', () => {
    void ctx.run(() => pairTvBluetooth(ctx, renderBleRows), 'tvBleStatus', 'Opening TV Bluetooth pairing');
  });
  return {
    connectRdp: () => connectRdpSession(ctx),
    installAndroidApk: () => installAndroidCompanionFromConnect(ctx, saveAndOpenPhone),
    probeRdp: () => probeRdpHost(ctx),
    pairTvBle: () => pairTvBluetooth(ctx, renderBleRows),
    renderTvBle: renderBleRows
  };
}

/** @description Populate #sessionDeviceSelect in the studio toolbar with all active devices. @param {object} ctx Stage context. @returns {void} */
export function renderDeviceSwitcher(ctx) {
  const { app, $ } = ctx;
  const select = $('sessionDeviceSelect');
  const opt = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  select.replaceChildren(
    ...app.state.phones.map((p) => opt(`phone:${p.id}`, `${p.name} (${p.form === 'tv' ? 'TV' : p.platform === 'android' ? 'Android' : 'iPhone'})`)),
    ...app.state.computerList.map((c) => opt(`computer:${c.id}`, `${c.name || `Device ${String(c.id).slice(0, 8)}`} (${isTvNode(c) ? 'TV' : isAndroidNode(c) ? 'Android' : 'Computer'})`)),
    ...app.state.rdpSessions.map((r) => opt(`rdp:${r.sessionId}`, `${rdpLabel(r)} (RDP)`))
  );
  const activeKey = ctx.currentTargetKey();
  if (activeKey) select.value = activeKey;
}

/** @description Show or hide the non-blocking DRM protected-surface overlay on TV frames. @param {object} ctx Stage context. @param {object} frame Frame metadata. @returns {void} */
export function renderProtectedSurface(ctx, frame) {
  const notice = ctx.$('protectedSurfaceNotice');
  if (!frame?.protectedSurface) { notice.hidden = true; return; }
  const pkg = frame.activePackage ? ` (${frame.activePackage})` : '';
  ctx.$('protectedSurfaceTitle').textContent = `Protected video app active${pkg}`;
  ctx.$('protectedSurfaceBody').textContent = 'Fire OS blocks Wi-Fi screen capture inside DRM streaming apps. Remote arrows, OK, Back, Home and Play/Pause still control your TV live.';
  notice.hidden = false;
}

function notifyHostFullscreen(active) {
  for (const target of new Set([window, window.parent, window.top])) {
    try {
      if (!target?.document?.documentElement) continue;
      if (active) target.document.documentElement.setAttribute('data-oshal-stage-fullscreen', 'true');
      else target.document.documentElement.removeAttribute('data-oshal-stage-fullscreen');
      target.dispatchEvent(new CustomEvent('oshal:stage-fullscreen', { detail: { fullscreen: active } }));
    } catch { /* cross-origin parent */ }
  }
}

/** @description Toggle fullscreen stage mode (.is-fullscreen + Fullscreen API + parent event). @param {object} ctx Stage context. @param {boolean} active Desired state. @returns {void} */
export function setFullscreenStage(ctx, active) {
  const { $, view } = ctx;
  const next = Boolean(active && ctx.app.state.selected);
  view.fullscreen = next;
  const card = $('stageCard');
  card.classList.toggle('is-fullscreen', next);
  $('fullscreenHud').hidden = !next;
  $('fullscreenStageBtn').setAttribute('aria-pressed', String(next));
  $('fullscreenStageLabel').textContent = next ? 'Exit full screen' : 'Full screen';
  notifyHostFullscreen(next);
  if (next && document.fullscreenElement !== card) card.requestFullscreen?.().catch(() => {});
  else if (!next && document.fullscreenElement === card) document.exitFullscreen?.().catch(() => {});
}

/** @description Set the open/collapsed state and active tab (Controls | Concierge) of the 340px right rail. @param {object} ctx Stage context. @param {boolean} open Rail visibility. @param {string} tab Active tab key. @returns {void} */
export function setRailState(ctx, open, tab) {
  const { $, view } = ctx;
  const nextTab = tab === 'controls' ? 'controls' : 'concierge';
  view.conciergeCollapsed = !open;
  view.railTab = nextTab;
  if (!open) $('sessionView').setAttribute('data-concierge', 'collapsed');
  else $('sessionView').removeAttribute('data-concierge');
  $('railTabControls').setAttribute('aria-selected', String(nextTab === 'controls'));
  $('railTabConcierge').setAttribute('aria-selected', String(nextTab === 'concierge'));
  $('railControlsPane').hidden = nextTab !== 'controls';
  $('railConciergePane').hidden = nextTab !== 'concierge';
  $('openControlsRailBtn').setAttribute('aria-pressed', String(Boolean(open && nextTab === 'controls')));
  $('toggleConciergeBtn').setAttribute('aria-pressed', String(Boolean(open && nextTab === 'concierge')));
}

/** @description Toggle or switch the desktop right rail tab, falling back to #sessionSheet on mobile. @param {object} ctx Stage context. @param {string} targetTab Tab key. @returns {void} */
export function toggleRailTab(ctx, targetTab) {
  if (!ctx.desktopMedia.matches) {
    if (ctx.app.state.sessionSheetOpen) ctx.app.closeSessionSheet(false);
    else ctx.app.openSessionSheet(true);
    return;
  }
  const willClose = !ctx.view.conciergeCollapsed && ctx.view.railTab === targetTab;
  setRailState(ctx, !willClose, targetTab);
}

/** @description Briefly display the visual touch gesture dot inside #deviceFrame. @param {object} ctx Stage context. @param {number} clientX Pointer X. @param {number} clientY Pointer Y. @returns {void} */
export function flashTouchIndicator(ctx, clientX, clientY) {
  const frame = ctx.$('deviceFrame');
  const dot = ctx.$('touchIndicator');
  const rect = frame.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  dot.style.left = `${Math.max(8, Math.min(rect.width - 8, Math.round(clientX - rect.left)))}px`;
  dot.style.top = `${Math.max(8, Math.min(rect.height - 8, Math.round(clientY - rect.top)))}px`;
  dot.hidden = false;
  clearTimeout(ctx.view.touchTimer);
  ctx.view.touchTimer = setTimeout(() => { dot.hidden = true; }, 380);
}
