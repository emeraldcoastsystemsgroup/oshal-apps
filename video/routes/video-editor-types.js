/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video editor's server-side shapes and ceilings: private projects, immutable timeline revisions and immutable owned media with verified metadata, plus the EDITOR-PLAN first-slice storage bounds.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDITOR_LIMITS = exports.EditorError = void 0;
/** A refusal with an HTTP status and a stable code; the routes answer with the code only. */
class EditorError extends Error {
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}
exports.EditorError = EditorError;
/**
 * @description First-slice storage ceilings from video/EDITOR-PLAN.md: 100 MiB per clip, 32 MiB per
 * WAV bed, 200 MiB of media per project, 20 files and 500 MiB per owner, 100 retained revisions.
 */
exports.EDITOR_LIMITS = Object.freeze({ documentBytes: 262144, title: 160, projects: 200, retainedRevisions: 100,
    revisionNumber: 100000, clipBytes: 104857600, bedBytes: 33554432, projectMediaBytes: 209715200,
    ownerMedia: 20, ownerMediaBytes: 524288000, clipSeconds: 30, bedSeconds: 60, maxFps: 60,
    maxPixels: 2073600, maxDimension: 1920 });
