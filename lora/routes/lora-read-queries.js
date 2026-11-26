"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveTrainingState = deriveTrainingState;
exports.listOwnerCharacters = listOwnerCharacters;
exports.listOwnerModels = listOwnerModels;
/** Derive the current training/run state from a character's aggregate model counts and latest status. */
function deriveTrainingState(row) {
    if (Number(row.training_count ?? 0) > 0)
        return 'training';
    if (Number(row.queued_count ?? 0) > 0)
        return 'queued';
    const latest = String(row.latest_status ?? '').trim();
    if (latest === 'validating')
        return 'validating';
    if (latest === 'scored' || latest === 'trained')
        return 'ready';
    if (latest === 'failed')
        return 'failed';
    return 'idle';
}
function formatCharacterRow(raw) {
    const { training_count: _tc, queued_count: _qc, ...rest } = raw;
    const datasetCount = Number(raw.dataset_count ?? 0);
    const activeModelVersion = raw.active_version == null ? null : Number(raw.active_version);
    const trainingState = deriveTrainingState(raw);
    return {
        ...rest,
        dataset_count: datasetCount,
        datasetCount,
        activeModelVersion,
        training_state: trainingState,
        trainingState,
        activeRunState: trainingState,
        latest_status: raw.latest_status ?? null,
    };
}
/**
 * @description The caller's characters, oldest first, each with dataset count, version count,
 * latest version, active model version, latest overall score, and current training state. Pure read.
 */
async function listOwnerCharacters(ctx, ownerSub) {
    const rows = (await ctx.pool.query(`SELECT c.subject, c.display_name, c.trigger_word, c.hero_image, c.base_model, c.ident_prompt,
            'lora-' || replace(c.id::text, '-', '') AS storage_key,
            c.negative_prompt, c.identity_structure, c.identity_violation,
            c.autonomous, c.max_hours, c.plateau_epsilon, c.active_version, c.created_at,
            (SELECT max(version) FROM oshal_lora_models m WHERE m.character_id = c.id) AS latest_version,
            (SELECT count(*) FROM oshal_lora_models m WHERE m.character_id = c.id) AS version_count,
            (SELECT count(*) FROM oshal_lora_dataset_images d WHERE d.character_id = c.id) AS dataset_count,
            (SELECT m.status FROM oshal_lora_models m WHERE m.character_id = c.id ORDER BY m.version DESC LIMIT 1) AS latest_status,
            (SELECT count(*) FROM oshal_lora_models m WHERE m.character_id = c.id AND m.status = 'training') AS training_count,
            (SELECT count(*) FROM oshal_lora_models m WHERE m.character_id = c.id AND m.status = 'queued') AS queued_count,
            (SELECT s.overall FROM oshal_lora_scores s WHERE s.character_id = c.id ORDER BY s.version DESC LIMIT 1) AS latest_score
     FROM oshal_lora_characters c
     WHERE c.owner_sub = $1
     ORDER BY c.created_at ASC`, [ownerSub])).rows;
    return rows.map(formatCharacterRow);
}
function formatModelRow(raw, fallbackSubject, fallbackDisplayName, fallbackActiveVersion) {
    const { active_version: rowActive, ...rest } = raw;
    const activeVersion = rowActive !== undefined ? rowActive : fallbackActiveVersion;
    const active = activeVersion != null && Number(activeVersion) === Number(raw.version);
    return {
        ...rest,
        subject: raw.subject ?? fallbackSubject ?? null,
        display_name: raw.display_name ?? fallbackDisplayName ?? null,
        active,
    };
}
/**
 * @description List the signed-in owner's trained model versions. When `subject` is provided,
 * filters to that character (returning null if not owned/found); when omitted, returns all
 * versions across all of the owner's characters, newest first. Pure read.
 */
async function listOwnerModels(ctx, ownerSub, subject) {
    if (subject) {
        const char = (await ctx.pool.query('SELECT id, subject, display_name, active_version FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2', [subject, ownerSub])).rows[0];
        if (!char)
            return null;
        const rows = (await ctx.pool.query(`SELECT m.version, m.status, m.lora_path, m.base_model, m.dataset_count, m.network_dim, m.epochs,
              m.steps, m.final_loss, m.duration_sec, m.parent_version, m.ticket_id, m.created_at,
              s.overall, s.identity_mean, s.quality_mean, s.min_cell, s.weak_cells, s.gallery_url
       FROM oshal_lora_models m
       LEFT JOIN oshal_lora_scores s ON s.character_id = m.character_id AND s.version = m.version
       WHERE m.character_id = $1 ORDER BY m.version DESC`, [char.id])).rows;
        return {
            subject: char.subject,
            models: rows.map((row) => formatModelRow(row, char.subject, char.display_name, char.active_version)),
        };
    }
    const rows = (await ctx.pool.query(`SELECT c.subject, c.display_name, c.active_version,
            m.version, m.status, m.lora_path, m.base_model, m.dataset_count, m.network_dim, m.epochs,
            m.steps, m.final_loss, m.duration_sec, m.parent_version, m.ticket_id, m.created_at,
            s.overall, s.identity_mean, s.quality_mean, s.min_cell, s.weak_cells, s.gallery_url
     FROM oshal_lora_models m
     JOIN oshal_lora_characters c ON c.id = m.character_id
     LEFT JOIN oshal_lora_scores s ON s.character_id = m.character_id AND s.version = m.version
     WHERE c.owner_sub = $1
     ORDER BY m.created_at DESC, m.version DESC`, [ownerSub])).rows;
    return { subject: null, models: rows.map((row) => formatModelRow(row)) };
}
