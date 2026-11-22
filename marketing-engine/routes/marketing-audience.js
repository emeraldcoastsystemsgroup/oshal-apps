"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine P1 audience store routes
 *     (/api/marketing/audience/*): owner-scoped contact CRUD & segmentation (by list, tag,
 *     consent state, channel, purpose, suppression, search), recipient consent evidence capture
 *     and export, contact deletion with pre-delete consent export leaving zero rows behind,
 *     audience lists & memberships, and normalized-hash suppressions. Mirrors migration
 *     003-marketing-audience.sql at the lazy-DDL chokepoint.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.1 P1 CSV import with
 *     consent attestation (`POST /audience/contacts/import-csv`): atomic refusal when any row
 *     lacks a consent source, pending-by-default unless documented prior consent is present,
 *     strict refusal to re-subscribe suppressed addresses, list ownership validation, and
 *     per-contact consent evidence persistence.
 *
 * @module marketing-audience
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAudienceSchema = ensureAudienceSchema;
exports.listContacts = listContacts;
exports.upsertContact = upsertContact;
exports.exportContactConsent = exportContactConsent;
exports.deleteContact = deleteContact;
exports.listLists = listLists;
exports.createList = createList;
exports.addListMembers = addListMembers;
exports.removeListMember = removeListMember;
exports.listSuppressions = listSuppressions;
exports.createSuppression = createSuppression;
exports.deleteSuppression = deleteSuppression;
exports.importContactsCsv = importContactsCsv;
exports.registerAudienceRoutes = registerAudienceRoutes;
const crypto = __importStar(require("crypto"));
const database_1 = require("@/shared/services/database");
const marketing_audience_model_1 = require("./marketing-audience-model");
const marketing_audience_csv_1 = require("./marketing-audience-csv");
const marketing_support_1 = require("./marketing-support");
/** Lazy-DDL mirror of migrations/003-marketing-audience.sql. */
const AUDIENCE_TABLE_DDL = [
    `CREATE TABLE IF NOT EXISTS oshal_marketing_contacts (
    contact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    email_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    tags JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced','suppressed')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, email_hash)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_contacts_owner_updated
    ON oshal_marketing_contacts (owner_sub, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_consents (
    consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
    purpose TEXT NOT NULL DEFAULT 'marketing',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','revoked')),
    evidence JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_consents_owner_contact
    ON oshal_marketing_consents (owner_sub, contact_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_lists (
    list_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, slug)
  )`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_list_members (
    owner_sub TEXT NOT NULL,
    list_id UUID NOT NULL REFERENCES oshal_marketing_lists (list_id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, contact_id)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_list_members_owner_contact
    ON oshal_marketing_list_members (owner_sub, contact_id)`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_suppressions (
    suppression_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
    address_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, channel, address_hash)
  )`,
];
const AUDIENCE_RLS_TABLES = [
    'oshal_marketing_contacts',
    'oshal_marketing_consents',
    'oshal_marketing_lists',
    'oshal_marketing_list_members',
    'oshal_marketing_suppressions',
];
/**
 * @description Ensure the 003-marketing-audience tables + owner FORCE-RLS at the lazy-DDL chokepoint.
 * @param pool - Framework pool.
 * @returns Resolves when audience tables are ensured.
 */
async function ensureAudienceSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'marketing-audience',
        statements: [
            ...AUDIENCE_TABLE_DDL,
            ...AUDIENCE_RLS_TABLES.flatMap((table) => (0, database_1.buildOwnerRlsPolicyStatements)(table, 'owner_sub')),
        ],
        requirements: [
            { table: 'oshal_marketing_contacts', columns: ['contact_id', 'owner_sub', 'email', 'email_hash', 'tags'] },
            { table: 'oshal_marketing_consents', columns: ['consent_id', 'owner_sub', 'contact_id', 'channel', 'status', 'evidence'] },
            { table: 'oshal_marketing_lists', columns: ['list_id', 'owner_sub', 'slug', 'name'] },
            { table: 'oshal_marketing_list_members', columns: ['owner_sub', 'list_id', 'contact_id'] },
            { table: 'oshal_marketing_suppressions', columns: ['suppression_id', 'owner_sub', 'channel', 'address_hash', 'reason'] },
        ],
    });
}
/** Run work inside a DB transaction when the pool supports connect(), or directly on query-only pools. */
async function withOptionalTransaction(pool, work) {
    const connectable = pool;
    if (typeof connectable.connect !== 'function')
        return work(pool);
    const client = await connectable.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        try {
            await client.query('ROLLBACK');
        }
        catch { /* rollback best-effort */ }
        throw err;
    }
    finally {
        client.release();
    }
}
/** Group rows by a string key into a Map. */
function groupBy(list, key) {
    const map = new Map();
    for (const row of list) {
        const k = String(row?.[key] ?? '');
        const bucket = map.get(k);
        if (bucket)
            bucket.push(row);
        else
            map.set(k, [row]);
    }
    return map;
}
/** Load one owner's complete contact export bundle, or null when the contact does not exist. */
async function loadContactExport(pool, sub, contactId) {
    if (!marketing_support_1.UUID_RE.test(contactId))
        return null;
    const contact = (await (0, marketing_support_1.rows)(pool, 'SELECT * FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]))[0];
    if (!contact)
        return null;
    const consents = await (0, marketing_support_1.rows)(pool, 'SELECT * FROM oshal_marketing_consents WHERE contact_id = $1 AND owner_sub = $2 ORDER BY created_at DESC', [contactId, sub]);
    const lists = await (0, marketing_support_1.rows)(pool, `SELECT l.list_id, l.slug, l.name, m.added_at
       FROM oshal_marketing_list_members m
       JOIN oshal_marketing_lists l ON l.list_id = m.list_id AND l.owner_sub = m.owner_sub
      WHERE m.contact_id = $1 AND m.owner_sub = $2
      ORDER BY m.added_at ASC`, [contactId, sub]);
    const suppressions = await (0, marketing_support_1.rows)(pool, 'SELECT * FROM oshal_marketing_suppressions WHERE address_hash = $1 AND owner_sub = $2 ORDER BY created_at DESC', [String(contact.email_hash), sub]);
    return { contact, bundle: (0, marketing_audience_model_1.buildConsentExport)(contact, consents, lists, suppressions) };
}
/**
 * @description GET /audience/contacts — list & segment contacts by list, tag, consentState,
 * channel, purpose, suppressed, and search query.
 */
async function listContacts(ctx, sub, req, res) {
    const parsed = (0, marketing_audience_model_1.parseAudienceFilters)((req.query ?? {}));
    if (parsed.error || !parsed.filters) {
        res.status(400).json({ error: parsed.error ?? 'invalid_filters' });
        return;
    }
    const [contactRows, consentRows, memberRows, suppressionRows] = await Promise.all([
        (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_contacts WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT 1000', [sub]),
        (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_consents WHERE owner_sub = $1 ORDER BY created_at DESC', [sub]),
        (0, marketing_support_1.rows)(ctx.pool, `SELECT m.contact_id, l.list_id, l.slug, l.name, m.added_at
         FROM oshal_marketing_list_members m
         JOIN oshal_marketing_lists l ON l.list_id = m.list_id AND l.owner_sub = m.owner_sub
        WHERE m.owner_sub = $1`, [sub]),
        (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1', [sub]),
    ]);
    const consentsByContact = groupBy(consentRows, 'contact_id');
    const listsByContact = groupBy(memberRows, 'contact_id');
    const suppByHash = groupBy(suppressionRows, 'address_hash');
    const hydrated = contactRows.map((c) => {
        const supps = suppByHash.get(String(c.email_hash)) ?? [];
        return {
            ...c,
            tags: Array.isArray(c.tags) ? c.tags : [],
            metadata: c.metadata && typeof c.metadata === 'object' ? c.metadata : {},
            consents: consentsByContact.get(String(c.contact_id)) ?? [],
            lists: listsByContact.get(String(c.contact_id)) ?? [],
            suppressions: supps,
            suppressed: supps.length > 0 || c.status === 'suppressed',
        };
    });
    const contacts = (0, marketing_audience_model_1.segmentContacts)(hydrated, parsed.filters);
    res.json({ contacts, total: contacts.length });
}
/** Validate an optional consent payload on contact creation. */
function parseOptionalConsent(raw, req) {
    if (raw === undefined || raw === null)
        return {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { error: 'invalid_consent' };
    const c = raw;
    const channel = String(c.channel || 'email');
    if (!marketing_audience_model_1.AUDIENCE_CHANNELS.includes(channel))
        return { error: 'invalid_channel' };
    const status = String(c.status || 'pending');
    if (!marketing_audience_model_1.CONSENT_STATES.includes(status))
        return { error: 'invalid_consent_state' };
    const purpose = typeof c.purpose === 'string' && c.purpose.trim() ? c.purpose.trim().slice(0, 120) : 'marketing';
    const uaHeader = typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    const evidence = (0, marketing_audience_model_1.normalizeConsentEvidence)(c.evidence, { ip: req.ip, userAgent: uaHeader });
    if ((0, marketing_support_1.tooLarge)(evidence, 32_000))
        return { error: 'evidence_too_large' };
    return { consent: { channel, purpose, status, evidence: evidence } };
}
/** Attach validated owner-scoped list memberships to a contact. */
async function attachInitialLists(pool, sub, contactId, listIds) {
    const attached = [];
    for (const listId of listIds) {
        const found = await (0, marketing_support_1.rows)(pool, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [listId, sub]);
        if (!found.length)
            continue;
        await pool.query(`INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id)
       VALUES ($1, $2, $3) ON CONFLICT (list_id, contact_id) DO NOTHING`, [sub, listId, contactId]);
        attached.push(listId);
    }
    return attached;
}
/** Validate and normalize the body of POST /audience/contacts. */
function parseContactBody(body, req) {
    const email = (0, marketing_audience_model_1.normalizeEmail)(body.email);
    if (!email)
        return { error: 'invalid_email' };
    const rawName = typeof body.displayName === 'string'
        ? body.displayName
        : typeof body.display_name === 'string' ? body.display_name : '';
    const displayName = rawName.trim().slice(0, 200);
    const tags = (0, marketing_audience_model_1.normalizeTags)(body.tags);
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata : {};
    if ((0, marketing_support_1.tooLarge)(metadata, 32_000))
        return { error: 'metadata_too_large' };
    const parsedConsent = parseOptionalConsent(body.consent, req);
    if (parsedConsent.error)
        return { error: parsedConsent.error };
    const listIds = Array.isArray(body.listIds)
        ? body.listIds.filter((id) => typeof id === 'string' && marketing_support_1.UUID_RE.test(id)).slice(0, 25)
        : [];
    return { email, displayName, tags, metadata, consent: parsedConsent.consent, listIds };
}
/**
 * @description POST /audience/contacts — upsert an owner-scoped contact with optional consent
 * evidence and initial list memberships. Refuses re-confirming a suppressed address.
 */
async function upsertContact(ctx, sub, req, res) {
    const parsed = parseContactBody((req.body ?? {}), req);
    if (parsed.error || !parsed.email) {
        res.status(400).json({ error: parsed.error ?? 'invalid_email' });
        return;
    }
    const emailHash = (0, marketing_audience_model_1.hashAddress)(parsed.email);
    const supps = await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND address_hash = $2', [sub, emailHash]);
    const consentChannel = parsed.consent?.channel ?? 'email';
    if (supps.some((s) => String(s.channel) === consentChannel) && parsed.consent?.status === 'confirmed') {
        res.status(409).json({ error: 'address_suppressed', channel: consentChannel });
        return;
    }
    const initialStatus = supps.length > 0 ? 'suppressed' : 'active';
    const contact = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_contacts (owner_sub, email, email_hash, display_name, tags, status, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)
     ON CONFLICT (owner_sub, email_hash) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE oshal_marketing_contacts.display_name END,
       tags = EXCLUDED.tags,
       metadata = EXCLUDED.metadata,
       status = CASE WHEN oshal_marketing_contacts.status = 'suppressed' THEN 'suppressed' ELSE EXCLUDED.status END,
       updated_at = now()
     RETURNING *`, [sub, parsed.email, emailHash, parsed.displayName ?? '', JSON.stringify(parsed.tags ?? []), initialStatus, JSON.stringify(parsed.metadata ?? {})]))[0];
    let consent = null;
    if (parsed.consent) {
        const c = parsed.consent;
        consent = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_consents (owner_sub, contact_id, channel, purpose, status, evidence)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`, [sub, String(contact.contact_id), c.channel, c.purpose, c.status, JSON.stringify(c.evidence)]))[0];
    }
    const attachedLists = parsed.listIds?.length
        ? await attachInitialLists(ctx.pool, sub, String(contact.contact_id), parsed.listIds)
        : [];
    res.status(201).json({ contact, consent, suppressed: supps.length > 0, listIds: attachedLists });
}
/**
 * @description GET /audience/contacts/:id/consent-export — export the contact profile,
 * list memberships, suppression records, and all consent rows with their sign-up evidence.
 */
async function exportContactConsent(ctx, sub, req, res) {
    const id = String(req.params.id || '');
    const loaded = await loadContactExport(ctx.pool, sub, id);
    if (!loaded) {
        res.status(404).json({ error: 'contact_not_found' });
        return;
    }
    res.json({ consentExport: loaded.bundle });
}
/**
 * @description DELETE /audience/contacts/:id — export full consent evidence first, then delete
 * the contact, its consents, and its list memberships (and matching suppression when purgeSuppression=true).
 */
async function deleteContact(ctx, sub, req, res) {
    const id = String(req.params.id || '');
    const purgeSuppression = req.query?.purgeSuppression === 'true'
        || req.body?.purgeSuppression === true;
    const result = await withOptionalTransaction(ctx.pool, async (q) => {
        const loaded = await loadContactExport(q, sub, id);
        if (!loaded)
            return null;
        await q.query('DELETE FROM oshal_marketing_list_members WHERE contact_id = $1 AND owner_sub = $2', [id, sub]);
        await q.query('DELETE FROM oshal_marketing_consents WHERE contact_id = $1 AND owner_sub = $2', [id, sub]);
        await q.query('DELETE FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [id, sub]);
        if (purgeSuppression) {
            await q.query('DELETE FROM oshal_marketing_suppressions WHERE address_hash = $1 AND owner_sub = $2', [String(loaded.contact.email_hash), sub]);
        }
        return loaded.bundle;
    });
    if (!result) {
        res.status(404).json({ error: 'contact_not_found' });
        return;
    }
    res.json({ deleted: true, contactId: id, consentExport: result });
}
/** @description GET /audience/lists — list the owner's audience lists with member counts. */
async function listLists(ctx, sub, _req, res) {
    const lists = await (0, marketing_support_1.rows)(ctx.pool, `SELECT l.*, COALESCE(m.cnt, 0)::int AS member_count
       FROM oshal_marketing_lists l
       LEFT JOIN (
         SELECT list_id, COUNT(*)::int AS cnt
           FROM oshal_marketing_list_members
          WHERE owner_sub = $1
          GROUP BY list_id
       ) m ON m.list_id = l.list_id
      WHERE l.owner_sub = $1
      ORDER BY l.created_at DESC LIMIT 200`, [sub]);
    res.json({ lists });
}
/** @description POST /audience/lists — create an owner-scoped audience list. */
async function createList(ctx, sub, req, res) {
    const b = (req.body ?? {});
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : '';
    if (!name) {
        res.status(400).json({ error: 'list_name_required' });
        return;
    }
    const rawSlug = typeof b.slug === 'string' && b.slug.trim() ? b.slug : name;
    const slug = (0, marketing_support_1.slugify)(rawSlug);
    if (!slug) {
        res.status(400).json({ error: 'list_name_not_sluggable' });
        return;
    }
    const description = typeof b.description === 'string' ? b.description.trim().slice(0, 1000) : '';
    try {
        const list = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_lists (owner_sub, slug, name, description)
       VALUES ($1,$2,$3,$4) RETURNING *`, [sub, slug, name, description]))[0];
        res.status(201).json({ list });
    }
    catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'slug_exists', slug });
            return;
        }
        throw err;
    }
}
/** @description POST /audience/lists/:id/members — add one or more owner-scoped contacts to a list. */
async function addListMembers(ctx, sub, req, res) {
    const listId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(listId)) {
        res.status(404).json({ error: 'list_not_found' });
        return;
    }
    const foundList = await (0, marketing_support_1.rows)(ctx.pool, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [listId, sub]);
    if (!foundList.length) {
        res.status(404).json({ error: 'list_not_found' });
        return;
    }
    const b = (req.body ?? {});
    const rawIds = Array.isArray(b.contactIds) ? b.contactIds : b.contactId ? [b.contactId] : [];
    const ids = [...new Set(rawIds.filter((x) => typeof x === 'string' && marketing_support_1.UUID_RE.test(x)))].slice(0, 100);
    if (!ids.length) {
        res.status(400).json({ error: 'contact_id_required' });
        return;
    }
    const added = [];
    for (const contactId of ids) {
        const found = await (0, marketing_support_1.rows)(ctx.pool, 'SELECT contact_id FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]);
        if (!found.length) {
            res.status(404).json({ error: 'contact_not_found', contactId });
            return;
        }
        await ctx.pool.query(`INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id)
       VALUES ($1,$2,$3) ON CONFLICT (list_id, contact_id) DO NOTHING`, [sub, listId, contactId]);
        added.push(contactId);
    }
    res.status(201).json({ listId, added });
}
/** @description DELETE /audience/lists/:id/members/:contactId — remove a contact from a list. */
async function removeListMember(ctx, sub, req, res) {
    const listId = String(req.params.id || '');
    const contactId = String(req.params.contactId || '');
    if (!marketing_support_1.UUID_RE.test(listId) || !marketing_support_1.UUID_RE.test(contactId)) {
        res.status(404).json({ error: 'membership_not_found' });
        return;
    }
    const r = await ctx.pool.query('DELETE FROM oshal_marketing_list_members WHERE list_id = $1 AND contact_id = $2 AND owner_sub = $3', [listId, contactId, sub]);
    if (!r.rowCount) {
        res.status(404).json({ error: 'membership_not_found' });
        return;
    }
    res.json({ removed: true, listId, contactId });
}
/** @description GET /audience/suppressions — list owner-scoped suppressions. */
async function listSuppressions(ctx, sub, req, res) {
    const channel = typeof req.query?.channel === 'string' ? req.query.channel.trim() : '';
    if (channel && !marketing_audience_model_1.AUDIENCE_CHANNELS.includes(channel)) {
        res.status(400).json({ error: 'invalid_channel' });
        return;
    }
    const sql = channel
        ? 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = $2 ORDER BY created_at DESC LIMIT 500'
        : 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT 500';
    const suppressions = await (0, marketing_support_1.rows)(ctx.pool, sql, channel ? [sub, channel] : [sub]);
    res.json({ suppressions });
}
/** @description POST /audience/suppressions — add a normalized-hash suppression and revoke matching consents. */
async function createSuppression(ctx, sub, req, res) {
    const b = (req.body ?? {});
    const channel = String(b.channel || 'email');
    if (!marketing_audience_model_1.AUDIENCE_CHANNELS.includes(channel)) {
        res.status(400).json({ error: 'invalid_channel' });
        return;
    }
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
    if (!reason) {
        res.status(400).json({ error: 'reason_required' });
        return;
    }
    const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim().slice(0, 120) : 'manual';
    const email = (0, marketing_audience_model_1.normalizeEmail)(b.email);
    const rawHash = typeof b.addressHash === 'string' ? b.addressHash.trim().toLowerCase() : '';
    const addressHash = email ? (0, marketing_audience_model_1.hashAddress)(email) : marketing_audience_model_1.SHA256_HEX_RE.test(rawHash) ? rawHash : '';
    if (!addressHash) {
        res.status(400).json({ error: 'address_or_hash_required' });
        return;
    }
    const suppression = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_suppressions (owner_sub, channel, address_hash, reason, source)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (owner_sub, channel, address_hash) DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source
     RETURNING *`, [sub, channel, addressHash, reason, source]))[0];
    const matched = await (0, marketing_support_1.rows)(ctx.pool, 'SELECT contact_id FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2', [sub, addressHash]);
    let revokedConsents = 0;
    for (const row of matched) {
        const upd = await ctx.pool.query(`UPDATE oshal_marketing_consents SET status = 'revoked', updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2 AND channel = $3 AND status <> 'revoked'`, [sub, String(row.contact_id), channel]);
        revokedConsents += Number(upd.rowCount ?? 0);
        await ctx.pool.query(`UPDATE oshal_marketing_contacts SET status = 'suppressed', updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2`, [sub, String(row.contact_id)]);
    }
    res.status(201).json({ suppression, revokedConsents });
}
/** @description DELETE /audience/suppressions/:id — remove an owner-scoped suppression row. */
async function deleteSuppression(ctx, sub, req, res) {
    const id = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(id)) {
        res.status(404).json({ error: 'suppression_not_found' });
        return;
    }
    const r = await ctx.pool.query('DELETE FROM oshal_marketing_suppressions WHERE suppression_id = $1 AND owner_sub = $2', [id, sub]);
    if (!r.rowCount) {
        res.status(404).json({ error: 'suppression_not_found' });
        return;
    }
    res.json({ deleted: true, suppressionId: id });
}
/** Validate and normalize the JSON body of POST /audience/contacts/import-csv. */
function parseImportRequestBody(body, req) {
    const channel = String(body.channel || 'email').trim();
    if (!marketing_audience_model_1.AUDIENCE_CHANNELS.includes(channel))
        return { error: 'invalid_channel' };
    const purpose = typeof body.purpose === 'string' && body.purpose.trim() ? body.purpose.trim().slice(0, 120) : 'marketing';
    let listIds = [];
    if (body.listIds !== undefined && body.listIds !== null) {
        if (!Array.isArray(body.listIds) || body.listIds.length > 25)
            return { error: 'invalid_list_id' };
        if (body.listIds.some((id) => typeof id !== 'string' || !marketing_support_1.UUID_RE.test(id)))
            return { error: 'invalid_list_id' };
        listIds = [...new Set(body.listIds)];
    }
    const importBatchId = crypto.randomUUID();
    const uaHeader = typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    const csvResult = (0, marketing_audience_csv_1.parseAudienceCsv)(body.csv, {
        consentSource: body.consentSource ?? body.consent_source,
        attestation: body.attestation,
        importBatchId,
        defaultTags: (0, marketing_audience_model_1.normalizeTags)(body.tags),
        fallbackIp: req.ip,
        fallbackUserAgent: uaHeader,
    });
    if (!csvResult.ok) {
        return { error: csvResult.error ?? 'invalid_csv_format', missingConsentSourceRows: csvResult.missingConsentSourceRows };
    }
    return {
        parsed: {
            importBatchId,
            channel,
            purpose,
            listIds,
            consentSource: csvResult.consentSource ?? null,
            totalRows: csvResult.totalRows ?? 0,
            rows: csvResult.rows ?? [],
            invalidRows: csvResult.invalidRows ?? [],
        },
    };
}
/** Verify every requested list id exists under the caller's owner scope; returns missing id or null. */
async function verifyOwnedLists(q, sub, listIds) {
    for (const listId of listIds) {
        const found = await (0, marketing_support_1.rows)(q, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [listId, sub]);
        if (!found.length)
            return listId;
    }
    return null;
}
/** Build the per-contact summary item returned by POST /audience/contacts/import-csv. */
function buildImportedContactSummary(contact, consent, row, mergedTags, updated) {
    return {
        contact_id: contact.contact_id,
        email: contact.email,
        email_hash: contact.email_hash,
        display_name: contact.display_name ?? '',
        tags: Array.isArray(contact.tags) ? contact.tags : mergedTags,
        status: contact.status ?? 'active',
        consent_id: consent?.consent_id ?? null,
        consentStatus: row.status,
        consentSource: row.consentSource,
        priorConsentDocumented: row.priorConsentDocumented,
        downgradedToPending: row.downgradedToPending,
        action: updated ? 'updated' : 'imported',
        rowNumber: row.rowNumber,
    };
}
/** Persist one unsuppressed CSV row (contact upsert, consent evidence row, and validated list links). */
async function persistImportedContact(q, sub, row, opts) {
    const existing = (await (0, marketing_support_1.rows)(q, 'SELECT contact_id, tags, status, metadata FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2', [sub, row.emailHash]))[0];
    if (existing && String(existing.status) === 'suppressed')
        return { suppressed: true };
    const mergedTags = (0, marketing_audience_model_1.normalizeTags)([...(Array.isArray(existing?.tags) ? existing.tags : []), ...row.tags]);
    const baseMeta = existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? existing.metadata : {};
    const mergedMeta = { ...baseMeta, lastConsentSource: row.consentSource, lastImportBatchId: opts.importBatchId };
    const contact = (await (0, marketing_support_1.rows)(q, `INSERT INTO oshal_marketing_contacts (owner_sub, email, email_hash, display_name, tags, status, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb,'active',$6::jsonb)
     ON CONFLICT (owner_sub, email_hash) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE oshal_marketing_contacts.display_name END,
       tags = EXCLUDED.tags, metadata = EXCLUDED.metadata,
       status = CASE WHEN oshal_marketing_contacts.status = 'suppressed' THEN 'suppressed' ELSE EXCLUDED.status END,
       updated_at = now()
     RETURNING *`, [sub, row.email, row.emailHash, row.displayName, JSON.stringify(mergedTags), JSON.stringify(mergedMeta)]))[0];
    const consent = (await (0, marketing_support_1.rows)(q, `INSERT INTO oshal_marketing_consents (owner_sub, contact_id, channel, purpose, status, evidence)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`, [sub, String(contact.contact_id), opts.channel, opts.purpose, row.status, JSON.stringify(row.evidence)]))[0];
    for (const listId of opts.listIds) {
        await q.query(`INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id)
       VALUES ($1,$2,$3) ON CONFLICT (list_id, contact_id) DO NOTHING`, [sub, listId, String(contact.contact_id)]);
    }
    const updated = Boolean(existing);
    return { suppressed: false, updated, contactSummary: buildImportedContactSummary(contact, consent, row, mergedTags, updated) };
}
/** Execute the owner-scoped CSV import transaction without ever re-subscribing suppressed addresses. */
async function runCsvImportTx(q, sub, parsed) {
    const missingList = await verifyOwnedLists(q, sub, parsed.listIds);
    if (missingList)
        return { notFoundListId: missingList };
    const suppRows = await (0, marketing_support_1.rows)(q, 'SELECT address_hash FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = $2', [sub, parsed.channel]);
    const suppressedHashes = new Set(suppRows.map((r) => String(r.address_hash || '').toLowerCase()));
    const seenHashes = new Set();
    const contacts = [];
    const skipped = parsed.invalidRows.map((r) => ({ ...r }));
    const counts = { imported: 0, updated: 0, pending: 0, confirmedWithPriorConsent: 0, downgradedToPending: 0, skippedSuppressed: 0 };
    for (const row of parsed.rows) {
        if (suppressedHashes.has(row.emailHash)) {
            counts.skippedSuppressed += 1;
            skipped.push({ rowNumber: row.rowNumber, email: row.email, emailHash: row.emailHash, reason: 'suppressed' });
            continue;
        }
        if (seenHashes.has(row.emailHash)) {
            skipped.push({ rowNumber: row.rowNumber, email: row.email, emailHash: row.emailHash, reason: 'duplicate_in_csv' });
            continue;
        }
        seenHashes.add(row.emailHash);
        const saved = await persistImportedContact(q, sub, row, parsed);
        if (saved.suppressed) {
            suppressedHashes.add(row.emailHash);
            counts.skippedSuppressed += 1;
            skipped.push({ rowNumber: row.rowNumber, email: row.email, emailHash: row.emailHash, reason: 'suppressed' });
            continue;
        }
        if (saved.updated)
            counts.updated += 1;
        else
            counts.imported += 1;
        if (row.status === 'confirmed')
            counts.confirmedWithPriorConsent += 1;
        else
            counts.pending += 1;
        if (row.downgradedToPending)
            counts.downgradedToPending += 1;
        if (saved.contactSummary)
            contacts.push(saved.contactSummary);
    }
    return {
        summary: {
            importBatchId: parsed.importBatchId, consentSource: parsed.consentSource, channel: parsed.channel,
            purpose: parsed.purpose, totalRows: parsed.totalRows, ...counts,
            invalidRows: parsed.invalidRows.length, contacts, skipped,
        },
    };
}
/**
 * @description POST /audience/contacts/import-csv — import RFC-4180 CSV contacts with mandatory
 * consent-source attestation, pending-by-default unless documented prior consent is present, and
 * strict non-resubscription of suppressed addresses.
 */
async function importContactsCsv(ctx, sub, req, res) {
    const checked = parseImportRequestBody((req.body ?? {}), req);
    if (checked.error || !checked.parsed) {
        res.status(400).json({
            error: checked.error ?? 'invalid_csv_format',
            ...(checked.missingConsentSourceRows ? { missingConsentSourceRows: checked.missingConsentSourceRows } : {}),
        });
        return;
    }
    const result = await withOptionalTransaction(ctx.pool, (q) => runCsvImportTx(q, sub, checked.parsed));
    if (result.notFoundListId) {
        res.status(404).json({ error: 'list_not_found', listId: result.notFoundListId });
        return;
    }
    res.status(200).json(result.summary);
}
/**
 * @description Register all P1 audience store routes under /api/marketing/audience/*.
 * @param router - The marketing Express router.
 * @param ctx - Framework app context.
 */
function registerAudienceRoutes(router, ctx) {
    ensureAudienceSchema(ctx.pool).catch((err) => marketing_support_1.logger.error({ err }, 'Failed to ensure marketing-engine audience schema'));
    router.get('/audience/contacts', (0, marketing_support_1.authed)(ctx, listContacts));
    router.post('/audience/contacts', (0, marketing_support_1.authed)(ctx, upsertContact));
    router.post('/audience/contacts/import-csv', (0, marketing_support_1.authed)(ctx, importContactsCsv));
    router.get('/audience/contacts/:id/consent-export', (0, marketing_support_1.authed)(ctx, exportContactConsent));
    router.delete('/audience/contacts/:id', (0, marketing_support_1.authed)(ctx, deleteContact));
    router.get('/audience/lists', (0, marketing_support_1.authed)(ctx, listLists));
    router.post('/audience/lists', (0, marketing_support_1.authed)(ctx, createList));
    router.post('/audience/lists/:id/members', (0, marketing_support_1.authed)(ctx, addListMembers));
    router.delete('/audience/lists/:id/members/:contactId', (0, marketing_support_1.authed)(ctx, removeListMember));
    router.get('/audience/suppressions', (0, marketing_support_1.authed)(ctx, listSuppressions));
    router.post('/audience/suppressions', (0, marketing_support_1.authed)(ctx, createSuppression));
    router.delete('/audience/suppressions/:id', (0, marketing_support_1.authed)(ctx, deleteSuppression));
}
