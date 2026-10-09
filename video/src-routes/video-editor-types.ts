/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video editor's server-side shapes and ceilings: private projects, immutable timeline revisions and immutable owned media with verified metadata, plus the EDITOR-PLAN first-slice storage bounds.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */
import type { Pool } from 'pg';
import type { PackageAuthorizationContext } from '@/app/composition/application-authorization-runtime';
import type { TimelineDocument } from './video-edit-compiler';

export type { TimelineDocument };
export interface EditorOwner { issuer: string; sub: string }
export interface EditorProjectInput { title: string; document: TimelineDocument }
export interface EditorProjectMetadata { id: string; title: string; revision: number; createdAt: string; updatedAt: string }
export interface EditorProjectSnapshot extends EditorProjectMetadata { document: TimelineDocument }
export interface EditorRevisionMetadata { revision: number; title: string; createdAt: string }

/** @description Verified metadata of one immutable uploaded file; `frames` is counted in the 30 fps project time base. */
export interface EditorMedia {
  id: string; kind: 'video' | 'audio'; bytes: number; sha256: string; container: 'mp4' | 'wav';
  videoCodec: 'h264' | null; audioCodec: string | null; width: number | null; height: number | null;
  frames: number; durationMs: number; hasAudio: boolean;
}

/** @description The slice of the per-package framework context the editor reads. */
export interface EditorContext { pool: Pick<Pool, 'connect'> & { storageModel?: string }; authorization?: PackageAuthorizationContext; appPackageDir?: string; intent?: (name: string, input: unknown) => Promise<unknown> }
export type ConfirmEditorAccess = () => Promise<void>;

/** A refusal with an HTTP status and a stable code; the routes answer with the code only. */
export class EditorError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

/**
 * @description First-slice storage ceilings from video/EDITOR-PLAN.md: 100 MiB per clip, 32 MiB per
 * WAV bed, 200 MiB of media per project, 20 files and 500 MiB per owner, 100 retained revisions.
 */
export const EDITOR_LIMITS = Object.freeze({ documentBytes: 262144, title: 160, projects: 200, retainedRevisions: 100,
  revisionNumber: 100000, clipBytes: 104857600, bedBytes: 33554432, projectMediaBytes: 209715200,
  ownerMedia: 20, ownerMediaBytes: 524288000, clipSeconds: 30, bedSeconds: 60, maxFps: 60,
  maxPixels: 2073600, maxDimension: 1920 });
