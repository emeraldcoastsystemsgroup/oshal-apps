/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.9.7 (R21): UMD entry point for deterministic response-plan manifest building, bounded line-by-line unified diffing, and plan-to-plan comparison; delegates to response-artifacts.js so the browser serves one bound asset with zero catalog changes.
 */
(function (root) {
  'use strict';
  const source = typeof require === 'function' ? require('./response-artifacts.js') : (root.OperationsResponseManifest || root.OperationsResponseArtifacts || null);
  if (!source) return;
  const api = {
    AUTHORIZATION_NOTICE: source.AUTHORIZATION_NOTICE,
    MAX_DIFF_LINES: source.MAX_DIFF_LINES,
    sha256Hex: source.sha256Hex,
    bundleDigest: source.bundleDigest,
    buildManifest: source.buildManifest,
    unifiedDiff: source.unifiedDiff,
    comparePlans: source.comparePlans,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OperationsResponseManifest = api;
})(typeof window === 'object' ? window : globalThis);
