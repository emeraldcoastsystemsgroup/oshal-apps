/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.6: page drag-and-drop reordering, named master creation and canvas editing with collapsed JSON, new named character/paragraph styles, and in-place object editing (CREATE-TOOL-PUBLISHING-STUDIO-06, -07, -15).
 */
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ALLOWED_FONTS = ['Libertinus Serif', 'Liberation Sans', 'Liberation Mono'];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = color => '#' + color.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function fillSelect(select, pairs, preferred) {
  if (!select) return;
  select.replaceChildren(...pairs.map(([v, label]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    return o;
  }));
  if (pairs.some(([v]) => String(v) === String(preferred))) select.value = preferred;
}

function validateIdentifier(raw, label) {
  const name = String(raw ?? '').trim();
  if (!KEY_PATTERN.test(name)) {
    throw new Error(`${label} must start with a letter and use letters, digits, _ or - (max 64).`);
  }
  return name;
}

function activeMaster(state) {
  if (!state.model || !state.editingMaster) return null;
  return state.model.masters.find(m => m.id === state.editingMaster) ?? null;
}

function activeObject(api) {
  const { state } = api;
  const master = activeMaster(state);
  if (master) return master.objects.find(o => o.id === state.masterItem) ?? null;
  const item = api.selected();
  return item && !item.storyId ? item : null;
}

export function createPublishingParity(api) {
  const $ = id => document.getElementById(id);
  const { state } = api;
  let dragSource = null;

  function movePage(from, to) {
    api.editable();
    if (!api.guardFields()) return;
    const pages = state.model?.pages ?? [];
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= pages.length || to >= pages.length || from === to) return;
    api.edit({ op: 'move-page', page: pages[from].id, index: to });
    state.page = to;
    state.editingMaster = null;
    state.masterItem = null;
    api.paint();
    api.status(`Moved page to position ${to + 1}.`);
  }

  function wirePageThumb(button, index, pageId) {
    button.draggable = true;
    button.dataset.pageId = pageId;
    button.dataset.pageIndex = String(index);
    button.addEventListener('dragstart', event => {
      if (state.busy) { event.preventDefault(); return; }
      dragSource = index;
      button.dataset.dragging = 'true';
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    button.addEventListener('dragover', event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      button.dataset.dropTarget = 'true';
    });
    button.addEventListener('dragleave', () => { delete button.dataset.dropTarget; });
    button.addEventListener('drop', api.action(event => {
      event.preventDefault();
      delete button.dataset.dropTarget;
      const raw = dragSource ?? Number(event.dataTransfer?.getData('text/plain'));
      dragSource = null;
      if (Number.isInteger(raw) && raw !== index) movePage(raw, index);
    }));
    button.addEventListener('dragend', () => {
      dragSource = null;
      delete button.dataset.dragging;
      for (const n of document.querySelectorAll('#page-rail [data-drop-target]')) delete n.dataset.dropTarget;
    });
    button.addEventListener('keydown', api.action(event => {
      if (event.altKey && event.key === 'ArrowUp') movePage(index, index - 1);
      else if (event.altKey && event.key === 'ArrowDown') movePage(index, index + 1);
    }));
  }

  function createMaster() {
    api.editable();
    if (!api.guardFields()) return;
    const name = validateIdentifier($('new-master-name')?.value, 'Master name');
    if (state.model.masters.some(m => m.id === name)) throw new Error(`Master "${name}" already exists.`);
    api.edit({ op: 'create-master', master: name, objects: [] });
    $('new-master-name').value = '';
    if ($('master-select')) $('master-select').value = name;
    api.paint();
    api.status(`Created master "${name}".`);
  }

  function applyMasterToPage() {
    api.editable();
    if (!api.guardFields()) return;
    const masterId = $('master-select')?.value || null;
    if (!masterId) throw new Error('Create or select a master first.');
    api.edit({ op: 'set-page', page: api.page().id, values: { masterId } });
    api.paint();
    api.status(`Applied master "${masterId}" to Page ${state.page + 1}.`);
  }

  function toggleMasterEdit(force) {
    api.editable();
    if (!api.guardFields()) return;
    const next = force === undefined ? !state.editingMaster : Boolean(force);
    if (!next) {
      state.editingMaster = null;
      state.masterItem = null;
      api.paint();
      api.status('Returned to page editing.');
      return;
    }
    const masterId = $('master-select')?.value || api.page()?.masterId || state.model?.masters[0]?.id;
    if (!masterId) throw new Error('Create or select a master first.');
    state.editingMaster = masterId;
    state.item = null;
    state.selectedIds.clear();
    state.masterItem = state.model.masters.find(m => m.id === masterId)?.objects[0]?.id ?? null;
    api.paint();
    api.status(`Editing master "${masterId}" on the canvas.`);
  }

  function addMasterItem(kind) {
    api.editable();
    if (!api.guardFields()) return;
    const master = activeMaster(state);
    if (!master) throw new Error('Enter master edit mode first.');
    const p = api.page(), id = api.uid('master_' + kind);
    const baseGeom = { id, kind, x: p.margin, y: Math.max(12, Math.round(p.margin / 2)), width: Math.min(180, p.width - 2 * p.margin), height: kind === 'rect' ? 40 : 28 };
    const pStyle = Object.keys(state.model.paragraphStyles)[0] ?? 'body';
    const cStyle = Object.keys(state.model.characterStyles)[0] ?? 'default';
    let item;
    if (kind === 'text') item = { ...baseGeom, paragraph: { style: pStyle, runs: [{ text: 'Master header', style: cStyle }] } };
    else if (kind === 'rect') item = { ...baseGeom, color: [54, 86, 204] };
    else if (kind === 'number') item = { ...baseGeom, width: 48, height: 24, style: cStyle };
    else throw new Error('Unsupported master item kind.');
    const objects = [...api.copy(master.objects), item];
    api.edit({ op: 'set-master', master: master.id, objects });
    state.masterItem = id;
    api.paint();
    api.status(`Added ${kind} to master "${master.id}".`);
  }

  function removeMasterItem() {
    api.editable();
    if (!api.guardFields()) return;
    const master = activeMaster(state);
    if (!master || !state.masterItem) throw new Error('Select a master item first.');
    const objects = api.copy(master.objects).filter(o => o.id !== state.masterItem);
    api.edit({ op: 'set-master', master: master.id, objects });
    state.masterItem = null;
    api.paint();
    api.status(`Removed item from master "${master.id}".`);
  }

  function createCharacterStyle() {
    api.editable();
    const name = validateIdentifier($('new-character-style-name')?.value, 'Character style name');
    if (Object.hasOwn(state.model.characterStyles, name)) throw new Error(`Character style "${name}" already exists.`);
    const font = $('font')?.value || 'Libertinus Serif';
    if (!ALLOWED_FONTS.includes(font)) throw new Error('Choose one of: ' + ALLOWED_FONTS.join(', '));
    const size = Number($('font-size')?.value || 12);
    const weight = Number($('font-weight')?.value || 400);
    const style = $('font-style')?.value || 'normal';
    const color = rgb($('font-color')?.value || '#000000');
    api.edit({ op: 'set-character-style', name, values: { font, size, weight, style, color } }, api.fields.character);
    $('new-character-style-name').value = '';
    if ($('character-style')) $('character-style').value = name;
    api.paint();
    api.status(`Created character style "${name}".`);
  }

  function createParagraphStyle() {
    api.editable();
    const name = validateIdentifier($('new-paragraph-style-name')?.value, 'Paragraph style name');
    if (Object.hasOwn(state.model.paragraphStyles, name)) throw new Error(`Paragraph style "${name}" already exists.`);
    const leading = Number($('leading')?.value || 3);
    const spaceAfter = Number($('space-after')?.value || 6);
    const indent = Number($('indent')?.value || 0);
    const align = $('align')?.value || 'left';
    api.edit({ op: 'set-paragraph-style', name, values: { leading, spaceAfter, indent, align } }, api.fields.paragraph);
    $('new-paragraph-style-name').value = '';
    if ($('paragraph-style')) $('paragraph-style').value = name;
    api.paint();
    api.status(`Created paragraph style "${name}".`);
  }

  function mutateActiveObject(mutate, pageOp) {
    api.editable();
    const obj = activeObject(api);
    if (!obj) throw new Error('Select a placed object first.');
    const master = activeMaster(state);
    if (master) {
      const objects = api.copy(master.objects);
      const target = objects.find(o => o.id === obj.id);
      if (!target) throw new Error('Selected master item no longer exists.');
      mutate(target);
      api.edit({ op: 'set-master', master: master.id, objects });
      return;
    }
    api.edit(pageOp(api.page(), obj));
  }

  function applyItemColor() {
    const color = rgb($('item-color').value);
    mutateActiveObject(t => { t.color = color; }, (p, o) => ({ op: 'set-object', page: p.id, object: o.id, values: { color } }));
    api.status('Updated shape colour in place.');
  }

  function applyItemText() {
    const text = $('item-text-value').value;
    const pStyle = $('item-paragraph-style').value;
    const cStyle = $('item-character-style').value;
    const paragraph = { style: pStyle, runs: [{ text, style: cStyle }] };
    mutateActiveObject(t => { t.paragraph = paragraph; }, (p, o) => ({ op: 'set-object', page: p.id, object: o.id, values: { paragraph } }));
    api.status('Updated object text in place.');
  }

  function applyReplaceImage() {
    api.editable();
    const obj = activeObject(api);
    if (!obj || obj.kind !== 'image') throw new Error('Select a placed picture first.');
    const asset = state.assets.find(a => a.id === $('replace-image-asset').value);
    if (!asset) throw new Error('Choose an uploaded image first.');
    const descriptor = { id: asset.id, sha256: asset.sha256, bytes: asset.bytes, mime: asset.mime };
    const master = activeMaster(state);
    if (master) {
      api.layout(m => {
        if (!m.assets.some(a => a.id === asset.id)) m.assets.push(descriptor);
        const target = m.masters.find(x => x.id === master.id)?.objects.find(o => o.id === obj.id);
        if (target) target.assetId = asset.id;
      });
    } else {
      api.edit({ op: 'replace-image', page: api.page().id, object: obj.id, asset: descriptor });
    }
    api.status('Replaced picture in place.');
  }

  function applyItemNumberStyle() {
    const style = $('item-number-style').value;
    mutateActiveObject(t => { t.style = style; }, (p, o) => ({ op: 'set-object', page: p.id, object: o.id, values: { style } }));
    api.status('Updated page number style in place.');
  }

  function syncUi() {
    const m = state.model;
    if (!m) {
      if ($('master-edit-banner')) $('master-edit-banner').hidden = true;
      if ($('pub-item-inplace')) $('pub-item-inplace').hidden = true;
      return;
    }
    if (state.editingMaster && !m.masters.some(x => x.id === state.editingMaster)) {
      state.editingMaster = null;
      state.masterItem = null;
    }
    const masterPairs = m.masters.length ? m.masters.map(x => [x.id, x.id]) : [['', 'No masters yet']];
    const chosenMaster = state.editingMaster || $('master-select')?.value || api.page()?.masterId || m.masters[0]?.id || '';
    fillSelect($('master-select'), masterPairs, chosenMaster);
    if ($('toggle-master-edit')) {
      $('toggle-master-edit').setAttribute('aria-pressed', String(Boolean(state.editingMaster)));
      $('toggle-master-edit').textContent = state.editingMaster ? 'Exit master canvas' : 'Edit master on canvas';
    }
    if ($('master-canvas-tools')) $('master-canvas-tools').hidden = !state.editingMaster;
    if ($('master-edit-banner')) {
      $('master-edit-banner').hidden = !state.editingMaster;
      if ($('master-edit-label')) $('master-edit-label').textContent = state.editingMaster ? `Editing master: ${state.editingMaster}` : '';
    }
    if ($('export-png')) $('export-png').textContent = `Download page ${state.page + 1} PNG`;
    syncInplace(m);
  }

  function syncInplace(m) {
    const host = $('pub-item-inplace');
    if (!host) return;
    const obj = activeObject(api);
    host.hidden = !obj;
    for (const kind of ['rect', 'text', 'image', 'number']) {
      const box = $('pub-inplace-' + kind);
      if (box) box.hidden = !obj || obj.kind !== kind;
    }
    if (!obj) return;
    if (obj.kind === 'rect') $('item-color').value = hex(obj.color);
    if (obj.kind === 'text') {
      $('item-text-value').value = obj.paragraph.runs.map(r => r.text).join('');
      fillSelect($('item-paragraph-style'), Object.keys(m.paragraphStyles).map(k => [k, k]), obj.paragraph.style);
      fillSelect($('item-character-style'), Object.keys(m.characterStyles).map(k => [k, k]), obj.paragraph.runs[0]?.style ?? 'default');
    }
    if (obj.kind === 'image') {
      fillSelect($('replace-image-asset'), state.assets.map(a => [a.id, a.title]), obj.assetId);
    }
    if (obj.kind === 'number') {
      fillSelect($('item-number-style'), Object.keys(m.characterStyles).map(k => [k, k]), obj.style);
    }
  }

  function syncDisabled(blocked) {
    const m = state.model;
    const set = (id, off) => { const n = $(id); if (n) n.disabled = off; };
    set('move-page-up', blocked || !m || state.page <= 0);
    set('move-page-down', blocked || !m || state.page >= m.pages.length - 1);
    for (const id of ['new-master-name', 'create-master', 'master-select', 'new-character-style-name', 'create-character-style', 'new-paragraph-style-name', 'create-paragraph-style', 'item-color', 'apply-item-color', 'item-text-value', 'item-paragraph-style', 'item-character-style', 'apply-item-text', 'replace-image-asset', 'apply-replace-image', 'item-number-style', 'apply-item-number-style']) {
      set(id, blocked);
    }
    const hasMaster = Boolean($('master-select')?.value);
    set('toggle-master-edit', blocked || !hasMaster);
    set('apply-master-to-page', blocked || !hasMaster);
    set('master-add-text', blocked || !state.editingMaster);
    set('master-add-rect', blocked || !state.editingMaster);
    set('master-add-number', blocked || !state.editingMaster);
    set('master-remove-item', blocked || !state.editingMaster || !state.masterItem);
    set('exit-master-edit', state.busy);
    if ($('apply-replace-image') && !state.assets.length) $('apply-replace-image').disabled = true;
  }

  const on = (id, ev, fn) => { $(id)?.addEventListener(ev, api.action(fn)); };
  on('move-page-up', 'click', () => movePage(state.page, state.page - 1));
  on('move-page-down', 'click', () => movePage(state.page, state.page + 1));
  on('create-master', 'click', createMaster);
  on('apply-master-to-page', 'click', applyMasterToPage);
  on('toggle-master-edit', 'click', () => toggleMasterEdit());
  on('exit-master-edit', 'click', () => toggleMasterEdit(false));
  on('master-select', 'change', () => {
    const chosen = $('master-select').value;
    if (state.editingMaster && chosen) { state.editingMaster = chosen; state.masterItem = null; }
    if ($('master') && chosen && state.model?.masters.some(x => x.id === chosen)) {
      $('master-objects').value = JSON.stringify(state.model.masters.find(x => x.id === chosen)?.objects ?? [], null, 2);
    }
    api.paint();
  });
  on('master-add-text', 'click', () => addMasterItem('text'));
  on('master-add-rect', 'click', () => addMasterItem('rect'));
  on('master-add-number', 'click', () => addMasterItem('number'));
  on('master-remove-item', 'click', removeMasterItem);
  on('create-character-style', 'click', createCharacterStyle);
  on('create-paragraph-style', 'click', createParagraphStyle);
  on('apply-item-color', 'click', applyItemColor);
  on('item-color', 'change', applyItemColor);
  on('apply-item-text', 'click', applyItemText);
  on('apply-replace-image', 'click', applyReplaceImage);
  on('apply-item-number-style', 'click', applyItemNumberStyle);

  return { wirePageThumb, syncUi, syncDisabled, movePage, toggleMasterEdit };
}
