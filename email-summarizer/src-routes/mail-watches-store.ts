/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | Deterministic mailbox watch rules, query matcher, security category classifier and native-kernel-safe SQL store (plain 1-column keys, JS sorting, zero ON CONFLICT / ORDER BY / DISTINCT / OFFSET) for Gmail alert monitoring including the TotalConnect security preset.
 * 2   | maintainer@emeraldcoastsystemsgroup.com    | 1.8.1: return [] from listWatches and listRecentHits when migration 005 tables are not yet provisioned (42P01 / missingWatchTable) so read-only GET /api/email-watches answers 200 cleanly before a user's first write.
 */

export interface WatchPreset {
  id: string;
  label: string;
  query: string;
}

export interface WatchInput {
  watchId: string;
  label: string;
  accountHint: string;
  provider: string;
  query: string;
  enabled: boolean;
}

export interface WatchRecord extends WatchInput {
  lastCheckedAt: string | null;
  lastHitAt: string | null;
  lastHitSummary: string;
  hitCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WatchHitRecord {
  watchId: string;
  messageId: string;
  category: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  detectedAt: string | null;
}

export interface CandidateMessage {
  messageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface WatchClauseToken {
  kind: 'from' | 'subject' | 'phrase' | 'term';
  value: string;
}

export type WatchCategory = 'alarm' | 'trouble' | 'disarmed' | 'armed' | 'sensor' | 'activity';

export interface WatchDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, any>[]; rowCount?: number | null }>;
}

export const TOTALCONNECT_QUERY =
  'from:alarmnet.com OR from:totalconnect2.com OR from:mytotalconnectcomfort.com OR from:resideo.com OR "Total Connect" OR TotalConnect OR TotConnect';

export const PRESETS: Readonly<Record<string, Readonly<WatchPreset>>> = Object.freeze({
  totalconnect: Object.freeze({
    id: 'totalconnect',
    label: 'TotalConnect Security Monitor',
    query: TOTALCONNECT_QUERY,
  }),
});

const PRESET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  totconnect: 'totalconnect',
});

/** Resolve a built-in watch preset by canonical id or supported alias (`totconnect` -> `totalconnect`). */
export function resolveWatchPreset(name: unknown): Readonly<WatchPreset> | undefined {
  const key = bounded(name, 64).toLowerCase();
  if (!key) return undefined;
  return PRESETS[key] || PRESETS[PRESET_ALIASES[key] || ''];
}

const CATEGORY_RULES: ReadonlyArray< readonly [WatchCategory, RegExp] > = Object.freeze([
  ['alarm', /\b(alarm|burglary|intrusion|panic|fire|smoke|co\b|carbon monoxide|duress|tamper)\b/i],
  ['trouble', /\b(trouble|low battery|power loss|ac loss|offline|supervision|comm failure|sensor fault)\b/i],
  ['disarmed', /\b(disarm|disarmed)\b/i],
  ['armed', /\b(arm|armed|arming|armed away|armed stay|armed night)\b/i],
  ['sensor', /\b(zone|door|window|motion|garage|lock|unlocked|opened|closed)\b/i],
]);

/** Bound and normalize single-line text. */
export function bounded(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Primary key for `oshal_email_watches`. */
export function watchKey(sub: string, watchId: string): string {
  return `${sub}|${watchId}`;
}

/** Primary key for `oshal_email_watch_hits`. */
export function hitKey(sub: string, watchId: string, messageId: string): string {
  return `${sub}|${watchId}|${messageId}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function duplicateKey(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '23505' || /23505|unique (constraint|key)|duplicate key/i.test(String(e?.message || ''));
}

/** True when the migration table has not been provisioned yet. */
export function missingWatchTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42P01' || /does not exist|unknown table|no such table|undefined table/i.test(String(e?.message || ''));
}

/** Parse one OR-clause into field/phrase/term tokens, ignoring Gmail window operators. */
function tokenizeClause(clause: string): WatchClauseToken[] {
  const tokens: WatchClauseToken[] = [];
  const pattern = /(from|subject):(?:"([^"]+)"|(\S+))|"([^"]+)"|(\S+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clause)) !== null) {
    const field = match[1]?.toLowerCase();
    const fieldVal = (match[2] || match[3] || '').trim().toLowerCase();
    if (field === 'from' && fieldVal) tokens.push({ kind: 'from', value: fieldVal });
    else if (field === 'subject' && fieldVal) tokens.push({ kind: 'subject', value: fieldVal });
    else if (match[4]?.trim()) tokens.push({ kind: 'phrase', value: match[4].trim().toLowerCase() });
    else if (match[5]) {
      const bare = match[5].replace(/^[()]+|[()]+$/g, '').trim().toLowerCase();
      if (!bare || /^(-?in:|newer_than:|older_than:|after:|before:)/.test(bare)) continue;
      tokens.push({ kind: 'term', value: bare });
    }
  }
  return tokens;
}

/** Parse a Gmail-style watch query into alternative token clauses (`OR` between clauses, `AND` within). */
export function parseWatchQuery(query: string): WatchClauseToken[][] {
  return String(query || '')
    .split(/\s+OR\s+|\s*\|\|\s*/i)
    .map((part) => tokenizeClause(part.trim()))
    .filter((clause) => clause.length > 0);
}

function matchesToken(token: WatchClauseToken, sender: string, subject: string, haystack: string): boolean {
  if (token.kind === 'from') {
    if (token.value.includes('@')) return sender.includes(token.value);
    return new RegExp(`(?:^|[@.<\\s])${escapeRegExp(token.value)}(?:$|[>\\s,;])`, 'i').test(sender);
  }
  if (token.kind === 'subject') return subject.includes(token.value);
  if (token.kind === 'phrase' || token.value.length >= 4) return haystack.includes(token.value);
  return new RegExp(`\\b${escapeRegExp(token.value)}\\b`, 'i').test(haystack);
}

/** Evaluate parsed watch clauses deterministically against sender, subject and preview snippet. */
export function matchesWatchMessage(clauses: WatchClauseToken[][], msg: Pick<CandidateMessage, 'sender' | 'subject' | 'snippet'>): boolean {
  if (!clauses.length) return false;
  const sender = String(msg.sender || '').toLowerCase();
  const subject = String(msg.subject || '').toLowerCase();
  const haystack = `${sender} ${subject} ${String(msg.snippet || '').toLowerCase()}`;
  return clauses.some((clause) => clause.every((tok) => matchesToken(tok, sender, subject, haystack)));
}

/** Classify a matched watch alert deterministically from its subject and preview snippet. */
export function classifyWatchCategory(subject: string, snippet: string): WatchCategory {
  const combined = `${String(subject || '')} ${String(snippet || '')}`;
  for (const [category, rule] of CATEGORY_RULES) {
    if (rule.test(combined)) return category;
  }
  return 'activity';
}

/** Validate and normalize a `POST /api/email-watches` request body. */
export function normalizeWatchInput(
  body: unknown,
): { ok: true; value: WatchInput } | { ok: false; code: number; error: string; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 400, error: 'invalid_body', message: 'Expected a JSON object describing the mailbox watch.' };
  }
  const b = body as Record<string, unknown>;
  const presetKey = bounded(b.preset, 64).toLowerCase();
  const preset = resolveWatchPreset(presetKey);
  if (presetKey && !preset) {
    return { ok: false, code: 400, error: 'invalid_preset', message: `Unknown watch preset "${presetKey}".` };
  }
  const watchId = bounded(b.watchId ?? b.id ?? preset?.id ?? '', 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(watchId)) {
    return { ok: false, code: 400, error: 'invalid_watch_id', message: 'watchId must be 2-64 lowercase letters, digits, hyphens or underscores.' };
  }
  const label = bounded(b.label ?? preset?.label ?? '', 120);
  if (!label) return { ok: false, code: 400, error: 'invalid_label', message: 'A non-empty watch label is required.' };
  const rawQuery = String(b.query ?? preset?.query ?? '');
  if (/[\r\n]/.test(rawQuery)) return { ok: false, code: 400, error: 'invalid_query', message: 'Watch query must be a single line.' };
  const query = bounded(rawQuery, 500);
  if (!query || rawQuery.trim().length > 500 || parseWatchQuery(query).length === 0) {
    return { ok: false, code: 400, error: 'invalid_query', message: 'Watch query must be 1-500 characters with at least one searchable term.' };
  }
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') {
    return { ok: false, code: 400, error: 'invalid_enabled', message: 'enabled must be a boolean when provided.' };
  }
  const accountHint = bounded(b.accountHint ?? b.account ?? '', 200);
  return { ok: true, value: { watchId, label, accountHint, provider: 'google', query, enabled: b.enabled === undefined ? true : b.enabled } };
}

export function formatWatchRow(row: Record<string, any>): WatchRecord {
  return {
    watchId: String(row.watch_id || ''),
    label: String(row.label || ''),
    accountHint: String(row.account_hint || ''),
    provider: String(row.provider || 'google'),
    query: String(row.query || ''),
    enabled: Boolean(row.enabled),
    lastCheckedAt: toIso(row.last_checked_at),
    lastHitAt: toIso(row.last_hit_at),
    lastHitSummary: String(row.last_hit_summary || ''),
    hitCount: Number(row.hit_count) || 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function formatHitRow(row: Record<string, any>): WatchHitRecord {
  return {
    watchId: String(row.watch_id || ''),
    messageId: String(row.message_id || ''),
    category: String(row.category || 'activity'),
    sender: String(row.sender || ''),
    subject: String(row.subject || ''),
    snippet: String(row.snippet || ''),
    receivedAt: toIso(row.received_at) || new Date(0).toISOString(),
    detectedAt: toIso(row.detected_at),
  };
}

const WATCH_COLS =
  'watch_key, user_sub, watch_id, label, account_hint, provider, query, enabled, last_checked_at, last_hit_at, last_hit_summary, hit_count, created_at, updated_at';

/** List all watches for one signed-in person, sorted newest update first in JS. */
export async function listWatches(db: WatchDb, sub: string): Promise<WatchRecord[]> {
  try {
    const { rows } = await db.query(`SELECT ${WATCH_COLS} FROM oshal_email_watches WHERE user_sub = $1`, [sub]);
    return rows
      .map(formatWatchRow)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '') || a.watchId.localeCompare(b.watchId));
  } catch (err) {
    if (missingWatchTable(err)) return [];
    throw err;
  }
}

/** List recent alert hits for one signed-in person, sorted newest received first in JS. */
export async function listRecentHits(db: WatchDb, sub: string, limit = 25): Promise<WatchHitRecord[]> {
  try {
    const { rows } = await db.query(
      'SELECT watch_id, message_id, category, sender, subject, snippet, received_at, detected_at FROM oshal_email_watch_hits WHERE user_sub = $1',
      [sub],
    );
    return rows
      .map(formatHitRow)
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.messageId.localeCompare(a.messageId))
      .slice(0, Math.max(1, Math.min(100, limit)));
  } catch (err) {
    if (missingWatchTable(err)) return [];
    throw err;
  }
}

/** Seed installation-configured `EMAIL_DEFAULT_WATCHES` presets once per user without overwriting existing rows. */
export async function ensureDefaultWatches(db: WatchDb, sub: string, nowIso = new Date().toISOString()): Promise<void> {
  const raw = String(process.env.EMAIL_DEFAULT_WATCHES || '').trim();
  if (!raw || !sub) return;
  const seenIds = new Set<string>();
  const presets = raw
    .split(',')
    .map((entry) => resolveWatchPreset(entry))
    .filter((p): p is Readonly<WatchPreset> => Boolean(p && !seenIds.has(p.id) && seenIds.add(p.id)));
  for (const preset of presets) {
    const key = watchKey(sub, preset.id);
    const existing = (await db.query('SELECT watch_key FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2', [key, sub])).rows[0];
    if (existing) continue;
    try {
      await db.query(
        'INSERT INTO oshal_email_watches (watch_key, user_sub, watch_id, label, account_hint, provider, query, enabled, hit_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 0, $8, $8)',
        [key, sub, preset.id, preset.label, '', 'google', preset.query, nowIso],
      );
    } catch (err) {
      if (!duplicateKey(err)) throw err;
    }
  }
}

/** Create or update a caller's watch using plain SELECT + UPDATE/INSERT (no ON CONFLICT). */
export async function saveWatch(db: WatchDb, sub: string, input: WatchInput, nowIso = new Date().toISOString()): Promise<{ created: boolean; watch: WatchRecord }> {
  const key = watchKey(sub, input.watchId);
  const existing = (await db.query(`SELECT ${WATCH_COLS} FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2`, [key, sub])).rows[0];
  if (existing) {
    await db.query(
      'UPDATE oshal_email_watches SET label = $3, account_hint = $4, provider = $5, query = $6, enabled = $7, updated_at = $8 WHERE watch_key = $1 AND user_sub = $2',
      [key, sub, input.label, input.accountHint, input.provider, input.query, input.enabled, nowIso],
    );
    const updated = (await db.query(`SELECT ${WATCH_COLS} FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2`, [key, sub])).rows[0];
    return { created: false, watch: formatWatchRow(updated) };
  }
  try {
    await db.query(
      'INSERT INTO oshal_email_watches (watch_key, user_sub, watch_id, label, account_hint, provider, query, enabled, hit_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9)',
      [key, sub, input.watchId, input.label, input.accountHint, input.provider, input.query, input.enabled, nowIso],
    );
  } catch (err) {
    if (!duplicateKey(err)) throw err;
    await db.query(
      'UPDATE oshal_email_watches SET label = $3, account_hint = $4, provider = $5, query = $6, enabled = $7, updated_at = $8 WHERE watch_key = $1 AND user_sub = $2',
      [key, sub, input.label, input.accountHint, input.provider, input.query, input.enabled, nowIso],
    );
  }
  const saved = (await db.query(`SELECT ${WATCH_COLS} FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2`, [key, sub])).rows[0];
  return { created: !existing, watch: formatWatchRow(saved) };
}

/** Delete one caller's watch and its recorded hits. */
export async function deleteWatch(db: WatchDb, sub: string, watchId: string): Promise<boolean> {
  const cleanId = bounded(watchId, 64).toLowerCase();
  if (!cleanId) return false;
  const key = watchKey(sub, cleanId);
  const existing = (await db.query('SELECT watch_key FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2', [key, sub])).rows[0];
  if (!existing) return false;
  await db.query('DELETE FROM oshal_email_watch_hits WHERE user_sub = $1 AND watch_id = $2', [sub, cleanId]);
  await db.query('DELETE FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2', [key, sub]);
  return true;
}

/** Deduplicate matched candidates by `hit_key`, insert unseen hits, and update the watch's counters. */
export async function recordWatchCheck(
  db: WatchDb,
  sub: string,
  watch: WatchRecord,
  matched: CandidateMessage[],
  nowIso = new Date().toISOString(),
): Promise<{ watch: WatchRecord; newHits: WatchHitRecord[] }> {
  const ordered = [...matched].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  const newHits: WatchHitRecord[] = [];
  let hitCount = watch.hitCount;
  let lastHitAt = watch.lastHitAt;
  let lastHitSummary = watch.lastHitSummary;
  for (const msg of ordered) {
    const hKey = hitKey(sub, watch.watchId, msg.messageId);
    const seen = (await db.query('SELECT hit_key FROM oshal_email_watch_hits WHERE hit_key = $1 AND user_sub = $2', [hKey, sub])).rows[0];
    if (seen) continue;
    const category = classifyWatchCategory(msg.subject, msg.snippet);
    const sender = bounded(msg.sender, 300);
    const subject = bounded(msg.subject || '(no subject)', 400);
    const snippet = bounded(msg.snippet, 600);
    try {
      await db.query(
        'INSERT INTO oshal_email_watch_hits (hit_key, user_sub, watch_id, message_id, category, sender, subject, snippet, received_at, detected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [hKey, sub, watch.watchId, msg.messageId, category, sender, subject, snippet, msg.receivedAt, nowIso],
      );
    } catch (err) {
      if (duplicateKey(err)) continue;
      throw err;
    }
    hitCount += 1;
    lastHitAt = msg.receivedAt;
    lastHitSummary = bounded(`[${category.toUpperCase()}] ${subject}${sender ? ` — ${sender}` : ''}`, 300);
    newHits.push({ watchId: watch.watchId, messageId: msg.messageId, category, sender, subject, snippet, receivedAt: msg.receivedAt, detectedAt: nowIso });
  }
  const key = watchKey(sub, watch.watchId);
  await db.query(
    'UPDATE oshal_email_watches SET last_checked_at = $3, last_hit_at = $4, last_hit_summary = $5, hit_count = $6, updated_at = $3 WHERE watch_key = $1 AND user_sub = $2',
    [key, sub, nowIso, lastHitAt, lastHitSummary, hitCount],
  );
  const updated = (await db.query(`SELECT ${WATCH_COLS} FROM oshal_email_watches WHERE watch_key = $1 AND user_sub = $2`, [key, sub])).rows[0];
  return { watch: updated ? formatWatchRow(updated) : { ...watch, lastCheckedAt: nowIso, lastHitAt, lastHitSummary, hitCount }, newHits };
}
