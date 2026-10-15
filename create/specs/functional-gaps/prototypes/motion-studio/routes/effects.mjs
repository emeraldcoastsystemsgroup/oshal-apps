/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Query the actual pinned native effect registry without customer data or saved edits; publish complete bounded index/schema observations.
 */
import { createHash } from 'node:crypto';
import { motionEngine } from './engine-client.mjs';
import { MotionError } from './project-store.mjs';
import { stringifyNative } from '../tools/native-json.mjs';
const observation = value => {
  if (Buffer.byteLength(stringifyNative(value)) > 60 * 1024) throw new MotionError(413, 'motion_agent_observation_limit');
  return value;
};
export async function effectRegistry(ctx) {
  const blank = await motionEngine(ctx, { op: 'create' });
  const result = await motionEngine(ctx, { op: 'edit', document: blank.document, commands: [{ command: 'effect.list', params: {} }] });
  const effects = result.results?.[0];
  if (!Array.isArray(effects) || !effects.every(effect => typeof effect.id === 'string' && typeof effect.name === 'string' && Array.isArray(effect.params))) throw new MotionError(503, 'motion_effect_catalog_invalid');
  return { upstream: result.upstream, renderer: 'cpu', effects,
    stamp: createHash('sha256').update(stringifyNative(effects)).digest('hex') };
}
export async function effectIndex(ctx, stamp, offset) {
  if (typeof stamp !== 'string' || stamp !== 'start' && !/^[0-9a-f]{64}$/.test(stamp) || !/^(0|[1-9][0-9]{0,5})$/.test(offset)) throw new MotionError(400, 'motion_invalid_effect_page');
  const registry = await effectRegistry(ctx), start = Number(offset);
  if (stamp !== 'start' && stamp !== registry.stamp) throw new MotionError(409, 'motion_effect_catalog_changed');
  if (start > registry.effects.length) throw new MotionError(400, 'motion_invalid_effect_page');
  const effects = registry.effects.slice(start, start + 64).map(({ id, name, category, params }) => ({ id, name, category, parameterCount: params.length }));
  return observation({ schemaVersion: 1, upstream: registry.upstream, renderer: registry.renderer,
    stamp: registry.stamp, offset: start, total: registry.effects.length, effects,
    nextOffset: start + effects.length, complete: start + effects.length === registry.effects.length,
    schemaLookup: '/api/motion-studio/effect-schema/{effect}',
    evidence: 'Native registry inventory; individual effect rendering, external inputs and installed availability require verification.' });
}
export async function effectSchema(ctx, id) {
  if (typeof id !== 'string' || id.length > 128 || !/^[a-z][a-zA-Z0-9._-]*$/.test(id)) throw new MotionError(400, 'motion_invalid_effect');
  const registry = await effectRegistry(ctx), effect = registry.effects.find(entry => entry.id === id);
  if (!effect) throw new MotionError(404, 'motion_effect_not_found');
  return observation({ schemaVersion: 1, upstream: registry.upstream, stamp: registry.stamp, renderer: registry.renderer,
    effect, popupValues: 'zero-based',
    sourceInputs: 'Worker validation refuses host file paths and expressions on file-backed parameters. Supported inline LUT/shape text remains editable; custom OCIO configurations need an owned asset adapter.',
    instructions: 'Apply effect.apply with explicit layers. Inspect the saved effects group for actual property UIDs and instantiated values before prop.set. Catalog defaults may be normalized positions; saved instances contain actual layer coordinates. Preserve untouched keys and fields.' });
}
