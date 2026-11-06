/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fence original image import attempts to exact owner, image, revision and ticket before download, filesystem write and acknowledgement.
 */
import type { AppContext } from '@/app/composition/app-context';
import { editorAccess, editorOwnerKey, editorTransaction, assertEditorCharacterOwner } from './lora-caption-editor';
class ImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
/** One immutable ticket/revision binding per import attempt prevents delayed source jobs from replacing a newer failed-attempt retry. */
export async function bindDatasetImport(ctx: AppContext, characterId: string, imageId: string, ticketId: string): Promise<number> {
  const a = await editorAccess(ctx, 'lora.configure');
  await assertEditorCharacterOwner(ctx, characterId, a);
  await editorAccess(ctx, 'lora.execute', a);
  return editorTransaction(ctx, 'lora.execute', a, async client => {
    const row = (await client.query(`INSERT INTO oshal_lora_dataset_imports(image_id,character_id,owner_key,import_revision,ticket_id) VALUES($1,$2,$3,1,$4) ON CONFLICT(image_id) DO UPDATE SET import_revision=oshal_lora_dataset_imports.import_revision+1,ticket_id=EXCLUDED.ticket_id,updated_at=NOW() WHERE oshal_lora_dataset_imports.owner_key=EXCLUDED.owner_key RETURNING import_revision`, [imageId, characterId, editorOwnerKey(a), ticketId])).rows[0];
    if (!row) throw new ImportError('The import source belongs to a different original person.', 403);
    return Number(row.import_revision);
  });
}
export async function checkDatasetImport(ctx: AppContext, characterId: string, imageId: string, revisionValue: number, ticketId: string, configure: boolean): Promise<any> {
  const a = await editorAccess(ctx, 'lora.execute');
  await assertEditorCharacterOwner(ctx, characterId, a);
  if (configure) await editorAccess(ctx, 'lora.configure', a);
  const row = (await ctx.pool.query(`SELECT d.id,d.filename,d.caption,d.status FROM oshal_lora_dataset_images d JOIN oshal_lora_dataset_imports i ON i.image_id=d.id WHERE d.id=$1 AND d.character_id=$2 AND i.owner_key=$3 AND i.import_revision=$4 AND i.ticket_id=$5 AND d.status='queued'`, [imageId, characterId, editorOwnerKey(a), revisionValue, ticketId])).rows[0];
  if (!row) throw new ImportError('The dataset import is stale or belongs to another image.', 409);
  await editorAccess(ctx, 'lora.execute', a);
  if (configure) await editorAccess(ctx, 'lora.configure', a);
  return row;
}
