/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Phone & Device Control client controller conforming to docs/ux/screen-standard.md: sortable KernelTable views, portal theme inheritance, Cockpit Concierge rail handoff, and live device execution.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: the page's start. It reads your phones (this package), your computers (the kernel's /api/computers) and each computer's last bridge report, and hands them to the Devices view (phone-stage.js) and Connect a device (phone-setup.js). The concierge rail gets the page's context to read; it is not given anything to press.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: the view switch marks its choice with aria-selected only (styled as a selection, not as a primary button), and the empty line is shorter.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: when /api/phone-control/devices answers 403 (an account that holds the page view only, not the administrator's role), show #notAllowed and hide the device and connect views.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: merge Connect into a modal sheet opened by Add a device or /config/ui, preserve the non-admin 403 #notAllowed view, manage history state so Back closes sheets before the session (DS-39), hide the shell orb during an active session, and guard inert planned controls.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: attach surface-bridge-client.js cleanly without console 404 when embedded in the cockpit, keep the shell concierge orb visible at all times, open the Connect sheet on #connect-tv, pass full device/computer context snapshot to the concierge rail, and sync modal background inert state.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: gate rdp.list() on hasStoredRdp() to eliminate 404 console noise when no RDP session is active, and exit fullscreen stage on Escape before closing modal sheets.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0: the line under the heading counts what the tree lists (a phone or TV that signed in with the Open Swarm app is a phone or TV, not a computer).
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): the line a page-only account reads says what it cannot do ("Your account cannot add or control devices here.") instead of naming the administrator; the 403 handling is unchanged.
 */

import { createComputerClient, createPackageClient, createRdpClient, hasStoredRdp } from '/api/phone-control/ui/computer-link.js';
import { mountStage } from '/api/phone-control/ui/phone-stage.js';
import { mountSetup } from '/api/phone-control/ui/phone-setup.js';
import { buildPhoneControlContextSnapshot, connectPhoneControlHandoff } from '/api/phone-control/ui/editor-handoff.mjs';

const byId = (id) => document.getElementById(id);

function setShellOrbHidden(hidden) {
  const seen = new Set();
  for (const win of [window, window.parent, window.top]) {
    if (!win || seen.has(win)) continue;
    seen.add(win);
    try {
      const root = win.document?.documentElement;
      if (!root) continue;
      if (hidden) root.setAttribute('data-oshal-assistant-hidden', 'true');
      else root.removeAttribute('data-oshal-assistant-hidden');
      win.dispatchEvent(new win.CustomEvent('oshal:assistant-visibility', { detail: { hidden: Boolean(hidden) } }));
    } catch { /* cross-origin frame */ }
  }
}

function showNotAllowed(app) {
  app.state.notAllowed = true;
  app.state.connectOpen = false;
  app.state.sessionSheetOpen = false;
  app.state.selected = null;
  setShellOrbHidden(false);
  byId('notAllowed').hidden = false;
  byId('devicesView').hidden = true;
  byId('sessionView').hidden = true;
  byId('connectSheet').hidden = true;
  byId('connectScrim').hidden = true;
  byId('sessionSheet').hidden = true;
  byId('sessionSheetScrim').hidden = true;
  byId('pageActions').hidden = true;
  app.syncModalLayers?.();
  app.say('Your account cannot add or control devices here.');
}

const app = {
  computers: createComputerClient(),
  records: createPackageClient(),
  rdp: createRdpClient(),
  state: {
    phones: [],
    computerList: [],
    rdpSessions: [],
    reports: new Map(),
    selected: null,
    mode: 'devices',
    connectOpen: false,
    sessionSheetOpen: false,
    computersRefused: '',
    notAllowed: false,
    loadedOnce: false
  },
  byId,
  refreshTables() {
    if (window.KernelTable && typeof window.KernelTable.install === 'function') window.KernelTable.install(document);
  },
  say(text) { byId('pageLede').textContent = text; },
  async load() {
    let phones;
    let reports;
    try {
      [phones, reports] = await Promise.all([app.records.phones(), app.records.reports()]);
    } catch (error) {
      if (error?.status === 403) { showNotAllowed(app); return; }
      throw error;
    }
    app.state.phones = phones;
    app.state.reports = new Map(reports.map((item) => [item.computerNodeId, item]));
    try {
      app.state.computerList = await app.computers.list();
      app.state.computersRefused = '';
    } catch (error) {
      app.state.computerList = [];
      app.state.computersRefused = error.status === 401 ? 'Sign in through oshal to see your computers.' : `Your computers could not be read: ${error.message}`;
    }
    app.state.rdpSessions = hasStoredRdp() ? await app.rdp.list().catch(() => []) : [];
    app.state.loadedOnce = true;
    app.emit();
  },
  computer(id) { return app.state.computerList.find((item) => String(item.id) === String(id)) || null; },
  rdpSession(id) { return app.state.rdpSessions.find((item) => String(item.sessionId) === String(id)) || null; },
  async remember(event) {
    try { await app.records.record(event); } catch { /* history never stops the action */ }
  },
  async keepReport(nodeId, report) {
    try {
      const saved = await app.records.report(nodeId, report);
      app.state.reports.set(nodeId, saved);
    } catch {
      app.state.reports.set(nodeId, { computerNodeId: nodeId, report, reportedAt: Date.now() });
    }
  },
  listeners: [],
  onChange(listener) { app.listeners.push(listener); },
  emit() {
    if (app.state.notAllowed) return;
    setShellOrbHidden(false);
    for (const listener of app.listeners) listener();
    surface?.emitContext?.(buildPhoneControlContextSnapshot(contextState()));
  },
  openConnect(push = true) {
    if (app.state.notAllowed) return;
    app.state.connectOpen = true;
    app.state.mode = 'connect';
    byId('connectSheet').hidden = false;
    byId('connectScrim').hidden = false;
    if (push && history.state?.pcView !== 'connect') history.pushState({ pcView: 'connect' }, '');
    app.emit();
  },
  closeConnect(fromPop = false) {
    if (!app.state.connectOpen) return;
    app.state.connectOpen = false;
    app.state.mode = 'devices';
    byId('connectSheet').hidden = true;
    byId('connectScrim').hidden = true;
    if (!fromPop && history.state?.pcView === 'connect') history.back();
    app.emit();
  }
};

let surface = null;

function contextState() {
  const chosen = app.state.selected;
  const phone = chosen?.kind === 'phone' ? app.state.phones.find((item) => item.id === chosen.id) : null;
  const computer = chosen?.kind === 'computer' ? app.computer(chosen.id) : null;
  const rdp = chosen?.kind === 'rdp' ? app.rdpSession(chosen.id) : null;
  return {
    mode: app.state.mode,
    phone,
    computer,
    rdp,
    phones: app.state.phones,
    computers: app.state.computerList,
    rdpSessions: app.state.rdpSessions,
    selectedPhone: phone,
    selectedComputer: computer,
    selectedRdp: rdp
  };
}

function lede() {
  if (app.state.notAllowed) return 'Your account cannot add or control devices here.';
  if (app.state.computersRefused) return app.state.computersRefused;
  const phones = app.state.phones.length;
  const computers = app.state.computerList.length;
  const rdpCount = app.state.rdpSessions.length;
  if (!phones && !computers && !rdpCount) return 'No phones, TVs or computers yet.';
  const android = app.state.computerList.filter((c) => String(c?.platform || '').toLowerCase() === 'android').length;
  const phoneWords = `${phones + android} ${phones + android === 1 ? 'phone or TV' : 'phones and TVs'}`;
  const computerWords = `${computers - android} ${computers - android === 1 ? 'computer' : 'computers'}`;
  const rdpWords = rdpCount ? ` · ${rdpCount} RDP` : '';
  return `${phoneWords} · ${computerWords}${rdpWords}.`;
}

async function attachSurface() {
  connectPhoneControlHandoff({ getState: contextState });
  if (window.parent === window) return;
  try {
    const sdk = await import('/shared/ui/js/surface-bridge-client.js');
    if (typeof sdk.createSurfaceBridgeClient === 'function') {
      surface = sdk.createSurfaceBridgeClient({ app: 'phone-control' });
      surface.attach();
      surface.emitContext?.(buildPhoneControlContextSnapshot(contextState()));
    }
  } catch {
    surface = null;
  }
}

function handlePopState(event) {
  if (app.state.notAllowed) return;
  const view = event.state?.pcView || 'list';
  if (view === 'session-sheet' && event.state?.selected) {
    app.closeConnect(true);
    if (!app.state.selected) app.select?.(event.state.selected, false);
    app.openSessionSheet?.(false);
  } else if (view === 'session' && event.state?.selected) {
    app.closeConnect(true);
    app.closeSessionSheet?.(true);
    if (!app.state.selected || app.state.selected.id !== event.state.selected.id) app.select?.(event.state.selected, false);
  } else if (view === 'connect') {
    app.closeSessionSheet?.(true);
    app.openConnect(false);
  } else {
    app.closeSessionSheet?.(true);
    app.closeConnect(true);
    app.endSession?.(true);
  }
}

function wireLayers() {
  window.addEventListener('popstate', handlePopState);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (byId('stageCard')?.classList.contains('is-fullscreen')) { app.exitFullscreen?.(); return; }
    if (!byId('rowMenu').hidden) { app.closeRowMenu?.(); return; }
    if (app.state.sessionSheetOpen) { app.closeSessionSheet?.(false); return; }
    if (app.state.connectOpen) app.closeConnect(false);
  });
  window.addEventListener('pagehide', () => setShellOrbHidden(false));
}

function start() {
  history.replaceState({ pcView: 'list' }, '');
  byId('addDeviceBtn').addEventListener('click', () => app.openConnect(true));
  byId('connectCloseBtn').addEventListener('click', () => app.closeConnect(false));
  byId('connectScrim').addEventListener('click', () => app.closeConnect(false));
  wireLayers();
  app.onChange(() => app.say(lede()));
  mountStage(app);
  mountSetup(app);
  const startConnect = location.pathname.includes('/config/')
    || location.hash === '#connect'
    || location.hash === '#connect-tv'
    || new URLSearchParams(location.search).get('connect') === '1';
  if (startConnect) app.openConnect(true);
  void attachSurface();
  app.load().catch((error) => app.say(`Your devices could not be read: ${error.message}`));
}

start();
