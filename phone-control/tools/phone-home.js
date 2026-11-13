/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0, the first screen as a tree with details (Roger, 2026-11-10: "the initial screen is terrible, it should have all of the data about the connection and the tree function ... a tree list on the left, tables on the right ... we should be able to rename connections ... see the program node under the orbit node"). Each computer is a row; under it are the phones and TVs that connect through it and the programs bound on it. A row still opens its session; its Details button shows how it connects, through what, its state, what it can do, and Rename. The list used to be two flat groups in a half-width card with every row's text centred.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0 (T27; Roger, 2026-11-10: "we should be able to rename connections"): a computer in the tree has Rename too. It saves the kernel's own given name (PATCH /api/computers/{id}), the name the Devices page shows, so both screens name the device the same way; a refused name is said in the kernel's words. More options stays on saved phones and TVs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guide the device overview with search, separate connection and control status, an explicit next action and expandable connection details; keep session and rename handlers unchanged.
 */
import { computerStanding, isAndroidNode, isTvNode, phoneReachable } from '/api/phone-control/ui/computer-link.js';

/** What a computer or an enrolled Android device can do, by the tool it reports. */
const ABILITIES = [['screen.read', 'Read the screen'], ['screen.capture', 'Take a screenshot'], ['desktop.control', 'Press keys and touch'],
  ['app.open', 'Open apps'], ['shell.exec', 'Run commands']];
/** Names people know for the application keys a computer reports as bound. */
const PROGRAMS = { 'libreoffice-writer': 'LibreOffice Writer', 'libreoffice-calc': 'LibreOffice Calc', 'microsoft.office.winword.exe.15': 'Word',
  'microsoft.windowsterminal': 'Windows Terminal', 'microsoft.windowsnotepad': 'Notepad', 'microsoft.screensketch': 'Snipping Tool', chrome: 'Chrome' };

/** @description The name a person knows a bound program by. @param {string} key Application key. @returns {string} Name. */
export function programName(key) {
  const raw = String(key || '').trim();
  if (PROGRAMS[raw]) return PROGRAMS[raw];
  const last = raw.split('.').filter((part) => part && !/^(exe|\d+)$/i.test(part)).pop() || raw;
  return last ? last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Program';
}

/** @description How a saved phone or TV reaches its computer, in words. @param {object} phone Saved device. @returns {string} The connection. */
export function howItConnects(phone) {
  if (phone.platform !== 'android') return 'Bluetooth keyboard, screen by AirPlay';
  return /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(String(phone.address || '')) ? 'Wi-Fi (ADB)' : 'USB (ADB)';
}

/**
 * @description The first screen's tree: each computer with the saved phones and TVs that connect through it and its bound
 * programs, then what is attached to no listed computer. Pure.
 * @param {{phones: object[], computerList: object[], rdpSessions: object[], reports: Map}} state The page's state.
 * @param {(phone: object) => object|null} [enrolled] The Open Swarm app sign-in that stands for a saved Android device, when there is one.
 * @returns {{computers: object[], loose: object[]}} Computers (connected first, then by name) and the unattached devices.
 */
export function homeTree(state, enrolled = () => null) {
  const hosts = state.computerList.filter((c) => !isAndroidNode(c));
  const byId = new Map(hosts.map((c) => [String(c.id), c]));
  const saved = state.phones.map((phone) => {
    const host = byId.get(String(phone.computerNodeId || '')) || null;
    const reachable = phoneReachable(phone, state.reports.get(phone.computerNodeId)?.report || null) || Boolean(enrolled(phone));
    return { kind: 'phone', id: String(phone.id), phone, host, reachable };
  });
  const computers = hosts.map((computer) => ({ kind: 'computer', id: String(computer.id), computer, standing: computerStanding(computer),
    children: saved.filter((entry) => entry.host === computer),
    programs: (Array.isArray(computer.bound) ? computer.bound : []).map((key) => ({ key: String(key), name: programName(key) })) }))
    .sort((a, b) => Number(Boolean(b.computer.connected)) - Number(Boolean(a.computer.connected))
      || String(a.computer.name || '').localeCompare(String(b.computer.name || '')));
  const signedIn = state.computerList.filter((c) => isAndroidNode(c)).map((computer) => ({ kind: 'computer', id: String(computer.id), computer,
    standing: computerStanding(computer), children: [], programs: [], android: true }));
  return { computers, loose: [...saved.filter((entry) => !entry.host), ...signedIn] };
}

/**
 * @description The rows of a device's Connection table and, when the device reports its tools, of What it can do. Pure.
 * @param {object} entry A tree entry. @returns {{connection: Array<[string,string]>, abilities: Array<[string,string]>}} Label and value pairs.
 */
export function detailRows(entry) {
  if (entry.kind === 'phone') {
    const { phone, host, reachable } = entry;
    return { connection: [['How it connects', howItConnects(phone)], ['Through', host ? (host.name || 'A computer') : 'No computer on this list'],
      ['State', reachable ? 'Connected' : 'Last seen offline'], ['Control', phone.controlEnabled ? 'On' : 'Off'], ['Address', String(phone.address || 'Not recorded')]], abilities: [] };
  }
  const { computer, standing } = entry, tools = Array.isArray(computer.tools) ? computer.tools : [];
  const seen = Number(computer.last_seen) > 0 ? new Date(Number(computer.last_seen)).toLocaleString() : 'Not recorded';
  return { connection: [['How it connects', isAndroidNode(computer) ? 'The Open Swarm app on the device, directly' : 'Open Swarm Orbit on the computer, directly'],
    ['Through', 'Directly'], ['State', standing.text], ['Last seen', seen], ['Control', computer.can_control ? 'On' : 'Off'],
    ['System', [computer.platform, computer.arch].filter(Boolean).join(' · ') || 'Not reported']],
  abilities: tools.length ? ABILITIES.map(([tool, label]) => [label, tools.includes(tool) ? 'On' : 'Off']) : [] };
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function table(heading, rows) {
  const section = make('section', 'pc-detail-section');
  section.append(make('h3', 'pc-detail-heading', heading));
  const body = make('tbody');
  for (const [label, value] of rows) {
    const tr = make('tr'), th = make('th', '', label);
    th.scope = 'row'; tr.append(th, make('td', '', value)); body.append(tr);
  }
  const grid = make('table', 'pc-detail-table'); grid.append(body); section.append(grid);
  return section;
}

/**
 * @description Give one of the person's computers a name: the kernel keeps it as the name its owner gave (the same one the Devices
 * page shows), apart from the name the computer reports about itself. A refusal is thrown with the kernel's words.
 * @param {string} id The computer. @param {string} name One line of at most 80 characters. @returns {Promise<void>} Saved.
 */
export async function renameComputer(id, name) {
  const response = await fetch(`/api/computers/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ name }) });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  throw new Error(body.detail || body.message || `the server answered ${response.status}`);
}

/** Presentation comes only from the route's connection report and the person's saved control switch. */
function presentation(entry) {
  const phone = entry.kind === 'phone' ? entry.phone : null, computer = entry.computer;
  const label = phone ? phone.name : computer.name || `Device ${entry.id.slice(0, 8)}`;
  const kind = phone ? (phone.form === 'tv' ? 'TV' : phone.platform === 'android' ? 'Android phone' : 'iPhone')
    : isAndroidNode(computer) ? (isTvNode(computer) ? 'TV' : 'Android device') : 'Computer';
  const connected = phone ? entry.reachable : Boolean(computer.connected);
  const control = phone ? Boolean(phone.controlEnabled) : Boolean(computer.can_control);
  const usable = phone ? connected && control : entry.standing.usable;
  const fix = phone ? (!connected ? `Check the connection on ${phone.name}${entry.host ? ` and ${entry.host.name}` : ''}. Connection help has the steps for your device.`
    : !control ? 'Control is off for this saved device. Review its control options before opening a session.' : 'Open its screen and use the controls, or ask its concierge for help.')
    : entry.standing.fix || 'Open its screen and use the controls, or ask its concierge for help.';
  return { label, kind, connected, control, usable, fix, here: Boolean(computer?.this_device),
    action: usable ? 'Open device' : phone && connected && !control ? 'Control options' : 'Connection help' };
}

function stateBadges(info) {
  const states = make('div', 'pc-device-state');
  states.append(make('span', `pc-state-pill ${info.connected ? 'is-connected' : ''}`, info.connected ? 'Connected' : 'Not connected'),
    make('span', 'pc-state-pill', `Control ${info.control ? 'on' : 'off'}`));
  if (info.here) states.append(make('span', 'pc-state-pill is-here', 'This device'));
  return states;
}

function renameControls(label, act) {
  const holder = make('div', 'pc-rename-controls'), rename = make('button', 'ks-btn', 'Rename');
  const form = make('form', 'pc-rename-form'), input = make('input');
  rename.type = 'button'; form.hidden = true; input.type = 'text'; input.maxLength = 80; input.value = label;
  input.setAttribute('aria-label', 'New name');
  const save = make('button', 'ks-btn', 'Save'), cancel = make('button', 'pc-tertiary-btn', 'Cancel'), said = make('span', 'pc-rename-status');
  save.type = 'submit'; cancel.type = 'button'; said.setAttribute('role', 'status');
  form.append(input, save, cancel, said);
  rename.addEventListener('click', () => { form.hidden = false; input.focus(); input.select(); });
  cancel.addEventListener('click', () => { form.hidden = true; input.value = label; said.textContent = ''; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name || name === label) { form.hidden = true; return; }
    save.disabled = true; said.textContent = 'Saving…';
    try { await act.rename(name); } catch (error) { said.textContent = `Not renamed: ${error.message}`; save.disabled = false; }
  });
  holder.append(rename, form); return holder;
}

/** One contextual action; advanced connection and rename controls stay behind the same detail disclosure. */
function buildDetails(entry, info, act) {
  const panel = make('div', 'pc-details'); panel.dataset.detailsFor = `${entry.kind}:${entry.id}`;
  const head = make('div', 'pc-details-head'), rows = detailRows(entry);
  head.append(make('p', 'pc-eyebrow', info.kind), make('h2', 'pc-details-name', info.label), stateBadges(info));
  const next = make('div', 'pc-next-step'), action = make('button', 'ks-btn ks-btn-primary', info.action);
  action.type = 'button'; action.addEventListener('click', (event) => {
    event.stopPropagation();
    if (info.usable) act.open();
    else if (entry.kind === 'phone' && info.connected && !info.control) act.more(action);
    else act.help();
  });
  next.append(make('p', 'pc-next-copy', info.fix), action);
  const advanced = make('details', 'pc-advanced'), summary = make('summary', '', 'Connection details');
  advanced.append(summary, table('Connection', rows.connection));
  if (rows.abilities.length) advanced.append(table('What it can do', rows.abilities));
  const options = make('div', 'pc-details-actions'); options.append(renameControls(info.label, act));
  if (entry.kind === 'phone') {
    const more = make('button', 'ks-btn', 'More options'); more.type = 'button'; more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (event) => { event.stopPropagation(); act.more(more); }); options.append(more);
  }
  advanced.append(options); panel.append(head, next, advanced); return panel;
}

function buildRow(entry, info, selected, act, detailsOpen) {
  const item = make('li', 'pc-device-row'), line = make('div', 'pc-row-line');
  const button = make('button', `pc-rail-item${selected || detailsOpen ? ' is-selected' : ''}`);
  item.dataset.entry = `${entry.kind}:${entry.id}`; item.dataset.deviceKind = info.kind;
  button.type = 'button'; button.setAttribute('aria-selected', String(selected));
  const name = make('span', 'pc-rail-name', info.label);
  name.append(make('small', '', `${info.connected ? 'Connected' : 'Not connected'} · Control ${info.control ? 'on' : 'off'}`));
  if (info.here) name.append(make('span', 'pc-here-label', 'This device'));
  button.append(make('span', `pc-dot ${info.connected && info.control ? 'tone-ok' : 'tone-warn'}`), name);
  button.addEventListener('click', act.open);
  const details = make('button', 'ks-btn pc-row-details', detailsOpen ? 'Hide' : 'Details');
  details.type = 'button'; details.setAttribute('aria-expanded', String(detailsOpen));
  details.setAttribute('aria-label', `${detailsOpen ? 'Hide' : 'Details of'} ${info.label}`);
  details.addEventListener('click', (event) => { event.stopPropagation(); act.details(); });
  line.append(button, details); item.append(line); return item;
}

function matchesQuery(entry, query) {
  const info = presentation(entry);
  return `${info.label} ${info.kind}`.toLowerCase().includes(query);
}

function matchingTree(tree, query) {
  if (!query) return tree;
  const matches = (entry) => matchesQuery(entry, query);
  const computers = tree.computers.flatMap((entry) => {
    if (matches(entry)) return [entry];
    const children = entry.children.filter(matches), programs = entry.programs.filter(p => p.name.toLowerCase().includes(query));
    return children.length || programs.length ? [{ ...entry, children, programs }] : [];
  });
  return { computers, loose: tree.loose.filter(matches) };
}

function entriesOf(tree) {
  return [...tree.computers.flatMap(entry => [entry, ...entry.children]), ...tree.loose];
}

function wireSearch(ctx, redraw) {
  const search = ctx.$('deviceSearch'), clear = ctx.$('deviceSearchClear');
  search.oninput = () => {
    ctx.app.state.homeQuery = search.value.trim().toLowerCase(); ctx.app.state.homeDetails = ''; redraw();
  };
  clear.hidden = !search.value;
  clear.onclick = () => { search.value = ''; ctx.app.state.homeQuery = ''; redraw(); search.focus(); };
}

function entryActions(ctx, hooks, entry, open, redraw) {
  const { app } = ctx, phone = entry.kind === 'phone' ? entry.phone : null;
  return {
    open: () => hooks.selectDevice(ctx, { kind: entry.kind, id: phone ? phone.id : entry.computer.id }, true),
    details: () => {
      const key = `${entry.kind}:${entry.id}`;
      app.state.homeDetails = open ? '' : key; redraw();
      document.querySelector(`[data-entry="${CSS.escape(key)}"] > .pc-row-line .pc-row-details`)?.focus({ preventScroll: true });
    },
    help: () => app.openConnect(true), more: (trigger) => hooks.openRowMenu(ctx, phone, trigger),
    rename: phone ? async (name) => { await app.records.updatePhone(phone.id, { name }); await app.load(); }
      : async (name) => { await renameComputer(entry.computer.id, name); await app.load(); }
  };
}

function treeToggle(ctx, entry, redraw) {
  const state = ctx.app.state, kids = entry.children.length + entry.programs.length, open = Boolean(state.homeQuery) || state.homeOpen.has(entry.id);
  const toggle = make('button', 'pc-tree-toggle', open ? '−' : '+');
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} what is under ${entry.computer.name || 'this computer'} (${kids})`);
  toggle.disabled = Boolean(state.homeQuery);
  toggle.addEventListener('click', () => {
    state.homeTouched = true; if (open) state.homeOpen.delete(entry.id); else state.homeOpen.add(entry.id); redraw();
    document.querySelector(`[data-entry="${CSS.escape(`computer:${entry.id}`)}"] > .pc-row-line .pc-tree-toggle`)?.focus({ preventScroll: true });
  });
  return { toggle, open };
}

function computerRow(ctx, entry, row, redraw) {
  const item = row(entry);
  if (!entry.children.length && !entry.programs.length) return item;
  const { toggle, open } = treeToggle(ctx, entry, redraw);
  item.querySelector('.pc-row-line').prepend(toggle); item.classList.add('has-children');
  if (open) {
    const under = make('ul', 'pc-rail-list pc-children'); under.append(...entry.children.map(row));
    for (const program of entry.programs) {
      const li = make('li', 'pc-program-row'); li.dataset.program = program.key;
      li.append(make('span', 'pc-program-name', program.name), make('small', '', 'Program bound on this computer')); under.append(li);
    }
    item.append(under);
  }
  return item;
}

function rdpRows(ctx, hooks, query) {
  return ctx.app.state.rdpSessions.filter(rdp => !query || hooks.rdpLabel(rdp).toLowerCase().includes(query)).map(rdp => {
    const item = make('li', 'pc-device-row'), line = make('div', 'pc-row-line');
    const selected = ctx.app.state.selected?.kind === 'rdp' && ctx.app.state.selected.id === rdp.sessionId;
    const button = make('button', `pc-rail-item${selected ? ' is-selected' : ''}`), name = make('span', 'pc-rail-name', hooks.rdpLabel(rdp));
    button.setAttribute('aria-selected', String(selected));
    button.type = 'button'; name.append(make('small', '', `RDP desktop · ${rdp.connected !== false ? 'connected' : 'disconnected'}`));
    button.append(make('span', `pc-dot ${rdp.connected !== false ? 'tone-ok' : 'tone-warn'}`), name);
    button.addEventListener('click', () => hooks.selectDevice(ctx, { kind: 'rdp', id: rdp.sessionId }, true));
    const more = make('button', 'ks-btn pc-row-more', '⋮'); more.type = 'button';
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-label', `Options for ${hooks.rdpLabel(rdp)}`);
    more.addEventListener('click', (event) => { event.stopPropagation(); hooks.openRowMenu(ctx, null, more, rdp); });
    item.dataset.entry = `rdp:${rdp.sessionId}`; line.append(button, more); item.append(line); return item;
  });
}

function prepareSelection(state, tree, wide) {
  const entries = entriesOf(tree), has = entries.some(entry => `${entry.kind}:${entry.id}` === state.homeDetails);
  if (!has) state.homeDetails = '';
  if (wide && (!state.homeDetailsInitialized || state.homeQuery && !has)) {
    const matched = state.homeQuery ? entries.filter(entry => matchesQuery(entry, state.homeQuery)) : entries;
    const choices = matched.length ? matched : entries;
    const first = choices.find(entry => entry.computer?.this_device) || choices.find(entry => presentation(entry).usable) || choices[0];
    state.homeDetails = first ? `${first.kind}:${first.id}` : '';
  }
  state.homeDetailsInitialized = true;
}

/**
 * @description Render the searchable device tree and the chosen connection's next step, without issuing device commands.
 * @param {object} ctx The stage context. @param {object} hooks Existing session, menu and device-name actions.
 * @returns {void} Rendered.
 */
export function renderHome(ctx, hooks) {
  const { app, $ } = ctx, state = app.state, query = state.homeQuery || '';
  const full = homeTree(state, phone => hooks.enrolledAndroidFor(app, phone)), tree = matchingTree(full, query);
  const wide = window.matchMedia('(min-width: 900px)').matches, redraw = () => renderHome(ctx, hooks);
  state.homeOpen = state.homeOpen || new Set();
  if (!state.homeTouched) for (const c of full.computers) if (c.children.length) state.homeOpen.add(c.id);
  prepareSelection(state, tree, wide); wireSearch(ctx, redraw);
  let shown = null;
  const row = entry => {
    const open = state.homeDetails === `${entry.kind}:${entry.id}`, info = presentation(entry);
    const act = entryActions(ctx, hooks, entry, open, redraw), selected = state.selected?.kind === entry.kind && String(state.selected.id) === entry.id;
    const item = buildRow(entry, info, selected, act, open);
    if (open) { shown = buildDetails(entry, info, act); if (!wide) item.append(shown); }
    return item;
  };
  const computers = tree.computers.map(entry => computerRow(ctx, entry, row, redraw)), rdp = rdpRows(ctx, hooks, query);
  $('computerRail').replaceChildren(...computers, ...rdp); $('phoneRail').replaceChildren(...tree.loose.map(row));
  $('phoneRailTitle').textContent = full.computers.length ? 'Not attached to a computer on this list' : 'Phones & TVs';
  $('railEmpty').hidden = Boolean(state.phones.length || state.computerList.length || state.rdpSessions.length);
  $('deviceSearchStatus').textContent = query ? (computers.length || tree.loose.length || rdp.length ? 'Matching devices and their connections' : 'No matching devices. Try another name.') : '';
  const pane = $('deviceDetails');
  pane.replaceChildren(...(wide && shown ? [shown] : wide ? [make('h2', '', 'Choose a device'), make('p', 'ks-help', 'Use Details to see its connection, control switch and next step.')] : []));
  pane.hidden = !wide; $('addDeviceBtn').classList.toggle('ks-btn-primary', !shown);
}
