/**
 * Upload limits — the bytes this installation will actually accept, not only what the engine could read.
 *
 * The routes declare their own ceilings (a 200 MiB .ply, a 300 MiB video). The native kernel admits a
 * multipart request body of at most 10 MiB + 64 KiB (crates/api/src/package_dispatch.rs
 * decode_request_body MAX_UPLOAD_BYTES, sized under its sixteen-MiB process frame) and its bridge
 * answers a single file over 10 MiB with 413 application_upload_too_large (bridge
 * multipart_compat.js MAX_FILE_BYTES). The cap is a kernel constant: the manifest has no field that
 * raises it for one package. So /capabilities and the page state the smaller of the two, and the page
 * refuses an oversized file before sending it.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: effectiveUploadLimits clamps every per-file byte ceiling to the native kernel's 10 MiB file cap when the package runs in the native sandbox (OSHAL_EGRESS=kernel, set by the bridge) and adds requestBytes, the most one multipart request may carry, so the page can split photos into requests that fit. The route ceilings are unchanged.
 *
 * @module upload-limits
 */

/** @description Largest single file the native kernel's bridge accepts in a multipart upload. */
export const NATIVE_FILE_BYTES = 10 * 1024 * 1024;

/** @description Per-file byte ceilings a route declares (counts pass through unchanged). */
export interface DeclaredUploadLimits {
  imageBytes: number; imagesPerRequest: number; imagesPerJob: number; videoBytes: number; plyBytes: number; depthBytes: number;
}

/** @description What the page and the capabilities tool read: the effective ceilings and where they come from. */
export interface EffectiveUploadLimits extends DeclaredUploadLimits {
  /** 'native' when the kernel's cap applies, 'declared' when only the routes' own ceilings do. */
  host: 'native' | 'declared';
  /** Most file bytes one request may carry; null when only the per-file ceilings apply. */
  requestBytes: number | null;
  /** The routes' own ceilings, kept so a reader can see what the engine itself would take. */
  declared: DeclaredUploadLimits;
}

/**
 * @description Whether this module runs in the native kernel's package sandbox. The bridge sets
 * OSHAL_EGRESS=kernel there; nothing else does.
 * @param env - Process environment.
 * @returns True inside the native sandbox.
 */
export function nativeHost(env: Record<string, string | undefined>): boolean {
  return env.OSHAL_EGRESS === 'kernel';
}

/**
 * @description The upload ceilings that hold on this installation. Under the native kernel every
 * per-file byte ceiling is clamped to its 10 MiB file cap and one request carries at most that many
 * file bytes; elsewhere the declared ceilings stand.
 * @param declared - The routes' declared ceilings.
 * @param env - Process environment.
 * @returns The effective ceilings.
 */
export function effectiveUploadLimits(declared: DeclaredUploadLimits, env: Record<string, string | undefined>): EffectiveUploadLimits {
  const base = { ...declared };
  if (!nativeHost(env)) return { ...base, host: 'declared', requestBytes: null, declared: base };
  const cap = (bytes: number): number => Math.min(bytes, NATIVE_FILE_BYTES);
  return {
    ...base, imageBytes: cap(base.imageBytes), videoBytes: cap(base.videoBytes), plyBytes: cap(base.plyBytes), depthBytes: cap(base.depthBytes),
    host: 'native', requestBytes: NATIVE_FILE_BYTES, declared: base,
  };
}
