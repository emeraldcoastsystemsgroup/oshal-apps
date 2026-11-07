/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded declarative agent edits use the editor's immutable validator, locks and geometry, never code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Describe nested group duplication and deterministic remapped descendant identifiers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Describe bounded PSD inspection/import/source tools and distinguish editable subset from PSD export/full fidelity.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Support the shared automatic document save/read/refresh handoff and preserve concurrent drafts and editable layers.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.15.3: a colour named in words ("a white background", "red fins") becomes the hex the editor stores, at the agent boundary only; Jarvis's "white" background refused every new project.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.16.0: a person approved this batch, so a small slip no longer refuses it after the fact: a new layer keeps only the fields its type has, and a colour that is not a color falls to the layer's default. The saved document is still the editor's own.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.15.4: batches the local model drew failed only at the approved run (a one-node window, a flame at y=1.1, type "shape"), when it could no longer correct them. The operation schema now states layer types and path bounds, so the kernel refuses them before a card is held and the model corrects its call; the contract carries a worked drawing.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.19.2: align editingContract sourceVersion with the manifest version.
 */
import { applyOperation, createProject, validateProject } from './model.mjs';
import { COMMON, FIELDS } from './model-validation.mjs';
import { combinePaths } from './vector-geometry.mjs';
const forms = {
  add: ['layer', 'index', 'images'], update: ['id', 'patch'], remove: ['id'], reorder: ['id', 'index'],
  duplicate: ['id', 'newId', 'offset'], group: ['ids', 'id'], ungroup: ['id'], arrange: ['ids', 'mode'],
  project: ['patch'], boolean: ['ids', 'mode'], mask: ['id', 'mask'], clearMask: ['id'],
};
const unitNumber = { type: 'number', minimum: 0, maximum: 1 };
// The rules a concierge's drawing breaks most, stated where the kernel checks them before it holds a card.
const layerSchema = { type: 'object', required: ['id', 'type'], properties: {
  id: { type: 'string', minLength: 1, maxLength: 100 },
  type: { type: 'string', enum: ['image', 'text', 'rect', 'ellipse', 'freehand', 'adjustment', 'group', 'path'] },
  contours: { type: 'array', minItems: 1, maxItems: 128, items: { type: 'object', required: ['nodes'], properties: {
    closed: { type: 'boolean' },
    nodes: { type: 'array', minItems: 2, maxItems: 2000, items: { type: 'object', required: ['x', 'y'], properties: { x: unitNumber, y: unitNumber } } },
  } } },
} };
export const operationSchema = { type: 'object', additionalProperties: false, required: ['type'], properties: {
  type: { type: 'string', enum: Object.keys(forms) }, id: { type: 'string', maxLength: 100 },
  ids: { type: 'array', minItems: 2, maxItems: 200, items: { type: 'string', maxLength: 100 } },
  layer: layerSchema, patch: { type: 'object' }, images: { type: 'object' }, mask: { type: 'object' },
  index: { type: 'integer', minimum: 0, maximum: 200 },
  newId: { type: 'string', maxLength: 100 }, offset: { type: 'number', minimum: -32768, maximum: 32768 },
  mode: { type: 'string', enum: ['left','center','right','top','middle','bottom','distribute-x','distribute-y','union','difference','intersection','xor'] },
} };
// A concierge writes colours the way a person says them. Only these names, and only under a colour field, become hex;
// anything else reaches the validator unchanged, so the stored document format is the editor's own.
const NAMED_COLORS = Object.freeze({ white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a', gray: '#808080', grey: '#808080', silver: '#c0c0c0', gold: '#ffd700',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkred: '#8b0000', darkblue: '#00008b', lightblue: '#add8e6', darkgreen: '#006400', orangered: '#ff4500',
  navy: '#000080', teal: '#008080', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', lime: '#00ff00', maroon: '#800000',
  olive: '#808000', beige: '#f5f5dc', tan: '#d2b48c', indigo: '#4b0082', violet: '#ee82ee', crimson: '#dc143c', coral: '#ff7f50', skyblue: '#87ceeb' });
const COLOR_FIELDS = new Set(['background', 'fill', 'stroke', 'color']);
const REAL_COLOR = /^(?:transparent|#[a-f0-9]{3,4}|#[a-f0-9]{6}|#[a-f0-9]{8})$/i;
/** A new layer as the validator takes it: the fields its type has, and no color it cannot read. An unknown type is still refused. */
function agentLayer(layer) {
  const fields = layer && FIELDS[layer.type];
  if (!fields) return layer;
  const allowed = new Set([...COMMON, ...fields]);
  return Object.fromEntries(Object.entries(layer).filter(([key, value]) => allowed.has(key) && !(COLOR_FIELDS.has(key) && !REAL_COLOR.test(String(value)))));
}
function namedColors(value, field) {
  if (typeof value === 'string') return COLOR_FIELDS.has(field) ? NAMED_COLORS[value.trim().toLowerCase().replace(/[\s-]+/g, '')] ?? value : value;
  if (Array.isArray(value)) return value.map(item => namedColors(item));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, namedColors(item, key)]));
  }
  return value;
}
export function blankProject(input) { return createProject({ name: input.title, width: input.width ?? 1200, height: input.height ?? 800, background: namedColors(input.background, 'background') ?? 'transparent' }); }
export function applyAgentOperations(value, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 16 || JSON.stringify(operations).length > 15000) throw new TypeError('Use 1–16 bounded editing operations');
  let next = validateProject(value, { assetMode: 'reference' }), booleans = 0;
  for (const named of namedColors(operations)) {
    const operation = named?.type === 'add' ? { ...named, layer: agentLayer(named.layer) } : named;
    const allowed = forms[operation?.type];
    if (!allowed || Object.keys(operation).some(key => key !== 'type' && !allowed.includes(key))) throw new TypeError('Unsupported editing fields');
    if (operation.type === 'boolean') {
      if (++booleans > 1 || !Array.isArray(operation.ids) || operation.ids.length !== 2) throw new TypeError('Use one two-path boolean per batch');
      const operands = operation.ids.map(id => next.layers.find(layer => layer.id === id));
      if (operands.some(layer => !layer || layer.type !== 'path') || operands.reduce((sum,layer) => sum + layer.contours.reduce((n,c) => n+c.nodes.length,0),0) > 256) throw new TypeError('Use the editor worker for larger booleans');
      next = applyOperation(next, { type: 'booleanResult', ids: operation.ids, result: combinePaths(next, operation.ids, operation.mode) });
    }
    else if (operation.type === 'mask' || operation.type === 'clearMask') next = applyOperation(next, { type: 'update', id: operation.id, patch: { mask: operation.type === 'mask' ? operation.mask : null } });
    else next = applyOperation(next, operation);
  }
  return validateProject(next, { assetMode: 'reference' });
}
export function editingContract() {
  return { editor: 'create', version: 1, sourceVersion: '1.19.2', maxOperations: 16, maxInputBytes: 16384,
    operations: forms, operationSchema,
    conventions: { drawing: 'Compose a requested picture yourself from rect, ellipse, text and path layers; no asset is needed. A rect, ellipse or text layer has id, type, x, y, w, h in canvas pixels. A path layer also has contours; each contour has at least 2 nodes, each node x and y between 0 and 1 of the layer box. Layer type is exactly one of image, text, rect, ellipse, freehand, adjustment, group, path.',
      coordinates: 'Canvas pixels; children use parent-local coordinates; path node x/y normalized 0..1, in/out offsets relative to node.',
      opacity: '0..1', masks: 'Original image source pixels; polygon points or additive/subtractive brush operations; feather 0..64.',
      adjustments: 'Add a layer type adjustment with scope stack or layer/targetId. exposure -8..8, black < white 0..255, gamma .1..10, saturation 0..300, curve ordered {x,y} 0..1.',
      appearance: 'Version 4 shape primitives (rect/ellipse layer types) accept shape rectangle|rounded-rectangle|ellipse|triangle|diamond and radius 0..4096. Outlines on primitives/freehand/path accept dash (up to16 lengths .1..512), cap butt|round|square, join miter|round|bevel. Every paint layer/group supports shadow null or {color six-digit hex, opacity0..1, blur0..64, offsetX/offsetY -512..512}; parent-coordinate pixels, source alpha preserved. Shadows have an aggregate bounded scratch pixel budget. Group shadows must be removed before ungrouping; transformed child paint scales with the group.',
      vectors: 'Add/update path contours [{closed,nodes:[{x,y,in:{x,y},out:{x,y}}]}], fill, stroke, strokeWidth, dash, cap, join, gradient {from,to,stops:[{offset,color}]}, clip polygon.',
      assets: 'Only original-owner canonical uploaded image references. No URL fetching, filesystem paths, code, provider calls or inline data.',
      saves: 'Read project id/revision first. One batch = one immutable revision; invalid batch saves nothing. A stale revision is a conflict. The editor automatically saves its current draft before the concierge reads it and refreshes the same project on return. A concurrent browser draft is preserved with a conflict message.',
      locks: 'Locked layers/ancestors are refused. Explicit unlocking is an edit, never silently unlock.',
      duplicate: 'Duplicate supports nested groups. Supply newId for the copied root; descendants receive deterministic newId-prefix:base36-index IDs (prefix at most96 characters), in existing layer order. Read the returned document for IDs. Child coordinates, masks, isolated opacity and owned image references stay unchanged; clipped targets inside the copy are remapped. Only the copied root receives offset. Locked descendants, ID collisions or existing resource ceilings refuse the whole operation.',
      booleans: 'One boolean per batch; at most256 total operand nodes. Larger paths use the browser worker. Two visible unlocked root paths, closed unclipped contours. 0.1 pixel flattening; originals hidden and retained. Mixed-winding nonzero contours refused.',
      exports: 'Document export is editable JSON only. PNG/JPEG and bounded SVG export remain editor controls; agents must not claim a raster render.', },
    examples: [
      { type: 'add', layer: { id: 'heading', type: 'text', text: 'Hello', x: 40, y: 40, w: 300, h: 80 } },
      { type: 'update', id: 'heading', patch: { text: 'Updated heading', opacity: .8 } },
      { type: 'add', layer: { id: 'exposure', type: 'adjustment', scope: 'stack', exposure: .5 } },
      { type: 'mask', id: 'photo-layer', mask: { points: [{x:0,y:0},{x:100,y:0},{x:100,y:100}], feather: 4 } },
      { type: 'group', ids: ['heading', 'photo-layer'], id: 'composition' },
      { type: 'boolean', ids: ['path-a','path-b'], mode: 'union' },
      { type: 'add', layer: { id: 'hull', type: 'rect', name: 'Hull', x: 340, y: 200, w: 120, h: 400, fill: '#e63946', stroke: '#1b2a4a', strokeWidth: 6 } },
      { type: 'add', layer: { id: 'window', type: 'ellipse', name: 'Window', x: 370, y: 280, w: 60, h: 60, fill: '#87ceeb', stroke: '#1b2a4a', strokeWidth: 4 } },
      { type: 'add', layer: { id: 'flame', type: 'path', name: 'Flame', x: 350, y: 600, w: 100, h: 140, fill: '#ff8c00', contours: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] }] } },
    ], psd: { profileVersion:1, inspectTool:'create-inspect-psd', importTool:'create-import-psd', sourceTool:'create-psd-source',
      maxBytes:4194304, dimensions:2048, pixelLayers:32, groupDepth:4,
      supported:'RGB8 PSDv1 raw/RLE pixel layers, normal isolated groups, opacity and placement. Preserve immutable original; inspect losses and explicit mode before held import.',
      unsupported:'Other blends/pass-through, masks, text/effects/smart objects/adjustments refuse editable conversion. Flattened opaque merged cache only by explicit choice; no PSD export/full fidelity.', },
    unsupported: ['Motion/compositing','RAW development','Page publishing','Audio workstation','PDF workbench','PSD export/full fidelity'] };
}
