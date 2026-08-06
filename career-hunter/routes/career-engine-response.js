"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectEngineStart = rejectEngineStart;
exports.rejectEngineClaim = rejectEngineClaim;
exports.rejectUploadClaim = rejectUploadClaim;
/**
 * @description Send the established single-flight/global-ceiling response for a rejected start.
 * @param res Express response receiving the stable failure contract
 * @param result runner start result
 * @param label human-readable operation label
 * @returns true when a rejection response was sent
 */
function rejectEngineStart(res, result, label) {
    if (result.started)
        return false;
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
function rejectEngineClaim(res, lease, label) {
    if (lease.status === 'ok')
        return false;
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
function rejectUploadClaim(res, lease, label) {
    if (lease.status === 'ok')
        return false;
    const duplicate = lease.status === 'inflight';
    const error = duplicate ? `${label} already in progress`
        : 'busy - too many career uploads in progress';
    res.status(duplicate ? 409 : 429).json({ ok: false, error, err: error });
    return true;
}
//# sourceMappingURL=career-engine-response.js.map