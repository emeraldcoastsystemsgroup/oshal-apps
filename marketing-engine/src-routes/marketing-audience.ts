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
 *
 * @module marketing-audience
 */

import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import {
  AUDIENCE_CHANNELS, CONSENT_STATES, SHA256_HEX_RE, buildConsentExport, hashAddress,
  normalizeConsentEvidence, normalizeEmail, normalizeTags, parseAudienceFilters, segmentContacts,
  type ConsentExportBundle, type HydratedContact,
} from './marketing-audience-model';
import {
  UUID_RE, authed, logger, rows, slugify, tooLarge, type QueryablePool,
} from './marketing-support';

/** Lazy-DDL mirror of migrations/003-marketing-audience.sql. */
const AUDIENCE_TABLE_DDL: string[] = [
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
export async function ensureAudienceSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-audience',
    statements: [
      ...AUDIENCE_TABLE_DDL,
      ...AUDIENCE_RLS_TABLES.flatMap((table) => buildOwnerRlsPolicyStatements(table, 'owner_sub')),
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
async function withOptionalTransaction<T>(
  pool: QueryablePool,
  work: (q: QueryablePool) => Promise<T>,
): Promise<T> {
  const connectable = pool as QueryablePool & {
    connect?: () => Promise<QueryablePool & { release: () => void }>;
  };
  if (typeof connectable.connect !== 'function') return work(pool);
  const client = await connectable.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rollback best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Group rows by a string key into a Map. */
function groupBy(list: any[], key: string): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const row of list) {
    const k = String(row?.[key] ?? '');
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Load one owner's complete contact export bundle, or null when the contact does not exist. */
async function loadContactExport(
  pool: QueryablePool, sub: string, contactId: string,
): Promise<{ contact: any; bundle: ConsentExportBundle } | null> {
  if (!UUID_RE.test(contactId)) return null;
  const contact = (await rows(
    pool, 'SELECT * FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub],
  ))[0];
  if (!contact) return null;
  const consents = await rows(
    pool, 'SELECT * FROM oshal_marketing_consents WHERE contact_id = $1 AND owner_sub = $2 ORDER BY created_at DESC', [contactId, sub],
  );
  const lists = await rows(
    pool,
    `SELECT l.list_id, l.slug, l.name, m.added_at
       FROM oshal_marketing_list_members m
       JOIN oshal_marketing_lists l ON l.list_id = m.list_id AND l.owner_sub = m.owner_sub
      WHERE m.contact_id = $1 AND m.owner_sub = $2
      ORDER BY m.added_at ASC`,
    [contactId, sub],
  );
  const suppressions = await rows(
    pool,
    'SELECT * FROM oshal_marketing_suppressions WHERE address_hash = $1 AND owner_sub = $2 ORDER BY created_at DESC',
    [String(contact.email_hash), sub],
  );
  return { contact, bundle: buildConsentExport(contact, consents, lists, suppressions) };
}

/**
 * @description GET /audience/contacts — list & segment contacts by list, tag, consentState,
 * channel, purpose, suppressed, and search query.
 */
export async function listContacts(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const parsed = parseAudienceFilters((req.query ?? {}) as Record<string, unknown>);
  if (parsed.error || !parsed.filters) { res.status(400).json({ error: parsed.error ?? 'invalid_filters' }); return; }
  const [contactRows, consentRows, memberRows, suppressionRows] = await Promise.all([
    rows(ctx.pool, 'SELECT * FROM oshal_marketing_contacts WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT 1000', [sub]),
    rows(ctx.pool, 'SELECT * FROM oshal_marketing_consents WHERE owner_sub = $1 ORDER BY created_at DESC', [sub]),
    rows(
      ctx.pool,
      `SELECT m.contact_id, l.list_id, l.slug, l.name, m.added_at
         FROM oshal_marketing_list_members m
         JOIN oshal_marketing_lists l ON l.list_id = m.list_id AND l.owner_sub = m.owner_sub
        WHERE m.owner_sub = $1`,
      [sub],
    ),
    rows(ctx.pool, 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1', [sub]),
  ]);
  const consentsByContact = groupBy(consentRows, 'contact_id');
  const listsByContact = groupBy(memberRows, 'contact_id');
  const suppByHash = groupBy(suppressionRows, 'address_hash');
  const hydrated: HydratedContact[] = contactRows.map((c) => {
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
  const contacts = segmentContacts(hydrated, parsed.filters);
  res.json({ contacts, total: contacts.length });
}

/** Validate an optional consent payload on contact creation. */
function parseOptionalConsent(
  raw: unknown, req: Request,
): { consent?: { channel: string; purpose: string; status: string; evidence: Record<string, unknown> }; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid_consent' };
  const c = raw as Record<string, unknown>;
  const channel = String(c.channel || 'email');
  if (!(AUDIENCE_CHANNELS as readonly string[]).includes(channel)) return { error: 'invalid_channel' };
  const status = String(c.status || 'pending');
  if (!(CONSENT_STATES as readonly string[]).includes(status)) return { error: 'invalid_consent_state' };
  const purpose = typeof c.purpose === 'string' && c.purpose.trim() ? c.purpose.trim().slice(0, 120) : 'marketing';
  const uaHeader = typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
  const evidence = normalizeConsentEvidence(c.evidence, { ip: req.ip, userAgent: uaHeader });
  if (tooLarge(evidence, 32_000)) return { error: 'evidence_too_large' };
  return { consent: { channel, purpose, status, evidence: evidence as unknown as Record<string, unknown> } };
}

/** Attach validated owner-scoped list memberships to a contact. */
async function attachInitialLists(pool: QueryablePool, sub: string, contactId: string, listIds: string[]): Promise<string[]> {
  const attached: string[] = [];
  for (const listId of listIds) {
    const found = await rows(pool, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [listId, sub]);
    if (!found.length) continue;
    await pool.query(
      `INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id)
       VALUES ($1, $2, $3) ON CONFLICT (list_id, contact_id) DO NOTHING`,
      [sub, listId, contactId],
    );
    attached.push(listId);
  }
  return attached;
}

/** Validate and normalize the body of POST /audience/contacts. */
function parseContactBody(
  body: Record<string, unknown>, req: Request,
): {
  email?: string;
  displayName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  consent?: { channel: string; purpose: string; status: string; evidence: Record<string, unknown> };
  listIds?: string[];
  error?: string;
} {
  const email = normalizeEmail(body.email);
  if (!email) return { error: 'invalid_email' };
  const rawName = typeof body.displayName === 'string'
    ? body.displayName
    : typeof body.display_name === 'string' ? body.display_name : '';
  const displayName = rawName.trim().slice(0, 200);
  const tags = normalizeTags(body.tags);
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? (body.metadata as Record<string, unknown>) : {};
  if (tooLarge(metadata, 32_000)) return { error: 'metadata_too_large' };
  const parsedConsent = parseOptionalConsent(body.consent, req);
  if (parsedConsent.error) return { error: parsedConsent.error };
  const listIds = Array.isArray(body.listIds)
    ? body.listIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).slice(0, 25)
    : [];
  return { email, displayName, tags, metadata, consent: parsedConsent.consent, listIds };
}

/**
 * @description POST /audience/contacts — upsert an owner-scoped contact with optional consent
 * evidence and initial list memberships. Refuses re-confirming a suppressed address.
 */
export async function upsertContact(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const parsed = parseContactBody((req.body ?? {}) as Record<string, unknown>, req);
  if (parsed.error || !parsed.email) { res.status(400).json({ error: parsed.error ?? 'invalid_email' }); return; }
  const emailHash = hashAddress(parsed.email);
  const supps = await rows(
    ctx.pool, 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND address_hash = $2', [sub, emailHash],
  );
  const consentChannel = parsed.consent?.channel ?? 'email';
  if (supps.some((s) => String(s.channel) === consentChannel) && parsed.consent?.status === 'confirmed') {
    res.status(409).json({ error: 'address_suppressed', channel: consentChannel });
    return;
  }
  const initialStatus = supps.length > 0 ? 'suppressed' : 'active';
  const contact = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_contacts (owner_sub, email, email_hash, display_name, tags, status, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)
     ON CONFLICT (owner_sub, email_hash) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE oshal_marketing_contacts.display_name END,
       tags = EXCLUDED.tags,
       metadata = EXCLUDED.metadata,
       status = CASE WHEN oshal_marketing_contacts.status = 'suppressed' THEN 'suppressed' ELSE EXCLUDED.status END,
       updated_at = now()
     RETURNING *`,
    [sub, parsed.email, emailHash, parsed.displayName ?? '', JSON.stringify(parsed.tags ?? []), initialStatus, JSON.stringify(parsed.metadata ?? {})],
  ))[0];
  let consent: any = null;
  if (parsed.consent) {
    const c = parsed.consent;
    consent = (await rows(
      ctx.pool,
      `INSERT INTO oshal_marketing_consents (owner_sub, contact_id, channel, purpose, status, evidence)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
      [sub, String(contact.contact_id), c.channel, c.purpose, c.status, JSON.stringify(c.evidence)],
    ))[0];
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
export async function exportContactConsent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id || '');
  const loaded = await loadContactExport(ctx.pool, sub, id);
  if (!loaded) { res.status(404).json({ error: 'contact_not_found' }); return; }
  res.json({ consentExport: loaded.bundle });
}

/**
 * @description DELETE /audience/contacts/:id — export full consent evidence first, then delete
 * the contact, its consents, and its list memberships (and matching suppression when purgeSuppression=true).
 */
export async function deleteContact(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id || '');
  const purgeSuppression = req.query?.purgeSuppression === 'true'
    || (req.body as { purgeSuppression?: unknown } | null)?.purgeSuppression === true;
  const result = await withOptionalTransaction(ctx.pool, async (q) => {
    const loaded = await loadContactExport(q, sub, id);
    if (!loaded) return null;
    await q.query('DELETE FROM oshal_marketing_list_members WHERE contact_id = $1 AND owner_sub = $2', [id, sub]);
    await q.query('DELETE FROM oshal_marketing_consents WHERE contact_id = $1 AND owner_sub = $2', [id, sub]);
    await q.query('DELETE FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [id, sub]);
    if (purgeSuppression) {
      await q.query(
        'DELETE FROM oshal_marketing_suppressions WHERE address_hash = $1 AND owner_sub = $2',
        [String(loaded.contact.email_hash), sub],
      );
    }
    return loaded.bundle;
  });
  if (!result) { res.status(404).json({ error: 'contact_not_found' }); return; }
  res.json({ deleted: true, contactId: id, consentExport: result });
}

/** @description GET /audience/lists — list the owner's audience lists with member counts. */
export async function listLists(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
  const lists = await rows(
    ctx.pool,
    `SELECT l.*, COALESCE(m.cnt, 0)::int AS member_count
       FROM oshal_marketing_lists l
       LEFT JOIN (
         SELECT list_id, COUNT(*)::int AS cnt
           FROM oshal_marketing_list_members
          WHERE owner_sub = $1
          GROUP BY list_id
       ) m ON m.list_id = l.list_id
      WHERE l.owner_sub = $1
      ORDER BY l.created_at DESC LIMIT 200`,
    [sub],
  );
  res.json({ lists });
}

/** @description POST /audience/lists — create an owner-scoped audience list. */
export async function createList(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : '';
  if (!name) { res.status(400).json({ error: 'list_name_required' }); return; }
  const rawSlug = typeof b.slug === 'string' && b.slug.trim() ? b.slug : name;
  const slug = slugify(rawSlug);
  if (!slug) { res.status(400).json({ error: 'list_name_not_sluggable' }); return; }
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 1000) : '';
  try {
    const list = (await rows(
      ctx.pool,
      `INSERT INTO oshal_marketing_lists (owner_sub, slug, name, description)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [sub, slug, name, description],
    ))[0];
    res.status(201).json({ list });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') { res.status(409).json({ error: 'slug_exists', slug }); return; }
    throw err;
  }
}

/** @description POST /audience/lists/:id/members — add one or more owner-scoped contacts to a list. */
export async function addListMembers(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const listId = String(req.params.id || '');
  if (!UUID_RE.test(listId)) { res.status(404).json({ error: 'list_not_found' }); return; }
  const foundList = await rows(ctx.pool, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [listId, sub]);
  if (!foundList.length) { res.status(404).json({ error: 'list_not_found' }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const rawIds = Array.isArray(b.contactIds) ? b.contactIds : b.contactId ? [b.contactId] : [];
  const ids = [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, 100);
  if (!ids.length) { res.status(400).json({ error: 'contact_id_required' }); return; }
  const added: string[] = [];
  for (const contactId of ids) {
    const found = await rows(ctx.pool, 'SELECT contact_id FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]);
    if (!found.length) { res.status(404).json({ error: 'contact_not_found', contactId }); return; }
    await ctx.pool.query(
      `INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id)
       VALUES ($1,$2,$3) ON CONFLICT (list_id, contact_id) DO NOTHING`,
      [sub, listId, contactId],
    );
    added.push(contactId);
  }
  res.status(201).json({ listId, added });
}

/** @description DELETE /audience/lists/:id/members/:contactId — remove a contact from a list. */
export async function removeListMember(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const listId = String(req.params.id || '');
  const contactId = String(req.params.contactId || '');
  if (!UUID_RE.test(listId) || !UUID_RE.test(contactId)) {
    res.status(404).json({ error: 'membership_not_found' });
    return;
  }
  const r = await ctx.pool.query(
    'DELETE FROM oshal_marketing_list_members WHERE list_id = $1 AND contact_id = $2 AND owner_sub = $3',
    [listId, contactId, sub],
  );
  if (!r.rowCount) { res.status(404).json({ error: 'membership_not_found' }); return; }
  res.json({ removed: true, listId, contactId });
}

/** @description GET /audience/suppressions — list owner-scoped suppressions. */
export async function listSuppressions(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const channel = typeof req.query?.channel === 'string' ? req.query.channel.trim() : '';
  if (channel && !(AUDIENCE_CHANNELS as readonly string[]).includes(channel)) {
    res.status(400).json({ error: 'invalid_channel' });
    return;
  }
  const sql = channel
    ? 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = $2 ORDER BY created_at DESC LIMIT 500'
    : 'SELECT * FROM oshal_marketing_suppressions WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT 500';
  const suppressions = await rows(ctx.pool, sql, channel ? [sub, channel] : [sub]);
  res.json({ suppressions });
}

/** @description POST /audience/suppressions — add a normalized-hash suppression and revoke matching consents. */
export async function createSuppression(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const channel = String(b.channel || 'email');
  if (!(AUDIENCE_CHANNELS as readonly string[]).includes(channel)) { res.status(400).json({ error: 'invalid_channel' }); return; }
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
  if (!reason) { res.status(400).json({ error: 'reason_required' }); return; }
  const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim().slice(0, 120) : 'manual';
  const email = normalizeEmail(b.email);
  const rawHash = typeof b.addressHash === 'string' ? b.addressHash.trim().toLowerCase() : '';
  const addressHash = email ? hashAddress(email) : SHA256_HEX_RE.test(rawHash) ? rawHash : '';
  if (!addressHash) { res.status(400).json({ error: 'address_or_hash_required' }); return; }
  const suppression = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_suppressions (owner_sub, channel, address_hash, reason, source)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (owner_sub, channel, address_hash) DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source
     RETURNING *`,
    [sub, channel, addressHash, reason, source],
  ))[0];
  const matched = await rows(
    ctx.pool,
    'SELECT contact_id FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2',
    [sub, addressHash],
  );
  let revokedConsents = 0;
  for (const row of matched) {
    const upd = await ctx.pool.query(
      `UPDATE oshal_marketing_consents SET status = 'revoked', updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2 AND channel = $3 AND status <> 'revoked'`,
      [sub, String(row.contact_id), channel],
    );
    revokedConsents += Number(upd.rowCount ?? 0);
    await ctx.pool.query(
      `UPDATE oshal_marketing_contacts SET status = 'suppressed', updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2`,
      [sub, String(row.contact_id)],
    );
  }
  res.status(201).json({ suppression, revokedConsents });
}

/** @description DELETE /audience/suppressions/:id — remove an owner-scoped suppression row. */
export async function deleteSuppression(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) { res.status(404).json({ error: 'suppression_not_found' }); return; }
  const r = await ctx.pool.query(
    'DELETE FROM oshal_marketing_suppressions WHERE suppression_id = $1 AND owner_sub = $2',
    [id, sub],
  );
  if (!r.rowCount) { res.status(404).json({ error: 'suppression_not_found' }); return; }
  res.json({ deleted: true, suppressionId: id });
}

/**
 * @description Register all P1 audience store routes under /api/marketing/audience/*.
 * @param router - The marketing Express router.
 * @param ctx - Framework app context.
 */
export function registerAudienceRoutes(router: Router, ctx: AppContext): void {
  ensureAudienceSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine audience schema'));
  router.get('/audience/contacts', authed(ctx, listContacts));
  router.post('/audience/contacts', authed(ctx, upsertContact));
  router.get('/audience/contacts/:id/consent-export', authed(ctx, exportContactConsent));
  router.delete('/audience/contacts/:id', authed(ctx, deleteContact));
  router.get('/audience/lists', authed(ctx, listLists));
  router.post('/audience/lists', authed(ctx, createList));
  router.post('/audience/lists/:id/members', authed(ctx, addListMembers));
  router.delete('/audience/lists/:id/members/:contactId', authed(ctx, removeListMember));
  router.get('/audience/suppressions', authed(ctx, listSuppressions));
  router.post('/audience/suppressions', authed(ctx, createSuppression));
  router.delete('/audience/suppressions/:id', authed(ctx, deleteSuppression));
}
