/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Phone & Device Control client controller conforming to docs/ux/screen-standard.md: sortable KernelTable views, portal theme inheritance, Cockpit Concierge rail handoff, and live device execution.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: the page's start. It reads your phones (this package), your computers (the kernel's /api/computers) and each computer's last bridge report, and hands them to the Devices view (phone-stage.js) and Connect a device (phone-setup.js). The concierge rail gets the page's context to read; it is not given anything to press.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: the view switch marks its choice with aria-selected only (styled as a selection, not as a primary button), and the empty line is shorter.
 */

import { createComputerClient, createPackageClient } from '/api/phone-control/ui/computer-link.js';
import { mountStage } from '/api/phone-control/ui/phone-stage.js';
import { mountSetup } from '/api/phone-control/ui/phone-setup.js';
import { connectPhoneControlHandoff, buildPhoneControlContextSnapshot } from '/api/phone-control/ui/editor-handoff.mjs';

const byId = (id) => document.getElementById(id);

const app = {
  computers: createComputerClient(),
  records: createPackageClient(),
  state: { phones: [], computerList: [], reports: new Map(), selected: null, mode: 'devices', computersRefused: '' },
  byId,
  refreshTables() {
    if (window.KernelTable && typeof window.KernelTable.install === 'function') window.KernelTable.install(document);
  },
  say(text) { byId('pageLede').textContent = text; },
  async load() {
    const [phones, reports] = await Promise.all([app.records.phones(), app.records.reports()]);
    app.state.phones = phones;
    app.state.reports = new Map(reports.map((item) => [item.computerNodeId, item]));
    try {
      app.state.computerList = await app.computers.list();
      app.state.computersRefused = '';
    } catch (error) {
      app.state.computerList = [];
      app.state.computersRefused = error.status === 401 ? 'Sign in through oshal to see your computers.' : `Your computers could not be read: ${error.message}`;
    }
    app.emit();
  },
  computer(id) { return app.state.computerList.find((item) => String(item.id) === String(id)) || null; },
  async keepReport(node, report) {
    const saved = await app.records.report(node, report);
    app.state.reports.set(node, saved);
    return saved;
  },
  async remember(event) {
    try {
      await app.records.record(event);
    } catch (error) {
      app.say(`What was sent could not be written to History: ${error.message}`);
    }
  },
  listeners: [],
  onChange(listener) { app.listeners.push(listener); },
  emit() {
    for (const listener of app.listeners) listener();
    surface?.emitContext?.(buildPhoneControlContextSnapshot(contextState()));
  },
  setMode(mode) {
    app.state.mode = mode === 'connect' ? 'connect' : 'devices';
    const connect = app.state.mode === 'connect';
    byId('devicesView').hidden = connect;
    byId('connectView').hidden = !connect;
    byId('tabDevices').setAttribute('aria-selected', String(!connect));
    byId('tabConnect').setAttribute('aria-selected', String(connect));
    byId('pageHeading').textContent = connect ? 'Connect a device' : 'Your devices';
    app.emit();
  }
};

let surface = null;

function contextState() {
  const selected = app.state.selected;
  const phone = selected?.kind === 'phone' ? app.state.phones.find((item) => item.id === selected.id) : null;
  const computer = selected?.kind === 'computer' ? app.computer(selected.id) : null;
  return { mode: app.state.mode, phone, computer, phones: app.state.phones, computers: app.state.computerList };
}

function lede() {
  if (app.state.computersRefused) return app.state.computersRefused;
  const phones = app.state.phones.length;
  const computers = app.state.computerList.length;
  if (!computers && !phones) return 'Phones connect through a computer you set up.';
  return `${phones} ${phones === 1 ? 'phone' : 'phones'} and ${computers} ${computers === 1 ? 'computer' : 'computers'}.`;
}

async function attachSurface() {
  try {
    const handoff = await import('/shared/ui/js/document-handoff.js');
    connectPhoneControlHandoff({ getState: contextState, registerSession: handoff.registerDocumentSession });
  } catch {
    connectPhoneControlHandoff({ getState: contextState });
  }
  try {
    const bridge = await import('/shared/ui/js/surface-bridge-client.js');
    if (typeof bridge.createSurfaceBridgeClient === 'function') {
      surface = bridge.createSurfaceBridgeClient({ app: 'phone-control' });
      surface.attach();
      surface.emitContext(buildPhoneControlContextSnapshot(contextState()));
    }
  } catch {
    surface = null;
  }
}

function start() {
  byId('tabDevices').addEventListener('click', () => app.setMode('devices'));
  byId('tabConnect').addEventListener('click', () => app.setMode('connect'));
  byId('railSetUp').addEventListener('click', () => app.setMode('connect'));
  app.onChange(() => app.say(lede()));
  mountStage(app);
  mountSetup(app);
  app.setMode(location.pathname.includes('/config/') || location.hash === '#connect' ? 'connect' : 'devices');
  void attachSurface();
  app.load().catch((error) => app.say(`Your devices could not be read: ${error.message}`));
}

start();
