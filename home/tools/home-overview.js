/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract the real Smart Home overview and page navigation, with searchable device context, truthful reported state and existing device actions.
 */
/* ── Home and its pages (1.6.0). Home is tiles in groups: kitchen and appliances, TVs and streaming, the switch
   cards, phones and tablets, computers. A tile opens the page for that thing; the address keeps the page
   (#fridge, #tvs, #help), so the phone's Back returns to Home. Roger, 2026-11-10: "Smart home needs a redesign
   ... connected devices are smart home items, fire sticks are as well". ── */
const PAGE_IDS = { fridge: 'page-fridge', tvs: 'page-tvs', help: 'page-help' };
/** Where a phone, TV or computer tile opens: Phone & Device Control when the person has it, else the Devices page. */
const DEVICE_APP = '/cockpit/?app=phone-control', DEVICES_PAGE = '/devices';
const ICONS = {
  fridge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 10h12M9 6.5v1.5M9 13v3"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  computer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4.5" width="16" height="11" rx="1.5"/><path d="M2.5 19.5h19"/></svg>',
  find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
};
let FRIDGE_TELEMETRY = null, SAVED_TVS = [], TV_PAGE_READY = false, CONNECTED = { tvs: [], phones: [], computers: [] }, DEVICE_LINK = DEVICES_PAGE, PAGE_OPENED_HERE = false;
let HOME_QUERY = '', HOME_SELECTED = '', HOME_SELECTION_CLOSED = false, HOME_ENTRIES = [], HOME_READ_AT = null;
let CONNECTED_DONE = false, CONNECTED_READ_FAILED = false;

/** The page the address names, or '' for Home. */
function currentPage() {
  const name = location.hash.replace(/^#/, '');
  return PAGE_IDS[name] ? name : (RUNBOOK_VIEW ? 'help' : '');
}
/** Show Home or the one open page. */
function applyPage() {
  const page = AUTOMATIONS_VIEW ? '' : currentPage();
  $('homeView').hidden = Boolean(page);
  for (const [name, id] of Object.entries(PAGE_IDS)) $(id).hidden = name !== page;
  window.scrollTo(0, 0);
}
function openPage(name) {
  if (!PAGE_IDS[name] || currentPage() === name) return;
  PAGE_OPENED_HERE = true;
  location.hash = name;
}
/** Back to Home: the browser's own Back when this visit opened the page, so the history stays one step deep. */
function closePage() {
  if (PAGE_OPENED_HERE && location.hash) { history.back(); return; }
  history.replaceState(null, '', location.pathname + location.search);
  applyPage();
}
window.addEventListener('hashchange', applyPage);
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-page-back]')) { closePage(); return; }
  const opener = event.target.closest('[data-open]');
  if (!opener) return;
  if ($('moreWrap')) $('moreWrap').open = false;
  openPage(opener.dataset.open);
});
document.addEventListener('click', (event) => {
  const detail = event.target.closest('[data-home-detail]');
  if (detail) {
    HOME_SELECTED = detail.dataset.homeDetail; HOME_SELECTION_CLOSED = false; renderTiles();
    if (window.innerWidth < 900) $('homeSelection').scrollIntoView({ block: 'start' });
    $('homeSelection').querySelector('h2')?.focus({ preventScroll: true });
  }
  if (event.target.closest('[data-home-close]')) {
    const id = HOME_SELECTED; HOME_SELECTED = ''; HOME_SELECTION_CLOSED = true; renderTiles();
    document.querySelector(`[data-home-detail="${CSS.escape(id)}"]`)?.focus();
  }
});
$('homeSearch').addEventListener('input', (event) => { HOME_QUERY = event.target.value.trim().toLowerCase(); renderTiles(); });
$('homeSearchClear').addEventListener('click', () => { HOME_QUERY = ''; $('homeSearch').value = ''; renderTiles(); $('homeSearch').focus(); });

/** No absent or malformed value becomes an Off state or an invented midpoint. */
function switchKnown(d) { return d.switch === 'on' || d.switch === 'off'; }
function switchSupported(d) { return (d.capabilities || []).includes('switch'); }
function reportedLevel(d) { return typeof d.level === 'number' && Number.isFinite(d.level) && d.level >= 0 && d.level <= 100 ? d.level : null; }
function deviceState(d) { return switchKnown(d) ? d.switch === 'on' ? 'On' : 'Off' : 'State not reported'; }
function homeMatches(d) { return !HOME_QUERY || [d.name, d.kind, d.room].filter(Boolean).join(' ').toLowerCase().includes(HOME_QUERY); }
function hasConnectedDevices() { return SAVED_TVS.length + CONNECTED.tvs.length + CONNECTED.phones.length + CONNECTED.computers.length > 0; }

/** One tile: a picture, a name and a line of state. It opens a page here, or the device in Phone & Device Control. */
function tileHtml(t) {
  const inner = `${ICONS[t.icon] || ''}<span class="tile-nm">${esc(t.name)}</span><span class="tile-st">${t.on === undefined ? '' : `<span class="dot ${t.on ? 'on' : ''}"></span>`}${esc(t.state || '')}</span>`;
  const tile = t.href
    ? `<a class="tile" href="${esc(t.href)}" target="_top" data-kind="${esc(t.icon)}">${inner}</a>`
    : `<button type="button" class="tile" data-open="${esc(t.open)}" data-kind="${esc(t.icon)}">${inner}</button>`;
  if (!t.id) return tile;
  return `<div class="home-tile-shell${HOME_SELECTED === t.id ? ' is-selected' : ''}">${tile}<button type="button" class="home-details-btn" data-home-detail="${esc(t.id)}" aria-label="Details for ${esc(t.name)}">Details</button></div>`;
}
/** What the refrigerator's tile says: both temperatures once the weekly check has them, else what the hub reports. */
function fridgeWords(d) {
  if (FRIDGE_TELEMETRY && FRIDGE_TELEMETRY.coolerTempF != null) return `Fridge ${FRIDGE_TELEMETRY.coolerTempF}°F · Freezer ${FRIDGE_TELEMETRY.freezerTempF}°F`;
  return d.temperatureF != null ? `${d.temperatureF}°F` : 'Look inside, list and meal ideas';
}
/** Draw every group from what is known now; a group with nothing in it is not shown. */
function renderTiles() {
  if (!$('tiles-kitchen')) return;
  const groups = homeGroups(); HOME_ENTRIES = Object.values(groups).flat();
  const visible = HOME_ENTRIES.filter(homeMatches);
  if (!visible.some(d => d.id === HOME_SELECTED)) HOME_SELECTED = '';
  if (!HOME_SELECTED && !HOME_SELECTION_CLOSED && window.innerWidth >= 900) HOME_SELECTED = visible[0]?.id || '';
  const kitchen = groups.kitchen.filter(homeMatches), tvs = groups.tvs.filter(homeMatches);
  const find = { open: 'tvs', icon: 'find', kind: 'TV', name: 'Find TVs', state: 'Look for TVs and streaming sticks on this network' };
  if (TV_PAGE_READY && (!HOME_QUERY || homeMatches(find))) tvs.push(find);
  const phones = groups.phones.filter(homeMatches), computers = groups.computers.filter(homeMatches);
  for (const [group, list, tiles] of [['grp-kitchen', 'tiles-kitchen', kitchen], ['grp-tv', 'tiles-tv', tvs], ['grp-phones', 'tiles-phones', phones], ['grp-computers', 'tiles-computers', computers]]) {
    $(list).innerHTML = tiles.map(tileHtml).join('');
    $(group).hidden = tiles.length === 0;
  }
  const plain = groups.devices.filter(homeMatches);
  $('grid').innerHTML = plain.map(d => cardHtml(d.raw)).join('');
  $('devicesSection').hidden = AUTOMATIONS_VIEW || !plain.length;
  $('homeSearchClear').hidden = !HOME_QUERY;
  $('homeSearchStatus').textContent = HOME_QUERY ? visible.length ? `${visible.length} matching device${visible.length === 1 ? '' : 's'}` : 'No matching devices. Try another name or room.' : '';
  renderHomeSelection(visible.find(d => d.id === HOME_SELECTED)); layout();
}

function homeGroups() {
  const hub = d => ({ id: `hub:${d.key}`, source: 'hub', raw: d, name: deviceName(d), room: d.room, state: deviceState(d),
    kind: d.category || ((d.capabilities || []).includes('thermostat') ? 'Thermostat' : 'Home device') });
  const linked = (d, icon) => ({ ...d, href: DEVICE_LINK, icon });
  return {
    kitchen: DEVICES.filter(isFridgeDevice).map(d => ({ ...hub(d), open: 'fridge', icon: 'fridge', kind: 'Refrigerator', state: fridgeWords(d) })),
    devices: DEVICES.filter(isPlainDevice).map(hub),
    tvs: [...SAVED_TVS.map(d => ({ ...d, id: `tv:${d.id}`, open: 'tvs', icon: 'tv', kind: 'TV', source: 'tv', state: 'Open the remote' })), ...CONNECTED.tvs.map(d => linked(d, 'tv'))],
    phones: CONNECTED.phones.map(d => linked(d, 'phone')), computers: CONNECTED.computers.map(d => linked(d, 'computer'))
  };
}

function homeSelectionAction(d) {
  if (d.href) return `<a class="btn solid" href="${esc(d.href)}" target="_top">${d.href === DEVICE_APP ? 'Open device controls' : 'Open Devices'}</a><p class="home-action-note">Choose this device on the device controls page.</p>`;
  if (d.open) return `<button type="button" class="btn solid" data-open="${esc(d.open)}">${d.open === 'fridge' ? 'Open refrigerator' : 'Open TV remotes'}</button>`;
  if (switchKnown(d.raw) && switchSupported(d.raw)) return `<button type="button" class="btn solid" onclick="toggle(${esc(JSON.stringify(d.raw.key))}, ${isOn(d.raw) ? 0 : 1})">Turn ${isOn(d.raw) ? 'off' : 'on'}</button>`;
  return `<p class="home-action-note">${switchSupported(d.raw) ? 'Read the devices again to see this switch’s state.' : 'This device has not reported a switch control.'}</p>${HUBS_SEEN ? '<button type="button" class="btn solid" onclick="refresh()">Read devices again</button>' : ''}`;
}

function homeConnectionRows(d) {
  const rows = [['Kind', d.kind], ['Room', d.room || 'Not reported']];
  if (d.source === 'computer') {
    rows.push(['Connection', d.raw.connected ? 'Connected' : 'Not connected'], ['Control', d.raw.can_control === true ? 'On' : d.raw.can_control === false ? 'Off' : 'Not reported']);
    if (Array.isArray(d.raw.bound)) rows.push(['Programs attached', String(d.raw.bound.length)]);
  } else if (d.source === 'phone') rows.push(['Connection', 'Paired through a computer'], ['Control', d.raw.controlEnabled === true ? 'On' : d.raw.controlEnabled === false ? 'Off' : 'Not reported']);
  else if (d.source === 'hub') rows.push(['Hub last read', HOME_READ_AT && Number.isFinite(Date.parse(HOME_READ_AT)) ? new Date(HOME_READ_AT).toLocaleString() : 'No reported time']);
  else rows.push(['Controls', 'The saved TV remote']);
  return rows;
}

function renderHomeSelection(d) {
  const panel = $('homeSelection'); panel.hidden = !d;
  if (!d) { panel.replaceChildren(); return; }
  const rows = homeConnectionRows(d).map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  const control = d.source === 'computer' && typeof d.raw.can_control === 'boolean' ? `<span class="pill">Control ${d.raw.can_control ? 'on' : 'off'}</span>` : '';
  panel.innerHTML = `<div class="home-selection-top"><p class="home-kicker">${esc(d.kind)}</p><button type="button" class="lnk" data-home-close>Close details</button></div>
    <h2 tabindex="-1">${esc(d.name)}</h2><div class="home-device-state"><span class="pill">${esc(d.state)}</span>${control}</div>
    <div class="home-next-action">${homeSelectionAction(d)}</div><details class="home-connection"><summary>Connection details</summary><dl>${rows}</dl></details>`;
}

function updateHomeOverview() {
  const any = DEVICES.length || hasConnectedDevices() || (window.__scenes || []).length;
  $('homeOverviewTop').hidden = !any && !CONNECTED_READ_FAILED; $('homeWorkspace').hidden = !any && !TV_PAGE_READY;
  $('homeInventoryState').textContent = !CONNECTED_DONE ? 'Reading your connected devices…' : CONNECTED_READ_FAILED ? 'Some connected devices could not be read. Showing the devices available here.'
    : HOME_READ_AT && Number.isFinite(Date.parse(HOME_READ_AT)) ? `Home devices last read ${new Date(HOME_READ_AT).toLocaleString()}. Connected devices show their own connection state.`
      : 'Home devices and your own connected devices. No hub reading time was reported.';
}
/** A name two lists can be matched on: lower case, the "(Android)" the device list appends dropped. */
function nameKey(name) { return String(name || '').toLowerCase().replace(/\(android\)/g, '').replace(/[^a-z0-9]+/g, ''); }
/**
 * The person's connected devices as tiles. Their computers, phones and TVs come from the device list
 * (/api/computers); the phones and TVs paired through a computer come from Phone & Device Control. A device in
 * both is shown once, from the device list, which knows whether it is connected.
 */
function groupConnected(computers, phones, link) {
  const android = (link && link.isAndroidNode) || ((c) => String(c.platform || '').toLowerCase() === 'android');
  const tv = (link && link.isTvNode) || ((c) => android(c) && /\b(tv|fire\s*tv|aft\w*)\b/i.test(String(c.name || '')));
  const out = { tvs: [], phones: [], computers: [] }, seen = new Set();
  for (const c of computers || []) {
    const name = String(c.name || 'Device').replace(/\s*\(android\)\s*$/i, '');
    const programs = Array.isArray(c.bound) ? c.bound.length : 0;
    const state = c.connected ? (programs && !android(c) ? `Connected · ${programs} program${programs === 1 ? '' : 's'}` : 'Connected') : 'Not connected';
    (tv(c) ? out.tvs : android(c) ? out.phones : out.computers).push({ id: `computer:${c.id}`, source: 'computer', raw: c, name, room: c.room, on: Boolean(c.connected), state, kind: tv(c) ? 'TV' : android(c) ? 'Android device' : 'Computer' });
    seen.add(nameKey(c.name));
  }
  for (const phone of phones || []) {
    if (seen.has(nameKey(phone.name))) continue;
    seen.add(nameKey(phone.name));
    const kind = phone.form === 'tv' ? 'TV' : phone.platform === 'android' ? 'Android' : 'iPhone';
    (phone.form === 'tv' ? out.tvs : out.phones).push({ id: `phone:${phone.id}`, source: 'phone', raw: phone, name: phone.name || kind, room: phone.room, kind, state: `${kind} · paired through a computer` });
  }
  return out;
}
async function readJson(path) {
  try { const r = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
/**
 * Read the connected devices; any part that cannot be read leaves its tiles out and the rest of Home as it is.
 * Phone & Device Control is asked for nothing unless the person can open it (the TV page's own rule, helperAccess).
 */
async function loadConnected() {
  if (HUBS_VIEW || AUTOMATIONS_VIEW) return;
  const tvPage = await import('/api/home/ui/home-tvs.js').catch(() => null);
  const usable = Boolean(tvPage && tvPage.helperAccess) && await tvPage.helperAccess(window.fetch.bind(window)) === 'ok';
  const [link, computers, phones] = await Promise.all([
    usable ? import('/api/phone-control/ui/computer-link.js').catch(() => null) : null,
    readJson('/api/computers'),
    usable ? readJson('/api/phone-control/devices') : null,
  ]);
  DEVICE_LINK = usable ? DEVICE_APP : DEVICES_PAGE;
  CONNECTED = groupConnected((computers && computers.computers) || [], (phones && phones.devices) || [], link);
  CONNECTED_DONE = true; CONNECTED_READ_FAILED = !computers || usable && !phones;
  renderTiles();
}
/** The TVs and streaming page draws its own cards; Home shows one tile for each of them. */
function watchSavedTvs() {
  const list = $('tvList'), section = $('tvSection'); if (!list || !section || typeof MutationObserver !== 'function') return;
  const read = () => {
    SAVED_TVS = [...list.querySelectorAll('.tv-card')].map(card => ({ id: card.dataset.tv, name: card.querySelector('.nm')?.textContent.trim() })).filter(d => d.name);
    TV_PAGE_READY = !section.hidden;
    renderTiles();
  };
  new MutationObserver(read).observe(list, { childList: true });
  new MutationObserver(read).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  read();
}



/** Existing TV mode navigation, kept separate from device selection and commands. */
function homeTvFocusables() {
  return [...document.querySelectorAll('.btn,.scene,.sw,.card,a,button,input,select,textarea,[onclick]')].filter(el => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && el.offsetParent !== null;
  });
}
function moveHomeTvFocus(dir) {
  const els = homeTvFocusables(), current = document.activeElement;
  if (!els.length) return;
  if (!current || !els.includes(current)) { els[0].focus(); return; }
  const origin = current.getBoundingClientRect(), cx = origin.left + origin.width / 2, cy = origin.top + origin.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of els) {
    if (el === current) continue;
    const box = el.getBoundingClientRect(), dx = box.left + box.width / 2 - cx, dy = box.top + box.height / 2 - cy;
    if (!(dir === 'left' && dx < -4 || dir === 'right' && dx > 4 || dir === 'up' && dy < -4 || dir === 'down' && dy > 4)) continue;
    const along = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  best?.focus();
}
function mountHomeTvNavigation() {
  if (!new URLSearchParams(location.search).get('tv')) return;
  const tag = () => homeTvFocusables().forEach(el => { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); });
  const style = document.createElement('style');
  style.textContent = ':focus{outline:3px solid var(--accent,#7c6cff)!important;outline-offset:2px;border-radius:10px;}';
  document.documentElement.append(style); tag();
  new MutationObserver(tag).observe(document.body, { childList: true, subtree: true });
  const dirs = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  document.addEventListener('keydown', event => {
    const el = document.activeElement, typing = el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (dirs[event.keyCode] && !typing) { moveHomeTvFocus(dirs[event.keyCode]); event.preventDefault(); return; }
    if ((event.key === 'Enter' || event.keyCode === 23) && el && !typing) { el.click(); event.preventDefault(); }
  });
  setTimeout(() => homeTvFocusables()[0]?.focus(), 600);
}
mountHomeTvNavigation();
