/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Define private Create projects, immutable revision snapshots and bounded image asset metadata.
 */
import type { Pool } from 'pg';
import type { PackageAuthorizationContext } from '@/app/composition/application-authorization-runtime';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ProjectDocument { [key: string]: JsonValue }
export interface ProjectOwner { issuer: string; sub: string }
export interface ProjectInput { title: string; document: ProjectDocument }
export interface ProjectMetadata { id: string; title: string; revision: number; createdAt: string; updatedAt: string }
export interface ProjectSnapshot extends ProjectMetadata { document: ProjectDocument }
export interface RevisionMetadata { revision: number; title: string; createdAt: string }
export interface ProjectAsset { id: string; src: string; width: number; height: number; bytes: number; sha256: string }
export interface ProjectContext { pool: Pick<Pool, 'connect'>; authorization?: PackageAuthorizationContext; appPackageDir?: string }
export type ConfirmProjectAccess = () => Promise<void>;

export class ProjectError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

export const PROJECT_LIMITS = Object.freeze({ documentBytes: 262144, layers: 200, depth: 12, nodes: 100000,
  dimension: 8192, pixels: 33554432, title: 160, projects: 1000, revisions: 1000,
  imageBytes: 8388608, assets: 128, assetBytes: 536870912 });
export const PROJECT_ASSET_PREFIX = '/api/create/project-assets/';
