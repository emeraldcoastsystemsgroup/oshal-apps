/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Apply explicit immutable layer operations and retain editable project JSON across saves.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Publish the image filter bounds and a small set of named filter looks; each look sets all four filters so choosing one replaces the previous look instead of stacking on it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Upgrade mask edits to version 2 without rewriting unmasked v1 documents.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Integrate version 3 brush and arithmetic masks plus editable stack/clipped color adjustments with existing project history.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Duplicate isolated nested groups with independent IDs, clipped targets and unchanged owned source assets.
 */
import { demand, identifier, objectKeys, LIMITS, validateProject } from './model-validation.mjs';
import { parentGroup, throughGroup, groupFrame, worldLayer } from './group-geometry.mjs';
export { LIMITS, IMAGE_FILTERS, validateProject } from './model-validation.mjs';

const look = (label, saturation, grayscale, sepia, blur) => Object.freeze({ label, patch: Object.freeze({ saturation, grayscale, sepia, blur }) });

/** @description Named image filter looks offered by the properties panel; every patch is a valid image-layer update.
 * @returns {object} Immutable look ID to { label, patch } map. */
export const IMAGE_FILTER_LOOKS = Object.freeze({
  none: look('None', 100, 0, 0, 0),
  mono: look('Black and white', 100, 100, 0, 0),
  vintage: look('Vintage', 80, 0, 70, 0),
  vivid: look('Vivid', 170, 0, 0, 0),
  muted: look('Muted', 50, 0, 0, 0),
  soft: look('Soft focus', 100, 0, 0, 2),
});

function newId() { return globalThis.crypto?.randomUUID?.() ?? `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }

/** @description Create a bounded empty canvas without persisting identity or ownership.
 * @param {object} options Canvas size, name and background.
 * @returns {object} Normalized v1 project. */
export function createProject(options = {}) {
  objectKeys(options, ['width', 'height', 'name', 'background'], 'New project');
  return validateProject({ version: 1, width: 1200, height: 800, background: 'transparent', ...options, layers: [], images: {} });
}

function layerIndex(project, id) {
  identifier(id); const index = project.layers.findIndex(layer => layer.id === id);
  demand(index >= 0, 'Layer does not exist'); return index;
}

function editable(layer) { demand(!layer.locked, 'Unlock this layer before editing it'); }

function indexIn(value, maximum) { demand(Number.isInteger(value) && value >= 0 && value <= maximum, 'Layer order is out of range'); return value; }

function add(project, operation) {
  objectKeys(operation, ['type', 'layer', 'index', 'images'], 'Add operation');
  demand(operation.layer && typeof operation.layer === 'object', 'Add a layer object');
  const id = operation.layer.id ?? newId(); identifier(id);
  demand(!project.layers.some(layer => layer.id === id), 'Layer IDs must be unique');
  if (operation.images) {
    objectKeys(operation.images, Object.keys(operation.images), 'New image assets');
    for (const [key, value] of Object.entries(operation.images)) {
      identifier(key); demand(!Object.hasOwn(project.images, key), 'Image asset IDs must be unique'); project.images[key] = value;
    }
  }
  project.layers.splice(indexIn(operation.index ?? project.layers.length, project.layers.length), 0, { ...operation.layer, id });
}

function update(project, operation) {
  objectKeys(operation, ['type', 'id', 'patch'], 'Update operation');
  objectKeys(operation.patch, Object.keys(operation.patch ?? {}), 'Layer patch');
  demand(!Object.hasOwn(operation.patch, 'id') && !Object.hasOwn(operation.patch, 'type'), 'Layer ID and type are immutable');
  const index = layerIndex(project, operation.id), layer = project.layers[index];
  const parent = parentGroup(project, layer.id); if (parent) editable(worldLayer(project, parent));
  if (layer.locked) demand(Object.keys(operation.patch).every(key => ['locked', 'visible', 'name'].includes(key)), 'Unlock this layer before editing it');
  project.layers[index] = { ...layer, ...operation.patch };
}

function remove(project, operation) {
  objectKeys(operation, ['type', 'id'], 'Remove operation');
  const index = layerIndex(project, operation.id), layer = project.layers[index]; editable(worldLayer(project, layer));
  const removed = new Set([layer.id]);
  for (let pass = 0; pass < 5; pass++) for (const item of project.layers) {
    if (removed.has(item.id) && item.type === 'group') for (const child of item.children) removed.add(child);
    if (item.type === 'adjustment' && removed.has(item.targetId)) removed.add(item.id);
  }
  project.layers = project.layers.filter(item => !removed.has(item.id));
  for (let pass = 0; pass < 4; pass++) {
    for (const group of project.layers.filter(item => item.type === 'group')) group.children = group.children.filter(id => !removed.has(id));
    for (const group of project.layers.filter(item => item.type === 'group' && !item.children.length)) removed.add(group.id);
    project.layers = project.layers.filter(item => !removed.has(item.id));
  }
}

function reorder(project, operation) {
  objectKeys(operation, ['type', 'id', 'index'], 'Reorder operation');
  const index = layerIndex(project, operation.id), target = indexIn(operation.index, project.layers.length - 1);
  editable(worldLayer(project, project.layers[index]));
  const parent = parentGroup(project, operation.id);
  if (parent) {
    const sibling = project.layers[target]; demand(parent.children.includes(sibling.id), 'Reorder within the group or ungroup first');
    const previous = parent.children.indexOf(operation.id), destination = parent.children.indexOf(sibling.id);
    parent.children.splice(previous, 1); parent.children.splice(destination, 0, operation.id);
  }
  const [layer] = project.layers.splice(index, 1); project.layers.splice(target, 0, layer);
}

function duplicate(project, operation) {
  objectKeys(operation, ['type', 'id', 'newId', 'offset'], 'Duplicate operation');
  const index = layerIndex(project, operation.id), layer = project.layers[index]; editable(worldLayer(project, layer));
  const id = identifier(operation.newId ?? newId()), offset = operation.offset ?? 20;
  demand(typeof offset === 'number' && Number.isFinite(offset) && Math.abs(offset) <= 32768, 'Duplicate offset is out of range');
  demand(!project.layers.some(item => item.id === id), 'Layer IDs must be unique');
  if (layer.type === 'group') {
    const members = new Set([layer.id]);
    const include = group => {
      for (const childId of group.children) {
        members.add(childId);
        const child = project.layers[layerIndex(project, childId)];
        if (child.type === 'group') include(child);
      }
    };
    include(layer);
    const sources = project.layers.filter(item => members.has(item.id));
    demand(project.layers.length + sources.length <= LIMITS.layers, 'Too many layers');
    const ids = new Map([[layer.id, id]]), taken = new Set(project.layers.map(item => item.id));
    taken.add(id);
    let serial = 0;
    for (const source of sources) {
      editable(worldLayer(project, source));
      if (source.id === layer.id) continue;
      const childId = identifier(`${id.slice(0, 96)}:${(++serial).toString(36)}`);
      demand(!taken.has(childId), 'Layer IDs must be unique');
      taken.add(childId); ids.set(source.id, childId);
    }
    const copies = sources.map(source => {
      const copy = structuredClone(source); copy.id = ids.get(source.id);
      if (copy.type === 'group') copy.children = copy.children.map(child => ids.get(child));
      if (copy.type === 'adjustment' && copy.scope === 'layer') copy.targetId = ids.get(copy.targetId);
      if (copy.sourceIds) copy.sourceIds = copy.sourceIds.map(sourceId => ids.get(sourceId) ?? sourceId);
      if (source.id === layer.id) {
        copy.name = `${layer.name.slice(0, 114)} copy`; copy.x += offset; copy.y += offset;
      }
      return copy;
    });
    const parent = parentGroup(project, layer.id);
    if (parent) parent.children.splice(parent.children.indexOf(layer.id) + 1, 0, id);
    project.layers.splice(index + 1, 0, ...copies);
    return;
  }
  const parent = parentGroup(project, layer.id); if (parent) parent.children.splice(parent.children.indexOf(layer.id) + 1, 0, id);
  project.layers.splice(index + 1, 0, { ...layer, id, name: `${layer.name.slice(0, 114)} copy`, x: layer.x + offset, y: layer.y + offset });
}

function group(project, operation) {
  objectKeys(operation, ['type', 'ids', 'id'], 'Group operation');
  demand(Array.isArray(operation.ids) && operation.ids.length >= 2, 'Choose at least two sibling layers');
  const ids = operation.ids.map(identifier), selected = ids.map(id => project.layers[layerIndex(project, id)]);
  for (const layer of selected) editable(worldLayer(project, layer));
  const parent = parentGroup(project, ids[0]);
  demand(selected.every(layer => parentGroup(project, layer.id)?.id === parent?.id), 'Group layers from the same parent');
  const siblings = parent ? parent.children : project.layers.filter(layer => !parentGroup(project, layer.id)).map(layer => layer.id);
  const positions = ids.map(id => siblings.indexOf(id)), first = Math.min(...positions), last = Math.max(...positions);
  const children = siblings.slice(first, last + 1), members = children.map(id => project.layers[layerIndex(project, id)]);
  for (const layer of members) editable(worldLayer(project, layer));
  const id = identifier(operation.id ?? newId()); demand(!project.layers.some(layer => layer.id === id), 'Layer IDs must be unique');
  const frame = groupFrame(members);
  for (const layer of members) { layer.x -= frame.x; layer.y -= frame.y; }
  const next = { id, type: 'group', name: 'Group', ...frame, baseWidth: frame.w, baseHeight: frame.h, children };
  const index = Math.max(...children.map(child => layerIndex(project, child)));
  project.layers.splice(index + 1, 0, next);
  if (parent) parent.children.splice(first, last - first + 1, id);
}

function ungroup(project, operation) {
  objectKeys(operation, ['type', 'id'], 'Ungroup operation');
  const index = layerIndex(project, operation.id), group = project.layers[index];
  demand(group.type === 'group', 'Select a group'); editable(worldLayer(project, group));
  demand(group.opacity === 1, 'Set group opacity to 1 before ungrouping to preserve isolated blending');
  const parent = parentGroup(project, group.id);
  for (const id of group.children) {
    const childIndex = layerIndex(project, id), layer = project.layers[childIndex]; editable(layer);
    project.layers[childIndex] = { ...throughGroup(layer, group), visible: layer.visible && group.visible };
  }
  if (parent) parent.children.splice(parent.children.indexOf(group.id), 1, ...group.children);
  project.layers.splice(layerIndex(project, group.id), 1);
}

function arrange(project, operation) {
  objectKeys(operation, ['type', 'ids', 'mode'], 'Arrange operation');
  demand(Array.isArray(operation.ids) && operation.ids.length >= 2 && new Set(operation.ids).size === operation.ids.length, 'Choose at least two different layers');
  const layers = operation.ids.map(id => project.layers[layerIndex(project, id)]);
  demand(layers.every(layer => layer.type !== 'adjustment' && !parentGroup(project, layer.id)), 'Arrange root paint layers or ungroup first');
  for (const layer of layers) editable(layer);
  const modes = ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-x', 'distribute-y'];
  demand(modes.includes(operation.mode), 'Unsupported arrangement');
  const bounds = layers.map(layer => ({ layer, frame: groupFrame([layer]) })), total = groupFrame(layers);
  const axis = ['left', 'center', 'right', 'distribute-x'].includes(operation.mode) ? 'x' : 'y', dimension = axis === 'x' ? 'w' : 'h';
  if (operation.mode.startsWith('distribute')) {
    demand(layers.length >= 3, 'Distribution needs at least three layers');
    bounds.sort((a, b) => a.frame[axis] + a.frame[dimension] / 2 - b.frame[axis] - b.frame[dimension] / 2);
    const first = bounds[0].frame[axis] + bounds[0].frame[dimension] / 2, last = bounds.at(-1).frame[axis] + bounds.at(-1).frame[dimension] / 2;
    bounds.forEach((item, index) => { item.layer[axis] += first + (last - first) * index / (bounds.length - 1) - item.frame[axis] - item.frame[dimension] / 2; }); return;
  }
  const factor = ['center', 'middle'].includes(operation.mode) ? .5 : ['right', 'bottom'].includes(operation.mode) ? 1 : 0;
  for (const item of bounds) item.layer[axis] += total[axis] + total[dimension] * factor - item.frame[axis] - item.frame[dimension] * factor;
}

function booleanResult(project, operation) {
  objectKeys(operation, ['type', 'ids', 'result'], 'Boolean result');
  demand(Array.isArray(operation.ids) && operation.ids.length === 2 && new Set(operation.ids).size === 2, 'Choose two different paths');
  for (const id of operation.ids) {
    const layer = project.layers[layerIndex(project, id)]; editable(worldLayer(project, layer));
    demand(layer.type === 'path' && !parentGroup(project, id), 'Combine root paths or ungroup them first');
    layer.visible = false;
  }
  demand(operation.result?.type === 'path', 'Boolean result must be an editable path');
  add(project, { type: 'add', layer: { ...operation.result, sourceIds: operation.ids } });
}

function changeProject(project, operation) {
  objectKeys(operation, ['type', 'patch'], 'Canvas operation');
  objectKeys(operation.patch, ['name', 'width', 'height', 'background'], 'Canvas patch'); Object.assign(project, operation.patch);
}

/** @description Apply one deliberate edit to a new snapshot; rejected edits never mutate the input.
 * @param {object} project Existing v1 document.
 * @param {object} operation Add, update, remove, reorder, duplicate or project edit.
 * @returns {object} Normalized edited project. */
export function applyOperation(project, operation) {
  const next = validateProject(project), handlers = { add, update, remove, reorder, duplicate, group, ungroup, booleanResult, arrange, project: changeProject };
  demand(operation && Object.hasOwn(handlers, operation.type), 'Unsupported project operation');
  handlers[operation.type](next, operation);
  if (next.layers.some(layer => layer.mask != null)) next.version = Math.max(next.version, 2);
  if (next.layers.some(layer => layer.mask?.operations?.length || ['adjustment', 'group', 'path'].includes(layer.type))) next.version = 3;
  return validateProject(next);
}

/** @description Save layered JSON with its asset mapping; reference mode is suitable for API persistence.
 * @param {object} project Editable project.
 * @param {object} options Validation options; assetMode reference forbids embedded data.
 * @returns {string} Normalized portable JSON, never a flattened image. */
export function serializeProject(project, options = {}) { return JSON.stringify(validateProject(project, options)); }

/** @description Reject oversized or unsupported files before admitting a portable project.
 * @param {string} source JSON project contents.
 * @param {object} options Validation options.
 * @returns {object} Normalized independent project. */
export function parseProject(source, options = {}) {
  const maximum = options.assetMode === 'reference' ? LIMITS.referenceBytes : LIMITS.portableBytes;
  demand(typeof source === 'string' && new TextEncoder().encode(source).length <= maximum, 'Project file is too large');
  return validateProject(JSON.parse(source), options);
}
