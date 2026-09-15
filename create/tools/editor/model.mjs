/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Apply explicit immutable layer operations and retain editable project JSON across saves.
 */
import { demand, identifier, objectKeys, LIMITS, validateProject } from './model-validation.mjs';
export { LIMITS, validateProject } from './model-validation.mjs';

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
  if (layer.locked) demand(Object.keys(operation.patch).every(key => ['locked', 'visible', 'name'].includes(key)), 'Unlock this layer before editing it');
  project.layers[index] = { ...layer, ...operation.patch };
}

function remove(project, operation) {
  objectKeys(operation, ['type', 'id'], 'Remove operation');
  const index = layerIndex(project, operation.id); editable(project.layers[index]); project.layers.splice(index, 1);
}

function reorder(project, operation) {
  objectKeys(operation, ['type', 'id', 'index'], 'Reorder operation');
  const index = layerIndex(project, operation.id), target = indexIn(operation.index, project.layers.length - 1);
  editable(project.layers[index]); const [layer] = project.layers.splice(index, 1); project.layers.splice(target, 0, layer);
}

function duplicate(project, operation) {
  objectKeys(operation, ['type', 'id', 'newId', 'offset'], 'Duplicate operation');
  const index = layerIndex(project, operation.id), layer = project.layers[index]; editable(layer);
  const id = identifier(operation.newId ?? newId()), offset = operation.offset ?? 20;
  demand(typeof offset === 'number' && Number.isFinite(offset) && Math.abs(offset) <= 32768, 'Duplicate offset is out of range');
  demand(!project.layers.some(item => item.id === id), 'Layer IDs must be unique');
  project.layers.splice(index + 1, 0, { ...layer, id, name: `${layer.name.slice(0, 114)} copy`, x: layer.x + offset, y: layer.y + offset });
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
  const next = validateProject(project), handlers = { add, update, remove, reorder, duplicate, project: changeProject };
  demand(operation && Object.hasOwn(handlers, operation.type), 'Unsupported project operation');
  handlers[operation.type](next, operation); return validateProject(next);
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
