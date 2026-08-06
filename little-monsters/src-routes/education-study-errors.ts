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

import type { Response } from 'express';
import { EducationAccessError } from './education-access';

/** An expected study-route failure that is safe to return to the client. */
export class StudyHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'StudyHttpError';
  }
}

/** A uniform not-found response for missing and out-of-scope study resources. */
export function studyResourceNotFound(): StudyHttpError {
  return new StudyHttpError('Study resource not found', 404);
}

/** Send an expected authorization or study-domain error. */
export function sendStudyError(res: Response, error: unknown): boolean {
  if (error instanceof EducationAccessError || error instanceof StudyHttpError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}
