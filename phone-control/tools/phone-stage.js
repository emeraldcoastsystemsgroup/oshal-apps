/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0, the Devices view: the rail of your phones and computers, the selected one's screen in a device frame and its controls. An Android phone's screen is read from the phone about every 1.5 s while this view is open and visible; a tap or drag on it, the keys, typing, opening an app and reading the words on screen each run one bridge command on the computer the phone is connected to. A computer shows its own picture and opens the kernel's page to work on it. Nothing is sent while Allow control is off.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: with no phone and no computer the Devices view is only the empty card and its one primary; the empty phone frame and the history column stay hidden until there is something to show.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: a TV (Fire TV or Android TV, form === 'tv') shows as TV in the rail and header, reveals the TV remote (arrows, OK, Play/Pause), hides Recent apps and Power, and tells a tap or drag on the TV picture to use the remote's arrows and OK.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: remote-control first screen and session (C-REM-1, C-REM-6, C-REM-7, N14, DS-39): device rows with overflow menu (Allow control, in-page confirmed Remove), full-frame phone session with Android bottom bar, live iPhone AirPlay screen mirroring through UxPlay (Start mirroring / Stop mirroring + mirror-frame loop), 48px Session sheet handle, desktop top session toolbar ending with X and 320px right pane.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: integrate sessionComputer, sessionMedia, sessionCollab, and specialized phoneConcierge controllers for RP-PHC-01..13, direct iPhone click-to-tap / drag-to-swipe / wheel-to-scroll, auto-resumed AirPlay mirroring, mirrored iPhone screen text reading, streamlined quick-control dock, and modal background inert gating.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: AI Office-aligned studio toolbar (#sessionDeviceSelect switcher, inline Home/Back/Recents/Sync/#sessionMirrorBtn/+ Add Device/Controls/Concierge/Full screen), collapsible 340px Controls | Concierge right rail, fullscreen stage (.is-fullscreen + parent event fallback + #fullscreenHud), TV #protectedSurfaceNotice + fast post-input frame wakeups, pre-mirror iPhone stage touchpad + #iosStageGuide, and persisted RDP state cleanup.
 */

import { readFrame, tapPoint, swipeFromDrag, createQueue, workHref, computerStanding, phoneReachable, setStoredRdp } from '/api/phone-control/ui/computer-link.js';
import {
  flashTouchIndicator, handleRdpPointerUp, loadStageHistory, rdpLabel, rdpLoop, readRdpScreen,
  renderDeviceSwitcher, renderProtectedSurface, renderRdpHead, renderScreenItems, sendRdpInput,
  setFullscreenStage, setRailState, toggleRailTab
} from '/api/phone-control/ui/phone-rdp.js';
import { mountSessionComputer } from '/api/phone-control/ui/session-computer.js';
import { mountSessionMedia } from '/api/phone-control/ui/session-media.js';
import { mountSessionCollab } from '/api/phone-control/ui/session-collab.js';
import { mountPhoneConcierge } from '/api/phone-control/ui/phone-concierge.js';

const ANDROID = { label: 'Android' };
const TV = { label: 'TV' };
const IPHONE = { label: 'iPhone' };
const isTv = (phone) => phone?.form === 'tv';

function setLayerBlocked(el, blocked) {
  if (!el) return;
  el.inert = Boolean(blocked);
  if (blocked) el.setAttribute('data-audit-skip', 'true');
  else el.removeAttribute('data-audit-skip');
}

function syncModalLayers(ctx) {
  const { app, $ } = ctx;
  const connectOpen = Boolean(app.state.connectOpen);
  const sheetOpen = Boolean(app.state.sessionSheetOpen) && !connectOpen;
  setLayerBlocked($('pageHeader'), connectOpen || sheetOpen);
  setLayerBlocked($('devicesView'), connectOpen || sheetOpen);
  setLayerBlocked($('sessionView'), connectOpen || sheetOpen);
  setLayerBlocked($('sessionSheet'), connectOpen);
}

function createStageContext(app) {
  const $ = app.byId;
  const ctx = {
    app,
    $,
    queue: createQueue(),
    desktopMedia: window.matchMedia('(min-width: 1040px)'),
    view: {
      generation: 0, frame: null, pictureUrl: '', apps: [], computerTag: '',
      drag: null, padDrag: null, menuPhone: null, menuRdp: null, menuTrigger: null,
      pendingRemoveId: null, pendingRemoveRdpId: null, mirrorRunning: false,
      wakeFrame: null, fastFramePendingAt: 0, fullscreen: false, conciergeCollapsed: false, railTab: 'concierge', touchTimer: null
    },
    selectedPhone: () => (app.state.selected?.kind === 'phone' ? app.state.phones.find((p) => p.id === app.state.selected.id) || null : null),
    selectedComputer: () => (app.state.selected?.kind === 'computer' ? app.computer(app.state.selected.id) : null),
    selectedRdp: () => (app.state.selected?.kind === 'rdp' ? app.rdpSession(app.state.selected.id) : null),
    currentTargetKey: () => (app.state.selected ? `${app.state.selected.kind}:${app.state.selected.id}` : ''),
    status: (text) => { $('stageStatus').textContent = text; },
    setVisible: (id, visible) => { $(id).hidden = !visible; }
  };
  ctx.phoneCommand = (phone, verb, args, action, summary, limitMs) => phoneCommand(ctx, phone, verb, args, action, summary, limitMs);
  ctx.press = (action, summary, verb, args, after) => press(ctx, action, summary, verb, args, after);
  ctx.loadHistory = () => loadStageHistory(ctx);
  ctx.savePref = (patch) => {
    const targetKey = ctx.currentTargetKey();
    return targetKey ? app.records.savePreferences({ targetKey, ...patch }).catch(() => null) : Promise.resolve(null);
  };
  ctx.restartFrameLoops = () => restartFrameLoops(ctx);
  ctx.scheduleFastFrame = (delayMs = 260) => scheduleFastFrame(ctx, delayMs);
  ctx.syncActiveDevice = () => syncActiveDevice(ctx);
  ctx.flashTouchIndicator = (clientX, clientY) => flashTouchIndicator(ctx, clientX, clientY);
  ctx.refreshActiveComputerFrame = () => { ctx.view.computerTag = ''; restartFrameLoops(ctx); };
  ctx.sessionComputer = mountSessionComputer(ctx);
  ctx.sessionMedia = mountSessionMedia(ctx);
  ctx.sessionCollab = mountSessionCollab(ctx);
  ctx.phoneConcierge = mountPhoneConcierge(ctx);
  return ctx;
}

/** @description Mount the Devices list and active Session view. @param {object} app The page. @returns {void} */
export function mountStage(app) {
  const ctx = createStageContext(app);
  app.select = (choice, push = true) => selectDevice(ctx, choice, push);
  app.endSession = (fromPop = false) => void endSession(ctx, fromPop);
  app.openSessionSheet = (push = true) => openSessionSheet(ctx, push);
  app.closeSessionSheet = (fromPop = false) => closeSessionSheet(ctx, fromPop);
  app.closeRowMenu = () => closeRowMenu(ctx);
  app.syncModalLayers = () => syncModalLayers(ctx);
  app.exitFullscreen = () => setFullscreenStage(ctx, false);
  wireRowActions(ctx);
  wireControls(ctx);
  ctx.desktopMedia.addEventListener?.('change', () => renderStage(ctx));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && ctx.view.fullscreen) setFullscreenStage(ctx, false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restartFrameLoops(ctx);
  });
  app.onChange(() => {
    renderRail(ctx);
    renderStage(ctx);
  });
}

function restartFrameLoops(ctx) {
  const phone = ctx.selectedPhone();
  const computer = ctx.selectedComputer();
  const rdp = ctx.selectedRdp();
  ctx.view.generation += 1;
  if (phone?.controlEnabled && (phone.platform === 'android' || (phone.platform === 'ios' && ctx.view.mirrorRunning))) {
    void frameLoop(ctx, ctx.view.generation);
  } else if (computer) {
    void computerLoop(ctx, ctx.view.generation);
  } else if (rdp) {
    void rdpLoop(ctx, ctx.view.generation, showPicture);
  }
}

function buildRow(label, sub, tone, selected, onPick, onMore) {
  const item = document.createElement('li');
  item.className = 'pc-device-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `pc-rail-item${selected ? ' is-selected' : ''}`;
  button.setAttribute('aria-selected', String(selected));
  const dot = document.createElement('span');
  dot.className = `pc-dot ${tone}`;
  const name = document.createElement('span');
  name.className = 'pc-rail-name';
  name.textContent = label;
  const small = document.createElement('small');
  small.textContent = sub;
  name.append(small);
  button.append(dot, name);
  button.addEventListener('click', onPick);
  item.append(button);
  if (onMore) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ks-btn pc-row-more';
    more.textContent = '⋮';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', `Options for ${label}`);
    more.addEventListener('click', (event) => { event.stopPropagation(); onMore(more); });
    item.append(more);
  }
  return item;
}

function renderRail(ctx) {
  const { app, $ } = ctx;
  closeRowMenu(ctx);
  $('phoneRail').replaceChildren(...app.state.phones.map((phone) => {
    const report = app.state.reports.get(phone.computerNodeId)?.report || null;
    const reachable = phoneReachable(phone, report);
    const kind = isTv(phone) ? TV : phone.platform === 'android' ? ANDROID : IPHONE;
    const selected = app.state.selected?.kind === 'phone' && app.state.selected.id === phone.id;
    const stateText = `${kind.label} · ${reachable ? 'connected' : 'last seen offline'}${phone.controlEnabled ? '' : ' · control off'}`;
    return buildRow(phone.name, stateText, reachable ? 'tone-ok' : 'tone-warn', selected,
      () => selectDevice(ctx, { kind: 'phone', id: phone.id }, true), (trigger) => openRowMenu(ctx, phone, trigger));
  }));
  const computerRows = app.state.computerList.map((computer) => {
    const standing = computerStanding(computer);
    const selected = app.state.selected?.kind === 'computer' && String(app.state.selected.id) === String(computer.id);
    return buildRow(computer.name || `Computer ${String(computer.id).slice(0, 8)}`, `Computer · ${standing.text}`, standing.tone, selected,
      () => selectDevice(ctx, { kind: 'computer', id: computer.id }, true), null);
  });
  const rdpRows = app.state.rdpSessions.map((rdp) => {
    const selected = app.state.selected?.kind === 'rdp' && String(app.state.selected.id) === String(rdp.sessionId);
    const live = rdp.connected !== false;
    return buildRow(rdpLabel(rdp), `RDP desktop · ${live ? 'connected' : 'disconnected'}`, live ? 'tone-ok' : 'tone-warn', selected,
      () => selectDevice(ctx, { kind: 'rdp', id: rdp.sessionId }, true), (trigger) => openRowMenu(ctx, null, trigger, rdp));
  });
  $('computerRail').replaceChildren(...computerRows, ...rdpRows);
  $('railEmpty').hidden = Boolean(app.state.phones.length || app.state.computerList.length || app.state.rdpSessions.length);
  renderDeviceSwitcher(ctx);
}

function openRowMenu(ctx, phone, trigger, rdp = null) {
  const menu = ctx.$('rowMenu');
  if (!menu.hidden && ((phone && ctx.view.menuPhone?.id === phone.id) || (rdp && ctx.view.menuRdp?.sessionId === rdp.sessionId))) {
    closeRowMenu(ctx);
    return;
  }
  closeRowMenu(ctx);
  ctx.view.menuPhone = phone;
  ctx.view.menuRdp = rdp;
  ctx.view.menuTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  ctx.$('rowToggleControl').hidden = Boolean(rdp);
  if (phone) ctx.$('rowToggleControl').textContent = phone.controlEnabled ? 'Allow control: On' : 'Allow control: Off';
  ctx.$('rowRemoveDevice').textContent = rdp ? 'Disconnect RDP' : 'Remove';
  menu.hidden = false;
  const rect = trigger.getBoundingClientRect();
  menu.style.top = `${Math.min(window.innerHeight - 116, Math.round(rect.bottom + 6))}px`;
  menu.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
}

function closeRowMenu(ctx) {
  ctx.$('rowMenu').hidden = true;
  if (ctx.view.menuTrigger) ctx.view.menuTrigger.setAttribute('aria-expanded', 'false');
  ctx.view.menuPhone = null;
  ctx.view.menuRdp = null;
  ctx.view.menuTrigger = null;
}

function syncSessionPlacement(ctx) {
  const { $, desktopMedia, app } = ctx;
  const desktop = desktopMedia.matches;
  const sheetOpen = Boolean(app.state.sessionSheetOpen);
  const controls = [
    $('allowControlRow'), $('typeForm'), $('openForm'),
    $('controlBar'), $('pointerPad'), $('computerPointerSection'), $('sessionFeaturesSection')
  ];
  if (desktop && !sheetOpen) {
    $('railConciergeBody').append($('conciergeCard'), $('computerConciergeCard'));
    $('railControlsDynamic').append(...controls);
    $('railControlsBody').append($('screenTextCard'), $('historyCard'));
  } else {
    $('sessionSheetControlsSlot').append(...controls);
    if (desktop) {
      $('railConciergeBody').append($('conciergeCard'), $('computerConciergeCard'));
      $('sessionSheetDetails').append($('screenTextCard'), $('historyCard'));
    } else {
      $('sessionSheetDetails').append($('conciergeCard'), $('computerConciergeCard'), $('screenTextCard'), $('historyCard'));
    }
  }
  const computer = ctx.selectedComputer();
  const workHost = desktop && computer ? $('desktopAssistSlot') : $('computerActions');
  workHost.append($('workOnIt'));
}

function openSessionSheet(ctx, push = true) {
  const { app, $ } = ctx;
  if (!app.state.selected) return;
  app.state.sessionSheetOpen = true;
  $('sessionSheet').hidden = false;
  $('sessionSheetScrim').hidden = false;
  $('sessionHandleBtn').setAttribute('aria-expanded', 'true');
  syncSessionPlacement(ctx);
  if (push && history.state?.pcView !== 'session-sheet') {
    history.pushState({ pcView: 'session-sheet', selected: app.state.selected }, '');
  }
  app.emit();
}

function closeSessionSheet(ctx, fromPop = false) {
  const { app, $ } = ctx;
  if (!app.state.sessionSheetOpen) return;
  app.state.sessionSheetOpen = false;
  $('sessionSheet').hidden = true;
  $('sessionSheetScrim').hidden = true;
  $('sessionHandleBtn').setAttribute('aria-expanded', 'false');
  syncSessionPlacement(ctx);
  if (!fromPop && history.state?.pcView === 'session-sheet') history.back();
  app.emit();
}

function loadTargetPreferences(ctx, targetKey, generation) {
  if (!targetKey) return;
  ctx.app.records.preferences(targetKey)
    .then((prefs) => {
      if (generation !== ctx.view.generation) return;
      ctx.sessionComputer.applyPreferences(prefs);
      ctx.sessionMedia.applyPreferences(prefs);
    })
    .catch(() => {});
}

async function probeIosMirror(ctx, phone, generation) {
  const reply = await phoneCommand(ctx, phone, 'status', { adb: false });
  if (generation !== ctx.view.generation || !reply?.ok) return;
  await ctx.app.keepReport(phone.computerNodeId, reply);
  if (generation !== ctx.view.generation) return;
  if (reply.mirror?.running && !ctx.view.mirrorRunning) {
    ctx.view.mirrorRunning = true;
    renderStage(ctx);
    restartFrameLoops(ctx);
    return;
  }
  renderStage(ctx);
}

function selectDevice(ctx, choice, push = true) {
  const { app, $, view, status } = ctx;
  closeRowMenu(ctx);
  app.state.sessionSheetOpen = false;
  $('sessionSheet').hidden = true;
  $('sessionSheetScrim').hidden = true;
  $('sessionHandleBtn').setAttribute('aria-expanded', 'false');
  app.state.selected = choice;
  view.generation += 1;
  view.frame = null;
  view.apps = [];
  view.computerTag = '';
  const phone = ctx.selectedPhone();
  view.mirrorRunning = Boolean(phone?.platform === 'ios' && app.state.reports.get(phone.computerNodeId)?.report?.mirror?.running);
  showPicture(ctx, null);
  status('');
  ctx.sessionComputer.resetForSelection();
  ctx.sessionMedia.resetForSelection();
  ctx.sessionCollab.onSelectTarget();
  ctx.phoneConcierge.onSelectTarget();
  if (push) {
    const fn = history.state?.pcView === 'connect' ? 'replaceState' : 'pushState';
    history[fn]({ pcView: 'session', selected: choice }, '');
  }
  renderStage(ctx);
  renderRail(ctx);
  void loadStageHistory(ctx);
  app.emit();
  restartFrameLoops(ctx);
  loadTargetPreferences(ctx, ctx.currentTargetKey(), view.generation);
  if (phone?.platform === 'android' && phone.controlEnabled) void loadApps(ctx, phone, view.generation);
  if (phone?.platform === 'ios' && phone.controlEnabled && !view.mirrorRunning) void probeIosMirror(ctx, phone, view.generation);
}

async function endSession(ctx, fromPop = false) {
  const { app, $, view, status } = ctx;
  if (!app.state.selected) return;
  const wasSheet = history.state?.pcView === 'session-sheet';
  const wasSession = history.state?.pcView === 'session';
  await Promise.allSettled([
    ctx.sessionMedia.beforeEndSession(),
    ctx.sessionComputer.beforeEndSession(),
    Promise.resolve(ctx.sessionCollab.beforeEndSession())
  ]);
  app.state.sessionSheetOpen = false;
  $('sessionSheet').hidden = true;
  $('sessionSheetScrim').hidden = true;
  $('sessionHandleBtn').setAttribute('aria-expanded', 'false');
  setFullscreenStage(ctx, false);
  app.state.selected = null;
  view.generation += 1;
  view.frame = null;
  view.mirrorRunning = false;
  showPicture(ctx, null);
  status('');
  renderStage(ctx);
  renderRail(ctx);
  if (!fromPop) {
    if (wasSheet) history.go(-2);
    else if (wasSession) history.back();
  }
  app.emit();
}

function showPicture(ctx, blob) {
  const image = ctx.$('screenImage');
  if (ctx.view.pictureUrl) URL.revokeObjectURL(ctx.view.pictureUrl);
  ctx.view.pictureUrl = blob ? URL.createObjectURL(blob) : '';
  image.hidden = !blob;
  if (blob) {
    image.src = ctx.view.pictureUrl;
    ctx.$('iosStageGuide').hidden = true;
  } else {
    image.removeAttribute('src');
    ctx.$('protectedSurfaceNotice').hidden = true;
  }
  ctx.sessionComputer.render();
  ctx.sessionCollab.renderWhiteboard();
}

function adoptRotatedSerial(ctx, phone, nextSerial) {
  if (!phone || phone.platform !== 'android' || !nextSerial || nextSerial === phone.address) return;
  phone.address = nextSerial;
  void ctx.app.records.updatePhone(phone.id, { address: nextSerial }).catch(() => {});
}

async function syncActiveDevice(ctx) {
  const phone = ctx.selectedPhone();
  if (ctx.selectedComputer() || ctx.selectedRdp()) {
    ctx.status('Refreshing screen…');
    ctx.refreshActiveComputerFrame();
    return;
  }
  if (!phone) return;
  await ctx.queue.press(async () => {
    if (phone.platform === 'ios') {
      ctx.status('Syncing Bluetooth & pointer…');
      const synced = await phoneCommand(ctx, phone, 'ble-sync', { address: phone.address }, 'sync', 'Sync iPhone Bluetooth', 25000);
      const fresh = await phoneCommand(ctx, phone, 'status', { adb: false });
      if (fresh?.ok) await ctx.app.keepReport(phone.computerNodeId, fresh);
      if (!synced) return;
      ctx.$('assistiveTouchBar').hidden = !synced.assistiveTouchOff;
      ctx.status(synced.message || (synced.ok ? 'iPhone Bluetooth synced.' : 'Bluetooth sync needs attention.'));
      renderStage(ctx);
      return;
    }
    ctx.status(isTv(phone) ? 'Syncing TV connection…' : 'Syncing Android connection…');
    const verb = isTv(phone) ? 'adb-connect-tv' : 'adb-connect';
    if (isTv(phone) || phone.address.includes(':')) {
      const synced = await phoneCommand(ctx, phone, verb, { address: phone.address }, 'sync', `Sync ${phone.name}`, 25000);
      if (synced?.ok) adoptRotatedSerial(ctx, phone, synced.serial);
    }
    const fresh = await phoneCommand(ctx, phone, 'status', {});
    if (fresh?.ok) await ctx.app.keepReport(phone.computerNodeId, fresh);
    ctx.status(`${phone.name} synced.`);
    renderStage(ctx);
    restartFrameLoops(ctx);
    scheduleFastFrame(ctx, 60);
  });
}

function sendHomeKey(ctx) {
  const phone = ctx.selectedPhone();
  if (!phone) return;
  if (phone.platform === 'android') press(ctx, 'key home', 'Home', 'adb-key', { key: 'HOME' });
  else press(ctx, 'key home', 'Home', 'ble-key', { key: 'Home', address: phone.address });
}

function syncPlatformAttributes(phone, tv, ios) {
  for (const button of document.querySelectorAll('[data-phone-only]')) button.hidden = !phone;
  for (const button of document.querySelectorAll('[data-android-only]')) {
    button.hidden = phone?.platform !== 'android' || (tv && button.hasAttribute('data-not-tv'));
  }
  for (const button of document.querySelectorAll('[data-tv-only]')) button.hidden = !tv;
  for (const button of document.querySelectorAll('[data-ios-only]')) button.hidden = !ios || tv;
}

function renderStage(ctx) {
  const { $, view, setVisible, desktopMedia } = ctx;
  const phone = ctx.selectedPhone();
  const computer = ctx.selectedComputer();
  const rdp = ctx.selectedRdp();
  const tv = isTv(phone);
  const ios = phone?.platform === 'ios';
  const active = Boolean(phone || computer || rdp);
  setVisible('pageHeader', !active && !ctx.app.state.notAllowed);
  setVisible('devicesView', !active && !ctx.app.state.notAllowed);
  setVisible('sessionView', active && !ctx.app.state.notAllowed);
  $('deviceFrame').dataset.kind = tv ? 'tv' : phone ? phone.platform : (computer || rdp) ? 'computer' : 'none';
  $('androidNavBar').dataset.tv = String(tv);
  setVisible('allowControlRow', Boolean(phone));
  setVisible('controlBar', Boolean(phone));
  setVisible('quickControlDock', active);
  setVisible('typeForm', active);
  setVisible('openForm', active);
  setVisible('tvRemote', tv);
  setVisible('pointerPad', ios);
  setVisible('computerPointerSection', Boolean(computer));
  setVisible('iosMirrorBar', false);
  setVisible('androidNavBar', phone?.platform === 'android' && !tv);
  setVisible('screenTextCard', phone?.platform === 'android' || (ios && view.mirrorRunning) || Boolean(rdp));
  setVisible('computerActions', Boolean(computer) && !desktopMedia.matches);
  setVisible('sessionHandleBtn', !desktopMedia.matches);
  setVisible('refreshScreen', phone?.platform === 'android' || (ios && view.mirrorRunning) || Boolean(rdp));
  const mirrorLabel = view.mirrorRunning ? 'Stop mirroring' : 'Start mirroring';
  $('sessionMirrorLabel').textContent = mirrorLabel;
  for (const id of ['iosMirrorBtn', 'sheetMirrorBtn', 'quickMirrorBtn']) $(id).textContent = mirrorLabel;
  syncPlatformAttributes(phone, tv, ios);
  $('iosStageGuide').hidden = true;
  $('screenNote').hidden = false;
  if (phone) renderPhoneHead(ctx, phone);
  else if (computer) renderComputerHead(ctx, computer);
  else if (rdp) renderRdpHead(ctx, rdp);
  ctx.sessionComputer.render();
  ctx.sessionCollab.renderWhiteboard();
  ctx.phoneConcierge.render();
  setRailState(ctx, !view.conciergeCollapsed, view.railTab);
  syncSessionPlacement(ctx);
  syncModalLayers(ctx);
}

function renderPhoneHead(ctx, phone) {
  const { app, $, view } = ctx;
  const host = app.computer(phone.computerNodeId);
  const tv = isTv(phone);
  const how = tv ? (phone.platform === 'ios' ? 'TV over Bluetooth' : 'TV over Wi-Fi')
    : phone.platform === 'android' ? 'Android over Wi-Fi'
      : view.mirrorRunning ? 'iPhone over Bluetooth + AirPlay' : 'iPhone over Bluetooth';
  const dims = view.frame?.deviceWidth && view.frame?.deviceHeight ? ` · ${view.frame.deviceWidth}×${view.frame.deviceHeight}` : '';
  $('stageTitle').textContent = phone.name;
  $('stageSub').textContent = `${how}${dims} · through ${host?.name || 'a computer that is not listed now'}`;
  $('allowControl').checked = phone.controlEnabled;
  const showIosGuide = Boolean(phone.platform === 'ios' && !tv && phone.controlEnabled && $('screenImage').hidden);
  $('iosStageGuide').hidden = !showIosGuide;
  if ($('screenImage').hidden) {
    if (tv && phone.platform === 'ios') {
      $('screenNote').hidden = false;
      $('screenNote').textContent = phone.controlEnabled
        ? 'Connected over Bluetooth (OSHAL-KB). Use the TV remote below or type on your keyboard.'
        : 'Allow control is off: nothing is sent to this TV.';
    } else if (phone.platform === 'ios') {
      const rcv = app.state.reports.get(phone.computerNodeId)?.report?.mirror?.receiverName || 'OSHAL Mirror';
      $('iosMirrorTargetName').textContent = rcv;
      $('screenNote').hidden = showIosGuide;
      $('screenNote').textContent = !phone.controlEnabled
        ? 'Allow control is off: nothing is sent to this iPhone.'
        : `Waiting for ${rcv} — swipe down Control Center → Screen Mirroring → ${rcv}.`;
    } else {
      $('screenNote').hidden = false;
      $('screenNote').textContent = phone.controlEnabled
        ? (tv ? 'Reading the TV’s screen…' : 'Reading the phone’s screen…')
        : (tv ? 'Allow control is off: nothing is sent to this TV.' : 'Allow control is off: nothing is sent to this phone.');
    }
  } else {
    $('screenNote').hidden = false;
  }
  $('appInput').placeholder = phone.platform === 'ios' ? 'App name, for example Notes' : 'App name or package';
}

function renderComputerHead(ctx, computer) {
  const { $ } = ctx;
  const standing = computerStanding(computer);
  $('stageTitle').textContent = computer.name || 'Computer';
  $('stageSub').textContent = `${computer.platform || 'computer'} · ${standing.text}`;
  $('workOnIt').href = workHref(computer.id);
  $('computerConciergeWorkBtn').href = workHref(computer.id);
  $('appInput').placeholder = 'App name, command or URL';
  if ($('screenImage').hidden) {
    $('screenNote').textContent = standing.usable ? 'Waiting for the first picture…' : standing.text;
  }
}

async function phoneCommand(ctx, phone, verb, args, action, summary, limitMs) {
  const { app, status } = ctx;
  if (!phone.controlEnabled) { status('Allow control is off: nothing was sent.'); return null; }
  const host = app.computer(phone.computerNodeId);
  if (!computerStanding(host).usable) {
    status(`${host?.name || 'The computer this phone is connected to'} is not taking commands now: ${computerStanding(host).text}.`);
    return null;
  }
  let reply;
  try {
    reply = await app.computers.bridge(phone.computerNodeId, verb, args, limitMs);
  } catch (error) {
    reply = { ok: false, error: 'refused', message: error.message, exitCode: null };
  }
  if (action) {
    await app.remember({
      computerNodeId: phone.computerNodeId, phoneId: phone.id, action, summary,
      ok: Boolean(reply.ok), exitCode: reply.exitCode ?? null, error: reply.ok ? null : reply.message || reply.error
    });
    void loadStageHistory(ctx);
  }
  return reply;
}

function scheduleFastFrame(ctx, delayMs = 260) {
  const wait = Math.max(40, delayMs);
  ctx.view.fastFramePendingAt = Date.now() + wait;
  if (typeof ctx.view.wakeFrame !== 'function') return;
  const wake = ctx.view.wakeFrame;
  ctx.view.wakeFrame = null;
  setTimeout(wake, wait);
}

function waitNextFrame(ctx, ms) {
  let waitMs = ms;
  if (ctx.view.fastFramePendingAt > 0) {
    waitMs = Math.min(ms, Math.max(40, ctx.view.fastFramePendingAt - Date.now()));
    ctx.view.fastFramePendingAt = 0;
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ctx.view.wakeFrame === finish) ctx.view.wakeFrame = null;
      resolve();
    };
    const timer = setTimeout(finish, waitMs);
    ctx.view.wakeFrame = finish;
  });
}

function press(ctx, action, summary, verb, args, after) {
  const phone = ctx.selectedPhone();
  if (!phone) return;
  ctx.status(`${summary}…`);
  void ctx.queue.press(async () => {
    const extra = phone.platform === 'android' ? { serial: phone.address } : { address: phone.address };
    const reply = await phoneCommand(ctx, phone, verb, { ...extra, ...args }, action, summary);
    if (!reply) return;
    if (phone.platform === 'android' && reply.ok) scheduleFastFrame(ctx, 260);
    if (phone.platform === 'ios' && reply.error === 'assistive_touch_off') ctx.$('assistiveTouchBar').hidden = false;
    ctx.status(reply.ok ? `${summary}: done.` : reply.message || 'It did not work.');
    if (reply.ok && after) after(reply);
  });
}

async function toggleSessionMirror(ctx) {
  const phone = ctx.selectedPhone();
  if (phone?.platform !== 'ios') return;
  await ctx.queue.press(async () => {
    if (ctx.view.mirrorRunning) {
      ctx.status('Stopping screen mirroring…');
      const stopped = await phoneCommand(ctx, phone, 'mirror-stop', {}, 'mirror', 'Stop iPhone screen mirroring', 30000);
      if (!stopped) return;
      ctx.view.mirrorRunning = false;
      ctx.view.generation += 1;
      showPicture(ctx, null);
      renderStage(ctx);
      ctx.status(stopped.ok ? 'Screen mirroring stopped.' : stopped.message || 'Could not stop mirroring.');
      return;
    }
    ctx.status('Starting AirPlay receiver…');
    let started = await phoneCommand(ctx, phone, 'mirror-start', {}, 'mirror', 'Start iPhone screen mirroring', 45000);
    if (!started) return;
    if (!started.ok && started.error === 'no_uxplay') {
      ctx.status('Setting up UxPlay on that computer…');
      const setup = await phoneCommand(ctx, phone, 'setup-mirror', {}, 'set up', 'AirPlay screen mirroring (UxPlay)', 300000);
      if (!setup?.ok) { ctx.status(setup?.message || 'UxPlay setup failed.'); return; }
      started = await phoneCommand(ctx, phone, 'mirror-start', {}, 'mirror', 'Start iPhone screen mirroring', 45000);
    }
    if (!started?.ok) { ctx.status(started?.message || 'Could not start mirroring.'); return; }
    ctx.view.mirrorRunning = true;
    const saved = ctx.app.state.reports.get(phone.computerNodeId)?.report;
    if (saved) saved.mirror = started.mirror;
    renderStage(ctx);
    ctx.status(`AirPlay receiver on as ${started.receiverName}.`);
    restartFrameLoops(ctx);
  });
}

async function frameLoop(ctx, generation) {
  const { app, $, queue, view, status } = ctx;
  while (generation === view.generation) {
    const phone = ctx.selectedPhone();
    const isMirrorIos = phone?.platform === 'ios' && view.mirrorRunning;
    if (!phone || !phone.controlEnabled || (phone.platform !== 'android' && !isMirrorIos)) return;
    if (document.visibilityState === 'visible' && !app.state.connectOpen) {
      const frameVerb = isMirrorIos ? 'mirror-frame' : 'adb-frame';
      const send = async (verb, args) => (await phoneCommand(ctx, phone, verb, args)) || { ok: false, message: $('stageStatus').textContent };
      const job = queue.refresh(() => readFrame(send, phone.address, ctx.sessionMedia.frameWidth(), frameVerb));
      if (job) {
        try {
          const frame = await job;
          if (generation !== view.generation) return;
          adoptRotatedSerial(ctx, phone, frame.serial);
          view.frame = { ...frame, width: frame.deviceWidth, height: frame.deviceHeight };
          showPicture(ctx, new Blob([frame.bytes], { type: frame.mime }));
          renderProtectedSurface(ctx, frame);
          renderPhoneHead(ctx, phone);
          $('screenNote').textContent = '';
          if (frame.screenAsleep) status('Screen is asleep — press Home or OK to wake it.');
          else status(frame.slow ? 'This computer has no ffmpeg, so each picture is a full PNG and slow.' : '');
        } catch (error) {
          if (generation !== view.generation) return;
          if (error?.reply?.error === 'mirror_not_running') {
            view.mirrorRunning = false;
            showPicture(ctx, null);
            renderStage(ctx);
            return;
          }
          $('screenNote').textContent = error.message;
        }
      }
    }
    await waitNextFrame(ctx, ctx.sessionMedia.phoneFrameMs());
  }
}

async function computerLoop(ctx, generation) {
  const { app, $, view } = ctx;
  while (generation === view.generation) {
    const computer = ctx.selectedComputer();
    if (!computer) return;
    if (document.visibilityState === 'visible' && !app.state.connectOpen && computerStanding(computer).usable) {
      try {
        const monitorBlob = await ctx.sessionComputer.captureSelectedMonitor(computer, ctx.sessionMedia.frameWidth());
        if (generation !== view.generation) return;
        if (monitorBlob) {
          showPicture(ctx, monitorBlob);
          $('screenNote').textContent = '';
        } else {
          const response = await app.computers.screen(computer.id, view.computerTag);
          if (generation !== view.generation) return;
          if (response.status === 200) {
            view.computerTag = response.headers.get('etag') || '';
            showPicture(ctx, await response.blob());
            $('screenNote').textContent = '';
          } else if (response.status === 404) {
            showPicture(ctx, null);
            $('screenNote').textContent = 'Waiting for a picture from that computer…';
          } else if (response.status !== 304) {
            $('screenNote').textContent = `The screen could not be read (HTTP ${response.status}).`;
          }
        }
      } catch (error) {
        $('screenNote').textContent = `The screen could not be read: ${error.message}`;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, ctx.sessionMedia.computerFrameMs()));
  }
}

async function loadApps(ctx, phone, generation) {
  const reply = await ctx.queue.press(() => phoneCommand(ctx, phone, 'adb-apps', { serial: phone.address }));
  if (generation !== ctx.view.generation || !reply?.ok) return;
  ctx.view.apps = reply.apps;
  ctx.$('appList').replaceChildren(...reply.apps.map((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.label = name.split('.').pop();
    return option;
  }));
}

function androidPackageFor(apps, text) {
  const wanted = text.trim().toLowerCase();
  if (apps.includes(text.trim())) return text.trim();
  const squashed = wanted.replace(/\s+/g, '');
  return apps.find((name) => name.split('.').pop().toLowerCase() === squashed)
    || apps.find((name) => name.toLowerCase().includes(squashed)) || null;
}

function closeRemoveDialog(ctx) {
  ctx.view.pendingRemoveId = null;
  ctx.view.pendingRemoveRdpId = null;
  const dialog = ctx.$('removePhoneDialog');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

async function confirmRemovePhone(ctx) {
  const id = ctx.view.pendingRemoveId;
  const rdpId = ctx.view.pendingRemoveRdpId;
  closeRemoveDialog(ctx);
  if (rdpId) {
    await ctx.app.rdp.disconnect(rdpId).catch(() => {});
    ctx.app.state.rdpSessions = ctx.app.state.rdpSessions.filter((item) => item.sessionId !== rdpId);
    setStoredRdp(ctx.app.state.rdpSessions.length > 0);
    if (ctx.app.state.selected?.kind === 'rdp' && ctx.app.state.selected.id === rdpId) await endSession(ctx, false);
    else ctx.app.emit();
    return;
  }
  if (!id) return;
  try {
    await ctx.app.records.removePhone(id);
    ctx.app.state.phones = ctx.app.state.phones.filter((item) => item.id !== id);
    if (ctx.app.state.selected?.kind === 'phone' && ctx.app.state.selected.id === id) await endSession(ctx, false);
    else ctx.app.emit();
  } catch (error) {
    ctx.app.say(`Device could not be removed: ${error.message}`);
  }
}

function wireRowActions(ctx) {
  const { $ } = ctx;
  $('rowToggleControl').addEventListener('click', () => {
    const target = ctx.view.menuPhone;
    closeRowMenu(ctx);
    if (target) void updatePhoneControl(ctx, target, !target.controlEnabled);
  });
  $('rowRemoveDevice').addEventListener('click', () => {
    const target = ctx.view.menuPhone;
    const rdpTarget = ctx.view.menuRdp;
    closeRowMenu(ctx);
    if (!target && !rdpTarget) return;
    ctx.view.pendingRemoveId = target?.id || null;
    ctx.view.pendingRemoveRdpId = rdpTarget?.sessionId || null;
    $('removePhoneTitle').textContent = rdpTarget ? `Disconnect ${rdpLabel(rdpTarget)}?` : `Remove ${target.name}?`;
    const dialog = $('removePhoneDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  $('cancelRemovePhone').addEventListener('click', () => closeRemoveDialog(ctx));
  $('confirmRemovePhone').addEventListener('click', () => void confirmRemovePhone(ctx));
  document.addEventListener('click', (event) => {
    if (!$('rowMenu').hidden && !event.target?.closest?.('#rowMenu, .pc-row-more')) closeRowMenu(ctx);
  });
}

function wireToolbarControls(ctx) {
  const { $ } = ctx;
  $('backToDevicesBtn').addEventListener('click', () => void endSession(ctx, false));
  $('sessionDeviceSelect').addEventListener('change', (event) => {
    const [kind, ...rest] = String(event.target.value || '').split(':');
    const id = rest.join(':');
    if (kind && id) selectDevice(ctx, { kind, id }, true);
  });
  $('syncDeviceBtn').addEventListener('click', () => void syncActiveDevice(ctx));
  $('sessionAddDeviceBtn').addEventListener('click', () => ctx.app.openConnect(true));
  $('openControlsRailBtn').addEventListener('click', () => toggleRailTab(ctx, 'controls'));
  $('toggleConciergeBtn').addEventListener('click', () => toggleRailTab(ctx, 'concierge'));
  $('railTabControls').addEventListener('click', () => setRailState(ctx, true, 'controls'));
  $('railTabConcierge').addEventListener('click', () => setRailState(ctx, true, 'concierge'));
  const hideRail = () => setRailState(ctx, false, ctx.view.railTab);
  $('closeConciergeRailBtn').addEventListener('click', hideRail);
  $('closeComputerRailBtn').addEventListener('click', hideRail);
  $('closeControlsRailBtn').addEventListener('click', hideRail);
  $('fullscreenStageBtn').addEventListener('click', () => setFullscreenStage(ctx, !ctx.view.fullscreen));
  $('fsSyncBtn').addEventListener('click', () => void syncActiveDevice(ctx));
  $('fsHomeBtn').addEventListener('click', () => sendHomeKey(ctx));
  $('fsExitBtn').addEventListener('click', () => setFullscreenStage(ctx, false));
  $('protectedGoHomeBtn').addEventListener('click', () => sendHomeKey(ctx));
}

function wireControls(ctx) {
  const { $, app } = ctx;
  wireToolbarControls(ctx);
  for (const button of document.querySelectorAll('.pc-key')) {
    button.addEventListener('click', () => {
      const phone = ctx.selectedPhone();
      if (!phone) return;
      if (phone.platform === 'android') press(ctx, `key ${button.dataset.key.toLowerCase()}`, button.textContent.trim(), 'adb-key', { key: button.dataset.key });
      else press(ctx, `key ${button.dataset.ios.toLowerCase()}`, button.textContent.trim(), 'ble-key', { key: button.dataset.ios });
    });
  }
  $('sessionControlsBtn').addEventListener('click', () => openSessionSheet(ctx, true));
  $('sessionHandleBtn').addEventListener('click', () => (app.state.sessionSheetOpen ? closeSessionSheet(ctx, false) : openSessionSheet(ctx, true)));
  $('sessionSheetDoneBtn').addEventListener('click', () => closeSessionSheet(ctx, false));
  $('sessionSheetScrim').addEventListener('click', () => closeSessionSheet(ctx, false));
  $('endSessionTopBtn').addEventListener('click', () => void endSession(ctx, false));
  $('endSessionBtn').addEventListener('click', () => void endSession(ctx, false));
  $('sessionMirrorBtn').addEventListener('click', () => void toggleSessionMirror(ctx));
  $('iosMirrorBtn').addEventListener('click', () => void toggleSessionMirror(ctx));
  $('sheetMirrorBtn').addEventListener('click', () => void toggleSessionMirror(ctx));
  $('quickMirrorBtn').addEventListener('click', () => void toggleSessionMirror(ctx));
  $('refreshScreen').addEventListener('click', () => restartFrameLoops(ctx));
  for (const button of document.querySelectorAll('.pc-move')) {
    button.addEventListener('click', () => press(ctx, 'pointer', `Move the pointer ${button.textContent.trim().toLowerCase()}`, 'ble-mouse',
      { dx: Number(button.dataset.dx), dy: Number(button.dataset.dy) }));
  }
  $('pointerClick').addEventListener('click', () => press(ctx, 'pointer', 'Click', 'ble-mouse', { dx: 0, dy: 0, click: true }));
  $('allowControl').addEventListener('change', () => {
    const phone = ctx.selectedPhone();
    if (phone) void updatePhoneControl(ctx, phone, $('allowControl').checked);
  });
  $('readScreen').addEventListener('click', () => readScreen(ctx));
  wireForms(ctx);
  wirePicture(ctx);
  wireStageTouchpad(ctx);
}

function wireForms(ctx) {
  const { $, view, status } = ctx;
  $('typeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('typeInput').value;
    const computer = ctx.selectedComputer();
    if (computer && text) {
      if (await ctx.sessionComputer.typeOnComputer(computer, text)) $('typeInput').value = '';
      return;
    }
    const rdp = ctx.selectedRdp();
    if (rdp && text) {
      const sent = await ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'type', text, enter: false }, `Type ${text.length} characters`));
      if (sent?.ok) $('typeInput').value = '';
      return;
    }
    const phone = ctx.selectedPhone();
    if (!phone || !text) return;
    press(ctx, 'type', `Type ${text.length} characters`, phone.platform === 'android' ? 'adb-text' : 'ble-type', { text }, () => { $('typeInput').value = ''; });
  });
  $('openForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('appInput').value.trim();
    const computer = ctx.selectedComputer();
    if (computer && name) {
      if (await ctx.sessionComputer.openOnComputer(computer, name)) $('appInput').value = '';
      return;
    }
    const rdp = ctx.selectedRdp();
    if (rdp && name) {
      await ctx.queue.press(async () => {
        await sendRdpInput(ctx, rdp, { action: 'key', key: 'Super' }, 'Open launcher');
        const sent = await sendRdpInput(ctx, rdp, { action: 'type', text: name, enter: true }, `Open ${name}`);
        if (sent?.ok) $('appInput').value = '';
      });
      return;
    }
    const phone = ctx.selectedPhone();
    if (!phone || !name) return;
    if (phone.platform === 'ios') return press(ctx, 'open app', `Open ${name}`, 'ble-open', { name });
    const pkg = androidPackageFor(view.apps, name);
    if (!pkg) return status(view.apps.length ? `No app on this device matches ${name}.` : 'The device’s apps have not been read yet.');
    return press(ctx, 'open app', `Open ${pkg}`, 'adb-launch', { package: pkg });
  });
}

function finishScreenPointerUp(ctx, event, end) {
  const start = ctx.view.drag;
  ctx.view.drag = null;
  if (!start) return;
  const rdp = ctx.selectedRdp();
  if (rdp) { handleRdpPointerUp(ctx, rdp, start, end); return; }
  const phone = ctx.selectedPhone();
  if (phone?.platform === 'ios' && !isTv(phone)) {
    flashTouchIndicator(ctx, event.clientX, event.clientY);
    ctx.phoneConcierge.handleIosGesture(start, end);
    return;
  }
  ctx.$('deviceFrame').focus({ preventScroll: true });
  if (isTv(phone) && phone?.platform === 'ios') { ctx.status("Use the remote's arrows and OK."); return; }
  if (!ctx.view.frame) return;
  try {
    const swipe = swipeFromDrag(start, end, end.box, ctx.view.frame, performance.now() - start.at);
    if (swipe) press(ctx, 'swipe', 'Swipe', 'adb-swipe', swipe);
    else {
      const point = tapPoint(end, end.box, ctx.view.frame);
      press(ctx, 'tap', `Tap at ${point.x}, ${point.y}`, 'adb-tap', point);
    }
  } catch (error) {
    ctx.status(error.message);
  }
}

function wirePicture(ctx) {
  const image = ctx.$('screenImage');
  image.addEventListener('load', () => {
    const phone = ctx.selectedPhone();
    const rdp = ctx.selectedRdp();
    if ((!phone && !rdp) || !(image.naturalWidth > 0 && image.naturalHeight > 0)) return;
    const dw = ctx.view.frame?.deviceWidth || image.naturalWidth;
    const dh = ctx.view.frame?.deviceHeight || image.naturalHeight;
    ctx.view.frame = { ...(ctx.view.frame || {}), width: dw, height: dh, deviceWidth: dw, deviceHeight: dh };
    if (phone) renderPhoneHead(ctx, phone);
    else if (rdp) renderRdpHead(ctx, rdp);
  });
  const local = (event) => { const box = image.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top, box }; };
  image.addEventListener('pointerdown', (event) => {
    if (ctx.selectedComputer()) { ctx.sessionComputer.onPointerDown(local(event)); return; }
    const phone = ctx.selectedPhone();
    if (phone?.platform === 'ios' && !isTv(phone)) flashTouchIndicator(ctx, event.clientX, event.clientY);
    ctx.view.drag = { ...local(event), at: performance.now() };
  });
  image.addEventListener('pointermove', (event) => {
    if (ctx.selectedComputer()) { ctx.sessionComputer.onPointerMove(event, local(event)); return; }
    if (ctx.view.drag && ctx.selectedPhone()?.platform === 'ios') flashTouchIndicator(ctx, event.clientX, event.clientY);
  });
  image.addEventListener('pointerup', (event) => {
    if (ctx.selectedComputer()) { ctx.sessionComputer.onPointerUp(local(event)); return; }
    finishScreenPointerUp(ctx, event, local(event));
  });
}

function wireStageTouchpad(ctx) {
  const frame = ctx.$('deviceFrame');
  const localPad = (event) => {
    const box = frame.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, box };
  };
  frame.addEventListener('pointerdown', (event) => {
    if (!ctx.$('screenImage').hidden || event.target?.closest?.('button, a, #protectedSurfaceNotice')) return;
    const phone = ctx.selectedPhone();
    if (!phone || phone.platform !== 'ios' || isTv(phone)) return;
    flashTouchIndicator(ctx, event.clientX, event.clientY);
    ctx.view.padDrag = { ...localPad(event), at: performance.now() };
  });
  frame.addEventListener('pointermove', (event) => {
    if (ctx.view.padDrag) flashTouchIndicator(ctx, event.clientX, event.clientY);
  });
  frame.addEventListener('pointerup', (event) => {
    const start = ctx.view.padDrag;
    ctx.view.padDrag = null;
    if (!start) return;
    flashTouchIndicator(ctx, event.clientX, event.clientY);
    ctx.phoneConcierge.handleIosGesture(start, localPad(event));
  });
}

async function updatePhoneControl(ctx, phone, enabled) {
  try {
    const { device } = await ctx.app.records.updatePhone(phone.id, { controlEnabled: enabled });
    ctx.app.state.phones = ctx.app.state.phones.map((item) => (item.id === device.id ? device : item));
    if (ctx.app.state.selected?.kind === 'phone' && ctx.app.state.selected.id === device.id) {
      selectDevice(ctx, { kind: 'phone', id: device.id }, false);
      ctx.status(enabled ? 'Control is on.' : 'Control is off: nothing is sent to this device.');
    } else {
      ctx.app.emit();
    }
  } catch (error) {
    if (ctx.selectedPhone()?.id === phone.id) ctx.$('allowControl').checked = !enabled;
    ctx.status(`Allow control could not be saved: ${error.message}`);
  }
}

function readScreen(ctx) {
  const rdp = ctx.selectedRdp();
  if (rdp) { readRdpScreen(ctx, rdp); return; }
  const phone = ctx.selectedPhone();
  if (!phone) return;
  if (phone.platform === 'ios' && !ctx.view.mirrorRunning) {
    ctx.status('Start mirroring first to read words from your iPhone screen.');
    return;
  }
  const verb = phone.platform === 'ios' ? 'mirror-ui' : 'adb-ui';
  press(ctx, 'read screen', 'Read the screen', verb, {}, (reply) => renderScreenItems(ctx, { phone }, reply));
}
