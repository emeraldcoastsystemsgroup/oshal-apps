/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Use only the original-context native engine relay and reject mismatched or malformed worker responses.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Report bounded original-route administrator setup guidance for missing or stale engines.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Admit precise tick render requests through the same original-context opaque relay.
 */
import {parseNative,stringifyNative} from '../tools/native-json.mjs';
import identity from './engine-identity.json' with { type: 'json' };
import { MotionError } from './project-store.mjs';
export const ENGINE_IDENTITY = Object.freeze(identity);
function engineFailure(code) {
  const error = new MotionError(503, code);
  const retryable = ['motion_engine_busy', 'motion_engine_timeout'].includes(code);
  error.detail = code === 'motion_engine_busy' ? 'The Motion engine is busy. Try again shortly.'
    : code === 'motion_engine_timeout' ? 'The Motion operation took too long. Try a smaller edit or preview.'
    : code === 'motion_engine_source_mismatch' ? 'The Motion engine needs an update by the installation administrator.'
    : 'The Motion engine is unavailable. Ask the installation administrator to check it.';
  if (!retryable) error.engineSetup = { expectedBuildHash: ENGINE_IDENTITY.buildHash,
    installHint: 'Installation administrator: run engine/install-engine.sh from the admitted Motion package directory with OSHAL_NETWORK set, then pin its private address in OSHAL_PACKAGE_ENGINES.' };
  return error;
}
const MAX = 12 * 1024 * 1024;
const operations = new Set(['create','catalog','inspect','edit','preview']);

/** No network/socket fallback, host parameter or caller identity is accepted from application input. */
export async function motionEngine(ctx, payload) {
  if (typeof ctx?.intent !== 'function') throw engineFailure('motion_native_engine_unavailable');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !operations.has(payload.op)
      || Object.keys(payload).some(key => !['op','document','commands','assets','comp','time','time_ticks','max_side','transparent','filter'].includes(key))) throw new MotionError(400,'motion_invalid_request');
  let request;
  try { request = {requestJson:stringifyNative(payload)}; } catch { throw new MotionError(400,'motion_invalid_request'); }
  if (Buffer.byteLength(JSON.stringify(request)) > MAX - 128) throw new MotionError(413,'motion_request_limit');
  let exchange;
  try { exchange = await ctx.intent('engine.exchange',{request:{cmd:'motion',args:request},timeoutMs:45000}); }
  catch { throw engineFailure('motion_native_engine_unavailable'); }
  if (exchange?.hello?.error === 'motion_engine_busy') throw engineFailure('motion_engine_busy');
  const hello = exchange?.hello?.bridge;
  if (!hello || ['protocol','buildHash','upstream'].some(key => hello[key] !== ENGINE_IDENTITY[key])) throw engineFailure('motion_engine_source_mismatch');
  const reply = exchange.reply;
  if (!reply || reply.id !== 1 || typeof reply !== 'object') throw engineFailure('motion_engine_invalid_response');
  if (reply.buildHash !== ENGINE_IDENTITY.buildHash && reply.error !== 'motion_engine_source_mismatch') throw engineFailure('motion_engine_source_mismatch');
  if (reply.ok !== true) {
    const code = typeof reply.error === 'string' && /^motion_[a-z0-9_]+$/.test(reply.error) ? reply.error : 'motion_operation_refused';
    throw ['motion_engine_busy','motion_engine_timeout','motion_engine_failed','motion_engine_source_mismatch'].includes(code) ? engineFailure(code) : new MotionError(400,code);
  }
  let result;try{const decoded=parseNative(reply.resultJson);if(decoded.buildHash!==ENGINE_IDENTITY.buildHash||decoded.ok!==true)throw new Error();result=decoded.result;}catch{throw engineFailure('motion_engine_invalid_response');}
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.upstream !== ENGINE_IDENTITY.upstream) throw engineFailure('motion_engine_invalid_response');
  return result;
}
