/**
 * Filesystem, extraction, and RAG lifecycle helpers for education materials.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Added no-clobber storage, content-derived media types, containment checks, and per-material RAG lifecycle
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Read exact native row-authorized material projections and refuse unsupported file mutations.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Keep native material bytes and grounding in the original relationship-checked SQL transaction.
 * ---------------------------------------------------------------------------
 *
 * @module education-material-storage
 */

import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'education-material-storage' });
const execFileAsync = promisify(execFile);

export interface StoredMaterialRow {
  material_id: string;
  class_id: string;
  uploaded_by: string;
  original_name?: string;
  stored_path: string;
  mime_type?: string;
  rag_collection?: string | null;
}

interface FileClassification {
  mimeType: string;
  extension: string;
}

/** Present only on the native admitted pool/client; credentials never enter the package. */
export interface NativeMaterialExecutor {
  nativeExecutor?: (name: string, input: Record<string, unknown>) => Promise<any>;
}

/** Create a collision-resistant collection without putting user input in a path. */
export function materialCollectionName(materialId: string): string {
  return `lm-material-${materialId.replace(/-/g, '').toLowerCase()}`;
}

/** Classify only signatures the server understands; everything else downloads as binary. */
export function classifyMaterial(buffer: Buffer, declaredMime?: string): FileClassification {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return { mimeType: 'application/pdf', extension: '.pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: 'image/jpeg', extension: '.jpg' };
  if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString('ascii'))) return { mimeType: 'image/gif', extension: '.gif' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  const declared = String(declaredMime || '').toLowerCase();
  if ((declared === 'text/plain' || declared === 'text/markdown') && !buffer.includes(0)) {
    return { mimeType: 'text/plain; charset=utf-8', extension: '.txt' };
  }
  return { mimeType: 'application/octet-stream', extension: '.bin' };
}

/** Persist one upload under validated UUID directories with an exclusive create. */
export function saveMaterialFile(
  classId: string,
  studentId: string,
  file: { buffer: Buffer; mimetype?: string },
  native?: NativeMaterialExecutor,
): { storedPath: string; mimeType: string } | Promise<{ storedPath: string; mimeType: string }> {
  if (native?.nativeExecutor) {
    return native.nativeExecutor('storage.school.save', { classId, studentId,
      content: file.buffer.toString('base64'), mimeType: classifyMaterial(file.buffer, file.mimetype).mimeType });
  }
  if (process.env.OSHAL_APPLICATION_FILES_READ_ONLY === '1') throw new Error('Native material uploads are not enabled');
  const classification = classifyMaterial(file.buffer, file.mimetype);
  const directory = path.resolve(process.cwd(), 'workspace-shared', 'education', classId, 'materials', studentId);
  fs.mkdirSync(directory, { recursive: true });
  const storedPath = path.join(directory, `${randomUUID()}${classification.extension}`);
  // The wx flag is intentional: random names should never overwrite an existing
  // file, and a collision must fail rather than becoming a confused-deputy write.
  fs.writeFileSync(storedPath, file.buffer, { flag: 'wx' });
  return { storedPath, mimeType: classification.mimeType };
}

/** Prove both lexical and symlink-resolved containment before a persisted-path read. */
export function resolveStoredMaterialPath(row: StoredMaterialRow): string {
  if (process.env.OSHAL_APPLICATION_FILES_READ_ONLY === '1') return nativeStoredMaterialPath(row);
  const expectedRoot = path.resolve(
    process.cwd(),
    'workspace-shared',
    'education',
    row.class_id,
    'materials',
    row.uploaded_by,
  );
  const candidate = path.resolve(String(row.stored_path));
  const lexicalRelative = path.relative(expectedRoot, candidate);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) throw new Error('Material path escaped its owner directory');
  const realRoot = fs.realpathSync(expectedRoot);
  const realCandidate = fs.realpathSync(candidate);
  const realRelative = path.relative(realRoot, realCandidate);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Material path resolved outside its owner directory');
  return realCandidate;
}

/** Read only the exact per-row file projection mounted by the admitted native host. */
function nativeStoredMaterialPath(row: StoredMaterialRow): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.material_id)) {
    throw new Error('Native material identifier is invalid');
  }
  const expected = `/application-files/little-monsters/lm_materials/${row.material_id}`;
  if (row.stored_path !== expected || fs.realpathSync(expected) !== expected || !fs.statSync(expected).isFile()) {
    throw new Error('Native material path differs from its authorized projection');
  }
  return expected;
}

/** Remove the stored file after containment validation; absence is already deleted. */
export function deleteStoredMaterial(row: StoredMaterialRow, native?: NativeMaterialExecutor): void | Promise<void> {
  if (native?.nativeExecutor && row.stored_path.startsWith('native-file:')) {
    return native.nativeExecutor('storage.school.delete', { storedPath: row.stored_path }).then(() => undefined);
  }
  if (process.env.OSHAL_APPLICATION_FILES_READ_ONLY === '1') throw new Error('Native material file deletion is not enabled');
  if (!fs.existsSync(row.stored_path)) return;
  const resolved = resolveStoredMaterialPath(row);
  fs.unlinkSync(resolved);
  logger.info({ materialId: row.material_id }, 'Stored material file deleted');
}

/** Extract bounded text from a supported material format. */
export async function extractMaterialText(file: { buffer: Buffer; mimetype?: string }): Promise<string> {
  const type = classifyMaterial(file.buffer, file.mimetype).mimeType;
  if (type === 'application/pdf') return parsePdf(file.buffer);
  if (type.startsWith('image/')) return ocrImage(file.buffer);
  if (type.startsWith('text/plain')) return file.buffer.toString('utf8').slice(0, 500_000);
  return '';
}

/** Parse embedded PDF text, then use bounded OCR for scanned pages. */
async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = require('pdf-parse');
    const text = String((await pdfParse(buffer)).text || '').trim();
    if (text) return text.slice(0, 500_000);
  } catch (err) {
    logger.warn({ err }, 'Embedded PDF text extraction failed; trying OCR');
  }
  return ocrPdf(buffer);
}

/** Delete a temporary file with an observable warning on unexpected cleanup failure. */
function removeTemporaryFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn({ err, filePath }, 'Temporary material file cleanup failed');
  }
}

/** OCR at most ten scanned PDF pages using a random, request-unique prefix. */
async function ocrPdf(buffer: Buffer): Promise<string> {
  const base = path.join(os.tmpdir(), `lm-pdf-${randomUUID()}`);
  const pdfPath = `${base}.pdf`;
  const pages: string[] = [];
  try {
    fs.writeFileSync(pdfPath, buffer, { flag: 'wx' });
    await execFileAsync('pdftoppm', ['-png', '-r', '150', '-l', '10', pdfPath, base], {
      timeout: 15_000, maxBuffer: 1024 * 1024,
    });
    const prefix = path.basename(base);
    pages.push(...fs.readdirSync(path.dirname(base))
      .filter(name => name.startsWith(prefix) && name.endsWith('.png'))
      .map(name => path.join(path.dirname(base), name))
      .sort());
    const output: string[] = [];
    for (const page of pages) output.push(await runTesseract(page));
    return output.join('\n').trim().slice(0, 500_000);
  } catch (err) {
    logger.warn({ err }, 'Scanned PDF OCR failed; material remains stored without grounding');
    return '';
  } finally {
    removeTemporaryFile(pdfPath);
    for (const page of pages) removeTemporaryFile(page);
  }
}

/** Run OCR for one already-contained temporary image. */
async function runTesseract(filePath: string): Promise<string> {
  const result = await execFileAsync('tesseract', [filePath, 'stdout', '-l', 'eng'], {
    timeout: 15_000, maxBuffer: 10 * 1024 * 1024,
  });
  return String(result.stdout || '');
}

/** OCR a single uploaded image without exposing its client-supplied filename. */
async function ocrImage(buffer: Buffer): Promise<string> {
  const temporaryPath = path.join(os.tmpdir(), `lm-image-${randomUUID()}`);
  try {
    fs.writeFileSync(temporaryPath, buffer, { flag: 'wx' });
    return (await runTesseract(temporaryPath)).trim().slice(0, 500_000);
  } catch (err) {
    logger.warn({ err }, 'Image OCR failed; material remains stored without grounding');
    return '';
  } finally {
    removeTemporaryFile(temporaryPath);
  }
}

/** Ingest one material into its own collection so moderation can revoke it exactly. */
export async function ingestMaterialText(
  text: string,
  collection: string,
  metadata: Record<string, unknown>,
  native?: NativeMaterialExecutor,
): Promise<boolean> {
  if (!text) return false;
  try {
    const { RagService } = require('@/features/rag');
    const result = native?.nativeExecutor
      ? await native.nativeExecutor('rag.ingest', { texts: [text], collection, metadata })
      : await new RagService().ingest([text], collection, metadata);
    logger.info({ collection: result.collection, chunkCount: result.chunkCount }, 'Material text ingested');
    return true;
  } catch (err) {
    logger.warn({ err, collection }, 'Material RAG ingestion failed');
    return false;
  }
}

/** Delete an exact per-material collection; callers decide whether failure is fatal. */
export async function deleteMaterialCollection(collection: string, native?: NativeMaterialExecutor): Promise<void> {
  if (native?.nativeExecutor) {
    await native.nativeExecutor('rag.delete', { collection });
    return;
  }
  const { RagService } = require('@/features/rag');
  await new RagService().deleteCollection(collection);
}

/** Re-extract a safely contained stored material for first approval or reindexing. */
export async function extractStoredMaterialText(row: StoredMaterialRow, native?: NativeMaterialExecutor): Promise<string> {
  return extractMaterialText({ buffer: await readStoredMaterial(row, native), mimetype: row.mime_type });
}

/** Resolve native bytes through the same material row policy instead of opening a package path. */
export async function readStoredMaterial(row: StoredMaterialRow, native?: NativeMaterialExecutor): Promise<Buffer> {
  if (row.stored_path.startsWith('native-file:')) {
    if (!native?.nativeExecutor) throw new Error('Native material storage is not linked');
    const value = await native.nativeExecutor('storage.school.read', { materialId: row.material_id });
    const bytes = Buffer.from(String(value.content || ''), 'base64');
    if (bytes.length !== value.size) throw new Error('Native material response size differs');
    return bytes;
  }
  return fs.readFileSync(resolveStoredMaterialPath(row));
}
