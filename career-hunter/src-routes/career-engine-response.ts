/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Centralize truthful engine-start and concurrency rejection responses for all Career routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Map admission-to-brokerage deadline expiry to a truthful gateway-timeout response.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Give multipart duplicates and the independent global upload ceiling exact upload-specific HTTP semantics.
 */
/**
 * Career engine HTTP rejection helpers.
 *
 * Keeps process-limit semantics consistent without coupling the reusable process runner to
 * Express. Mounted routes use 409 for a duplicate slot, 429 for the global ceiling, and 500 when
 * the operating system rejects a requested background start.
 *
 * @module career-engine-response
 */
import type { Response } from 'express';
import type { CliStartResult, RunLease } from './career-engine-runner';

/**
 * @description Send the established single-flight/global-ceiling response for a rejected start.
 * @param res Express response receiving the stable failure contract
 * @param result runner start result
 * @param label human-readable operation label
 * @returns true when a rejection response was sent
 */
export function rejectEngineStart(res: Response, result: CliStartResult, label: string): boolean {
  if (result.started) return false;
  const status = result.timedOut ? 504
    : result.limitReason === 'inflight' ? 409 : result.limitReason === 'busy' ? 429 : 500;
  const error = result.timedOut ? `${label} timed out`
    : result.limitReason === 'inflight'
    ? `${label} already running`
    : result.limitReason === 'busy' ? 'busy - too many career runs in progress' : (result.err || 'engine spawn failed');
  res.status(status).json({ ok: false, error, err: error });
  return true;
}

/**
 * @description Reject an unsuccessful manual claim before its caller mutates durable state.
 * @param res Express response receiving the stable failure contract
 * @param lease opaque runner claim result
 * @param label human-readable operation label
 * @returns true when a rejection response was sent
 */
export function rejectEngineClaim(res: Response, lease: RunLease, label: string): boolean {
  if (lease.status === 'ok') return false;
  return rejectEngineStart(res, { started: false, limitReason: lease.status }, label);
}

/**
 * @description Reject a multipart body before buffering with upload-specific duplicate/capacity
 * language, keeping the independent upload ceiling distinct from engine-run saturation.
 * @param res Express response receiving the stable upload admission contract
 * @param lease opaque upload-body claim result
 * @param label human-readable upload label used only for the caller's duplicate body
 * @returns true when an upload rejection response was sent
 */
export function rejectUploadClaim(res: Response, lease: RunLease, label: string): boolean {
  if (lease.status === 'ok') return false;
  const duplicate = lease.status === 'inflight';
  const error = duplicate ? `${label} already in progress`
    : 'busy - too many career uploads in progress';
  res.status(duplicate ? 409 : 429).json({ ok: false, error, err: error });
  return true;
}
