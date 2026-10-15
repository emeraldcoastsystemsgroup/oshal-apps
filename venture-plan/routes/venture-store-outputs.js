"use strict";
/**
 * Venture Plan — immutable model snapshots and versioned documents.
 *
 * NOTHING HERE IS EVER UPDATED. A recompute inserts a new `venture_models` row; a
 * regenerated document inserts a new `venture_documents` row with `version + 1`.
 * That is what makes "this funding memo was rendered from a model whose inputs
 * have since changed" a provable statement rather than a hunch: the document holds
 * the `model_id` it came from, and the model holds the `inputs_hash` of the exact
 * assumption set that produced it.
 *
 * THE VERSION NUMBER IS ALLOCATED INSIDE THE SAME TRANSACTION AS THE INSERT.
 * `SELECT MAX(version) + 1` in one statement and `INSERT` in another is a race two
 * concurrent regenerations of the same document lose — both read 3, both write 4,
 * and the unique index rejects one of them AFTER the caller was told it succeeded.
 * The insert below reads the max in a sub-select of the insert itself, so Postgres
 * serialises it and the unique index becomes a backstop rather than the mechanism.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — immutable model snapshot persistence with inputs hashing, latest/by-id reads scoped to the owner, and single-statement version allocation for document inserts so two concurrent regenerations cannot collide.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | insertDocumentVersions stores a run's whole document set in one statement after one version read. A native
 *   run stored its 17 computed documents with 17 inserts inside its 60-second request; live under load the request ran out
 *   (503 "package call timed out") after the model was stored and before the documents were, so they kept the earlier numbers.
 *   insertDocumentVersion casts its repeated parameters: PostgreSQL refused it ("inconsistent types deduced for parameter
 *   $2", owner_sub is VARCHAR in the WHERE and untyped in the SELECT list), so a narrated document was never stored there.
 *
 * @module venture-store-outputs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashInputs = hashInputs;
exports.insertModel = insertModel;
exports.latestModel = latestModel;
exports.getModel = getModel;
exports.insertDocumentVersion = insertDocumentVersion;
exports.insertDocumentVersions = insertDocumentVersions;
exports.listDocuments = listDocuments;
exports.getDocument = getDocument;
exports.documentHistory = documentHistory;
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const log = (0, logger_1.createChildLogger)({ module: 'venture-store-outputs' });
/** Map a models row to the API shape. */
function toModel(r) {
    return {
        id: String(r.id),
        ventureId: String(r.venture_id),
        scenarioId: r.scenario_id ? String(r.scenario_id) : null,
        runId: r.run_id ? String(r.run_id) : null,
        engineVersion: String(r.engine_version),
        inputsHash: String(r.inputs_hash),
        figures: (r.figures ?? {}),
        tables: (r.tables ?? {}),
        coverage: (r.coverage ?? {}),
        warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
        posture: String(r.posture),
        canPublish: r.can_publish === true,
        computedAt: new Date(r.computed_at).toISOString(),
    };
}
/**
 * @description Hash the exact inputs a model was computed from.
 *
 * Sorted keys, so the hash is a function of the VALUES rather than of object
 * insertion order — two identical assumption sets must hash identically or the
 * "your document is stale" signal fires on every recompute and nobody believes it
 * any more.
 *
 * @param engineVersion - The engine version string, folded in so an engine change
 *   invalidates every prior hash exactly as an input change would.
 * @param values - Assumption key -> numeric value.
 * @returns A 64-character hex digest.
 */
function hashInputs(engineVersion, values) {
    const canonical = Object.keys(values)
        .sort()
        .map((k) => `${k}=${values[k] === null ? '' : String(values[k])}`)
        .join('\n');
    return (0, crypto_1.createHash)('sha256').update(`${engineVersion}\n${canonical}`).digest('hex');
}
/**
 * @description Persist a computed model snapshot.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param m - The computed snapshot.
 * @returns The stored snapshot, including its assigned id.
 */
async function insertModel(pool, ownerSub, ventureId, m) {
    const { rows } = await pool.query(`INSERT INTO venture_models (venture_id, owner_sub, scenario_id, run_id, engine_version,
       inputs_hash, figures, tables, coverage, warnings, posture, can_publish)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12) RETURNING *`, [ventureId, ownerSub, m.scenarioId, m.runId, m.engineVersion, m.inputsHash,
        JSON.stringify(m.figures), JSON.stringify(m.tables), JSON.stringify(m.coverage),
        JSON.stringify(m.warnings), m.posture, m.canPublish]);
    log.info({ ownerSub, ventureId, modelId: rows[0].id, posture: m.posture, canPublish: m.canPublish }, 'model snapshot stored');
    return toModel(rows[0]);
}
/**
 * @description The newest snapshot for a venture, optionally for one scenario.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param scenarioId - Scenario id, or null for the base model.
 * @returns The snapshot, or null when nothing has been computed yet.
 */
async function latestModel(pool, ownerSub, ventureId, scenarioId) {
    const { rows } = scenarioId
        ? await pool.query(`SELECT * FROM venture_models WHERE venture_id = $1 AND owner_sub = $2 AND scenario_id = $3
       ORDER BY computed_at DESC LIMIT 1`, [ventureId, ownerSub, scenarioId])
        : await pool.query(`SELECT * FROM venture_models WHERE venture_id = $1 AND owner_sub = $2 AND scenario_id IS NULL
       ORDER BY computed_at DESC LIMIT 1`, [ventureId, ownerSub]);
    return rows.length ? toModel(rows[0]) : null;
}
/**
 * @description Read one snapshot by id, scoped to its owner.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param modelId - Snapshot id.
 * @returns The snapshot, or null.
 */
async function getModel(pool, ownerSub, modelId) {
    const { rows } = await pool.query('SELECT * FROM venture_models WHERE id = $1 AND owner_sub = $2', [modelId, ownerSub]);
    return rows.length ? toModel(rows[0]) : null;
}
/** Map a documents row to the API shape. */
function toDocument(r) {
    return {
        id: String(r.id),
        ventureId: String(r.venture_id),
        docKey: String(r.doc_key),
        version: Number(r.version),
        modelId: String(r.model_id),
        title: String(r.title),
        bodyMd: String(r.body_md),
        sections: Array.isArray(r.sections) ? r.sections : [],
        proseRunId: r.prose_run_id ? String(r.prose_run_id) : null,
        proseStatus: String(r.prose_status),
        unverifiedNumbers: Array.isArray(r.unverified_numbers) ? r.unverified_numbers.map(String) : [],
        assumptionsCited: Array.isArray(r.assumptions_cited) ? r.assumptions_cited.map(String) : [],
        estimatePct: Number(r.estimate_pct),
        createdAt: new Date(r.created_at).toISOString(),
    };
}
/**
 * @description Insert the next version of a document.
 *
 * The version number is computed in a sub-select of the INSERT itself rather than
 * by a prior SELECT, so two concurrent regenerations serialise instead of racing
 * to the same number. Documents are never updated; the previous version stays
 * readable through `documentHistory`.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param d - The rendered document.
 * @returns The stored document with its allocated version.
 */
async function insertDocumentVersion(pool, ownerSub, ventureId, d) {
    const { rows } = await pool.query(`INSERT INTO venture_documents (venture_id, owner_sub, doc_key, version, model_id, title,
       body_md, sections, prose_run_id, prose_status, unverified_numbers, assumptions_cited,
       estimate_pct)
     SELECT $1::uuid, $2::text, $3::text,
       COALESCE((SELECT MAX(version) FROM venture_documents
                 WHERE venture_id = $1::uuid AND owner_sub = $2::text AND doc_key = $3::text), 0) + 1,
       $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12
     RETURNING *`, [ventureId, ownerSub, d.docKey, d.modelId, d.title, d.bodyMd,
        JSON.stringify(d.sections), d.proseRunId ?? null, d.proseStatus ?? 'none',
        JSON.stringify(d.unverifiedNumbers ?? []), JSON.stringify(d.assumptionsCited ?? []),
        d.estimatePct ?? 100]);
    return toDocument(rows[0]);
}
/** The largest JSON one batched document insert carries; a bigger set is split across statements. */
const DOCUMENT_BATCH_BYTES = 2 * 1024 * 1024;
/** One batch of documents as the recordset the INSERT reads, with each version allocated. */
function documentRecords(docs, latest) {
    return docs.map((d) => ({
        doc_key: d.docKey, version: (latest.get(d.docKey) ?? 0) + 1, model_id: d.modelId, title: d.title,
        body_md: d.bodyMd, sections: d.sections, prose_run_id: d.proseRunId ?? null, prose_status: d.proseStatus ?? 'none',
        unverified_numbers: d.unverifiedNumbers ?? [], assumptions_cited: d.assumptionsCited ?? [], estimate_pct: d.estimatePct ?? 100,
    }));
}
/** Split records into batches no larger than DOCUMENT_BATCH_BYTES of JSON (one record always fits its own batch). */
function documentBatches(records) {
    const batches = [];
    let current = [];
    let bytes = 0;
    for (const r of records) {
        const size = JSON.stringify(r).length;
        if (current.length && bytes + size > DOCUMENT_BATCH_BYTES) {
            batches.push(current);
            current = [];
            bytes = 0;
        }
        current.push(r);
        bytes += size;
    }
    if (current.length)
        batches.push(current);
    return batches;
}
/**
 * @description Insert the next version of several documents in one statement per 2 MiB of documents.
 *
 * The current versions are read once and each document gets the next one; a document key appearing
 * twice keeps only its last entry, because the (venture, document, version) unique index would refuse
 * the pair. A concurrent writer of the same document is refused by that index rather than overwritten.
 * Documents are never updated; earlier versions stay readable through `documentHistory`.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param docs - The rendered documents.
 * @returns How many document versions were stored.
 */
async function insertDocumentVersions(pool, ownerSub, ventureId, docs) {
    const unique = [...new Map(docs.map((d) => [d.docKey, d])).values()];
    if (!unique.length)
        return 0;
    const { rows } = await pool.query(`SELECT doc_key, MAX(version) AS version FROM venture_documents
     WHERE venture_id = $1 AND owner_sub = $2 GROUP BY doc_key`, [ventureId, ownerSub]);
    const latest = new Map(rows.map((r) => [String(r.doc_key), Number(r.version)]));
    let stored = 0;
    for (const batch of documentBatches(documentRecords(unique, latest))) {
        const result = await pool.query(`INSERT INTO venture_documents (venture_id, owner_sub, doc_key, version, model_id, title,
         body_md, sections, prose_run_id, prose_status, unverified_numbers, assumptions_cited, estimate_pct)
       SELECT $1, $2, x.doc_key, x.version, x.model_id, x.title, x.body_md, x.sections, x.prose_run_id,
         x.prose_status, x.unverified_numbers, x.assumptions_cited, x.estimate_pct
       FROM jsonb_to_recordset($3::jsonb) AS x(doc_key text, version integer, model_id uuid, title text,
         body_md text, sections jsonb, prose_run_id uuid, prose_status text, unverified_numbers jsonb,
         assumptions_cited jsonb, estimate_pct numeric)
       RETURNING doc_key`, [ventureId, ownerSub, JSON.stringify(batch)]);
        stored += result.rows.length;
    }
    return stored;
}
/**
 * @description The newest version of every document a venture has.
 *
 * `DISTINCT ON (doc_key)` with a descending version order is what makes this one
 * query rather than one query per document key.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param includeBody - When false the (large) markdown body is omitted, which is
 *   what the list view wants.
 * @returns The newest version of each document.
 */
async function listDocuments(pool, ownerSub, ventureId, includeBody) {
    const { rows } = await pool.query(`SELECT DISTINCT ON (doc_key) * FROM venture_documents
     WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY doc_key, version DESC LIMIT 100`, [ventureId, ownerSub]);
    return rows.map((r) => {
        const doc = toDocument(r);
        return includeBody ? doc : { ...doc, bodyMd: '' };
    });
}
/**
 * @description Read the newest version of one document, or a specific version.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param docKey - Document key.
 * @param version - A specific version, or null for the newest.
 * @returns The document, or null.
 */
async function getDocument(pool, ownerSub, ventureId, docKey, version) {
    const { rows } = version === null
        ? await pool.query(`SELECT * FROM venture_documents WHERE venture_id = $1 AND owner_sub = $2 AND doc_key = $3
       ORDER BY version DESC LIMIT 1`, [ventureId, ownerSub, docKey])
        : await pool.query(`SELECT * FROM venture_documents WHERE venture_id = $1 AND owner_sub = $2 AND doc_key = $3
         AND version = $4`, [ventureId, ownerSub, docKey, version]);
    return rows.length ? toDocument(rows[0]) : null;
}
/**
 * @description Every version of one document, newest first, without bodies.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param docKey - Document key.
 * @returns The version history.
 */
async function documentHistory(pool, ownerSub, ventureId, docKey) {
    const { rows } = await pool.query(`SELECT * FROM venture_documents WHERE venture_id = $1 AND owner_sub = $2 AND doc_key = $3
     ORDER BY version DESC LIMIT 100`, [ventureId, ownerSub, docKey]);
    return rows.map((r) => ({ ...toDocument(r), bodyMd: '' }));
}
//# sourceMappingURL=venture-store-outputs.js.map