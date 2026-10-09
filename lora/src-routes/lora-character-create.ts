/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate character command fields before persistence and serialize each owner's creation check/insert in a bounded transaction, preventing concurrent identity reuse without changing existing rows.
 */
import type { PoolClient } from 'pg';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { isValidCharacterSubject } from './lora-train-dispatch';

const logger = createChildLogger({ module: 'lora-character-create' });
const KEYS = ['subject', 'displayName', 'triggerWord', 'heroImage', 'identPrompt', 'negativePrompt',
  'identityStructure', 'identityViolation', 'baseModel'] as const;
type Fields = Record<typeof KEYS[number], string>;
type Outcome = { status: number; body: Record<string, unknown> };
const refusal = (error: string, message: string): Outcome => ({ status: 400, body: { error, message } });

function parseFields(body: unknown): Fields | Outcome {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refusal('invalid_body', 'Provide a character configuration object.');
  const fields = {} as Fields;
  for (const key of KEYS) {
    const value = (body as Record<string, unknown>)[key] ?? '';
    if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 2048) {
      return refusal('invalid_field', `${key} must be text of at most 2048 UTF-8 bytes with no NUL characters.`);
    }
    fields[key] = value.trim();
  }
  if (!isValidCharacterSubject(fields.subject)) return refusal('invalid_subject', 'subject must be 1–64 letters, digits, dots, dashes or underscores, starting with a letter or digit.');
  if (!fields.heroImage) return refusal('hero_required', 'heroImage is the identity anchor every version is scored against.');
  if (!fields.identPrompt) return refusal('ident_required', 'identPrompt is the look every training image is generated from.');
  if (Boolean(fields.identityStructure) !== Boolean(fields.identityViolation)) {
    return refusal('structural_pair_incomplete', 'Provide both identityStructure and identityViolation, or neither.');
  }
  fields.displayName ||= fields.subject;
  fields.triggerWord ||= fields.subject;
  fields.baseModel ||= 'v1-5-pruned-emaonly-fp16.safetensors';
  return fields;
}

async function insertCharacter(client: PoolClient, owner: string, fields: Fields): Promise<Outcome> {
  const clash = (await client.query(
    `SELECT subject FROM oshal_lora_characters
      WHERE owner_sub = $1 AND (hero_image = $2 OR ident_prompt = $3) LIMIT 1`,
    [owner, fields.heroImage, fields.identPrompt],
  )).rows[0] as { subject: string } | undefined;
  if (clash) return { status: 409, body: { error: 'identity_artifact_reused', conflictsWith: clash.subject,
    message: `"${clash.subject}" already uses that hero image or identity sentence. A new character needs its own.` } };
  const inserted = await client.query(
    `INSERT INTO oshal_lora_characters
       (subject, display_name, trigger_word, hero_image, base_model, ident_prompt,
        negative_prompt, identity_structure, identity_violation, owner_sub)
     VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), $10)
     ON CONFLICT (owner_sub, subject) DO NOTHING RETURNING subject`,
    [fields.subject, fields.displayName, fields.triggerWord, fields.heroImage, fields.baseModel,
      fields.identPrompt, fields.negativePrompt, fields.identityStructure, fields.identityViolation, owner],
  );
  if (!inserted.rowCount) return { status: 409, body: { error: 'character already exists', subject: fields.subject } };
  return { status: 201, body: { ok: true, subject: fields.subject,
    message: 'Character saved. No training was started. Prepare its owned dataset and compatible GPU worker before training.' } };
}

/**
 * @description Persist a bounded configuration under a transaction-local owner lock across replicas.
 * @param ctx - Application context with its request-identity-aware pool.
 * @param owner - Authenticated owner, never taken from the body.
 * @param body - Untrusted configuration; refused before connecting when malformed.
 * @returns The API response after commit, or a safe refusal with no partial write.
 */
export async function createLoraCharacter(ctx: AppContext, owner: string, body: unknown): Promise<Outcome> {
  const fields = parseFields(body);
  if ('status' in fields) return fields;
  const client = await ctx.pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lora-character-create:${owner}`]);
    const outcome = await insertCharacter(client, owner, fields);
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    logger.error({ code }, 'character transaction failed');
    try { await client.query('ROLLBACK'); } catch {
      destroy = true;
      logger.error('character transaction rollback failed; discarding connection');
    }
    if (code === '55P03') return { status: 503, body: { error: 'character_creation_busy', message: 'Another character operation is still running. Retry shortly.' } };
    throw err;
  } finally { client.release(destroy); }
}
