/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate bounded inert project JSON and canonical immutable raster asset references without trusting identity fields.
 */
import { ProjectError, PROJECT_ASSET_PREFIX, PROJECT_LIMITS, type ProjectDocument, type ProjectInput, type JsonValue } from './create-project-types';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
export type ProjectValidator = (value: unknown, options: { assetMode: 'reference' }) => ProjectDocument;

/** Capture the installed shared ESM model revision once; native import remains intact in Node16 emit. */
export function loadProjectValidator(packageDir: string): Promise<ProjectValidator> {
  const file = resolve(packageDir, 'tools/editor/model-validation.mjs');
  const url = pathToFileURL(file); url.searchParams.set('revision', createHash('sha256').update(readFileSync(file)).digest('hex'));
  return import(url.href).then((module: { validateProject: ProjectValidator }) => module.validateProject);
}

/** Validate server-generated record identifiers before database or filesystem use. */
export function projectId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ProjectError(400, 'invalid_project_id');
  return value.toLowerCase();
}

/** Require the exact current optimistic revision; never coerce strings or fractions. */
export function baseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > PROJECT_LIMITS.revisions) {
    throw new ProjectError(400, 'invalid_base_revision');
  }
  return Number(value);
}

/** Accept only plain JSON records, including objects parsed without a prototype. */
export function projectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** Reject unexpected envelope fields so identity and tenant selectors cannot be silently accepted. */
export function exactFields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!projectRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ProjectError(400, 'invalid_project_fields');
}

/** Traverse before serializing, limiting depth, nodes and each scalar without invoking accessors. */
function inspectJson(value: unknown, state: { nodes: number }, depth: number): asserts value is JsonValue {
  if (++state.nodes > PROJECT_LIMITS.nodes || depth > PROJECT_LIMITS.depth) throw new ProjectError(400, 'project_document_too_complex');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (value.length > PROJECT_LIMITS.documentBytes) throw new ProjectError(400, 'invalid_project_string');
    return;
  }
  if (!Array.isArray(value) && !projectRecord(value)) throw new ProjectError(400, 'invalid_project_json');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (DANGEROUS_KEYS.has(key) || !('value' in descriptor)) throw new ProjectError(400, 'invalid_project_json');
    inspectJson(descriptor.value, state, depth + 1);
  }
}

/** Check shared canvas bounds and asset reference syntax; asset ownership is verified by the store. */
export function validateDocument(value: unknown, validate: ProjectValidator): ProjectDocument {
  inspectJson(value, { nodes: 0 }, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > PROJECT_LIMITS.documentBytes) throw new ProjectError(413, 'project_document_too_large');
  try { return validate(JSON.parse(serialized), { assetMode: 'reference' }); }
  catch { throw new ProjectError(400, 'invalid_project_document'); }
}

/** Validate create/save envelopes independently of Express body-parser configuration. */
export function projectInput(value: unknown, validate: ProjectValidator, save = false): ProjectInput {
  exactFields(value, save ? ['baseRevision', 'title', 'document'] : ['title', 'document']);
  if (save) baseRevision(value.baseRevision);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > PROJECT_LIMITS.title) throw new ProjectError(400, 'invalid_project_title');
  const document = validateDocument(value.document, validate);
  if (document.name !== value.title) throw new ProjectError(400, 'project_title_mismatch');
  return { title: value.title, document };
}

/** Extract server-issued immutable IDs without imposing an identity on the document's local image keys. */
export function documentAssets(document: ProjectDocument): Array<{ id: string; width: number; height: number }> {
  const images = document.images as Record<string, { src: string; width: number; height: number }>;
  return Object.values(images).map(image => {
    const id = projectId(image.src.slice(PROJECT_ASSET_PREFIX.length));
    if (image.src !== PROJECT_ASSET_PREFIX + id) throw new ProjectError(400, 'invalid_project_asset');
    return { id, width: image.width, height: image.height };
  });
}
