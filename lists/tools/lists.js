/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First Lists screen (1.0.0). The person's lists come from /api/lists; every action of the page is one of the routes the concierge's tools call. The grocery list is Shopping's: when Shopping answers for this person it is shown first among the lists and read, added to, ticked and cleared of an item through Shopping's own routes, in the person's own session; when Shopping does not answer it is not shown. Server text is always written as text, never as markup.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const S = { lists: [], grocery: null, current: null, items: [], undo: null, dragged: null, editing: null };
  const PHONE = window.matchMedia('(max-width: 759px)');

  /** One JSON request; the answer is its status and parsed body, never a thrown network error. */
  async function request(base, method, path, body) {
    try {
      const res = await fetch(base + path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const parsed = await res.json().catch(() => ({}));
      return { status: res.status, body: parsed && typeof parsed === 'object' ? parsed : {} };
    } catch (_) { return { status: 0, body: { message: 'The page could not reach the server.' } }; }
  }
  const api = (method, path, body) => request('/api/lists', method, path, body);
  const shop = (method, path, body) => request('/api/purchasing', method, path, body);
  const said = (r, fallback) => r.body.message || (typeof r.body.error === 'string' && r.body.error) || fallback || `That did not work (HTTP ${r.status}).`;

  /** A person's own list: every action is a Lists route. */
  const OWN = {
    load: async (list) => { const r = await api('GET', '/show?list=' + encodeURIComponent(list.id)); return r.status === 200 ? r.body.items : Promise.reject(r); },
    add: (list, title) => api('POST', '/items/add', { list: list.id, title }),
    tick: (list, item, done) => api('POST', done ? '/items/check' : '/items/uncheck', { list: list.id, item: item.id }),
    remove: (list, item) => api('POST', '/items/remove', { list: list.id, item: item.id }),
  };
  /** The grocery list: every action is one of Shopping's own routes. */
  const GROCERY = {
    load: async (list) => {
      if (!list.shopId) return [];
      const r = await shop('GET', `/lists/${encodeURIComponent(list.shopId)}/items`);
      if (r.status !== 200) return Promise.reject(r);
      return (r.body.items || []).map((row) => ({ id: row.item_id, title: row.title || '', done: row.status !== 'pending', quantity: Number(row.quantity) > 1 ? Number(row.quantity) : null, note: null, due: null }));
    },
    add: (_list, title) => shop('POST', '/lists/default/items', { title, quantity: 1 }),
    tick: (list, item, done) => shop('POST', `/lists/${encodeURIComponent(list.shopId)}/items/${encodeURIComponent(item.id)}`, { checked: done }),
    remove: (list, item) => shop('DELETE', `/lists/${encodeURIComponent(list.shopId)}/items/${encodeURIComponent(item.id)}`),
  };
  const source = (list) => (list.kind === 'grocery' ? GROCERY : OWN);

  function alertIn(id, text) { const box = $(id); box.textContent = text || ''; box.hidden = !text; }
  function status(text, undo) {
    $('status-text').textContent = text || '';
    $('status').hidden = !text;
    S.undo = undo || null;
    $('undo').hidden = !undo;
  }
  function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }

  /** Shopping's list for this person, or nothing when Shopping does not answer for them. */
  async function loadGrocery() {
    const r = await shop('GET', '/lists');
    if (r.status !== 200 || !Array.isArray(r.body.lists)) { S.grocery = null; return; }
    const first = r.body.lists[0];
    S.grocery = { kind: 'grocery', id: 'grocery', name: 'Groceries', open: first ? Number(first.item_count) || 0 : 0, shopId: first ? first.list_id : null };
  }
  async function loadLists() {
    const r = await api('GET', '/lists');
    if (r.status !== 200) { alertIn('side-alert', said(r, 'Your lists could not be read.')); return false; }
    alertIn('side-alert', '');
    S.lists = r.body.lists.map((row) => ({ kind: 'own', id: row.id, name: row.name, open: row.open, done: row.done }));
    if (r.body.groceries) await loadGrocery();
    renderLists();
    return true;
  }
  const everyList = () => (S.grocery ? [S.grocery, ...S.lists] : S.lists);

  function renderLists() {
    const box = $('lists');
    box.replaceChildren();
    for (const list of everyList()) {
      const li = el('li'), button = el('button', 'lx-list');
      button.type = 'button';
      button.dataset.list = list.id;
      if (S.current && S.current.id === list.id) button.setAttribute('aria-current', 'true');
      button.append(el('span', 'lx-name', list.name));
      if (list.kind === 'grocery') button.append(el('span', 'lx-chip', 'Shopping'));
      if (list.open) button.append(el('span', 'lx-count', String(list.open)));
      button.addEventListener('click', () => select(list, true));
      li.append(button);
      box.append(li);
    }
    $('none').hidden = everyList().length > 0 || Boolean(S.current);
    $('side-empty').hidden = everyList().length > 0;
  }

  /** Open one list in the main pane; on a phone that is its own screen. */
  async function select(list, show) {
    S.current = list;
    const own = list.kind === 'own';
    $('list').hidden = false; $('none').hidden = true;
    $('list-name').textContent = list.name;
    $('list-chip').hidden = own; $('order').hidden = own; $('list-menu').hidden = !own;
    alertIn('alert', ''); status('');
    if (show) $('lx').dataset.view = 'items';
    try { history.replaceState(null, '', '?list=' + encodeURIComponent(list.id)); } catch (_) { /* a framed page may not change its address */ }
    renderLists();
    await loadItems();
  }
  async function loadItems() {
    const list = S.current;
    try { S.items = await source(list).load(list); } catch (r) { S.items = []; alertIn('alert', said(r, `${list.name} could not be read.`)); }
    if (S.current === list) renderItems();
  }

  function meta(item) {
    const parts = [];
    if (item.quantity) parts.push('×' + item.quantity);
    if (item.due) parts.push('Due ' + new Date(item.due + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }));
    if (item.note) parts.push(item.note);
    return parts.join(' · ');
  }
  function menuFor(item, own) {
    const more = el('details', 'lx-more'), summary = el('summary', null, '⋯'), menu = el('div', 'lx-menu');
    summary.setAttribute('aria-label', 'More for ' + item.title); summary.title = 'More for ' + item.title;
    menu.setAttribute('data-no-glass', '');
    const entry = (label, run, cls) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', () => { more.open = false; run(); }); menu.append(b); };
    if (own) entry('Details', () => openDetails(item));
    if (own && !item.done) { entry('Move up', () => move(item, { to: 'up' })); entry('Move down', () => move(item, { to: 'down' })); }
    entry('Remove', () => remove(item), 'lx-danger');
    more.append(summary, menu);
    return more;
  }
  function rowFor(item) {
    const own = S.current.kind === 'own', li = el('li', 'lx-item' + (item.done ? ' lx-is-done' : ''));
    li.dataset.id = item.id;
    const tick = el('label', 'lx-tick'), box = el('input');
    box.type = 'checkbox'; box.checked = item.done; box.setAttribute('aria-label', (item.done ? 'Not done: ' : 'Done: ') + item.title);
    box.addEventListener('change', () => toggle(item, box.checked));
    tick.append(box, el('span', 'lx-box'));
    const words = el(own ? 'button' : 'div', 'lx-words');
    if (own) { words.type = 'button'; words.addEventListener('click', () => openDetails(item)); }
    words.append(el('span', 'lx-title', item.title));
    if (meta(item)) words.append(el('span', 'lx-meta', meta(item)));
    li.append(tick, words);
    if (own && !item.done) li.append(gripFor(item, li));
    li.append(menuFor(item, own));
    return li;
  }
  function renderItems() {
    const open = S.items.filter((item) => !item.done), done = S.items.filter((item) => item.done);
    $('open-items').replaceChildren(...open.map(rowFor));
    $('done-items').replaceChildren(...done.map(rowFor));
    $('empty').hidden = S.items.length > 0;
    $('done').hidden = done.length === 0;
    $('done-count').textContent = `Done (${done.length})`;
    $('clear-done').disabled = done.length === 0;
    S.current.open = open.length; S.current.done = done.length;
    renderLists();
  }

  /** The handle a row is dragged by; dropping it on another open row moves it to that row's place. */
  function gripFor(item, li) {
    const grip = el('span', 'lx-grip', '⋮⋮');
    grip.draggable = true; grip.title = 'Drag to reorder'; grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('dragstart', (e) => { S.dragged = item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); try { e.dataTransfer.setDragImage(li, 12, 12); } catch (_) { /* optional */ } });
    grip.addEventListener('dragend', () => { S.dragged = null; });
    li.addEventListener('dragover', (e) => { if (S.dragged && S.dragged !== item) { e.preventDefault(); li.classList.add('lx-over'); } });
    li.addEventListener('dragleave', () => li.classList.remove('lx-over'));
    li.addEventListener('drop', (e) => {
      li.classList.remove('lx-over');
      if (!S.dragged || S.dragged === item) return;
      e.preventDefault();
      const open = S.items.filter((row) => !row.done);
      move(S.dragged, { position: open.indexOf(item) + 1 });
    });
    return grip;
  }

  /** After a change the server accepted, read the list again; a refusal is shown where the work is. */
  async function settle(r, fallback) {
    if (r.status >= 200 && r.status < 300) { alertIn('alert', ''); await loadItems(); return true; }
    alertIn('alert', said(r, fallback));
    await loadItems();
    return false;
  }
  async function addItem(title) {
    const list = S.current, r = await source(list).add(list, title);
    if (r.status >= 200 && r.status < 300 && list.kind === 'grocery' && !list.shopId) { await loadGrocery(); if (S.grocery) { S.grocery.name = list.name; S.current = S.grocery; } }
    const done = await settle(r, `“${title}” was not added.`);
    if (done && r.body.already && r.body.already.length) status(`${r.body.already[0]} is already on the list.`);
    else if (done) status('');
    return done;
  }
  async function toggle(item, done) { await settle(await source(S.current).tick(S.current, item, done), `“${item.title}” could not be changed.`); }
  async function move(item, change) { await settle(await api('POST', '/items/move', { list: S.current.id, item: item.id, ...change }), `“${item.title}” could not be moved.`); }
  async function remove(item) {
    const list = S.current, ok = await settle(await source(list).remove(list, item), `“${item.title}” was not removed.`);
    if (ok) status(`Removed ${item.title}.`, list.kind === 'own' ? { list: list.id, item } : null);
  }
  /** Put a removed item back with what it held. */
  async function undo() {
    const kept = S.undo;
    status('');
    if (!kept || !S.current || S.current.id !== kept.list) return;
    const r = await api('POST', '/items/add', { list: kept.list, title: kept.item.title, note: kept.item.note, quantity: kept.item.quantity, due: kept.item.due });
    if (r.status === 200 && kept.item.done && r.body.added[0]) await api('POST', '/items/check', { list: kept.list, item: r.body.added[0].id });
    await settle(r, `“${kept.item.title}” was not put back.`);
  }

  function openDetails(item) {
    S.editing = item;
    $('d-title').value = item.title; $('d-note').value = item.note || '';
    $('d-quantity').value = item.quantity || ''; $('d-due').value = item.due || '';
    alertIn('d-error', '');
    $('details').showModal();
  }
  async function saveDetails(event) {
    event.preventDefault();
    const quantity = $('d-quantity').value.trim();
    const change = { title: $('d-title').value, note: $('d-note').value, quantity: quantity === '' ? null : Number(quantity), due: $('d-due').value || null };
    const r = await api('POST', '/items/edit', { list: S.current.id, item: S.editing.id, ...change });
    if (r.status !== 200) { alertIn('d-error', said(r, 'The item was not saved.')); return; }
    $('details').close();
    await loadItems();
  }

  /** One question in a dialog: a confirmation, or a name to type. Answers the typed text, true, or null when cancelled. */
  function ask(title, options) {
    return new Promise((resolve) => {
      const dialog = $('ask'), input = $('ask-input');
      $('ask-title').textContent = title;
      $('ask-field').hidden = !options.label; $('ask-label').textContent = options.label || '';
      input.value = options.value || '';
      $('ask-ok').textContent = options.ok; $('ask-ok').classList.toggle('lx-danger', Boolean(options.danger)); $('ask-ok').classList.toggle('lx-primary', !options.danger);
      alertIn('ask-error', '');
      const finish = (value) => { $('ask-form').onsubmit = null; $('ask-cancel').onclick = null; dialog.oncancel = null; dialog.close(); resolve(value); };
      $('ask-form').onsubmit = (e) => { e.preventDefault(); finish(options.label ? input.value : true); };
      $('ask-cancel').onclick = () => finish(null);
      dialog.oncancel = (e) => { e.preventDefault(); finish(null); };
      dialog.showModal();
      if (options.label) input.select();
    });
  }
  async function renameList() {
    const list = S.current, name = await ask('Rename list', { label: 'Name', value: list.name, ok: 'Rename' });
    if (name === null) return;
    const r = await api('POST', '/rename', { list: list.id, name });
    if (r.status !== 200) { alertIn('alert', said(r, 'The list was not renamed.')); return; }
    list.name = r.body.list.name; $('list-name').textContent = list.name; alertIn('alert', ''); renderLists();
  }
  async function clearDone() {
    const n = S.items.filter((item) => item.done).length;
    if (!n || !(await ask(`Clear ${n} done item${n === 1 ? '' : 's'}?`, { ok: 'Clear', danger: true }))) return;
    await settle(await api('POST', '/clear-done', { list: S.current.id }), 'The done items were not cleared.');
  }
  async function deleteList() {
    const list = S.current, n = S.items.length;
    if (!(await ask(`Delete ${list.name}${n ? ` and its ${n} item${n === 1 ? '' : 's'}` : ''}?`, { ok: 'Delete', danger: true }))) return;
    const r = await api('POST', '/delete', { list: list.id });
    if (r.status !== 200) { alertIn('alert', said(r, 'The list was not deleted.')); return; }
    S.current = null; $('list').hidden = true; $('lx').dataset.view = 'lists';
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* framed */ }
    await loadLists();
    if (!PHONE.matches && everyList()[0]) await select(everyList()[0], false);
  }
  async function newList(event) {
    event.preventDefault();
    const input = $('new-list-name'), name = input.value.trim();
    if (!name) { input.focus(); return; }
    const r = await api('POST', '/lists', { name });
    if (r.status !== 200 && r.status !== 201) { alertIn('side-alert', said(r, 'The list was not made.')); return; }
    input.value = '';
    await loadLists();
    const made = S.lists.find((list) => list.id === r.body.list.id);
    if (made) { await select(made, true); $('add-title').focus(); }
  }

  function wire() {
    $('new-list').addEventListener('submit', newList);
    $('add').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('add-title'), title = input.value.replace(/\s+/g, ' ').trim();
      if (!title || !S.current) { input.focus(); return; }
      $('add-button').disabled = true;
      try { if (await addItem(title)) input.value = ''; } finally { $('add-button').disabled = false; input.focus(); }
    });
    $('back').addEventListener('click', () => { $('lx').dataset.view = 'lists'; });
    $('undo').addEventListener('click', undo);
    $('rename').addEventListener('click', () => { $('list-menu').open = false; renameList(); });
    $('clear-done').addEventListener('click', () => { $('list-menu').open = false; clearDone(); });
    $('delete-list').addEventListener('click', () => { $('list-menu').open = false; deleteList(); });
    $('details-form').addEventListener('submit', saveDetails);
    $('d-cancel').addEventListener('click', () => $('details').close());
    $('d-remove').addEventListener('click', () => { $('details').close(); remove(S.editing); });
    document.addEventListener('click', (event) => {
      document.querySelectorAll('.lx-more[open]').forEach((open) => { if (!open.contains(event.target)) open.open = false; });
    });
  }

  /** Start: the lists, then the list the address names, else the first one on a wide screen. */
  async function start() {
    wire();
    if (!(await loadLists())) return;
    const named = new URLSearchParams(location.search).get('list');
    const wanted = named && everyList().find((list) => list.id === named);
    if (wanted) await select(wanted, true);
    else if (!PHONE.matches && everyList()[0]) await select(everyList()[0], false);
  }
  start();
}());
