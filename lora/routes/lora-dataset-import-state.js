"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindDatasetImport = bindDatasetImport;
exports.checkDatasetImport = checkDatasetImport;
const lora_caption_editor_1 = require("./lora-caption-editor");
class ImportError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
/** One immutable ticket/revision binding per import attempt prevents delayed source jobs from replacing a newer failed-attempt retry. */
async function bindDatasetImport(ctx, characterId, imageId, ticketId) {
    const a = await (0, lora_caption_editor_1.editorAccess)(ctx, 'lora.configure');
    await (0, lora_caption_editor_1.assertEditorCharacterOwner)(ctx, characterId, a);
    await (0, lora_caption_editor_1.editorAccess)(ctx, 'lora.execute', a);
    return (0, lora_caption_editor_1.editorTransaction)(ctx, 'lora.execute', a, async (client) => {
        const row = (await client.query(`INSERT INTO oshal_lora_dataset_imports(image_id,character_id,owner_key,import_revision,ticket_id) VALUES($1,$2,$3,1,$4) ON CONFLICT(image_id) DO UPDATE SET import_revision=oshal_lora_dataset_imports.import_revision+1,ticket_id=EXCLUDED.ticket_id,updated_at=NOW() WHERE oshal_lora_dataset_imports.owner_key=EXCLUDED.owner_key RETURNING import_revision`, [imageId, characterId, (0, lora_caption_editor_1.editorOwnerKey)(a), ticketId])).rows[0];
        if (!row)
            throw new ImportError('The import source belongs to a different original person.', 403);
        return Number(row.import_revision);
    });
}
async function checkDatasetImport(ctx, characterId, imageId, revisionValue, ticketId, configure) {
    const a = await (0, lora_caption_editor_1.editorAccess)(ctx, 'lora.execute');
    await (0, lora_caption_editor_1.assertEditorCharacterOwner)(ctx, characterId, a);
    if (configure)
        await (0, lora_caption_editor_1.editorAccess)(ctx, 'lora.configure', a);
    const row = (await ctx.pool.query(`SELECT d.id,d.filename,d.caption,d.status FROM oshal_lora_dataset_images d JOIN oshal_lora_dataset_imports i ON i.image_id=d.id WHERE d.id=$1 AND d.character_id=$2 AND i.owner_key=$3 AND i.import_revision=$4 AND i.ticket_id=$5 AND d.status='queued'`, [imageId, characterId, (0, lora_caption_editor_1.editorOwnerKey)(a), revisionValue, ticketId])).rows[0];
    if (!row)
        throw new ImportError('The dataset import is stale or belongs to another image.', 409);
    await (0, lora_caption_editor_1.editorAccess)(ctx, 'lora.execute', a);
    if (configure)
        await (0, lora_caption_editor_1.editorAccess)(ctx, 'lora.configure', a);
    return row;
}
