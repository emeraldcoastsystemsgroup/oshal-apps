/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.4.0 computer & session OS controls: direct computer pointer/keyboard control in touch or mouse-pad mode (RP-PHC-01), special keys & chords including Ctrl+Alt+Del, Super and F1-F12 (RP-PHC-02), multi-monitor enumeration & display switching (RP-PHC-05), capability-gated privacy screen / remote input block (RP-PHC-09), and session-end OS lock (RP-PHC-10).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: add wheel scrollOnComputer and keyOnComputer, dispatch touch-drag swipes on Swarm-enrolled Android nodes, invert scroll sign for Android Accessibility swipe semantics, and trigger fast post-action frame wakeups.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.3: import isTvNode from computer-link.js. enrolledAndroidFor called it without importing it, so Your devices answered "could not be read: isTvNode is not defined" whenever a saved Android phone or TV was not reachable through its computer and the person had a connected, controllable Android node whose name did not contain that phone's name (Roger's phone, 2026-11-08 and 2026-11-09).
 */

import { computerPoint, computerStanding, desktopControlSupport, fromBase64, isAndroidNode, isTvNode, toBase64 } from '/api/phone-control/ui/computer-link.js';
import { sendRdpInput } from '/api/phone-control/ui/phone-rdp.js';

const ANDROID_SPECIAL = { Escape: 'BACK', Tab: 'TAB', Return: 'ENTER', Backspace: 'BACKSPACE', Home: 'HOME' };
const IOS_SPECIAL = { Escape: 'Escape', Tab: 'Tab', Return: 'Enter', Backspace: 'Backspace', Home: 'Home' };
const LIVE_KEY_MAP = {
  Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
};

const MONITOR_PROBE_PY = [
  'import json,platform,re,shutil,subprocess',
  'os_name=platform.system().lower()',
  'mons=[]',
  'if os_name=="linux" and shutil.which("xrandr"):',
  '    r=subprocess.run(["xrandr","--listmonitors"],capture_output=True,text=True,timeout=8)',
  '    for ln in r.stdout.splitlines():',
  '        m=re.match(r"^\\s*(\\d+):\\s+(\\+\\*?|\\*)?(\\S+)\\s+(\\d+)/\\d+x(\\d+)/\\d+\\+(\\d+)\\+(\\d+)",ln)',
  '        if m: mons.append({"id":m.group(3),"label":f"{m.group(3)} ({m.group(4)}x{m.group(5)})","width":int(m.group(4)),"height":int(m.group(5)),"originX":int(m.group(6)),"originY":int(m.group(7)),"primary":"*" in (m.group(2) or "")})',
  'print(json.dumps({"ok":True,"platform":os_name,"monitors":mons}))'
].join('\n');

const MONITOR_CAPTURE_PY = [
  'import base64,json,os,shutil,subprocess,sys',
  'cfg=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))',
  'w,h,ox,oy,sw=int(cfg["width"]),int(cfg["height"]),int(cfg["originX"]),int(cfg["originY"]),int(cfg["scaleWidth"])',
  'ff=shutil.which("ffmpeg")',
  'disp=os.environ.get("DISPLAY") or ":0"',
  'if not ff:',
  '    print(json.dumps({"ok":False,"message":"ffmpeg is required on that computer to capture a secondary monitor."}));sys.exit(0)',
  'p=subprocess.run([ff,"-v","error","-f","x11grab","-video_size",f"{w}x{h}","-i",f"{disp}+{ox},{oy}","-frames:v","1","-vf",f"scale={sw}:-2","-q:v","7","-f","mjpeg","pipe:1"],capture_output=True,timeout=10)',
  'if p.returncode!=0 or not p.stdout.startswith(b"\\xff\\xd8"):',
  '    print(json.dumps({"ok":False,"message":"Secondary monitor capture failed on X11 display "+disp}));sys.exit(0)',
  'print(json.dumps({"ok":True,"mime":"image/jpeg","data":base64.b64encode(p.stdout).decode("ascii")}))'
].join('\n');

const PRIVACY_HOOK_SH = [
  'if command -v oshal-privacy-hook >/dev/null 2>&1; then',
  '  oshal-privacy-hook "$1" && printf \'{"ok":true}\\n\' || printf \'{"ok":false,"message":"oshal-privacy-hook refused the request."}\\n\'',
  'else',
  '  printf \'{"ok":false,"code":"no_driver","message":"oshal Node runs in user space without an OS display-blanking or local-input blocking driver (oshal-privacy-hook is not installed on that computer)."}\\n\'',
  'fi'
].join('\n');

const LOCK_OS_SH = [
  'os="$(uname -s 2>/dev/null || echo unknown)"',
  'if [ "$os" = "Darwin" ] && command -v pmset >/dev/null 2>&1; then pmset displaysleepnow && printf \'{"ok":true}\\n\' && exit 0; fi',
  'if command -v loginctl >/dev/null 2>&1 && loginctl lock-session >/dev/null 2>&1; then printf \'{"ok":true}\\n\' && exit 0; fi',
  'if command -v xdg-screensaver >/dev/null 2>&1 && xdg-screensaver lock >/dev/null 2>&1; then printf \'{"ok":true}\\n\' && exit 0; fi',
  'if command -v dm-tool >/dev/null 2>&1 && dm-tool lock >/dev/null 2>&1; then printf \'{"ok":true}\\n\' && exit 0; fi',
  'if command -v rundll32.exe >/dev/null 2>&1 && rundll32.exe user32.dll,LockWorkStation >/dev/null 2>&1; then printf \'{"ok":true}\\n\' && exit 0; fi',
  'printf \'{"ok":false,"message":"No desktop session lock command (loginctl, xdg-screensaver, pmset or LockWorkStation) succeeded on that computer."}\\n\''
].join('\n');

function parseLastJson(runAnswer) {
  const line = String(runAnswer?.output?.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  try { return JSON.parse(line); } catch { return null; }
}

function activeMonitor(state) {
  return state.monitors.find((m) => m.id === state.activeMonitorId && !m.primary) || null;
}

function renderButtons(ctx, state) {
  const { $ } = ctx;
  const computer = ctx.selectedComputer();
  $('inputModeBtn').textContent = state.inputMode === 'mouse' ? 'Input: Mouse pad' : 'Input: Touch tap';
  $('inputModeBtn').setAttribute('aria-pressed', String(state.inputMode === 'mouse'));
  $('liveKeysBtn').textContent = state.liveKeys ? 'Live keyboard: On' : 'Live keyboard: Off';
  $('liveKeysBtn').setAttribute('aria-pressed', String(state.liveKeys));
  $('privacyScreenBtn').textContent = state.privacyScreen ? 'Privacy screen: On' : 'Privacy screen: Off';
  $('privacyScreenBtn').setAttribute('aria-pressed', String(state.privacyScreen));
  $('lockOnEndBtn').textContent = state.lockOnEnd ? 'Lock on end: On' : 'Lock on end: Off';
  $('lockOnEndBtn').setAttribute('aria-pressed', String(state.lockOnEnd));
  const cursorEl = $('remoteCursor');
  const showCursor = Boolean(computer && state.inputMode === 'mouse' && !$('screenImage').hidden);
  cursorEl.hidden = !showCursor;
  if (showCursor) {
    cursorEl.style.left = `${Math.round(state.cursor.x * 1000) / 10}%`;
    cursorEl.style.top = `${Math.round(state.cursor.y * 1000) / 10}%`;
  }
}

async function runDesktop(ctx, computer, args, action, summary) {
  const check = desktopControlSupport(computer);
  if (!check.ok) {
    ctx.status(check.text);
    await ctx.app.remember({ computerNodeId: computer.id, action, summary, ok: false, error: check.text });
    void ctx.loadHistory();
    return null;
  }
  try {
    const reply = await ctx.app.computers.desktopControl(computer.id, args);
    const ok = Boolean(reply?.ok !== false);
    const err = ok ? null : (reply?.error || 'Computer refused input.');
    if (ok) ctx.scheduleFastFrame?.(260);
    await ctx.app.remember({ computerNodeId: computer.id, action, summary, ok, error: err });
    void ctx.loadHistory();
    ctx.status(ok ? `${summary}: done.` : err);
    return ok ? reply : null;
  } catch (error) {
    await ctx.app.remember({ computerNodeId: computer.id, action, summary, ok: false, error: error.message });
    void ctx.loadHistory();
    ctx.status(error.message);
    return null;
  }
}

function currentComputerCoords(ctx, state) {
  const img = ctx.$('screenImage');
  const box = img.getBoundingClientRect();
  const natural = { width: img.naturalWidth || 1280, height: img.naturalHeight || 800 };
  const pt = { x: state.cursor.x * (box.width || 640), y: state.cursor.y * (box.height || 400) };
  return computerPoint(pt, { width: box.width || 640, height: box.height || 400 }, natural, activeMonitor(state));
}

function handleComputerPointerUp(ctx, state, local) {
  const computer = ctx.selectedComputer();
  const start = state.padStart;
  state.padStart = null;
  if (!computer || !start) return false;
  const img = ctx.$('screenImage');
  const natural = { width: img.naturalWidth, height: img.naturalHeight };
  const moved = Math.hypot(local.x - start.x, local.y - start.y);
  if (state.inputMode === 'mouse') {
    const target = currentComputerCoords(ctx, state);
    const kind = moved >= 10 ? 'move' : 'click';
    const label = moved >= 10 ? `Move pointer to ${target.x}, ${target.y}` : `Click at ${target.x}, ${target.y}`;
    void ctx.queue.press(() => runDesktop(ctx, computer, { kind, ...target }, kind === 'move' ? 'pointer' : 'click', label));
    return true;
  }
  try {
    if (moved >= 18) {
      const startTarget = computerPoint(start, local.box, natural, activeMonitor(state));
      if (isAndroidNode(computer)) {
        const endTarget = computerPoint(local, local.box, natural, activeMonitor(state));
        void ctx.queue.press(() => runDesktop(ctx, computer, {
          kind: 'swipe', x1: startTarget.x, y1: startTarget.y, x2: endTarget.x, y2: endTarget.y, duration_ms: 260
        }, 'swipe', 'Swipe'));
        return true;
      }
      const amount = Math.max(-10, Math.min(10, Math.round((local.y - start.y) / 28))) || -2;
      void ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'scroll', amount, ...startTarget }, 'scroll', `Scroll (${amount})`));
      return true;
    }
    state.cursor = { x: Math.max(0, Math.min(1, local.x / local.box.width)), y: Math.max(0, Math.min(1, local.y / local.box.height)) };
    const target = computerPoint(local, local.box, natural, activeMonitor(state));
    void ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'click', ...target }, 'click', `Click at ${target.x}, ${target.y}`));
  } catch (error) {
    ctx.status(error.message);
  }
  return true;
}

async function sendSpecialKey(ctx, chord, label) {
  const computer = ctx.selectedComputer();
  if (computer) {
    await ctx.queue.press(async () => {
      const sent = await runDesktop(ctx, computer, { kind: 'key', keys: chord }, 'key', `Send ${label}`);
      if (!sent && chord === 'super' && String(computer.platform || '').toLowerCase() === 'windows') {
        await runDesktop(ctx, computer, { kind: 'key', keys: 'ctrl+escape' }, 'key', 'Send Windows Start (Ctrl+Esc)');
      }
    });
    return;
  }
  const rdp = ctx.selectedRdp();
  if (rdp) {
    await ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'key', key: chord }, `Send ${label}`));
    return;
  }
  const phone = ctx.selectedPhone();
  if (!phone) return;
  if (phone.platform === 'android' && ANDROID_SPECIAL[chord]) {
    ctx.press(`key ${ANDROID_SPECIAL[chord].toLowerCase()}`, label, 'adb-key', { key: ANDROID_SPECIAL[chord] });
    return;
  }
  if (phone.platform === 'ios' && (IOS_SPECIAL[chord] || chord === 'super')) {
    const iosKey = chord === 'super' ? 'Spotlight' : IOS_SPECIAL[chord];
    ctx.press(`key ${iosKey.toLowerCase()}`, label, 'ble-key', { key: iosKey });
    return;
  }
  ctx.status(`${label} is a computer keyboard shortcut and does not exist on ${phone.name}.`);
}

function renderMonitorOptions(ctx, state, list) {
  const select = ctx.$('monitorSelect');
  const options = [{ id: 'primary', label: 'Primary display' }, ...list.filter((m) => !m.primary)];
  select.replaceChildren(...options.map((item) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label;
    return opt;
  }));
  if (options.some((o) => o.id === state.activeMonitorId)) select.value = state.activeMonitorId;
  else { state.activeMonitorId = 'primary'; select.value = 'primary'; }
}

async function scanMonitors(ctx, state) {
  const computer = ctx.selectedComputer();
  if (!computer) {
    ctx.status('Phones and TVs have one built-in screen; monitor switching applies to multi-display computers.');
    return;
  }
  const standing = computerStanding(computer);
  if (!standing.usable) { ctx.status(standing.fix || standing.text); return; }
  ctx.status('Checking connected displays…');
  try {
    const raw = await ctx.app.computers.run(computer.id, `python3 -I -c '${MONITOR_PROBE_PY}'`, 15000);
    const list = Array.isArray(parseLastJson(raw)?.monitors) ? parseLastJson(raw).monitors : [];
    state.monitors = list;
    renderMonitorOptions(ctx, state, list);
    ctx.status(list.length > 1 ? `${list.length} monitors detected on ${computer.name}.`
      : list.length === 1 ? `1 display detected (${list[0].label}); already showing it.`
        : 'Only the primary display was reported by that computer.');
  } catch (error) {
    ctx.status(`Could not read monitors: ${error.message}`);
  }
}

async function togglePrivacyScreen(ctx, state) {
  const computer = ctx.selectedComputer();
  if (!computer) {
    ctx.status('Phones and TVs cannot blank their physical screen while streaming user-space frames.');
    return;
  }
  const standing = computerStanding(computer);
  if (!standing.usable) { ctx.status(standing.fix || standing.text); return; }
  const next = !state.privacyScreen;
  ctx.status(`${next ? 'Enabling' : 'Disabling'} privacy screen…`);
  try {
    const raw = await ctx.app.computers.run(computer.id, `sh -c '${PRIVACY_HOOK_SH}' sh ${next ? 'enable' : 'disable'}`, 15000);
    const reply = parseLastJson(raw) || { ok: false, message: 'Privacy screen hook did not answer.' };
    await ctx.app.remember({
      computerNodeId: computer.id, action: 'privacy screen', summary: `${next ? 'Enable' : 'Disable'} privacy screen`,
      ok: Boolean(reply.ok), error: reply.ok ? null : reply.message
    });
    void ctx.loadHistory();
    if (!reply.ok) { ctx.status(reply.message); return; }
    state.privacyScreen = next;
    renderButtons(ctx, state);
    void ctx.savePref({ privacyScreen: next });
    ctx.status(next ? 'Privacy screen and remote input block active.' : 'Privacy screen turned off.');
  } catch (error) {
    ctx.status(`Privacy screen refused: ${error.message}`);
  }
}

async function dispatchLock(ctx, computer, summary) {
  const standing = computerStanding(computer);
  if (!standing.usable) {
    const msg = standing.fix || standing.text;
    await ctx.app.remember({ computerNodeId: computer.id, action: 'lock', summary, ok: false, error: msg });
    return { ok: false, message: msg };
  }
  try {
    const raw = await ctx.app.computers.run(computer.id, LOCK_OS_SH, 15000);
    const reply = parseLastJson(raw) || { ok: false, message: 'Lock command gave no answer.' };
    await ctx.app.remember({ computerNodeId: computer.id, action: 'lock', summary, ok: Boolean(reply.ok), error: reply.ok ? null : reply.message });
    return reply;
  } catch (error) {
    await ctx.app.remember({ computerNodeId: computer.id, action: 'lock', summary, ok: false, error: error.message });
    return { ok: false, message: error.message };
  }
}

function wirePointerControls(ctx, state) {
  const { $ } = ctx;
  $('inputModeBtn').addEventListener('click', () => {
    if (!ctx.selectedComputer()) { ctx.status('Touch vs mouse-pad mode applies when controlling a computer.'); return; }
    state.inputMode = state.inputMode === 'touch' ? 'mouse' : 'touch';
    renderButtons(ctx, state);
    void ctx.savePref({ inputMode: state.inputMode });
    ctx.status(state.inputMode === 'mouse' ? 'Mouse-pad mode: drag to move cursor, tap to click.' : 'Touch-tap mode: tap screen to click, drag to scroll.');
  });
  $('liveKeysBtn').addEventListener('click', () => {
    if (!ctx.selectedComputer()) { ctx.status('Live hardware keyboard passthrough applies to computer sessions; use Type for phones.'); return; }
    state.liveKeys = !state.liveKeys;
    renderButtons(ctx, state);
    ctx.status(state.liveKeys ? 'Live keyboard on: keys pressed outside text boxes go to the computer.' : 'Live keyboard off.');
  });
  $('rightClickBtn').addEventListener('click', () => {
    const c = ctx.selectedComputer();
    if (c) void ctx.queue.press(() => runDesktop(ctx, c, { kind: 'rightclick', ...currentComputerCoords(ctx, state) }, 'right click', 'Right-click'));
  });
  $('doubleClickBtn').addEventListener('click', () => {
    const c = ctx.selectedComputer();
    if (c) void ctx.queue.press(() => runDesktop(ctx, c, { kind: 'doubleclick', ...currentComputerCoords(ctx, state) }, 'double click', 'Double-click'));
  });
  $('scrollUpBtn').addEventListener('click', () => {
    const c = ctx.selectedComputer();
    if (c) void ctx.queue.press(() => runDesktop(ctx, c, { kind: 'scroll', amount: isAndroidNode(c) ? -4 : 4, ...currentComputerCoords(ctx, state) }, 'scroll', 'Scroll up'));
  });
  $('scrollDownBtn').addEventListener('click', () => {
    const c = ctx.selectedComputer();
    if (c) void ctx.queue.press(() => runDesktop(ctx, c, { kind: 'scroll', amount: isAndroidNode(c) ? 4 : -4, ...currentComputerCoords(ctx, state) }, 'scroll', 'Scroll down'));
  });
}

function wireSystemControls(ctx, state) {
  const { $ } = ctx;
  $('ctrlAltDelBtn').addEventListener('click', () => void sendSpecialKey(ctx, 'ctrl+alt+delete', 'Ctrl+Alt+Del'));
  $('superKeyBtn').addEventListener('click', () => void sendSpecialKey(ctx, 'super', 'Super / Windows key'));
  $('specialKeyForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const select = $('specialKeySelect');
    void sendSpecialKey(ctx, select.value, select.options[select.selectedIndex]?.textContent || select.value);
  });
  $('scanMonitorsBtn').addEventListener('click', () => void scanMonitors(ctx, state));
  $('monitorSelect').addEventListener('change', () => {
    state.activeMonitorId = $('monitorSelect').value || 'primary';
    void ctx.savePref({ monitorId: state.activeMonitorId });
    ctx.refreshActiveComputerFrame();
    ctx.status(`Switched display to ${$('monitorSelect').options[$('monitorSelect').selectedIndex]?.textContent || state.activeMonitorId}.`);
  });
  $('privacyScreenBtn').addEventListener('click', () => void togglePrivacyScreen(ctx, state));
  $('lockOnEndBtn').addEventListener('click', async () => {
    if (!ctx.selectedComputer()) { ctx.status('Automatic session-end OS lock applies to computer sessions (on Android phones, press Power).'); return; }
    state.lockOnEnd = !state.lockOnEnd;
    renderButtons(ctx, state);
    await ctx.savePref({ lockOnEnd: state.lockOnEnd });
    ctx.status(state.lockOnEnd ? 'This computer will lock when you end the session.' : 'Lock on session end is off.');
  });
  $('lockNowBtn').addEventListener('click', async () => {
    const computer = ctx.selectedComputer();
    if (!computer) { ctx.status('OS workstation lock applies to computers (on Android phones, use Power in Session).'); return; }
    ctx.status(`Locking ${computer.name}…`);
    const reply = await dispatchLock(ctx, computer, `Lock ${computer.name}`);
    void ctx.loadHistory();
    ctx.status(reply.ok ? `${computer.name} locked.` : reply.message);
  });
}

function wireLiveKeyboard(ctx, state) {
  document.addEventListener('keydown', (event) => {
    if (!state.liveKeys || !ctx.selectedComputer() || ctx.app.state.connectOpen) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'Escape' && (ctx.app.state.sessionSheetOpen || !ctx.$('rowMenu').hidden)) return;
    const computer = ctx.selectedComputer();
    const mapped = LIVE_KEY_MAP[event.key] || (/^F([1-9]|1[0-2])$/.test(event.key) ? event.key : '');
    if (mapped || event.ctrlKey || event.altKey || event.metaKey) {
      const mods = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', event.metaKey && 'super'].filter(Boolean);
      const base = mapped || (event.key.length === 1 ? event.key.toLowerCase() : '');
      if (!base) return;
      event.preventDefault();
      const chord = [...mods, base].join('+');
      void ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'key', keys: chord }, 'key', `Key ${chord}`));
    } else if (event.key.length === 1) {
      event.preventDefault();
      void ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'type', text: event.key }, 'type', 'Type key'));
    }
  });
}

async function openOnComputer(ctx, computer, target) {
  const standing = computerStanding(computer);
  if (!standing.usable) { ctx.status(standing.fix || standing.text); return false; }
  if (!computer.tools?.includes('app.open')) { ctx.status(`${computer.name} does not advertise app.open.`); return false; }
  try {
    const reply = await ctx.app.computers.openApp(computer.id, target);
    const ok = Boolean(reply?.ok !== false);
    await ctx.app.remember({ computerNodeId: computer.id, action: 'open app', summary: `Open ${target}`, ok, error: ok ? null : reply?.error });
    void ctx.loadHistory();
    ctx.status(ok ? `Opened ${target}.` : (reply?.error || `Could not open ${target}.`));
    return ok;
  } catch (error) {
    ctx.status(error.message);
    return false;
  }
}

async function captureSelectedMonitor(ctx, state, computer, scaleWidth) {
  const mon = activeMonitor(state);
  if (!mon) return null;
  const cfg = toBase64(JSON.stringify({ ...mon, scaleWidth }));
  const parsed = parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${MONITOR_CAPTURE_PY}' ${cfg}`, 15000));
  if (!parsed?.ok) throw new Error(parsed?.message || 'Secondary monitor capture failed.');
  return new Blob([fromBase64(parsed.data)], { type: parsed.mime || 'image/jpeg' });
}

async function finishComputerSession(ctx, state) {
  const computer = ctx.selectedComputer();
  if (computer && state.privacyScreen && computerStanding(computer).usable) {
    await ctx.app.computers.run(computer.id, `sh -c '${PRIVACY_HOOK_SH}' sh disable`, 8000).catch(() => {});
  }
  if (computer && state.lockOnEnd) await dispatchLock(ctx, computer, `Lock ${computer.name} on session end`);
  state.privacyScreen = false;
  state.liveKeys = false;
}

/** @description Find a connected Swarm-enrolled Android node matching a saved Android phone record. @param {object} app App state holder. @param {object} phone Saved phone record. @returns {object|null} Matching Android node. */
export function enrolledAndroidFor(app, phone) {
  if (!phone || phone.platform !== 'android') return null;
  const list = app.state.computerList.filter((c) => isAndroidNode(c));
  const needle = String(phone.name || '').trim().toLowerCase();
  const tv = phone.form === 'tv';
  return list.find((c) => String(c.name || '').toLowerCase().includes(needle) && computerStanding(c).usable)
    || list.find((c) => computerStanding(c).usable && isTvNode(c) === tv) || null;
}

/** @description Route an Android phone verb through an enrolled Android node when the local ADB bridge is offline. @param {object} ctx Stage context. @param {object} node Enrolled Android node. @param {string} verb Phone bridge verb. @param {object} args Verb arguments. @param {string} summary Human label. @returns {Promise<boolean>} True on success. */
export async function dispatchEnrolledAndroidVerb(ctx, node, verb, args, summary) {
  if (verb === 'adb-key') return Boolean(await ctx.sessionComputer.keyOnComputer(node, args?.key || 'HOME', summary));
  if (verb === 'adb-text') return Boolean(await ctx.sessionComputer.typeOnComputer(node, args?.text || ''));
  if (verb === 'adb-launch') return Boolean(await ctx.sessionComputer.openOnComputer(node, args?.package || args?.name || ''));
  if (verb === 'adb-tap') {
    const res = await ctx.app.computers.run(node.id, 'mouse.click', { x: args.x, y: args.y, button: 'left', clicks: 1 }).catch(() => null);
    const ok = Boolean(res?.ok !== false);
    if (ok) ctx.scheduleFastFrame?.(260);
    return ok;
  }
  if (verb === 'adb-swipe') {
    const res = await ctx.app.computers.run(node.id, 'swipe', { x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, ms: args.ms || 220 }).catch(() => null);
    const ok = Boolean(res?.ok !== false);
    if (ok) ctx.scheduleFastFrame?.(260);
    return ok;
  }
  return false;
}

/** @description Mount computer input, special keys, monitor switch, privacy screen, and session-end lock. @param {object} ctx Stage context. @returns {object} Controller. */
export function mountSessionComputer(ctx) {
  const state = {
    inputMode: 'touch', liveKeys: false, privacyScreen: false, lockOnEnd: false,
    monitors: [], activeMonitorId: 'primary', cursor: { x: 0.5, y: 0.5 }, padStart: null
  };
  wirePointerControls(ctx, state);
  wireSystemControls(ctx, state);
  wireLiveKeyboard(ctx, state);
  return {
    applyPreferences(prefs) {
      state.inputMode = prefs.inputMode === 'mouse' ? 'mouse' : 'touch';
      state.privacyScreen = Boolean(prefs.privacyScreen);
      state.lockOnEnd = Boolean(prefs.lockOnEnd);
      state.activeMonitorId = prefs.monitorId || 'primary';
      renderMonitorOptions(ctx, state, state.monitors);
      renderButtons(ctx, state);
    },
    resetForSelection() {
      state.liveKeys = false; state.monitors = []; state.activeMonitorId = 'primary'; state.cursor = { x: 0.5, y: 0.5 };
      renderMonitorOptions(ctx, state, []);
      renderButtons(ctx, state);
    },
    render: () => renderButtons(ctx, state),
    onPointerDown(local) {
      if (!ctx.selectedComputer() || ctx.$('screenImage').hidden) return false;
      state.padStart = { ...local, cursorX: state.cursor.x, cursorY: state.cursor.y };
      return true;
    },
    onPointerMove(event, local) {
      if (!state.padStart || !ctx.selectedComputer() || state.inputMode !== 'mouse') return;
      if ((event.buttons & 1) === 0 && event.pointerType === 'mouse') return;
      state.cursor.x = Math.max(0, Math.min(1, state.padStart.cursorX + (local.x - state.padStart.x) / Math.max(local.box.width, 1)));
      state.cursor.y = Math.max(0, Math.min(1, state.padStart.cursorY + (local.y - state.padStart.y) / Math.max(local.box.height, 1)));
      renderButtons(ctx, state);
    },
    onPointerUp: (local) => handleComputerPointerUp(ctx, state, local),
    scrollOnComputer(computer, down, local) {
      if (local?.box?.width > 0 && local?.box?.height > 0) {
        state.cursor = { x: Math.max(0, Math.min(1, local.x / local.box.width)), y: Math.max(0, Math.min(1, local.y / local.box.height)) };
      }
      const amount = isAndroidNode(computer) ? (down ? 4 : -4) : (down ? -4 : 4);
      return ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'scroll', amount, ...currentComputerCoords(ctx, state) }, 'scroll', down ? 'Scroll down' : 'Scroll up'));
    },
    keyOnComputer: (computer, keys, label = `Key ${keys}`) => ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'key', keys }, 'key', label)),
    typeOnComputer: (computer, text) => ctx.queue.press(() => runDesktop(ctx, computer, { kind: 'type', text }, 'type', `Type ${text.length} characters`)),
    openOnComputer: (computer, target) => openOnComputer(ctx, computer, target),
    captureSelectedMonitor: (computer, scaleWidth) => captureSelectedMonitor(ctx, state, computer, scaleWidth),
    beforeEndSession: () => finishComputerSession(ctx, state)
  };
}
