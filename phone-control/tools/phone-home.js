/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0, the first screen as a tree with details (Roger, 2026-11-10: "the initial screen is terrible, it should have all of the data about the connection and the tree function ... a tree list on the left, tables on the right ... we should be able to rename connections ... see the program node under the orbit node"). Each computer is a row; under it are the phones and TVs that connect through it and the programs bound on it. A row still opens its session; its Details button shows how it connects, through what, its state, what it can do, and Rename. The list used to be two flat groups in a half-width card with every row's text centred.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0 (T27; Roger, 2026-11-10: "we should be able to rename connections"): a computer in the tree has Rename too. It saves the kernel's own given name (PATCH /api/computers/{id}), the name the Devices page shows, so both screens name the device the same way; a refused name is said in the kernel's words. More options stays on saved phones and TVs.
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

/** The details of one entry: its tables and its actions (Open, Rename, and More options for a saved phone or TV). */
function buildDetails(entry, label, act) {
  const panel = make('div', 'pc-details'); panel.dataset.detailsFor = `${entry.kind}:${entry.id}`;
  const rows = detailRows(entry), head = make('div', 'pc-details-head');
  head.append(make('h2', 'pc-details-name', label));
  const actions = make('div', 'pc-details-actions'), open = make('button', 'ks-btn ks-btn-primary', 'Open');
  open.type = 'button'; open.addEventListener('click', act.open); actions.append(open);
  if (entry.kind === 'phone' || entry.kind === 'computer') {
    const rename = make('button', 'ks-btn', 'Rename'), form = make('form', 'pc-rename-form'), input = make('input');
    rename.type = 'button'; form.hidden = true; input.type = 'text'; input.maxLength = 80; input.value = label; input.setAttribute('aria-label', 'New name');
    const save = make('button', 'ks-btn ks-btn-primary', 'Save'), cancel = make('button', 'pc-tertiary-btn', 'Cancel'), said = make('span', 'pc-rename-status');
    save.type = 'submit'; cancel.type = 'button'; said.setAttribute('role', 'status');
    form.append(input, save, cancel, said);
    rename.addEventListener('click', () => { form.hidden = false; input.focus(); input.select(); });
    cancel.addEventListener('click', () => { form.hidden = true; input.value = label; said.textContent = ''; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name || name === label) { form.hidden = true; return; }
      save.disabled = true; said.textContent = 'Saving…';
      try { await act.rename(name); } catch (error) { said.textContent = `Not renamed: ${error.message}`; save.disabled = false; }
    });
    actions.append(rename);
    if (entry.kind === 'phone') {
      const more = make('button', 'ks-btn', 'More options'); more.type = 'button'; more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', (event) => { event.stopPropagation(); act.more(more); });
      actions.append(more);
    }
    head.append(actions, form);
  } else head.append(actions);
  panel.append(head, table('Connection', rows.connection));
  if (rows.abilities.length) panel.append(table('What it can do', rows.abilities));
  if (entry.standing?.fix) panel.append(make('p', 'ks-help', entry.standing.fix));
  return panel;
}

function buildRow(entry, label, sub, tone, selected, act, detailsOpen) {
  const item = make('li', 'pc-device-row'), line = make('div', 'pc-row-line'), button = make('button', `pc-rail-item${selected ? ' is-selected' : ''}`);
  item.dataset.entry = `${entry.kind}:${entry.id}`;
  button.type = 'button'; button.setAttribute('aria-selected', String(selected));
  const name = make('span', 'pc-rail-name', label); name.append(make('small', '', sub));
  button.append(make('span', `pc-dot ${tone}`), name); button.addEventListener('click', act.open);
  const details = make('button', 'ks-btn pc-row-details', detailsOpen ? 'Hide' : 'Details');
  details.type = 'button'; details.setAttribute('aria-expanded', String(detailsOpen)); details.setAttribute('aria-label', `${detailsOpen ? 'Hide' : 'Details of'} ${label}`);
  details.addEventListener('click', (event) => { event.stopPropagation(); act.details(); });
  line.append(button, details); item.append(line);
  return item;
}

/**
 * @description Draw the first screen: the tree in #computerRail and #phoneRail, and the open entry's details beside it on a
 * wide screen or under its row on a narrow one.
 * @param {object} ctx The stage context (app, $).
 * @param {{selectDevice: Function, openRowMenu: Function, rdpLabel: Function, enrolledAndroidFor: Function}} hooks The stage's own actions.
 * @returns {void} Drawn.
 */
export function renderHome(ctx, hooks) {
  const { app, $ } = ctx, state = app.state, tree = homeTree(state, (phone) => hooks.enrolledAndroidFor(app, phone)), wide = window.matchMedia('(min-width: 900px)').matches;
  state.homeOpen = state.homeOpen || new Set(); // computers whose children are shown
  if (!state.homeTouched) for (const c of tree.computers) if (c.children.length) state.homeOpen.add(c.id);
  const isSelected = (kind, id) => state.selected?.kind === kind && String(state.selected.id) === String(id);
  const redraw = () => renderHome(ctx, hooks);
  let shown = null;
  const row = (entry) => {
    const key = `${entry.kind}:${entry.id}`, open = state.homeDetails === key;
    const phone = entry.kind === 'phone' ? entry.phone : null, computer = entry.computer;
    const label = phone ? phone.name : computer.name || `${isAndroidNode(computer) ? 'Device' : 'Computer'} ${entry.id.slice(0, 8)}`;
    const kindLabel = phone ? (phone.form === 'tv' ? 'TV' : phone.platform === 'android' ? 'Android' : 'iPhone') : isAndroidNode(computer) ? (isTvNode(computer) ? 'TV' : 'Android') : 'Computer';
    const sub = phone ? `${kindLabel} · ${entry.reachable ? 'connected' : 'last seen offline'}${phone.controlEnabled ? '' : ' · control off'}` : `${kindLabel} · ${entry.standing.text}`;
    const tone = phone ? (entry.reachable ? 'tone-ok' : 'tone-warn') : entry.standing.tone;
    const act = { open: () => hooks.selectDevice(ctx, { kind: entry.kind, id: phone ? phone.id : computer.id }, true),
      details: () => { state.homeDetails = open ? '' : key; redraw(); },
      more: (trigger) => hooks.openRowMenu(ctx, phone, trigger),
      rename: phone ? async (name) => { await app.records.updatePhone(phone.id, { name }); await app.load(); }
        : async (name) => { await renameComputer(computer.id, name); await app.load(); } };
    const item = buildRow(entry, label, sub, tone, isSelected(entry.kind, phone ? phone.id : computer.id), act, open);
    if (open) { shown = buildDetails(entry, label, act); if (!wide) item.append(shown); }
    return item;
  };
  const computerItems = tree.computers.map((entry) => {
    const item = row(entry), kids = entry.children.length + entry.programs.length;
    if (!kids) return item;
    const open = state.homeOpen.has(entry.id), toggle = make('button', 'pc-tree-toggle', open ? '−' : '+');
    toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} what is under ${entry.computer.name || 'this computer'} (${kids})`);
    toggle.addEventListener('click', () => { state.homeTouched = true; if (open) state.homeOpen.delete(entry.id); else state.homeOpen.add(entry.id); redraw(); });
    item.querySelector('.pc-row-line').prepend(toggle); item.classList.add('has-children');
    if (open) {
      const under = make('ul', 'pc-rail-list pc-children');
      under.append(...entry.children.map(row));
      for (const program of entry.programs) {
        const li = make('li', 'pc-program-row'); li.dataset.program = program.key;
        li.append(make('span', 'pc-program-name', program.name), make('small', '', 'Program bound on this computer'));
        under.append(li);
      }
      item.append(under);
    }
    return item;
  });
  const rdpItems = state.rdpSessions.map((rdp) => {
    const live = rdp.connected !== false, entry = { kind: 'rdp', id: String(rdp.sessionId) }, item = make('li', 'pc-device-row'), line = make('div', 'pc-row-line');
    const button = make('button', `pc-rail-item${isSelected('rdp', rdp.sessionId) ? ' is-selected' : ''}`), name = make('span', 'pc-rail-name', hooks.rdpLabel(rdp));
    button.type = 'button'; name.append(make('small', '', `RDP desktop · ${live ? 'connected' : 'disconnected'}`));
    button.append(make('span', `pc-dot ${live ? 'tone-ok' : 'tone-warn'}`), name);
    button.addEventListener('click', () => hooks.selectDevice(ctx, { kind: 'rdp', id: rdp.sessionId }, true));
    const more = make('button', 'ks-btn pc-row-more', '⋮'); more.type = 'button'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-label', `Options for ${hooks.rdpLabel(rdp)}`);
    more.addEventListener('click', (event) => { event.stopPropagation(); hooks.openRowMenu(ctx, null, more, rdp); });
    item.dataset.entry = `${entry.kind}:${entry.id}`; line.append(button, more); item.append(line);
    return item;
  });
  $('computerRail').replaceChildren(...computerItems, ...rdpItems);
  $('phoneRail').replaceChildren(...tree.loose.map(row));
  $('phoneRailTitle').textContent = tree.computers.length ? 'Not attached to a computer on this list' : 'Phones & TVs';
  $('railEmpty').hidden = Boolean(state.phones.length || state.computerList.length || state.rdpSessions.length);
  const pane = $('deviceDetails');
  pane.replaceChildren(...(wide && shown ? [shown] : wide ? [make('p', 'ks-help', 'Press Details on a row to see how it connects and what it can do.')] : []));
  pane.hidden = !wide;
}
