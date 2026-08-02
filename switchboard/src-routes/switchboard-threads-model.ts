/**
 * Switchboard Threads model — the PURE per-person aggregation logic (no framework imports).
 *
 * Threads is "every conversation with a person, on one line": the package's already-ingested
 * inbox store rows (oshal_inbox_messages — mail + inbox-fed social signals) folded into one
 * chronological timeline per counterpart. This module owns the aggregation so the store-CI
 * plain-node suite can require the COMPILED routes/switchboard-threads-model.js directly
 * (the kalshi-scan-config precedent — test the same bytes the framework mounts).
 *
 * Identity model — the package's EXISTING one, no new inference (per the ADR-113 read-only
 * first slice): a counterpart is keyed by the from-address email when one exists
 * (`addr:<email>`, case-folded — the same address the board already displays), else by the
 * normalized display name (`name:<lower>`). The thread's shown name is the display name from
 * the counterpart's MOST RECENT row (people rename; addresses don't). Bulk/no-reply senders
 * are not people and never form a thread (the same isBulk rule the Today board + Inbox use).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Initial pure threads model for the Threads pane: counterpart identity keying (email-first, name fallback — the package's existing model), bulk-sender exclusion, per-thread chronological ordering (items ascending, threads by recency), channel tally, and honest counts under per-thread caps. Zero imports by design so the store-CI plain-node suite tests the compiled bytes.
 *
 * @module switchboard-threads-model
 */

/** One row as read from the shared oshal_inbox_messages store. */
export interface StoredInboxRow {
  msg_id: string;
  from_addr: string;
  subject: string | null;
  snippet: string | null;
  category: string | null;
  received_at: string;
}

/** One normalized entry on a person's timeline (mirrors the /feed item vocabulary). */
export interface ThreadItem {
  id: string;
  source: string;
  kind: 'mail' | 'mention';
  subject: string;
  snippet: string;
  ts: string;
}

/** One counterpart's unified timeline. `count` is the TRUE total even when items are capped. */
export interface Thread {
  key: string;
  person: string;
  address: string | null;
  channels: string[];
  count: number;
  lastTs: string;
  items: ThreadItem[];
}

/** Aggregation bounds (a board, not an archive browser). */
export interface BuildThreadsOptions {
  maxThreads?: number;
  maxItemsPerThread?: number;
}

const DEFAULT_MAX_THREADS = 40;
const DEFAULT_MAX_ITEMS = 30;

/** Extract a human display name from an RFC From header (falls back to the address) — the package's existing helper. */
export function displayName(from: string): string {
  const f = String(from || '');
  return (f.match(/^"?([^"<]+?)"?\s*</)?.[1] || f.split('@')[0] || f || 'unknown').trim();
}

/** Extract the bare email address from an RFC From value ("Name <a@b>" or a bare address), or null. */
export function emailAddressOf(from: string): string | null {
  const f = String(from || '');
  const angled = f.match(/<\s*([^<>\s@]+@[^<>\s@]+)\s*>/)?.[1];
  if (angled) return angled.toLowerCase();
  const bare = f.trim().match(/^([^<>\s@]+@[^<>\s@]+)$/)?.[1];
  return bare ? bare.toLowerCase() : null;
}

/**
 * @description The counterpart identity key — the package's existing contact model, no new
 * inference: the case-folded email address when the From value carries one (`addr:`), else
 * the normalized display name (`name:`). Two names on one address are ONE person; one name
 * on two addresses is two counterparts (an address is identity; a name is a label).
 * @param from - The raw From value from the store.
 * @returns A stable grouping key.
 */
export function counterpartKey(from: string): string {
  const addr = emailAddressOf(from);
  if (addr) return `addr:${addr}`;
  return `name:${displayName(from).toLowerCase()}`;
}

/** Automated / bulk mail that never forms a person thread — the package's existing rule. */
export function isBulk(from: string, subject: string): boolean {
  return /no-?reply|do-?not-?reply|notifications?@|mailer|newsletter|updates?@|billing@|receipts?@|support@|via\b/i.test(from)
    || /unsubscribe|receipt|order (confirmed|shipped)|statement is ready/i.test(subject);
}

/** Infer the social platform from a stored notification's sender domain — the package's existing rule. */
export function inferPlatform(from: string): string {
  const f = String(from || '').toLowerCase();
  if (f.includes('linkedin.com')) return 'linkedin';
  if (f.includes('facebookmail') || f.includes('facebook.com')) return 'facebook';
  if (f.includes('instagram')) return 'instagram';
  if (/(^|@|\.)(x|twitter)\.com/.test(f)) return 'x';
  return 'social';
}

/** Map one store row onto the timeline item shape (social rows are platform mentions). */
function itemOf(row: StoredInboxRow): ThreadItem {
  const social = row.category === 'social';
  return {
    id: row.msg_id,
    source: social ? inferPlatform(row.from_addr || '') : 'gmail',
    kind: social ? 'mention' : 'mail',
    subject: row.subject || '(no subject)',
    snippet: row.snippet || '',
    ts: row.received_at,
  };
}

/**
 * @description Fold store rows into per-counterpart threads: drop bulk senders, group by the
 * existing identity key, order each timeline chronologically (oldest→newest, a conversation),
 * name each thread from its most recent row, and order threads most-recent-first. When a
 * timeline exceeds the per-thread cap the OLDEST items are trimmed and `count` keeps the
 * true total — the board never claims fewer exchanges than happened.
 * @param rows - Store rows in any order.
 * @param options - Optional caps ({ maxThreads, maxItemsPerThread }).
 * @returns Threads sorted by last activity, newest first.
 */
export function buildThreads(rows: StoredInboxRow[], options?: BuildThreadsOptions): Thread[] {
  const maxThreads = options?.maxThreads ?? DEFAULT_MAX_THREADS;
  const maxItems = options?.maxItemsPerThread ?? DEFAULT_MAX_ITEMS;
  interface Acc { key: string; address: string | null; items: ThreadItem[]; latestFrom: string; latestTs: number }
  const byKey = new Map<string, Acc>();
  for (const row of rows || []) {
    const from = row.from_addr || '';
    if (!from) continue;
    if (isBulk(from, row.subject || '')) continue;
    const key = counterpartKey(from);
    const item = itemOf(row);
    const ts = new Date(item.ts).getTime() || 0;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { key, address: emailAddressOf(from), items: [], latestFrom: from, latestTs: ts };
      byKey.set(key, acc);
    }
    acc.items.push(item);
    if (ts >= acc.latestTs) { acc.latestTs = ts; acc.latestFrom = from; if (!acc.address) acc.address = emailAddressOf(from); }
  }
  const threads: Thread[] = [];
  for (const acc of byKey.values()) {
    acc.items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const count = acc.items.length;
    const items = count > maxItems ? acc.items.slice(count - maxItems) : acc.items;
    const channels: string[] = [];
    for (const it of items) if (!channels.includes(it.source)) channels.push(it.source);
    threads.push({
      key: acc.key,
      person: displayName(acc.latestFrom),
      address: acc.address,
      channels,
      count,
      lastTs: items[items.length - 1]?.ts || '',
      items,
    });
  }
  threads.sort((a, b) => new Date(b.lastTs).getTime() - new Date(a.lastTs).getTime());
  return threads.slice(0, maxThreads);
}
