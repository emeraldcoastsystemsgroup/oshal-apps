"use strict";
/**
 * Education Study Errors — Little Monsters Platform API
 *
 * Keeps study-route failures consistent without exposing whether a guessed set
 * or card identifier exists outside the authenticated caller's scope.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add shared, non-oracular study-route error handling.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-errors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudyHttpError = void 0;
exports.studyResourceNotFound = studyResourceNotFound;
exports.sendStudyError = sendStudyError;
const education_access_1 = require("./education-access");
/** An expected study-route failure that is safe to return to the client. */
class StudyHttpError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'StudyHttpError';
    }
}
exports.StudyHttpError = StudyHttpError;
/** A uniform not-found response for missing and out-of-scope study resources. */
function studyResourceNotFound() {
    return new StudyHttpError('Study resource not found', 404);
}
/** Send an expected authorization or study-domain error. */
function sendStudyError(res, error) {
    if (error instanceof education_access_1.EducationAccessError || error instanceof StudyHttpError) {
        res.status(error.status).json({ error: error.message });
        return true;
    }
    return false;
}
//# sourceMappingURL=education-study-errors.js.map