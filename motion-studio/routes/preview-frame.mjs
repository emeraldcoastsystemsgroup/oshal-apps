/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.4 (CREATE-TOOL-MOTION-STUDIO-05): add bounded revision-pinned JSON preview frame helper for the motion-preview concierge tool.
 */
import { createHash } from 'node:crypto';
import { stringifyNative, decimalId } from '../tools/native-json.mjs';
import { MotionError, LIMITS } from './project-store.mjs';
import { ownedAssets } from './assets.mjs';
import { motionEngine } from './engine-client.mjs';
import { OBSERVATION_BYTES } from './project-inspection.mjs';

const MIN_PREVIEW_SIDE = 16;
const MAX_PREVIEW_SIDE = 512;
const FLOOR_ADAPTIVE_SIDE = 64;

function validUuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new MotionError(400, 'motion_invalid_id');
  }
  return value.toLowerCase();
}

function validNonNegativeTick(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new MotionError(400, 'motion_invalid_keyframe_tick');
  }
  return value;
}

function validCompParam(value) {
  if (value === 'auto') return null;
  try {
    return BigInt(decimalId(value));
  } catch {
    throw new MotionError(400, 'motion_invalid_native_id');
  }
}

function validInt(value, min, max) {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw new MotionError(400, 'motion_invalid_input');
  }
  return num;
}

function buildPreviewPayload(project, timeTicks, requestedSide, usedSide, rendered) {
  const pngBytes = Buffer.from(rendered.png, 'base64');
  const compId = String(rendered.comp);
  const resolvedTicks = String(rendered.timeTicks ?? timeTicks);
  return {
    ok: true,
    projectId: project.id,
    revision: project.revision,
    compId,
    timeTicks: resolvedTicks,
    timeSeconds: rendered.time,
    width: rendered.width,
    height: rendered.height,
    requestedMaxSide: requestedSide,
    maxSide: usedSide,
    mimeType: 'image/png',
    bytes: pngBytes.length,
    sha256: createHash('sha256').update(pngBytes).digest('hex'),
    previewUrl: `/api/motion-studio/projects/${project.id}/revisions/${project.revision}/preview-ticks/${resolvedTicks}/${compId}/${usedSide}/0`,
    dataUrl: 'data:image/png;base64,' + rendered.png,
  };
}

/** Render a bounded revision-pinned PNG frame payload that fits within the agent observation cap. */
export async function renderBoundedPreviewFrame(bound, store, params) {
  const projectId = validUuid(params.id);
  const revision = validInt(params.revision, 1, LIMITS.revisions);
  const timeTicks = validNonNegativeTick(params.timeTicks);
  const comp = validCompParam(params.compId);
  const requestedSide = validInt(params.maxSide, MIN_PREVIEW_SIDE, MAX_PREVIEW_SIDE);
  const project = await store.get(projectId, revision);
  const assets = await ownedAssets(project.document, store);
  let side = requestedSide;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rendered = await motionEngine(bound, {
      op: 'preview',
      document: project.document,
      assets,
      ...(comp === null ? {} : { comp }),
      time_ticks: BigInt(timeTicks),
      max_side: side,
      transparent: false,
    });
    const payload = buildPreviewPayload(project, timeTicks, requestedSide, side, rendered);
    if (Buffer.byteLength(stringifyNative(payload)) <= OBSERVATION_BYTES) return payload;
    if (side <= FLOOR_ADAPTIVE_SIDE) break;
    side = Math.max(FLOOR_ADAPTIVE_SIDE, Math.floor(side / 2));
  }
  throw new MotionError(413, 'motion_agent_observation_limit');
}
