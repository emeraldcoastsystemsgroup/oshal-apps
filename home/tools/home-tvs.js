/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.0: the TVs and streaming sticks section of the Smart Home screen. The person picks one of their own computers (the kernel's /api/computers, an online one first) and presses Scan for TVs: the page installs or updates Phone & Device Control's bridge on that computer when it is not 1.5.0 (the same verified install that page runs), asks Smart Home for the closed scan command, runs it on that computer, and records the answer; Android TVs found are also added to Phone & Device Control. Each TV card's buttons run one planned press the same way and say what the computer answered ("Press Allow on the TV, then Retry." while a Samsung waits). Installing the oshal TV app is one explicit press for one Android TV this computer already has permission to use. Nothing is scanned or installed when the page opens. When the person's app list says they cannot open Phone & Device Control (not installed, not theirs, or changed and waiting for re-approval), the section says which, requests nothing from it, and still lists the saved TVs.
 */

const LINK = '/api/phone-control/ui/computer-link.js';
const RDP = '/api/phone-control/ui/phone-rdp.js';
const RUN_MS = 45000;
const PAIR_MS = 60000;
const OLD_BRIDGE = new Set(['unknown_verb', 'bridge_not_installed']);

/** @description What each kind of device is called on its card. */
export const KIND_WORDS = Object.freeze({ 'android-tv': 'Android TV', 'samsung-tizen': 'Samsung TV', roku: 'Roku', cast: 'Google Cast' });

/** @description Waiting states and refusals in the words a person acts on, by the bridge's code. */
export const WAITING_WORDS = Object.freeze({
  samsung_allow_on_tv: 'Press Allow on the TV, then Retry.',
  tv_unauthorized: 'On the TV choose Always allow from this computer, then OK, and press Retry.',
  device_unauthorized: 'On the TV choose Always allow from this computer, then OK, and press Retry.',
  tv_not_answering: 'The TV did not answer. Turn it on with its remote, or press Wake, then Retry.'
});

const PRESS_WORDS = Object.freeze({ wake: 'Wake', off: 'Turn off', volume_up: 'Volume up', volume_down: 'Volume down', mute: 'Mute',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', select: 'OK', home: 'Home', back: 'Back', play_pause: 'Play or pause',
  launch_url: 'Open oshal', open_app: 'Open the oshal TV app', pair: 'Pair' });
const MOVES = [['up', '▲', 'Up'], ['left', '◀', 'Left'], ['select', 'OK', 'OK'], ['right', '▶', 'Right'], ['down', '▼', 'Down']];

/**
 * @description The buttons one TV's card shows, by its kind and what the computer said about it. Pure.
 * @param {object} tv A saved TV from /api/home/lan/devices.
 * @returns {{power:Array<object>, volume:Array<object>, moves:Array<object>, nav:Array<object>, extra:Array<object>}} Button rows.
 */
export function tvButtons(tv) {
  const empty = { power: [], volume: [], moves: [], nav: [], extra: [] };
  if (!tv || !tv.controllable || tv.kind === 'cast') return empty;
  const b = (action, label, aria) => ({ action, label, aria: aria || label });
  const rows = {
    power: [b('wake', 'Wake'), b('off', 'Turn off')],
    volume: [b('volume_down', 'Vol −', 'Volume down'), b('volume_up', 'Vol +', 'Volume up'), b('mute', 'Mute')],
    moves: MOVES.map(([action, label, aria]) => b(action, label, aria)),
    nav: [b('home', 'Home'), b('back', 'Back'), b('play_pause', 'Play/Pause', 'Play or pause')],
    extra: []
  };
  if (tv.kind === 'samsung-tizen') {
    rows.extra.push(b('launch_url', 'Open oshal on this TV'));
    if (!tv.samsung?.paired) rows.extra.push(b('pair', 'Pair'));
  }
  if (tv.kind === 'android-tv') {
    const adb = tv.adb?.state || 'off';
    rows.extra.push(tv.adb?.appInstalled ? b('open_app', 'Open oshal on this TV') : b('launch_url', 'Open oshal on this TV'));
    if (adb === 'device') rows.extra.push(b('install_app', 'Install the TV app'));
    if (adb === 'not-connected' || adb === 'unauthorized') rows.extra.push(b('pair', 'Connect'));
  }
  return rows;
}

/**
 * @description The computer the section starts on: one that is online, takes commands and can run the bridge. Pure.
 * @param {Array<object>} computers From /api/computers.
 * @param {Function} standing computer-link's computerStanding.
 * @param {Function} support computer-link's bridgeSupport.
 * @returns {object|null} The computer, or null when the person has none.
 */
export function pickComputer(computers, standing, support) {
  const own = (computers || []).filter((c) => String(c.platform || '').toLowerCase() !== 'android');
  return own.find((c) => standing(c).usable && support(c).ok) || own.find((c) => c.connected) || own[0] || null;
}

/**
 * @description The line a card shows for its last answer, in words, with a Retry when the TV is waiting. Pure.
 * @param {object|null} result The TV's lastResult.
 * @returns {{text:string, retry:boolean}} The words.
 */
export function resultWords(result) {
  if (!result) return { text: '', retry: false };
  if (result.ok) return { text: result.message, retry: false };
  const waiting = WAITING_WORDS[result.error];
  return { text: waiting || result.message || 'The computer did not do it.', retry: Boolean(waiting) };
}

async function call(fetchImpl, path, body) {
  const init = { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } };
  if (body !== undefined) Object.assign(init, { method: 'POST', body: JSON.stringify(body), headers: { ...init.headers, 'content-type': 'application/json' } });
  const response = await fetchImpl(path, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok && !(json && typeof json === 'object' && 'error' in json)) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return json;
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @description The section's controller: computers, the bridge on the chosen one, scans and presses.
 * @param {{root:HTMLElement, fetchImpl?:Function, origin?:string, link:object, rdp?:object}} options What it works with.
 * @returns {object} The controller.
 */
export function createTvSection({ root, fetchImpl = globalThis.fetch.bind(globalThis), origin = globalThis.location?.origin || '', link, rdp = null }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const state = { computers: [], computer: null, tvs: [], ready: new Map(), busy: false };
  const client = link.createComputerClient({ fetchImpl });
  const pkg = link.createPackageClient({ fetchImpl });
  const say = (text) => { $('tvStatus').textContent = text; };
  const api = (path, body) => call(fetchImpl, `/api/home${path}`, body);
  return {
    state,
    async start() { await Promise.all([this.loadComputers(), this.loadTvs()]); },
    async loadTvs() {
      const saved = await api('/lan/devices').catch(() => ({ tvs: [] }));
      state.tvs = Array.isArray(saved.tvs) ? saved.tvs : [];
      this.render();
    },
    async loadComputers() {
      try { state.computers = (await client.list()).filter((c) => String(c.platform || '').toLowerCase() !== 'android'); } catch { state.computers = []; }
      state.computer = pickComputer(state.computers, link.computerStanding, link.bridgeSupport);
      this.renderComputers();
    },
    renderComputers() { renderComputers(root, state, link); },
    choose(id) {
      state.computer = state.computers.find((c) => c.id === id) || null;
      this.renderComputers();
    },
    async ensureBridge(computer, force = false) {
      if (!force && state.ready.get(computer.id)) return true;
      const manifest = await pkg.manifest();
      const version = await client.bridge(computer.id, 'version', {}, 20000).catch((error) => ({ ok: false, message: error.message }));
      if (!force && link.bridgeMatches(version, manifest)) { state.ready.set(computer.id, true); return true; }
      say(`Updating the Phone & Device Control helper on ${computer.name}…`);
      const installed = await client.install(computer.id, manifest);
      if (!installed.ok) { say(installed.message || `The helper could not be installed on ${computer.name}.`); return false; }
      state.ready.set(computer.id, true);
      return true;
    },
    async run(computer, command, limitMs) {
      try { return link.parseReply(await client.run(computer.id, command, limitMs)); } catch (error) {
        return { ok: false, error: 'computer_refused', message: error.message || `${computer.name} did not take the command.` };
      }
    },
    scan() { return scan(this, state, { api, pkg, say }); },
    press(tv, action) { return press(this, state, tv, action, { api, say, origin, root }); },
    install(tv) { return installApp(this, state, tv, { api, say, origin, rdp, client, root }); },
    render() { renderTvs(root, state, this); }
  };
}

function renderComputers(root, state, link) {
  const select = root.querySelector('#tvComputer');
  const help = root.querySelector('#tvComputerHelp');
  const scanButton = root.querySelector('#tvScan');
  select.replaceChildren(...state.computers.map((c) => {
    const option = el('option', { value: c.id }, `${c.name || 'Computer'} · ${link.computerStanding(c).text}`);
    option.selected = state.computer?.id === c.id;
    return option;
  }));
  select.hidden = !state.computers.length;
  root.querySelector('#tvComputerLabel').hidden = !state.computers.length;
  const computer = state.computer;
  const blocked = !computer ? 'No computer of yours is connected. TVs are found by your own computer on the same Wi-Fi: '
    + 'install oshal Node on a Linux computer at home (Devices page), sign in, and allow control.'
    : (!link.bridgeSupport(computer).ok ? link.bridgeSupport(computer).text : (link.computerStanding(computer).usable ? '' : link.computerStanding(computer).fix));
  help.textContent = blocked;
  help.hidden = !blocked;
  root.querySelector('#tvDevicesLink').hidden = Boolean(computer);
  scanButton.disabled = Boolean(blocked) || state.busy;
}

async function scan(section, state, { api, pkg, say }) {
  const computer = state.computer;
  if (!computer || state.busy) return;
  state.busy = true;
  section.renderComputers();
  try {
    say(`Checking the helper on ${computer.name}…`);
    if (!(await section.ensureBridge(computer))) return;
    const plan = await api('/lan/discover-plan', { computer: { id: computer.id, name: computer.name } });
    if (!plan.ok) { say(plan.message || 'The scan could not be planned.'); return; }
    say(`Looking for TVs on ${computer.name}'s network. This takes a few seconds.`);
    let reply = await section.run(computer, plan.command, RUN_MS);
    if (!reply.ok && OLD_BRIDGE.has(reply.error) && await section.ensureBridge(computer, true)) reply = await section.run(computer, plan.command, RUN_MS);
    const recorded = await api('/lan/record', { op: 'discover', computer: { id: computer.id, name: computer.name }, reply });
    if (Array.isArray(recorded.devices)) state.tvs = recorded.devices;
    const added = await addToPhoneControl(pkg, recorded.phoneControl || []);
    say([recorded.ok ? recorded.said : (recorded.hint || recorded.message || reply.message), added].filter(Boolean).join(' '));
  } catch (error) {
    say(`The scan did not finish: ${error.message}`);
  } finally {
    state.busy = false;
    section.renderComputers();
    section.render();
  }
}

async function addToPhoneControl(pkg, wanted) {
  const usable = wanted.filter((tv) => tv.computerNodeId);
  if (!usable.length) return '';
  try {
    const have = await pkg.phones();
    const missing = usable.filter((tv) => !have.some((p) => p.address === tv.address && p.computerNodeId === tv.computerNodeId));
    for (const tv of missing) await pkg.savePhone(tv);
    return missing.length ? `Added ${missing.map((tv) => tv.name).join(', ')} to Phone & Device Control.` : '';
  } catch (error) {
    return `Phone & Device Control did not take the Android TVs: ${error.message}`;
  }
}

function computerFor(state, tv) {
  const own = state.computers.find((c) => c.id === tv.computer?.id);
  return own && own.connected ? own : state.computer;
}

async function press(section, state, tv, action, { api, say, origin, root }) {
  if (action === 'install_app') return section.install(tv);
  const computer = computerFor(state, tv);
  const card = root.querySelector(`[data-tv="${CSS.escape(tv.id)}"]`);
  if (!computer) { say('Choose one of your computers first.'); return null; }
  cardBusy(card, action === 'pair' && tv.kind === 'samsung-tizen' ? 'Look at the TV: press Allow with its remote.' : `Sending ${PRESS_WORDS[action] || action} to ${tv.name}…`);
  try {
    const plan = await api('/lan/control-plan', { device: tv.id, action, ...(action === 'launch_url' ? { url: new URL('/', origin || 'https://invalid').href } : {}) });
    if (!plan.ok) return finishCard(section, tv, { ok: false, error: plan.error, message: plan.message });
    if (!(await section.ensureBridge(computer))) return finishCard(section, tv, { ok: false, error: 'no_helper', message: `The helper is not set up on ${computer.name}.` });
    let reply = await section.run(computer, plan.command, action === 'pair' ? PAIR_MS : RUN_MS);
    if (!reply.ok && OLD_BRIDGE.has(reply.error) && await section.ensureBridge(computer, true)) reply = await section.run(computer, plan.command, RUN_MS);
    const recorded = await api('/lan/record', { op: 'control', device: tv.id, action, reply });
    if (recorded.device) state.tvs = state.tvs.map((item) => (item.id === tv.id ? recorded.device : item));
    return finishCard(section, recorded.device || tv, recorded.result || { ok: false, error: recorded.error, message: recorded.message }, Boolean(recorded.device));
  } catch (error) {
    return finishCard(section, tv, { ok: false, error: 'failed', message: error.message });
  }
}

async function installApp(section, state, tv, { api, say, origin, rdp, client, root }) {
  const computer = computerFor(state, tv);
  const card = root.querySelector(`[data-tv="${CSS.escape(tv.id)}"]`);
  if (!computer || !rdp) { say('Installing the TV app needs Phone & Device Control and one of your computers.'); return null; }
  if (card?.dataset.confirm !== 'install') { askInstall(card, tv); return null; }
  delete card.dataset.confirm;
  cardBusy(card, `Getting the oshal TV app for ${tv.name}…`);
  try {
    if (!(await section.ensureBridge(computer))) return finishCard(section, tv, { ok: false, message: `The helper is not set up on ${computer.name}.` });
    const apk = await rdp.resolveCompanionApk(null, false);
    if (!apk) return finishCard(section, tv, { ok: false, message: 'No signed oshal TV app is available on this server yet.' });
    const bridge = (verb, args, limit) => client.bridge(computer.id, verb, args, limit);
    const staged = await rdp.stageCompanionApk({ apk, bridge, nodeName: computer.name, onProgress: (m) => cardBusy(card, m) });
    cardBusy(card, `Installing the oshal TV app on ${tv.name}…`);
    const reply = await bridge('adb-install-apk', { serial: `${tv.address}:5555`, stageId: staged.stageId, sha256: staged.sha256,
      launchPackage: 'com.oshal.remote', serverUrl: origin }, 180000);
    const recorded = await api('/lan/record', { op: 'install', device: tv.id, reply });
    if (recorded.device) state.tvs = state.tvs.map((item) => (item.id === tv.id ? recorded.device : item));
    return finishCard(section, recorded.device || tv, recorded.result || { ok: false, message: recorded.message }, Boolean(recorded.device));
  } catch (error) {
    return finishCard(section, tv, { ok: false, message: error.message });
  }
}

function askInstall(card, tv) {
  if (!card) return;
  card.dataset.confirm = 'install';
  const line = card.querySelector('.tv-result');
  line.textContent = `Install the oshal TV app on ${tv.name}? Press Install the TV app again to install it.`;
}

function cardBusy(card, text) {
  if (!card) return;
  card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  card.querySelector('.tv-result').textContent = text;
}

function finishCard(section, tv, result, recorded = false) {
  section.render();
  const card = document.querySelector(`[data-tv="${CSS.escape(tv.id)}"]`);
  // A recorded answer is already the card's last result; one that never reached Smart Home is said here.
  if (card && result && !recorded) card.querySelector('.tv-result').textContent = resultWords(result).text;
  return result;
}

function renderTvs(root, state, section) {
  const list = root.querySelector('#tvList');
  root.querySelector('#tvEmpty').hidden = state.tvs.length > 0;
  list.replaceChildren(...state.tvs.map((tv) => tvCard(tv, section)));
}

function tvCard(tv, section) {
  const card = el('article', { className: 'card tv-card', 'data-tv': tv.id, 'aria-label': tv.name });
  const head = el('div', { className: 'crow' });
  head.append(el('span', { className: 'nm' }, tv.name), el('span', { className: 'pill' }, KIND_WORDS[tv.kind] || 'TV'));
  if (tv.power) head.append(el('span', { className: `pill ${tv.power === 'on' ? 'on' : ''}` }, tv.power === 'on' ? 'On' : 'Off'));
  const where = [tv.address, tv.room, tv.model, tv.computer?.name ? `found by ${tv.computer.name}` : ''].filter(Boolean).join(' · ');
  card.append(head, el('div', { className: 'tv-meta' }, where));
  if (tv.steps) card.append(el('p', { className: 'tv-steps' }, tv.steps));
  if (!tv.controllable || tv.kind === 'cast') card.append(el('p', { className: 'tv-steps' }, 'A Google Cast device: your computer cannot press its buttons.'));
  const rows = section ? tvButtons(tv) : tvButtons(null);
  const button = ({ action, label, aria }) => {
    const node = el('button', { type: 'button', className: 'btn tv-btn', 'data-action': action, 'aria-label': `${aria} on ${tv.name}` }, label);
    node.addEventListener('click', () => section.press(tv, action));
    return node;
  };
  for (const [key, cls] of [['power', 'tv-row'], ['volume', 'tv-row'], ['moves', 'tv-pad'], ['nav', 'tv-row'], ['extra', 'tv-row']]) {
    if (rows[key].length) card.append(rowOf(cls, rows[key].map(button)));
  }
  const words = resultWords(tv.lastResult);
  const line = el('p', { className: 'tv-result', role: 'status' }, words.text);
  if (words.retry && section) {
    const retry = el('button', { type: 'button', className: 'lnk' }, 'Retry');
    retry.addEventListener('click', () => section.press(tv, tv.lastResult.action));
    line.append(' ', retry);
  }
  card.append(line);
  return card;
}

function rowOf(cls, buttons) {
  const row = el('div', { className: cls });
  row.append(...buttons);
  return row;
}

/** @description Why the section cannot reach Phone & Device Control's helper, in words, by what the app list says. */
export const HELPER_WORDS = Object.freeze({
  missing: 'Finding TVs uses the Phone & Device Control helper on your computer, and Phone & Device Control is not installed for your account.',
  changed: 'Finding TVs uses the Phone & Device Control helper on your computer. Phone & Device Control changed, and an administrator must re-approve your access to it.',
  denied: 'Finding TVs uses the Phone & Device Control helper on your computer. Your account does not have Phone & Device Control (its device features are for its administrator).',
  unknown: 'Finding TVs uses the Phone & Device Control helper on your computer, which could not be loaded for your account.'
});

/**
 * @description Whether the person can open Phone & Device Control, from the kernel's list of their apps.
 * @param {Function} fetchImpl fetch.
 * @returns {Promise<string>} ok, missing, changed, denied, or unknown when the list cannot be read.
 */
export async function helperAccess(fetchImpl) {
  try {
    const body = await call(fetchImpl, '/api/swarm/apps');
    if (!Array.isArray(body?.apps)) return 'unknown';
    const app = body.apps.find((item) => (item.name || item.id) === 'phone-control');
    if (!app) return 'missing';
    if (app.accessChanged) return 'changed';
    return app.authorized === false ? 'denied' : 'ok';
  } catch { return 'unknown'; }
}

/**
 * @description Start the section on the Smart Home screen: load phone-control's computer link, then the computers and saved TVs.
 * @param {HTMLElement} root The section element.
 * @param {Function} [fetchImpl] fetch.
 * @returns {Promise<object|null>} The controller, or null when the section cannot run here.
 */
export async function mountTvSection(root, fetchImpl = globalThis.fetch.bind(globalThis)) {
  root.hidden = false;
  const access = await helperAccess(fetchImpl);
  let link = null;
  if (access === 'ok' || access === 'unknown') link = await import(LINK).catch(() => null);
  if (!link?.createComputerClient) {
    root.querySelector('#tvStatus').textContent = HELPER_WORDS[access === 'ok' ? 'unknown' : access];
    root.querySelector('#tvScan').disabled = true;
    const saved = await call(fetchImpl, '/api/home/lan/devices').catch(() => ({ tvs: [] }));
    const tvs = Array.isArray(saved.tvs) ? saved.tvs : [];
    root.querySelector('#tvEmpty').hidden = tvs.length > 0;
    root.querySelector('#tvList').replaceChildren(...tvs.map((tv) => tvCard(tv, null)));
    return null;
  }
  const rdp = await import(RDP).catch(() => null);
  const section = createTvSection({ root, link, rdp: rdp?.stageCompanionApk ? rdp : null });
  root.querySelector('#tvComputer').addEventListener('change', (event) => section.choose(event.target.value));
  root.querySelector('#tvScan').addEventListener('click', () => section.scan());
  await section.start();
  return section;
}

if (globalThis.document && !(globalThis.AppView && globalThis.AppView.active && globalThis.AppView.active())) {
  const root = document.getElementById('tvSection');
  const view = new URLSearchParams(globalThis.location?.search || '').get('view');
  if (root && (!view || view === 'devices')) mountTvSection(root).catch(() => { root.querySelector('#tvStatus').textContent = 'TVs could not be loaded just now.'; });
}
