/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Host validation thumbnails in owner-scoped controller storage so a scorecard cell can render without exposing a box-local path, and expire or delete them with their run.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind thumbnail lifetime to the model row so direct run deletion and late callbacks cannot restore deleted-run access.
 */

/**
 * Owner-scoped storage for LoRA validation thumbnails.
 *
 * Before this module the box sent only a bare ComfyUI filename per scorecard cell, so no cell could
 * ever render: the studio needs a fetchable URL and a filename on someone else's GPU box is not one.
 * Copying a BOUNDED thumbnail into the controller is the owner-storage half of the two options the
 * backlog entry names, and it is the one that does not require the GPU box to be reachable by the
 * browser at all.
 *
 * Three properties are load-bearing and each is enforced here rather than in the caller:
 *  - bounded: a thumbnail is at most MAX_CELL_IMAGE_BYTES and must actually be a PNG or JPEG by its
 *    magic bytes, so the ingest callback cannot be used to park arbitrary bytes in the database;
 *  - owner-scoped: every statement is keyed by a character_id the caller's own owner predicate
 *    resolved, and the table carries the same FORCE RLS owner policy as the score it belongs to;
 *  - perishable: every row carries an expiry, reads filter on it, and deleting a run deletes its
 *    images, so an expired or deleted run loses access rather than lingering as a readable blob.
 */

import type { AppContext } from '@/app/composition/app-context';

/** Largest single validation thumbnail the controller will accept and store, in bytes. */
export const MAX_CELL_IMAGE_BYTES = 256 * 1024;

/** Highest addressable cell index. The fixed validation matrix is far smaller; this is the wall. */
export const MAX_CELL_INDEX = 63;

/** Run age beyond which its hosted thumbnails cannot be read or renewed, in days. */
export const CELL_IMAGE_TTL_DAYS = 30;

const LIVE_SCORE_CELL = `EXISTS (
  SELECT 1 FROM oshal_lora_models m JOIN oshal_lora_scores s
    ON s.character_id=m.character_id AND s.version=m.version
  WHERE m.character_id=oshal_lora_cell_images.character_id AND m.version=oshal_lora_cell_images.version
    AND m.created_at + INTERVAL '${CELL_IMAGE_TTL_DAYS} days' > NOW()
    AND (s.cells -> oshal_lora_cell_images.cell_index ->> 'image')=oshal_lora_cell_images.source_filename)`;

/** The only image types a validation thumbnail may be, identified by magic bytes, never by header. */
export type CellImageContentType = 'image/png' | 'image/jpeg';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** One stored validation thumbnail as the studio reads it back. */
export interface StoredCellImage {
  contentType: CellImageContentType;
  bytes: Buffer;
}

/** The outcome of checking one candidate thumbnail before any database work happens. */
export type CellImageCheck =
  | { ok: true; contentType: CellImageContentType }
  | { ok: false; error: string };

/**
 * @description Identify a thumbnail by its leading bytes. A declared Content-Type is a claim by the
 * caller; the magic bytes are the artefact itself, so only the artefact decides. Anything that is
 * not a PNG or a JPEG is rejected rather than stored under a guessed type.
 * @param bytes - The candidate image body exactly as received.
 * @returns The content type to store and serve, or null when the bytes are not a supported image.
 */
export function sniffCellImageType(bytes: Buffer): CellImageContentType | null {
  if (bytes.length >= PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png';
  if (bytes.length >= JPEG_MAGIC.length && bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg';
  return null;
}

/**
 * @description Apply every bound a thumbnail must satisfy before it reaches the database: non-empty,
 * within MAX_CELL_IMAGE_BYTES, and a real PNG or JPEG. Returns the type to store rather than a
 * boolean so the caller cannot persist a type the bytes do not support.
 * @param bytes - The candidate image body exactly as received.
 * @returns `{ ok: true, contentType }`, or `{ ok: false, error }` naming the bound that failed.
 */
export function checkCellImage(bytes: Buffer): CellImageCheck {
  if (!bytes || bytes.length === 0) return { ok: false, error: 'empty_image' };
  if (bytes.length > MAX_CELL_IMAGE_BYTES) return { ok: false, error: 'image_too_large' };
  const contentType = sniffCellImageType(bytes);
  if (!contentType) return { ok: false, error: 'unsupported_image_type' };
  return { ok: true, contentType };
}

/**
 * @description Coerce a cell index from an untrusted query or body field. The matrix is small and
 * fixed, so anything outside 0..MAX_CELL_INDEX is a caller error rather than a cell.
 * @param value - The raw field.
 * @returns The integer index, or null when it is not an addressable cell.
 */
export function parseCellIndex(value: unknown): number | null {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > MAX_CELL_INDEX) return null;
  return index;
}

/**
 * @description The DDL for the hosted-thumbnail table, in the shape the rest of the LoRA schema
 * uses: a child of the character row, cascade-deleted with it, and under the identical owner/operator
 * FORCE RLS policy the score rows carry. Returned as statements so the lazy runtime bootstrap and
 * the install migration stay byte-comparable rather than drifting apart.
 * @returns Idempotent statements, in dependency order.
 */
export function cellImageSchemaStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS oshal_lora_cell_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        cell_index INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        image BYTEA NOT NULL,
        source_filename TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (character_id, version, cell_index)
      )`,
    'CREATE INDEX IF NOT EXISTS idx_lora_cell_images_run ON oshal_lora_cell_images(character_id, version)',
    'CREATE INDEX IF NOT EXISTS idx_lora_cell_images_expiry ON oshal_lora_cell_images(expires_at)',
    'ALTER TABLE oshal_lora_cell_images DROP CONSTRAINT IF EXISTS lora_cell_images_model_fk',
    `ALTER TABLE oshal_lora_cell_images ADD CONSTRAINT lora_cell_images_model_fk
       FOREIGN KEY (character_id, version) REFERENCES oshal_lora_models(character_id, version) ON DELETE CASCADE`,
    'ALTER TABLE oshal_lora_cell_images ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE oshal_lora_cell_images FORCE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS oshal_lora_cell_images_owner_policy ON oshal_lora_cell_images',
    `CREATE POLICY oshal_lora_cell_images_owner_policy ON oshal_lora_cell_images
         USING (EXISTS (SELECT 1 FROM oshal_lora_characters c
                         WHERE c.id = oshal_lora_cell_images.character_id
                           AND (c.owner_sub = current_setting('oshal.current_sub', true)
                                OR current_setting('oshal.is_operator', true) = 'on')))
         WITH CHECK (EXISTS (SELECT 1 FROM oshal_lora_characters c
                             WHERE c.id = oshal_lora_cell_images.character_id
                               AND (c.owner_sub = current_setting('oshal.current_sub', true)
                                    OR current_setting('oshal.is_operator', true) = 'on')))`,
  ];
}

/** The runtime-bootstrap requirement row for the hosted-thumbnail table. */
export const CELL_IMAGE_REQUIREMENT = {
  table: 'oshal_lora_cell_images',
  columns: ['id', 'character_id', 'version', 'cell_index', 'content_type', 'byte_size', 'image', 'source_filename', 'expires_at', 'created_at'],
};

/**
 * @description Store one checked thumbnail against an already owner-resolved character. Replaces an
 * earlier thumbnail for the same cell so a re-validated version does not accumulate blobs, and
 * preserves the run's expiry clock. A delayed upload must still match the current scorecard cell.
 * @param pool - The application pool.
 * @param characterId - A character id the caller resolved with its own owner predicate.
 * @param version - The validated model version the cell belongs to.
 * @param cellIndex - The cell's index in the fixed validation matrix.
 * @param contentType - The type checkCellImage returned for these exact bytes.
 * @param bytes - The thumbnail body.
 * @param sourceFilename - The box-side filename, kept for provenance only; never used as a URL.
 * @returns Whether a current, non-expired run and matching cell admitted the write.
 */
export async function storeCellImage(
  pool: AppContext['pool'],
  characterId: string,
  version: number,
  cellIndex: number,
  contentType: CellImageContentType,
  bytes: Buffer,
  sourceFilename: string | null,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO oshal_lora_cell_images
       (character_id, version, cell_index, content_type, byte_size, image, source_filename, expires_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, m.created_at + ($8 || ' days')::INTERVAL
       FROM oshal_lora_models m JOIN oshal_lora_scores s
         ON s.character_id=m.character_id AND s.version=m.version
       WHERE m.character_id=$1 AND m.version=$2
         AND m.created_at + ($8 || ' days')::INTERVAL > NOW()
         AND (s.cells -> $3::int ->> 'image')=$7
     ON CONFLICT (character_id, version, cell_index) DO UPDATE SET
       content_type = EXCLUDED.content_type,
       byte_size = EXCLUDED.byte_size,
       image = EXCLUDED.image,
       source_filename = EXCLUDED.source_filename,
       expires_at = EXCLUDED.expires_at,
       created_at = NOW()`,
    [characterId, version, cellIndex, contentType, bytes.length, bytes, sourceFilename, String(CELL_IMAGE_TTL_DAYS)],
  );
  return result.rowCount === 1;
}

/**
 * @description Read one live thumbnail. The expiry predicate is part of the read, not a sweep that
 * may not have run: an expired run loses access on the next request whether or not anything purged
 * it. The caller must already have resolved characterId under its own owner predicate.
 * @param pool - The application pool.
 * @param characterId - A character id the caller resolved with its own owner predicate.
 * @param version - The model version.
 * @param cellIndex - The cell index.
 * @returns The stored image, or null when there is none or it has expired.
 */
export async function readCellImage(
  pool: AppContext['pool'],
  characterId: string,
  version: number,
  cellIndex: number,
): Promise<StoredCellImage | null> {
  const row = (await pool.query(
    `SELECT content_type, image FROM oshal_lora_cell_images
      WHERE character_id = $1 AND version = $2 AND cell_index = $3 AND expires_at > NOW()
        AND ${LIVE_SCORE_CELL}`,
    [characterId, version, cellIndex],
  )).rows[0] as { content_type: string; image: Buffer } | undefined;
  if (!row) return null;
  const contentType = row.content_type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return { contentType, bytes: Buffer.from(row.image) };
}

/**
 * @description List the cell indexes of one run that currently have a live thumbnail. The scorecard
 * read uses this to tell the studio which cells it may render, so the studio never has to trust a
 * string the GPU box supplied to build an image source.
 * @param pool - The application pool.
 * @param characterId - A character id the caller resolved with its own owner predicate.
 * @param version - The model version.
 * @returns Ascending cell indexes with a live thumbnail.
 */
export async function hostedCellIndexes(
  pool: AppContext['pool'],
  characterId: string,
  version: number,
): Promise<number[]> {
  const rows = (await pool.query(
    `SELECT cell_index FROM oshal_lora_cell_images
      WHERE character_id = $1 AND version = $2 AND expires_at > NOW()
        AND ${LIVE_SCORE_CELL}
      ORDER BY cell_index ASC`,
    [characterId, version],
  )).rows as Array<{ cell_index: number }>;
  return rows.map((row) => Number(row.cell_index)).filter((index) => Number.isInteger(index));
}

/**
 * @description Delete every thumbnail belonging to one run. Called when the owner deletes the run,
 * so "deleted runs lose access" is a deletion rather than a hidden row.
 * @param pool - The application pool.
 * @param characterId - A character id the caller resolved with its own owner predicate.
 * @param version - The model version being deleted.
 * @returns The number of thumbnails removed.
 */
export async function deleteRunCellImages(
  pool: AppContext['pool'],
  characterId: string,
  version: number,
): Promise<number> {
  const result = await pool.query(
    'DELETE FROM oshal_lora_cell_images WHERE character_id = $1 AND version = $2',
    [characterId, version],
  );
  return Number(result.rowCount ?? 0);
}

/**
 * @description Remove already-expired thumbnails for one character. Reads are safe without this —
 * they filter on the expiry — so this exists to reclaim the bytes rather than to enforce access.
 * @param pool - The application pool.
 * @param characterId - A character id the caller resolved with its own owner predicate.
 * @returns The number of expired thumbnails removed.
 */
export async function purgeExpiredCellImages(
  pool: AppContext['pool'],
  characterId: string,
): Promise<number> {
  const result = await pool.query(
    'DELETE FROM oshal_lora_cell_images WHERE character_id = $1 AND expires_at <= NOW()',
    [characterId],
  );
  return Number(result.rowCount ?? 0);
}
