/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded declarative agent edits use the editor's immutable validator, locks and geometry, never code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Describe nested group duplication and deterministic remapped descendant identifiers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Describe bounded PSD inspection/import/source tools and distinguish editable subset from PSD export/full fidelity.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Support the shared automatic document save/read/refresh handoff and preserve concurrent drafts and editable layers.
 */
import { applyOperation, createProject, validateProject } from './model.mjs';
import { combinePaths } from './vector-geometry.mjs';
const forms = {
  add: ['layer', 'index', 'images'], update: ['id', 'patch'], remove: ['id'], reorder: ['id', 'index'],
  duplicate: ['id', 'newId', 'offset'], group: ['ids', 'id'], ungroup: ['id'], arrange: ['ids', 'mode'],
  project: ['patch'], boolean: ['ids', 'mode'], mask: ['id', 'mask'], clearMask: ['id'],
};
export const operationSchema = { type: 'object', additionalProperties: false, required: ['type'], properties: {
  type: { type: 'string', enum: Object.keys(forms) }, id: { type: 'string', maxLength: 100 },
  ids: { type: 'array', minItems: 2, maxItems: 200, items: { type: 'string', maxLength: 100 } },
  layer: { type: 'object' }, patch: { type: 'object' }, images: { type: 'object' }, mask: { type: 'object' },
  index: { type: 'integer', minimum: 0, maximum: 200 },
  newId: { type: 'string', maxLength: 100 }, offset: { type: 'number', minimum: -32768, maximum: 32768 },
  mode: { type: 'string', enum: ['left','center','right','top','middle','bottom','distribute-x','distribute-y','union','difference','intersection','xor'] },
} };
export function blankProject(input) { return createProject({ name: input.title, width: input.width ?? 1200, height: input.height ?? 800, background: input.background ?? 'transparent' }); }
export function applyAgentOperations(value, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 16 || JSON.stringify(operations).length > 15000) throw new TypeError('Use 1–16 bounded editing operations');
  let next = validateProject(value, { assetMode: 'reference' }), booleans = 0;
  for (const operation of operations) {
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
  return { editor: 'create', version: 1, sourceVersion: '1.15.2', maxOperations: 16, maxInputBytes: 16384,
    operations: forms, operationSchema,
    conventions: { coordinates: 'Canvas pixels; children use parent-local coordinates; path node x/y normalized 0..1, in/out offsets relative to node.',
      opacity: '0..1', masks: 'Original image source pixels; polygon points or additive/subtractive brush operations; feather 0..64.',
      adjustments: 'Add a layer type adjustment with scope stack or layer/targetId. exposure -8..8, black < white 0..255, gamma .1..10, saturation 0..300, curve ordered {x,y} 0..1.',
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
    ], psd: { profileVersion:1, inspectTool:'create-inspect-psd', importTool:'create-import-psd', sourceTool:'create-psd-source',
      maxBytes:4194304, dimensions:2048, pixelLayers:32, groupDepth:4,
      supported:'RGB8 PSDv1 raw/RLE pixel layers, normal isolated groups, opacity and placement. Preserve immutable original; inspect losses and explicit mode before held import.',
      unsupported:'Other blends/pass-through, masks, text/effects/smart objects/adjustments refuse editable conversion. Flattened opaque merged cache only by explicit choice; no PSD export/full fidelity.', },
    unsupported: ['Motion/compositing','RAW development','Page publishing','Audio workstation','PDF workbench','PSD export/full fidelity'] };
}
