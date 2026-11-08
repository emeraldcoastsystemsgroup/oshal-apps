"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | RP-KL-01: owner-scoped child profile store helpers (up to 8 profiles per parent, read-only legacy fallback under GET admission, and atomic legacy promotion on mutations).
 * -----------------------------------------------------------------------------
 *
 * @module youtube-children-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CHILDREN = void 0;
exports.isStoreAbsentError = isStoreAbsentError;
exports.validateChildName = validateChildName;
exports.parseChildIdInput = parseChildIdInput;
exports.parseStoredAggregate = parseStoredAggregate;
exports.allocateChildId = allocateChildId;
exports.rowToChildSummary = rowToChildSummary;
exports.listChildrenReadOnly = listChildrenReadOnly;
exports.ensureMigratedChildrenForWrite = ensureMigratedChildrenForWrite;
exports.resolveUploadChild = resolveUploadChild;
exports.MAX_CHILDREN = 8;
/** Whether a store error simply indicates the table has not been provisioned yet. */
function isStoreAbsentError(err) {
    const e = err;
    if (!e)
        return false;
    return e.code === '42P01' || /SQL schema is not provisioned|no such table/i.test(String(e.message || ''));
}
/** Validate and normalize a child's display first name (1..40 printable characters). */
function validateChildName(raw) {
    const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name)
        return { ok: false, message: 'Enter your child\'s first name.' };
    if (name.length > 40)
        return { ok: false, message: 'Keep the child name to 40 characters or fewer.' };
    return { ok: true, name };
}
/** Parse an optional childId parameter from query or body, failing closed on malformed tokens. */
function parseChildIdInput(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '')
        return { provided: false };
    const id = String(raw).trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(id))
        return { provided: true, invalid: true };
    return { provided: true, childId: id };
}
/** Parse a stored aggregate value whether returned as JSONB object or SQLite JSON string. */
function parseStoredAggregate(raw) {
    if (!raw)
        return null;
    if (typeof raw === 'object')
        return raw;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    return null;
}
/** Mint a readable, collision-free child_id slug for a parent's household. */
function allocateChildId(name, existingIds) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'child';
    if (!existingIds.has(base) && base !== 'default')
        return base;
    let seq = 2;
    while (existingIds.has(`${base}-${seq}`))
        seq += 1;
    return `${base}-${seq}`;
}
/** Map a database row from oshal_youtube_children (or legacy fallback) into ChildSummary. */
function rowToChildSummary(row, fallbackId = 'default', fallbackName = 'Child 1') {
    const agg = parseStoredAggregate(row.aggregate);
    const dateRange = row.date_range ?? agg?.dateRange ?? null;
    const hasData = Boolean(row.has_data ?? (agg !== null || row.total_watched != null));
    const hasBrief = Boolean(row.has_brief ?? (typeof row.brief === 'string' && row.brief.trim().length > 0));
    return {
        childId: typeof row.child_id === 'string' && row.child_id ? row.child_id : fallbackId,
        name: typeof row.name === 'string' && row.name ? row.name : fallbackName,
        hasData,
        totalWatched: Number(row.total_watched ?? agg?.totalWatched ?? 0),
        hasBrief,
        uploadedAt: row.uploaded_at ? String(row.uploaded_at) : null,
        briefAt: row.brief_at ? String(row.brief_at) : null,
        dateRange,
    };
}
/** Read-only list of a parent's child profiles, falling back to legacy oshal_youtube_activity without mutating. */
async function listChildrenReadOnly(pool, sub) {
    try {
        const res = await pool.query(`SELECT child_id, name, aggregate, total_watched, brief, uploaded_at, brief_at
         FROM oshal_youtube_children
        WHERE user_sub = $1
        ORDER BY created_at ASC, child_id ASC`, [sub]);
        const realRows = res.rows.filter((r) => typeof r.child_id === 'string' && r.child_id.length > 0);
        if (realRows.length > 0)
            return realRows.map((r) => rowToChildSummary(r));
    }
    catch (err) {
        if (!isStoreAbsentError(err))
            throw err;
    }
    try {
        const leg = await pool.query(`SELECT aggregate, total_watched, brief, uploaded_at, brief_at
         FROM oshal_youtube_activity
        WHERE user_sub = $1`, [sub]);
        if (leg.rows[0])
            return [rowToChildSummary(leg.rows[0], 'default', 'Child 1')];
        return [];
    }
    catch (err) {
        if (isStoreAbsentError(err))
            return [];
        throw err;
    }
}
/** Promote a legacy single-child row into oshal_youtube_children on a writer path and delete the legacy row. */
async function ensureMigratedChildrenForWrite(pool, sub) {
    const existing = await pool.query(`SELECT child_id, name FROM oshal_youtube_children WHERE user_sub = $1 ORDER BY created_at ASC, child_id ASC`, [sub]);
    const real = existing.rows.filter((r) => typeof r.child_id === 'string' && r.child_id.length > 0);
    if (real.length > 0)
        return real;
    const legacy = (await pool.query(`SELECT aggregate, raw_blob, total_watched, brief, uploaded_at, brief_at FROM oshal_youtube_activity WHERE user_sub = $1`, [sub])).rows[0];
    if (!legacy || (legacy.aggregate == null && legacy.raw_blob == null && legacy.brief == null))
        return [];
    const aggJson = legacy.aggregate == null
        ? null
        : typeof legacy.aggregate === 'string' ? legacy.aggregate : JSON.stringify(legacy.aggregate);
    await pool.query(`INSERT INTO oshal_youtube_children (user_sub, child_id, name, aggregate, raw_blob, total_watched, brief, uploaded_at, brief_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_sub, child_id) DO NOTHING`, [sub, 'child-1', 'Child 1', aggJson, legacy.raw_blob ?? null, legacy.total_watched ?? null, legacy.brief ?? null, legacy.uploaded_at ?? null, legacy.brief_at ?? null]);
    await pool.query(`DELETE FROM oshal_youtube_activity WHERE user_sub = $1`, [sub]);
    return [{ child_id: 'child-1', name: 'Child 1' }];
}
/** Resolve the target child for an upload or create 'Child 1' when the parent has not added a profile yet. */
async function resolveUploadChild(pool, sub, requestedChildId) {
    const children = await ensureMigratedChildrenForWrite(pool, sub);
    if (requestedChildId && requestedChildId !== 'default') {
        const found = children.find((c) => c.child_id === requestedChildId);
        if (!found) {
            const err = new Error('No child profile with that ID.');
            err.code = 'child_not_found';
            throw err;
        }
        return { childId: found.child_id, name: found.name };
    }
    if (children.length > 0)
        return { childId: children[0].child_id, name: children[0].name };
    return { childId: 'child-1', name: 'Child 1' };
}
