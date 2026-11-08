/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Present native layer properties in the common editor and delegate every edit to exact-time native commands.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.3, phones (Roger, trial.oswarm.ai, 2026-11-06, F7, and the trial check: no blank composition, an empty "Create or open a composition to start" box, dead playback buttons, 244 px of bars): with no composition open the empty state's one primary action is New composition (the rail's own Create composition form and its defaults), with Open a saved one as a link to More; the time slider, playback, work area and timeline wait until a composition is open; the app bar is the status and More (the saved-composition list, Undo, Export and the Project menu); the first pane is named Layers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0, the oshal design standard (docs/ux/design-standard.md §3.1, §3.2, §3.3, §4.3, §4.4, §4.10, §5.1; Alight Motion and Node Video, REFP CONVENTIONS §5.4; Roger, trial.oswarm.ai, 2026-11-06, F7). With nothing saved the editor opens on a blank untitled 1920×1080, 10 s, 30 fps composition whose one primary, Add layer, sits on the empty stage; the composition is saved at its first edit.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, RP-MOT-01 & RP-MOT-02: replace Video, Audio and Motion blur placeholders with live Video… and Audio… imports, audio mute/levels controls with keyframe diamonds, composition motion-blur shutter controls, and per-layer motion-blur switches.
 */
const number = (key, label, value, group = 'Transform', unit = '') => ({ key, label, value, type: 'number', step: 'any', group, unit });
const readable = value => typeof value === 'number' && Number.isFinite(value);
const KEYABLE = new Set(['transform/opacity', 'transform/position', 'transform/scale', 'transform/rotation', 'audio/levels']);
const KEY_NAMES = {
  'transform/opacity': 'Opacity', 'transform/position': 'Position',
  'transform/scale': 'Scale', 'transform/rotation': 'Rotation', 'audio/levels': 'Audio levels'
};

export function motionProperties(adapter) {
  const selected = adapter.layer(), info = adapter.state.propertiesInfo;
  if (!selected) return [];
  const isScene = ['Camera', 'Light'].includes(selected.source?.type || info?.source?.type);
  const hasAudio = Boolean(adapter.layerHasAudio?.(selected));
  const fields = [
    { key: 'name', label: 'Layer name', type: 'text', value: selected.name, group: 'Layer', disabled: selected.switches.locked },
    { key: 'visible', label: 'Visible', type: 'checkbox', value: !!selected.switches.video, group: 'Layer', disabled: selected.switches.locked },
    { key: 'motionBlur', label: 'Motion blur', type: 'checkbox', value: !!selected.switches.motion_blur, group: 'Layer', disabled: selected.switches.locked || isScene }
  ];
  if (hasAudio) {
    fields.push({ key: 'audioEnabled', label: 'Audio', type: 'checkbox', value: !!selected.switches.audio, group: 'Audio', disabled: selected.switches.locked });
  }
  if (info && adapter.propertiesCurrent()) {
    const labels = {
      'transform/position': ['X', 'Y', 'Z'], 'transform/scale': ['Scale X', 'Scale Y', 'Scale Z'],
      'transform/rotation': ['Rotation'], 'transform/opacity': ['Opacity'],
      'transform/orientation': ['Orientation X', 'Orientation Y', 'Orientation Z'],
      'transform/rotationX': ['Rotation X'], 'transform/rotationY': ['Rotation Y'],
      ...(hasAudio ? { 'audio/levels': ['Audio levels'] } : {})
    };
    for (const prop of info.properties) {
      if (!labels[prop.path]) continue;
      const values = Array.isArray(prop.value) ? prop.value : [prop.value];
      const propGroup = prop.path === 'audio/levels' ? 'Audio' : 'Transform';
      const unit = prop.path === 'audio/levels' ? 'dB' : prop.path.includes('position') ? 'px' : prop.path.includes('scale') || prop.path.includes('opacity') ? '%' : '°';
      values.forEach((value, index) => {
        if (readable(value)) fields.push({ ...number(prop.path + ':' + index, labels[prop.path][index] ?? prop.name, value, propGroup, unit), disabled: info.locked || adapter.state.playing || !!adapter.state.keyInfo });
      });
    }
  }
  if (adapter.state.textInfo && adapter.textCurrent() && !adapter.state.textInfo.locked) {
    fields.push({ key: 'text', label: 'Text', type: 'textarea', value: adapter.text(), group: 'Text', disabled: adapter.state.playing });
  }
  return fields;
}

export async function applyMotionProperty(adapter, key, value) {
  const selected = adapter.layer(), info = adapter.state.propertiesInfo;
  const field = motionProperties(adapter).find(item => item.key === key);
  if (!field || field.disabled) throw new Error('Select an editable native layer at the current time.');
  if (key === 'name') return adapter.apply([{ command: 'layer.rename', params: { layer: selected.id, name: value } }]);
  if (key === 'visible') return adapter.apply([{ command: 'layer.setSwitch', params: { layers: [selected.id], switch: 'video', value: Boolean(value) } }]);
  if (key === 'motionBlur') return adapter.apply([{ command: 'layer.setSwitch', params: { layers: [selected.id], switch: 'motionBlur', value: Boolean(value) } }]);
  if (key === 'audioEnabled') return adapter.apply([{ command: 'layer.setSwitch', params: { layers: [selected.id], switch: 'audio', value: Boolean(value) } }]);
  if (key === 'text') {
    const text = adapter.state.textInfo, command = adapter.textCommand(value);
    if (command) return adapter.apply([command], { previewTick: text.compTimeTicks });
    return;
  }
  if (!adapter.propertiesCurrent()) throw new Error('Read the current native properties before editing.');
  const split = key.lastIndexOf(':'), path = key.slice(0, split), index = Number(key.slice(split + 1));
  const prop = info.properties.find(item => item.path === path);
  if (!prop || !Number.isFinite(value)) throw new Error('This native property is unavailable.');
  const updated = Array.isArray(prop.value) ? prop.value.map((original, n) => n === index ? value : original) : value;
  return adapter.patchProperties([{ prop: prop.prop, value: updated }]);
}

function group(label, ...elements) {
  const details = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = label;
  details.append(summary, ...elements.filter(Boolean));
  return details;
}
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Modal top-layer layers for menus and sheets (docs/ux/design-standard.md §4.3, §4.4). */
export function createLayers(doc) {
  const win = doc.defaultView, stack = [];
  let ignore = 0;
  win.addEventListener('popstate', () => { if (ignore > 0) { ignore -= 1; return; } const top = stack.at(-1); if (top) void close(top.dialog, { history: false }); });
  function create(title, className, { onClose } = {}) {
    const dialog = make('dialog', 'ds-layer ' + className), head = make('header', 'ds-layer-head'), heading = make('h2', 'ds-layer-title', title), done = make('button', 'ds-layer-done', 'Done'), body = make('div', 'ds-layer-body');
    dialog.dataset.dsSheet = ''; dialog.setAttribute('aria-label', title); done.type = 'button'; head.append(heading, done); dialog.append(head, body);
    done.addEventListener('click', () => void close(dialog)); dialog.addEventListener('cancel', event => { event.preventDefault(); void close(dialog); });
    dialog.addEventListener('click', event => { if (event.target === dialog) void close(dialog); }); doc.body.append(dialog);
    return { dialog, body, heading, done, onClose };
  }
  async function open(layer, { nodes = [], anchor = null } = {}) {
    const restore = nodes.filter(Boolean).map(node => {
      const mark = doc.createComment('layer'); node.before(mark); layer.body.append(node);
      if (node.tagName === 'DETAILS') { const wasOpen = node.open; node.open = true; return () => { node.open = wasOpen; mark.replaceWith(node); }; }
      return () => { mark.replaceWith(node); };
    });
    stack.push({ dialog: layer.dialog, restore, onClose: layer.onClose }); layer.dialog.showModal();
    if (anchor && win.matchMedia('(min-width:801px)').matches) {
      const box = anchor.getBoundingClientRect(), width = Math.max(240, layer.dialog.offsetWidth);
      layer.dialog.classList.add('ds-anchored');
      layer.dialog.style.left = Math.max(8, Math.min(box.right - width, win.innerWidth - width - 8)) + 'px';
      layer.dialog.style.top = Math.min(box.bottom + 4, Math.max(8, win.innerHeight - layer.dialog.offsetHeight - 8)) + 'px';
    }
    try { win.history.pushState({ ...(win.history.state || {}), dsLayer: stack.length }, ''); } catch { /* embedded */ }
  }
  async function close(dialog, { history = true } = {}) {
    const index = stack.findIndex(entry => entry.dialog === dialog); if (index < 0) return;
    const [entry] = stack.splice(index, 1);
    for (const undo of entry.restore.reverse()) undo();
    dialog.close(); dialog.remove(); entry.onClose?.();
    if (history) {
      const address = win.location.href; ignore += 1;
      await new Promise(resolve => {
        let fired = false;
        const done = () => { if (fired) return; fired = true; win.removeEventListener('popstate', done); resolve(); };
        win.addEventListener('popstate', done); try { win.history.back(); } catch { done(); }
        setTimeout(() => { if (!fired && ignore > 0) ignore -= 1; done(); }, 600);
      });
      try { if (win.location.href !== address) win.history.replaceState(win.history.state, '', address); } catch { /* embedded */ }
    }
  }
  return { create, open, close, top: () => stack.at(-1)?.dialog ?? null };
}

function compFacts(comp, ticks) {
  const rate = comp.frame_rate ? Number(comp.frame_rate.num) / Number(comp.frame_rate.den) : NaN, seconds = Number(comp.duration) / ticks;
  const rgb = Array.isArray(comp.background) ? comp.background.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)) : null;
  const hex = rgb ? '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('') : null;
  return [['Size', comp.width + ' × ' + comp.height], ['Frame rate', Number.isFinite(rate) ? (Math.round(rate * 1000) / 1000) + ' fps' : '—'], ['Duration', Number.isFinite(seconds) ? (Math.round(seconds * 100) / 100) + ' s' : '—'], ...(hex ? [['Background', hex]] : [])];
}

function setupStageOverlays({ $, adapter, stage, wide, getFoundation }) {
  const inline = make('form', 'motion-inline-text'), label = make('label', '', 'Edit selected composition text'), input = make('textarea'), save = make('button', '', 'Apply text'), close = make('button', '', 'Close');
  inline.hidden = true; label.append(input); input.setAttribute('aria-label', 'Edit text in composition'); save.type = 'submit'; close.type = 'button'; inline.append(label, save, close); stage.append(inline);
  let inlineTarget = null;
  const target = () => JSON.stringify([adapter.state.project?.id, adapter.state.project?.revision, String(adapter.state.comp), String(adapter.state.layer), String(adapter.tick())]);
  $('preview').addEventListener('dblclick', () => {
    if (!motionProperties(adapter).some(field => field.key === 'text' && !field.disabled)) return;
    inlineTarget = target(); input.value = adapter.text(); inline.hidden = false; input.focus(); if (wide()) getFoundation()?.showPanel('properties');
  });
  input.addEventListener('input', () => { if (inlineTarget !== target()) return; const original = $('textEdit').elements.content; original.value = input.value; original.dispatchEvent(new Event('input', { bubbles: true })); });
  inline.onsubmit = async event => {
    event.preventDefault();
    if (inlineTarget !== target()) { adapter.problem(new Error('The selected text changed. Your native text draft remains in Typography.')); return; }
    try { await adapter.prepare(); inline.hidden = true; } catch (error) { adapter.problem(error); }
  };
  close.onclick = () => { inline.hidden = true; };
  const handle = make('button', 'motion-position-handle'); handle.type = 'button'; handle.hidden = true; handle.setAttribute('aria-label', 'Move selected layer in composition'); stage.append(handle);
  handle.addEventListener('dblclick', () => $('preview').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  const movable = () => {
    const info = adapter.state.propertiesInfo, selected = adapter.layer(), prop = info?.properties.find(item => item.path === 'transform/position');
    return adapter.propertiesCurrent() && !info?.locked && !info?.threeD && !prop?.hasExpression && !selected?.parent && Array.isArray(prop?.value) && prop.value.slice(0, 2).every(readable) && !adapter.state.playing ? prop : null;
  };
  function placeHandle() {
    const position = movable(), image = $('preview'), comp = adapter.comp();
    handle.hidden = !position || image.hidden || !comp || adapter.state.busy;
    if (handle.hidden) return;
    const area = stage.getBoundingClientRect(), box = image.getBoundingClientRect();
    handle.style.left = (box.left - area.left + Number(position.value[0]) / Number(comp.width) * box.width) + 'px';
    handle.style.top = (box.top - area.top + Number(position.value[1]) / Number(comp.height) * box.height) + 'px';
    handle.textContent = '↔'; handle.title = 'Drag ' + adapter.layer().name;
  }
  handle.onpointerdown = event => {
    if (event.button !== 0) return; const prop = movable(); if (!prop) return; event.preventDefault();
    const origin = target(), start = [event.clientX, event.clientY], box = $('preview').getBoundingClientRect(), comp = adapter.comp(), original = prop.value;
    let updated = original; handle.setPointerCapture(event.pointerId);
    handle.onpointermove = move => {
      if (origin !== target()) return;
      updated = original.map((val, i) => i === 0 ? val + (move.clientX - start[0]) * Number(comp.width) / box.width : i === 1 ? val + (move.clientY - start[1]) * Number(comp.height) / box.height : val);
      const area = stage.getBoundingClientRect();
      handle.style.left = (box.left - area.left + updated[0] / Number(comp.width) * box.width) + 'px';
      handle.style.top = (box.top - area.top + updated[1] / Number(comp.height) * box.height) + 'px';
    };
    handle.onpointercancel = () => { handle.onpointermove = null; placeHandle(); };
    handle.onpointerup = async () => { handle.onpointermove = null; if (origin !== target() || updated === original) return; try { await adapter.patchProperties([{ prop: prop.prop, value: updated }]); } catch (error) { adapter.problem(error); } placeHandle(); };
  };
  new ResizeObserver(placeHandle).observe(stage); $('preview').addEventListener('load', placeHandle);
  return { syncOverlays() { if (inlineTarget && inlineTarget !== target()) inline.hidden = true; placeHandle(); } };
}

function setupKeyframeDiamonds({ $, root, adapter, act }) {
  function keysOf(path) { const layer = adapter.layer(); let node = layer?.props; for (const part of path.split('/')) node = node?.children?.find(child => child.match === part); return node; }
  function keyHere(path) {
    const node = keysOf(path), layer = adapter.layer(); if (!node?.keys?.length || !layer) return null;
    const comp = adapter.comp(), frame = comp ? Number(BigInt(adapter.state.ticks) * BigInt(comp.frame_rate.den) / BigInt(comp.frame_rate.num)) : 0;
    const at = Number(adapter.tick()) - Number(layer.start_time || 0);
    const key = node.keys.find(item => Math.abs(Number(item.time) - at) <= Math.max(1, frame / 2));
    return key ? { node, key } : null;
  }
  async function diamond(path) {
    const found = keyHere(path), layer = adapter.layer();
    if (found) { await adapter.chooseKey({ layer: String(layer.id), prop: String(found.node.uid), timeTicks: String(found.key.time) }); return; }
    const info = adapter.state.propertiesInfo, prop = info?.properties.find(item => item.path === path);
    if (!prop || !adapter.propertiesCurrent()) throw new Error('Read the current properties before adding a key.');
    const form = $('key').elements; form.path.value = path; form.value.value = Array.isArray(prop.value) ? prop.value.join(',') : String(prop.value); form.ease.value = 'linear';
    await $('key').onsubmit();
    const added = keyHere(path), now = adapter.layer();
    if (added && now) await adapter.chooseKey({ layer: String(now.id), prop: String(added.node.uid), timeTicks: String(added.key.time) });
  }
  return function decorateDiamonds() {
    const edit = Boolean(adapter.state.project && adapter.state.permissions.change && !adapter.state.historical && !adapter.state.busy && !adapter.state.playing);
    for (const control of root.querySelectorAll('.ef-inspector [data-editor-property]')) {
      const [path, index] = control.dataset.editorProperty.split(':'), label = control.closest('.ef-property');
      if (!label || !KEYABLE.has(path) || index !== '0') continue;
      let button = label.querySelector('.motion-diamond');
      if (!button) { button = make('button', 'motion-diamond motion-icon'); button.type = 'button'; button.dataset.path = path; button.onclick = act(() => diamond(path)); label.append(button); label.classList.add('motion-keyed-row'); }
      const has = Boolean(keyHere(path)), name = KEY_NAMES[path] || path;
      button.textContent = has ? '◆' : '◇'; button.setAttribute('aria-pressed', String(has));
      button.setAttribute('aria-label', (has ? 'Edit the ' : 'Add a ') + name + ' keyframe at ' + adapter.state.time.toFixed(2) + ' s');
      button.title = button.getAttribute('aria-label'); button.disabled = !edit;
    }
  };
}

function layoutInspectorAndStage({ $, main, navigation, inspector, center }) {
  const hold = make('div', 'motion-hold'); hold.hidden = true; main.append(hold);
  const keyEditor = $('keyEditor'), workArea = $('workArea'), compMotionBlur = $('compMotionBlur'), revision = $('revision');
  const timeline = make('section', 'motion-timeline'); timeline.setAttribute('aria-label', 'Timeline'); timeline.append($('timeline')); main.append(timeline);
  const layerTree = make('section', 'motion-layer-tree'), compRow = make('button', 'motion-comp-row', 'Composition'); compRow.type = 'button';
  layerTree.append(make('h2', '', 'Layers'), $('comps').closest('label'), compRow, $('layers'));
  const mediaLib = group('Your media', $('assets').closest('label'), $('reuse'), $('dropAsset'));
  hold.append($('new'), $('renderPanel'), $('bundlePanel'), $('importDocument'), $('add'), $('image').closest('label'), $('videoFile').closest('label'), $('audioFile').closest('label'), $('newSceneLayer'), $('key'), $('projects'), $('duplicate'), $('export'), $('delete'), $('selected'));
  navigation.replaceChildren(layerTree, group('Precompose layers', $('nest')), mediaLib);
  const stage = $('stage'); stage.dataset.dsWork = '';
  const start = make('div', 'motion-start'), startButton = make('button', 'primary', 'Add layer'); startButton.type = 'button'; startButton.setAttribute('aria-haspopup', 'dialog'); start.append(startButton); stage.append(start);
  const transport = make('div', 'motion-transport'), playback = center.querySelector('.playback'), timeLabel = $('time').closest('label'), loopLabel = $('loop').closest('label');
  const icon = (node, glyph, label) => { node.textContent = glyph; node.classList.add('motion-icon'); node.setAttribute('aria-label', label); node.title = label; };
  const svg = d => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="' + d + '" fill="currentColor"/></svg>';
  icon($('previousFrame'), '', 'Previous frame'); $('previousFrame').innerHTML = svg('M6 5h2v14H6zM19 5v14l-10-7z');
  icon($('nextFrame'), '', 'Next frame'); $('nextFrame').innerHTML = svg('M16 5h2v14h-2zM5 5v14l10-7z'); $('playbackStatus').classList.add('motion-sr');
  playback.prepend($('previousFrame')); transport.append(playback, loopLabel, $('playbackStatus'));
  [...center.querySelectorAll(':scope > h2')].find(node => node.textContent === 'Timeline')?.remove();
  center.replaceChildren(stage, transport, timeLabel);
  const settings = make('section', 'motion-comp-settings'), facts = make('dl', 'motion-facts'), draftNote = make('p', 'motion-help', 'Saved when you add the first layer.');
  const newForm = $('new'); newForm.querySelector('button').hidden = true; newForm.append(draftNote);
  settings.append(make('h2', '', 'Composition'), facts, newForm, workArea, compMotionBlur);
  const layerHead = make('div', 'motion-layer-head'), layerName = make('p', 'motion-layer-name'), layerMenu = make('button', 'motion-icon', '⋯');
  layerMenu.type = 'button'; layerMenu.setAttribute('aria-label', 'Layer actions'); layerMenu.title = 'Layer actions'; layerMenu.setAttribute('aria-haspopup', 'dialog'); layerHead.append(layerName, layerMenu);
  hold.append($('layerUp').parentElement); [...inspector.querySelectorAll(':scope > h2')].find(node => node.textContent === 'Selected layer')?.remove();
  inspector.prepend(keyEditor, settings, layerHead);
  for (const [id, label] of [['layerSettings', 'Layer organization'], ['layerTiming', 'Layer timing'], ['textPanel', 'Typography and character selection'], ['transform', 'All transform axes'], ['sceneProperties', 'Camera and light properties'], ['effectsPanel', 'Effects'], ['mask', 'Add mask'], ['maskPanel', 'Mask geometry and feather']]) {
    const element = $(id), wrapper = group(label); element.before(wrapper); wrapper.append(element);
  }
  const advanced = $('advanced').closest('details'); hold.append(advanced);
  const layerTools = make('div', 'motion-layer-tools'), moreLayer = group('More layer tools'); moreLayer.classList.add('motion-more-layer');
  for (const node of [...inspector.children]) if (node !== keyEditor && node !== settings && node !== layerHead) moreLayer.append(node);
  layerTools.append(layerHead, moreLayer); inspector.append(layerTools);
  return { keyEditor, workArea, compMotionBlur, revision, timeline, compRow, mediaLib, stage, start, startButton, icon, settings, facts, newForm, layerHead, layerName, layerMenu, advanced, layerTools };
}

function createMenuOpener({ layers, act }) {
  return (title, items, anchor) => {
    const layer = layers.create(title, 'ds-menu'), list = make('div', 'ds-menu-list'); list.setAttribute('role', 'menu');
    for (const item of items) {
      if (!item) continue;
      if (item === '-') { list.append(make('hr', 'ds-menu-sep')); continue; }
      const entry = make('button', 'ds-menu-row' + (item.danger ? ' ds-danger' : ''), item.label);
      entry.type = 'button'; entry.disabled = Boolean(item.disabled); entry.setAttribute('role', 'menuitem');
      if (item.danger) entry.dataset.dsDestructive = '';
      entry.onclick = act(async () => { await layers.close(layer.dialog); await item.run(); });
      list.append(entry);
    }
    layer.body.append(list); return layers.open(layer, { anchor });
  };
}

function wireAddMenu({ $, adapter, sheet, act, dom, stateFlags, menu }) {
  const { newForm, mediaLib, startButton } = dom;
  async function ensureProject() {
    if (adapter.state.project) return true;
    if (!adapter.state.permissions?.create) throw new Error('This seat can watch compositions but not create one.');
    await newForm.onsubmit(); stateFlags.setDraft(false); return Boolean(adapter.state.project);
  }
  async function addLayer(kind) {
    if (!await ensureProject()) return;
    const form = $('add').elements; form.kind.value = kind; form.text.value = kind === 'text' ? 'Your caption' : kind === 'shape' ? 'Shape' : 'Solid';
    await $('add').onsubmit();
  }
  for (const mediaInput of [$('image'), $('videoFile'), $('audioFile')]) {
    const uploadHandler = mediaInput.onchange;
    mediaInput.onchange = async event => { try { if (!await ensureProject()) return; } catch (error) { adapter.problem(error); mediaInput.value = ''; return; } return uploadHandler(event); };
  }
  const canAdd = () => Boolean(adapter.state.project ? adapter.state.permissions.change && !adapter.state.historical : adapter.state.permissions?.create);
  function addMenu(anchor) {
    const off = !canAdd();
    return menu('Add', [
      { label: 'Text', run: () => addLayer('text'), disabled: off },
      { label: 'Shape', run: () => addLayer('shape'), disabled: off },
      { label: 'Solid', run: () => addLayer('background'), disabled: off },
      { label: 'Photo…', run: () => $('image').click(), disabled: off },
      { label: 'Video…', run: () => $('videoFile').click(), disabled: off },
      { label: 'Audio…', run: () => $('audioFile').click(), disabled: off },
      { label: 'Camera or light…', run: async () => { if (await ensureProject()) await sheet('Camera or light', [$('newSceneLayer')]); }, disabled: off },
      $('assets').options.length > 1 ? { label: 'From your media…', run: () => sheet('Your media', [mediaLib]), disabled: !adapter.state.project } : null
    ], anchor);
  }
  startButton.onclick = act(() => addMenu(startButton));
  return { addMenu, canAdd };
}

function wireMenusAndActions(ctx) {
  const { $, adapter, layers, sheet, act, wide, root, navigation, side, assistant, getFoundation, dom, stateFlags } = ctx;
  const { advanced, docMenu, renderButton, layerMenu, row } = dom;
  const menu = createMenuOpener({ layers, act });
  const { addMenu, canAdd } = wireAddMenu({ $, adapter, sheet, act, dom, stateFlags, menu });
  const help = make('div', 'motion-help-text');
  help.append(make('p', '', 'Frames render one at a time, so playback may be slower than real time.'), make('p', '', 'Properties show each value as it is stored at the current frame, before any expression runs; an expression may change what renders.'), make('p', '', 'Renders use the saved revision you see. A render may be up to 264 MiB and five minutes long.'));
  const tool = (label, glyph, run, className = '') => {
    const button = make('button', 'motion-tool ' + className); button.type = 'button';
    button.append(make('span', 'motion-glyph', glyph), make('span', 'motion-word', label));
    button.firstChild.setAttribute('aria-hidden', 'true'); button.setAttribute('aria-label', label); button.setAttribute('aria-haspopup', 'dialog'); button.onclick = act(() => run(button)); return button;
  };
  async function openConcierge() {
    if (wide()) { if (root.dataset.editorConcierge === 'open') root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide')); else getFoundation()?.showPanel('ai'); return; }
    await sheet('Concierge', [assistant.element]); assistant.element.querySelector('textarea')?.focus({ preventScroll: true });
  }
  const tools = {
    layers: tool('Layers', '☰', () => sheet('Layers', [navigation])), add: tool('Add', '+', button => addMenu(button)),
    properties: tool('Properties', '≡', () => sheet(adapter.layer() ? adapter.layer().name : 'Composition', [side]), 'motion-phone-only'),
    concierge: tool('Concierge', '✦', () => openConcierge(), 'motion-concierge'),
    more: tool('More', '⋯', button => menu('More', [{ label: 'More editing commands…', run: () => sheet('More editing commands', [advanced]), disabled: !adapter.state.project }, { label: 'Help', run: () => sheet('Help', [], [help]) }], button))
  };
  for (const [name, button] of Object.entries(tools)) button.dataset.tool = name;
  row.append(tools.layers, tools.add, tools.properties, tools.concierge, tools.more);
  docMenu.onclick = act(() => {
    const p = adapter.state.permissions || {};
    return menu('Composition', [
      { label: 'New', run: () => { stateFlags.setDraft(true); adapter.closeProject(); stateFlags.refresh(); }, disabled: !p.create },
      { label: 'Open…', run: () => sheet('Your compositions', [], [...stateFlags.compositionRows()]), disabled: !stateFlags.saved().length },
      { label: 'Import document…', run: () => sheet('Import document', [$('importDocument'), $('bundlePanel')]), disabled: !p.create },
      { label: 'Duplicate', run: () => $('duplicate').click(), disabled: $('duplicate').disabled },
      { label: 'Export editable JSON', run: () => $('export').click(), disabled: $('export').disabled }, '-',
      { label: 'Delete composition', danger: true, run: () => $('delete').click(), disabled: $('delete').disabled }
    ], docMenu);
  });
  renderButton.onclick = act(() => sheet('Export', [$('renderPanel')]));
  layerMenu.onclick = act(() => menu('Layer', [
    { label: 'Move up', run: () => $('layerUp').click(), disabled: $('layerUp').disabled },
    { label: 'Move down', run: () => $('layerDown').click(), disabled: $('layerDown').disabled },
    { label: 'Duplicate', run: () => $('duplicateLayer').click(), disabled: $('duplicateLayer').disabled }, '-',
    { label: 'Delete layer', danger: true, run: () => $('deleteLayer').click(), disabled: $('deleteLayer').disabled }
  ], layerMenu));
  return { tools, canAdd };
}

function wireConfirmAsk(adapter, layers) {
  adapter.setAsk(message => new Promise(resolve => {
    const removing = /^Remove/.test(message), layer = layers.create(removing ? 'Remove?' : 'Delete?', 'ds-sheet ds-confirm', { onClose: () => resolve(chosen) }); let chosen = false;
    const text = make('p', '', message), rowEl = make('div', 'ds-confirm-actions'), cancel = make('button', 'ds-layer-done', 'Cancel'), yes = make('button', 'ds-danger-fill', removing ? 'Remove' : 'Delete');
    cancel.type = yes.type = 'button'; yes.dataset.dsDestructive = ''; cancel.onclick = () => void layers.close(layer.dialog); yes.onclick = () => { chosen = true; void layers.close(layer.dialog); };
    rowEl.append(cancel, yes); layer.body.append(text, rowEl); void layers.open(layer);
  }));
}

function createRefresh({ $, root, adapter, dom, home, homeList, newButton, docMenu, docName, renderButton, tools, canAdd, compositionRows, saved, getStateFlags, setShown, foundation, assistant, decorateDiamonds, syncOverlays }) {
  return function refresh() {
    const { listed, draft, shownProject } = getStateFlags();
    const s = adapter.state, project = s.project, comp = adapter.comp(), hasLayer = Boolean(comp?.layers?.length), list = !project && !draft && listed && saved().length > 0;
    if (project?.id && shownProject !== project.id) setShown(project.id);
    home.hidden = !list; root.toggleAttribute('data-motion-home', list); root.toggleAttribute('data-motion-empty', !hasLayer); root.toggleAttribute('data-motion-composition', !adapter.layer());
    if (list) homeList.replaceChildren(...compositionRows()); newButton.disabled = !s.permissions?.create;
    dom.start.hidden = hasLayer || list; dom.startButton.disabled = !canAdd(); renderButton.hidden = !hasLayer; renderButton.disabled = !s.permissions?.export || s.busy;
    docName.textContent = project?.title ?? 'Untitled composition'; docMenu.setAttribute('aria-label', 'Composition: ' + docName.textContent); docMenu.title = docName.textContent;
    dom.facts.replaceChildren(...(comp ? compFacts(comp, s.ticks).flatMap(([term, val]) => { const dd = make('dd', '', val); if (term === 'Background') { const sw = make('span', 'motion-swatch'); sw.style.background = val; sw.setAttribute('aria-hidden', 'true'); dd.prepend(sw); } return [make('dt', '', term), dd]; }) : []));
    dom.facts.hidden = !comp; dom.newForm.hidden = Boolean(project); dom.workArea.hidden = !project; dom.compMotionBlur.hidden = !project;
    dom.settings.hidden = Boolean(adapter.layer()); dom.layerTools.hidden = dom.layerHead.hidden = !adapter.layer(); dom.layerName.textContent = adapter.layer()?.name ?? ''; dom.layerMenu.disabled = !adapter.layer();
    dom.compRow.setAttribute('aria-pressed', String(!adapter.layer())); dom.compRow.hidden = !project; $('comps').closest('label').hidden = $('comps').options.length < 2;
    const shellOwns = root.querySelector('.ef-panes [aria-controls$="-concierge"]')?.hidden; tools.concierge.classList.toggle('motion-phone-only', Boolean(shellOwns));
    tools.add.disabled = !canAdd(); foundation.refresh(); assistant.refresh(); decorateDiamonds(); syncOverlays();
  };
}

/** Lay Motion Studio's native workbench out to the design standard over the shared editor. */
export async function bindMotionFoundation(adapter) {
  const { createEditorFoundation } = await import('/shared/ui/js/editor-foundation.js');
  const { plannedControl } = await import('/shared/ui/js/planned-control.js').catch(() => ({ plannedControl: null })), $ = id => document.getElementById(id);
  const root = document.body, main = document.querySelector('main'), navigation = main.querySelector('aside'), inspector = main.querySelector('aside:last-child'), center = main.querySelector('.center'), header = document.querySelector('header');
  const layers = createLayers(document), wide = () => !matchMedia('(max-width:800px)').matches, act = work => async () => { try { await work(); } catch (error) { adapter.problem(error); } };
  const sheet = (title, nodes, extra = [], options = {}) => { const layer = layers.create(title, 'ds-sheet' + (options.half ? ' ds-half' : ''), options); layer.body.append(...extra); return layers.open(layer, { nodes }); };
  const saved = () => [...$('projects').options].filter(option => option.value);
  let listed = false, draft = false, foundation = null, shownProject = null, refresh = () => {};
  wireConfirmAsk(adapter, layers);
  const dom = layoutInspectorAndStage({ $, main, navigation, inspector, center });
  dom.compRow.onclick = () => adapter.selectLayer(null);
  const selection = () => ({ kind: 'motion-layer', ids: adapter.state.project && adapter.layer() ? [String(adapter.state.comp) + ':' + String(adapter.state.layer) + ':' + String(adapter.tick())] : [] });
  const getState = () => ({ documentId: adapter.state.project?.id ?? null, revision: adapter.state.project?.revision ?? null, title: adapter.state.project?.title ?? 'Untitled composition', dirty: adapter.hasDraft(), busy: adapter.state.busy, readOnly: !adapter.state.project || !adapter.state.permissions.change || adapter.state.historical, canUndo: !$('undo').disabled, canRedo: adapter.canRedo(), status: adapter.hasDraft() ? 'Field edits pending' : 'Saved native revision', error: $('error').hidden ? null : $('error').textContent });
  const { createRegisteredEditorAssistant } = await import('/shared/ui/js/editor-assistant.js');
  const assistant = await createRegisteredEditorAssistant({ app: 'motion-studio', bot: 'motion-editor', title: 'Motion Studio AI partner', root, getState: () => { const val = getState(); return { ...val, dirty: val.dirty || foundation?.hasPending() }; }, getSelection: selection });
  for (const node of header.querySelectorAll('[data-ef-phone="more"]')) node.removeAttribute('data-ef-phone');
  const docMenu = make('button', 'motion-doc'), docName = make('span', 'motion-doc-name', 'Untitled composition'), renderButton = make('button', 'primary motion-render', 'Render'), row = make('nav', 'motion-toolrow');
  docMenu.type = renderButton.type = 'button'; docMenu.append(docName, make('span', 'motion-caret', '▾')); docMenu.setAttribute('aria-haspopup', 'dialog'); renderButton.setAttribute('aria-haspopup', 'dialog');
  dom.icon($('undo'), '↶', 'Undo'); dom.icon($('redo'), '↷', 'Redo'); $('status').classList.add('motion-saved'); dom.revision.classList.add('motion-sr');
  row.dataset.dsToolrow = ''; row.setAttribute('aria-label', 'Motion tools');
  header.replaceChildren(header.querySelector('h1'), docMenu, $('undo'), $('redo'), row, $('status'), dom.revision, renderButton);
  foundation = createEditorFoundation({
    root, navigationLabel: 'Layers', ai: assistant.element, header, navigation, viewport: center, inspector, timeline: dom.timeline,
    getState, getSelection: selection, getProperties: () => motionProperties(adapter),
    applyProperty: async (key, value, context) => { if (context.documentId !== adapter.state.project?.id || context.revision !== adapter.state.project.revision || JSON.stringify(context.selection) !== JSON.stringify(selection())) throw new Error('The composition, layer or time changed. Select it again.'); await applyMotionProperty(adapter, key, value); },
    actions: { undo: () => $('undo').click(), redo: () => $('redo').click(), export: () => $('export').click() }
  });
  main.hidden = true; root.classList.add('motion-foundation');
  const side = root.querySelector('.ef-inspector'); side.querySelector('.ef-properties').before(dom.keyEditor, dom.layerHead);
  root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));
  if (plannedControl) { const prompts = make('div', 'motion-prompts'); prompts.append(plannedControl(document, { backlog: 'RP-ALL-01', label: 'Summarize', className: 'motion-chip' })); assistant.element.querySelector('.ef-assistant-composer')?.before(prompts); }
  const home = make('section', 'motion-home'), homeList = make('div', 'motion-home-list'), newButton = make('button', 'primary motion-new', '+ New');
  newButton.type = 'button'; newButton.dataset.efFloating = ''; home.setAttribute('aria-label', 'Your compositions'); home.append(make('h2', '', 'Your compositions'), homeList, newButton); home.hidden = true; root.querySelector('.ef-viewport').prepend(home);
  const openSaved = async id => { draft = false; $('projects').value = id; $('projects').dispatchEvent(new Event('change')); };
  const compositionRows = () => saved().map(option => { const entry = make('button', 'motion-home-row'); entry.type = 'button'; entry.append(make('span', 'motion-home-title', option.textContent)); entry.onclick = act(() => openSaved(option.value)); return entry; });
  newButton.onclick = () => { draft = true; adapter.closeProject(); refresh(); };
  const { tools, canAdd } = wireMenusAndActions({ $, adapter, layers, sheet, act, wide, root, navigation, side, assistant, getFoundation: () => foundation, dom: { ...dom, docMenu, renderButton, row }, stateFlags: { saved, compositionRows, setDraft: v => { draft = v; }, refresh: () => refresh() } });
  const decorateDiamonds = setupKeyframeDiamonds({ $, root, adapter, act });
  const { syncOverlays } = setupStageOverlays({ $, adapter, stage: dom.stage, wide, getFoundation: () => foundation });
  refresh = createRefresh({ $, root, adapter, dom, home, homeList, newButton, docMenu, docName, renderButton, tools, canAdd, compositionRows, saved, getStateFlags: () => ({ listed, draft, shownProject }), setShown: id => { shownProject = id; draft = false; }, foundation, assistant, decorateDiamonds, syncOverlays });
  new MutationObserver(() => { listed = true; refresh(); }).observe($('projects'), { childList: true });
  return { ...foundation, destroy: () => { assistant.destroy(); foundation.destroy(); }, refresh, layers };
}
