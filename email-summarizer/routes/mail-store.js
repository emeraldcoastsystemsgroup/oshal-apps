"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | The person's own searchable copy of their Gmail (Roger, 2026-10-29: "we shouldn't be hitting the api for emails when we access the tool... we should be storing a local copy of the emails"). A sync pass stores each message's sender, subject, Gmail preview, labels and time (never a body) in oshal_email_messages, new mail first and then older mail back to STORE_DAYS, inside the caller's deadline; a search reads that copy. Native-kernel safe: one-row reads by primary key, plain INSERTs (a duplicate is skipped), no ON CONFLICT, ORDER BY or DISTINCT (sorting is done here), so no statement copies the table into kernel memory.
 * 2   | maintainer@emeraldcoastsystemsgroup.com    | A pass resumes where the last one stopped (Roger's first live passes, 2026-10-29: 290 then only 73 more, still short of the first week). The copy is one contiguous range, oldest_at up to newest_at: a pass reads new mail after newest_at (less OVERLAP_MS), then continues downwards from oldest_at, so it never walks the messages already stored. Before, a pass that had not finished the first week started again from the newest message and re-checked every stored one, so each pass gained less and the copy stalled. A state left by the old passes (no newest_at) resumes from its last run. GET /messages answers from the copy only when the copy reaches back over the window asked for (storeCovers).
 * 3   | maintainer@emeraldcoastsystemsgroup.com    | listStored: one page of the person's inbox from the copy, newest first (Roger, 2026-10-30: "i still only see 30 emails in my inbox"; the Inbox asked for one page of 30 and never asked for more). A page is a keyset read: rows received at or before the cursor, in time windows that widen (1, 2, 4 … 32 days) and narrow again when a window holds too many rows, sorted here, light columns only (no search text). The next cursor is the last row's instant plus how many rows at that instant were listed, so a tie is neither dropped nor repeated. No ORDER BY or OFFSET (the native kernel copies a table for those).
 */
/**
 * @module mail-store
 * @description Sync and search of the person's stored mail copy. The tables come from
 * migrations/001-email-mail-store.sql; every row carries user_sub (owner row security on PostgreSQL,
 * and the native kernel keeps the whole table per person).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRESH_MS = exports.STORE_DAYS = void 0;
exports.messageKey = messageKey;
exports.gmailRow = gmailRow;
exports.syncGmail = syncGmail;
exports.readStoreState = readStoreState;
exports.storeIsFresh = storeIsFresh;
exports.searchWindow = searchWindow;
exports.storeCovers = storeCovers;
exports.parseSearch = parseSearch;
exports.searchStored = searchStored;
exports.listStored = listStored;
const DAY_MS = 24 * 3600 * 1000;
/** How far back the copy reaches. */
exports.STORE_DAYS = 180;
/** Re-read a little before the newest stored message: Gmail indexes late mail late; duplicates are skipped. */
const OVERLAP_MS = 10 * 60 * 1000;
/** The copy answers a search while its last pass is this recent (the schedule runs every 10 minutes). */
exports.FRESH_MS = 30 * 60 * 1000;
/** Mail Gmail lists that is not mail to search. */
const NOT_MAIL = '-in:chats -in:drafts';
const PRUNE_EVERY_MS = DAY_MS;
const STOP = new Set(['a', 'an', 'and', 'any', 'about', 'for', 'from', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'with',
    'email', 'emails', 'mail', 'message', 'messages', 'inbox']);
/**
 * @description The primary key of one stored message: one text column, so an existence check is a read by id.
 * @param sub - The owner's subject.
 * @param provider - The mail provider.
 * @param id - The provider's message id.
 * @returns The key.
 */
function messageKey(sub, provider, id) {
    return `${sub}|${provider}|${id}`;
}
function header(msg, name) {
    const payload = msg.payload;
    return (payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}
function bounded(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
/**
 * @description The row a Gmail metadata answer is stored as (no body, bounded text, lower-case search text).
 * @param sub - The owner's subject.
 * @param id - The message id.
 * @param msg - Gmail's metadata answer.
 * @returns The insert parameters and the message's time in ms.
 */
function gmailRow(sub, id, msg) {
    const sender = bounded(header(msg, 'From'), 300);
    const subject = bounded(header(msg, 'Subject') || '(no subject)', 400);
    const snippet = bounded(msg.snippet, 600);
    const labels = (msg.labelIds || []).join(',').slice(0, 400);
    const receivedMs = Number(msg.internalDate) || Date.parse(header(msg, 'Date')) || Date.now();
    const search = `${sender} ${subject} ${snippet}`.toLowerCase();
    return {
        params: [messageKey(sub, 'google', id), sub, 'google', id, sender, subject, snippet, labels, search, new Date(receivedMs).toISOString()],
        receivedMs,
    };
}
const INSERT = `INSERT INTO oshal_email_messages (msg_key, user_sub, provider, message_id, sender, subject, snippet, labels, search_text, received_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
function duplicate(err) {
    const e = err;
    return e?.code === '23505' || /23505|unique (constraint|key)|duplicate key/i.test(String(e?.message || ''));
}
/** A missing table (the migration has not run for this person yet) reads as "nothing stored". */
function missingTable(err) {
    const e = err;
    return e?.code === '42P01' || /does not exist|unknown table|no such table|undefined table/i.test(String(e?.message || ''));
}
function track(p, ms) {
    p.newestMs = p.newestMs === null ? ms : Math.max(p.newestMs, ms);
    p.oldestMs = p.oldestMs === null ? ms : Math.min(p.oldestMs, ms);
}
/** Store the messages of one id page that are not stored yet; stop at the deadline. */
async function storePage(db, sub, reader, ids, deadline, p) {
    for (const id of ids) {
        if (Date.now() >= deadline) {
            p.stopped = true;
            return;
        }
        const have = (await db.query('SELECT received_at FROM oshal_email_messages WHERE msg_key = $1', [messageKey(sub, 'google', id)])).rows[0];
        if (have) {
            track(p, toMs(have.received_at));
            continue;
        }
        const row = gmailRow(sub, id, await reader.metadata(id));
        try {
            await db.query(INSERT, row.params);
            p.inserted += 1;
        }
        catch (err) {
            if (!duplicate(err))
                throw err;
        }
        track(p, row.receivedMs);
    }
}
/** Walk every page of one Gmail search, storing as it goes; true when the search was exhausted. */
async function walk(db, sub, reader, q, deadline, p) {
    let token;
    do {
        if (Date.now() >= deadline) {
            p.stopped = true;
            return false;
        }
        const page = await reader.list(q, token);
        await storePage(db, sub, reader, page.ids, deadline, p);
        if (p.stopped)
            return false;
        token = page.next;
    } while (token);
    return true;
}
async function readRow(db, sub, provider) {
    const r = await db.query('SELECT newest_at, oldest_at, backfill_done, stored, pruned_at, last_run_at, last_error FROM oshal_email_sync WHERE sync_key = $1', [`${sub}|${provider}`]);
    return r.rows[0] || null;
}
/** A stored time in ms: pg hands back a Date (String() would drop its milliseconds), the native bridge a string. */
const toMs = (v) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
const ms = (v) => (v == null || v === '' ? null : toMs(v));
const iso = (v) => (v === null ? null : new Date(v).toISOString());
async function writeRow(db, sub, exists, s) {
    const values = [`${sub}|google`, sub, iso(s.newest), iso(s.oldest), s.done, s.stored, iso(s.pruned), s.error];
    if (exists) {
        await db.query(`UPDATE oshal_email_sync SET newest_at = $3, oldest_at = $4, backfill_done = $5, stored = $6, pruned_at = $7,
      last_error = $8, last_run_at = now() WHERE sync_key = $1 AND user_sub = $2`, values);
    }
    else {
        await db.query(`INSERT INTO oshal_email_sync (sync_key, user_sub, provider, newest_at, oldest_at, backfill_done, stored, pruned_at, last_error, last_run_at)
      VALUES ($1, $2, 'google', $3, $4, $5, $6, $7, $8, now())`, values);
    }
}
/** Drop stored mail older than the window, at most once a day; returns how many rows went. */
async function prune(db, sub, now) {
    const r = await db.query('DELETE FROM oshal_email_messages WHERE user_sub = $1 AND received_at < $2', [sub, new Date(now - exports.STORE_DAYS * DAY_MS).toISOString()]);
    return Number(r.rowCount || 0);
}
/**
 * @description One sync pass for the caller's Gmail: new mail since the newest stored message (the last week on a first
 * pass), then, once that is caught up, older mail backwards to STORE_DAYS, all before `deadline`. Progress is saved
 * even when a Gmail read fails, and the failure is recorded on the state and rethrown.
 * @param db - The caller-scoped pool.
 * @param sub - The caller's subject.
 * @param reader - The Gmail reads.
 * @param deadline - Epoch ms by which the pass stops starting new reads.
 * @param now - The pass's clock (tests).
 * @returns What was stored and the resulting state.
 */
async function syncGmail(db, sub, reader, deadline, now = Date.now()) {
    const row = await readRow(db, sub, 'google');
    const stored = row ? Number(row.stored) || 0 : 0;
    let oldest = row ? ms(row.oldest_at) : null, done = Boolean(row?.backfill_done);
    // A state written before passes resumed has no newest_at: its stored range ends at its last run.
    let newest = row ? ms(row.newest_at) ?? (oldest === null ? null : ms(row.last_run_at)) : null;
    let pruned = row ? ms(row.pruned_at) : null, removed = 0, caughtUp = newest === null;
    const p = { inserted: 0, newestMs: null, oldestMs: null, stopped: false };
    const back = { inserted: 0, newestMs: null, oldestMs: null, stopped: false };
    const horizon = Math.floor((now - exports.STORE_DAYS * DAY_MS) / 1000);
    let failure = null;
    try {
        if (newest !== null)
            caughtUp = await walk(db, sub, reader, `after:${Math.floor((newest - OVERLAP_MS) / 1000)} ${NOT_MAIL}`, deadline, p);
        if (caughtUp && !done) {
            const below = oldest === null ? '' : `before:${Math.floor(oldest / 1000) + 1} `;
            done = await walk(db, sub, reader, `${below}after:${horizon} ${NOT_MAIL}`, deadline, back);
            if (done)
                oldest = horizon * 1000;
        }
        // Stored now: everything from oldest up to this pass (the next pass re-reads from OVERLAP_MS before it).
        if (caughtUp)
            newest = now;
        if (done && (pruned === null || now - pruned >= PRUNE_EVERY_MS)) {
            removed = await prune(db, sub, now);
            pruned = now;
        }
    }
    catch (err) {
        failure = err;
    }
    // What the downward walk stored is contiguous below the copy even when a read failed part way.
    if (!done && back.oldestMs !== null)
        oldest = Math.min(oldest ?? back.oldestMs, back.oldestMs);
    p.inserted += back.inserted;
    const error = failure ? bounded(failure.message, 300) : null;
    const total = Math.max(0, stored + p.inserted - removed);
    await writeRow(db, sub, Boolean(row), { newest, oldest, done, stored: total, pruned, error });
    if (failure)
        throw failure;
    const state = { provider: 'google', stored: total, syncedThrough: iso(newest), oldestAt: iso(oldest), complete: done, lastRunAt: new Date().toISOString(), lastError: null };
    return { inserted: p.inserted, pruned: removed, caughtUp, complete: done, state };
}
/**
 * @description The caller's sync state, or null when nothing was ever stored (including before the migration ran).
 * @param db - The caller-scoped pool.
 * @param sub - The caller's subject.
 * @param provider - The provider whose copy to describe.
 * @returns The state.
 */
async function readStoreState(db, sub, provider = 'google') {
    let row;
    try {
        row = await readRow(db, sub, provider);
    }
    catch (err) {
        if (missingTable(err))
            return null;
        throw err;
    }
    if (!row)
        return null;
    const at = ms(row.last_run_at);
    return {
        provider, stored: Number(row.stored) || 0, syncedThrough: iso(ms(row.newest_at)), oldestAt: iso(ms(row.oldest_at)),
        complete: Boolean(row.backfill_done), lastRunAt: iso(at), lastError: row.last_error ? String(row.last_error) : null,
    };
}
/**
 * @description Whether the copy can answer a search: a pass has caught up with new mail within FRESH_MS.
 * @param state - The caller's state.
 * @param now - The clock.
 * @returns True when the copy is current.
 */
function storeIsFresh(state, now = Date.now()) {
    if (!state?.syncedThrough || !state.lastRunAt)
        return false;
    return now - new Date(state.lastRunAt).getTime() <= exports.FRESH_MS && now - new Date(state.syncedThrough).getTime() <= exports.FRESH_MS + OVERLAP_MS;
}
/**
 * @description The window a stored search covers: the search's own newer_than, else the days asked, within STORE_DAYS.
 * @param days - The days asked for.
 * @param query - The search words.
 * @returns The window in days.
 */
function searchWindow(days, query) {
    return Math.min(Math.max(parseSearch(query).days ?? days, 1), exports.STORE_DAYS);
}
/**
 * @description Whether the copy can answer a search over `days`: it is current and reaches back over the whole window.
 * @param state - The caller's state.
 * @param days - The search window in days.
 * @param now - The clock.
 * @returns True when every message of the window is in the copy.
 */
function storeCovers(state, days, now = Date.now()) {
    if (!storeIsFresh(state, now) || !state)
        return false;
    return state.complete || (state.oldestAt !== null && new Date(state.oldestAt).getTime() <= now - days * DAY_MS);
}
/**
 * @description Read the person's (or the concierge's) search words the way Gmail would: quoted phrases stay whole,
 * OR / | separate alternatives, from:/subject: keep their value as a word, newer_than:Nd|w|m sets the window, other
 * operators (in:, is:, label:, has:, category:) and filler words are dropped.
 * @param query - The search text.
 * @returns The parsed search; `any` is empty when no word is left.
 */
function parseSearch(query) {
    let days = null;
    const text = String(query ?? '').toLowerCase().replace(/[\r\n]+/g, ' ').slice(0, 300)
        .replace(/\bnewer_than:(\d+)([dwmy])\b/g, (_m, n, unit) => { days = Number(n) * { d: 1, w: 7, m: 30, y: 365 }[unit]; return ' '; })
        .replace(/\b(?:in|is|label|has|category|older_than|after|before):\S+/g, ' ')
        .replace(/\b(?:from|to|subject):/g, ' ');
    const any = text.split(/\s+(?:or)\s+|\|/).map((alt) => {
        const words = [];
        alt.replace(/"([^"]+)"|(\S+)/g, (_m, phrase, word) => {
            const w = String(phrase ?? word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
            if (w.length >= 2 && (phrase || !STOP.has(w)))
                words.push(w);
            return '';
        });
        return words;
    }).filter((words) => words.length);
    return { any, days };
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const atWordStart = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}`, 'u').test(text);
function toMessage(r) {
    const labels = String(r.labels || '').split(',');
    const unread = labels.includes('UNREAD'), important = labels.includes('IMPORTANT'), starred = labels.includes('STARRED');
    const received = new Date(toMs(r.received_at));
    return {
        id: String(r.message_id), from: String(r.sender || ''), subject: String(r.subject || ''), date: received.toUTCString(),
        internalDate: String(received.getTime()), receivedAt: received.toISOString(), snippet: String(r.snippet || ''),
        unread, important, starred, providerFlags: { unread, important, starred },
    };
}
/**
 * @description Search the caller's stored copy: messages within the window that hold every word of one alternative
 * (word-start matches, so "prep" finds "preparation"); when none does, the messages holding the most of the words,
 * marked matchedAll=false. No words lists the window's newest mail. Newest first, at most `max`.
 * @param db - The caller-scoped pool.
 * @param sub - The caller's subject.
 * @param days - The window asked for (the words' own newer_than wins), within STORE_DAYS.
 * @param max - How many to return.
 * @param query - The search words.
 * @param now - The clock (tests).
 * @returns The matching messages.
 */
async function searchStored(db, sub, days, max, query, now = Date.now()) {
    const parsed = parseSearch(query);
    const window = searchWindow(days, query);
    const words = [...new Set(parsed.any.flat())];
    const params = [sub, new Date(now - window * DAY_MS).toISOString()];
    const like = words.map((w) => { params.push(`%${w.replace(/[\\%_]/g, '\\$&')}%`); return `search_text LIKE $${params.length}`; });
    const sql = `SELECT message_id, sender, subject, snippet, labels, received_at, search_text FROM oshal_email_messages
    WHERE user_sub = $1 AND received_at >= $2${like.length ? ` AND (${like.join(' OR ')})` : ''}`;
    const rows = (await db.query(sql, params)).rows;
    const scored = rows.map((r) => {
        const text = String(r.search_text || '');
        const all = parsed.any.some((alt) => alt.every((w) => atWordStart(text, w)));
        return { r, all, hits: words.filter((w) => atWordStart(text, w)).length, at: toMs(r.received_at) };
    }).filter((s) => !words.length || s.hits > 0);
    const full = scored.filter((s) => s.all);
    const pick = (words.length && !full.length ? scored.sort((a, b) => b.hits - a.hits || b.at - a.at) : (words.length ? full : scored).sort((a, b) => b.at - a.at));
    return { messages: pick.slice(0, max).map((s) => toMessage(s.r)), matched: words.length && full.length ? full.length : pick.length, matchedAll: !words.length || full.length > 0, days: window, words: parsed.any };
}
/** A window read that returns this many rows may have been cut by the LIMIT: it is read again, narrower. */
const WINDOW_CAP = 500;
const WINDOW_MIN_MS = 3600 * 1000;
const WINDOW_MAX_MS = 32 * DAY_MS;
/** Newest first; the id breaks a tie so a cursor's skip count is exact. */
function newestFirst(a, b) {
    return b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/**
 * @description One page of the caller's stored inbox, newest first, by keyset: rows received at or before the cursor,
 * read in time windows that widen while they come back sparse and narrow when one holds WINDOW_CAP rows, sorted here.
 * Native-kernel safe: a bounded window and a LIMIT only, never ORDER BY or OFFSET; light columns, no search text.
 * @param db - The caller-scoped pool.
 * @param sub - The caller's subject.
 * @param max - The page size.
 * @param cursor - Where the page starts (the previous page's `next`); absent for the first page.
 * @param oldestAt - The copy's oldest message (the listing stops there), or null for a copy without one.
 * @param now - The clock (tests).
 * @returns The page, where the next one starts, and how far back the listing reaches.
 */
async function listStored(db, sub, max, cursor = {}, oldestAt = null, now = Date.now()) {
    const cursorMs = Date.parse(String(cursor.before ?? ''));
    const top = Number.isFinite(cursorMs) ? cursorMs : now + 60_000;
    const skip = Math.max(0, Math.trunc(Number(cursor.skip)) || 0);
    const floor = Math.max(now - exports.STORE_DAYS * DAY_MS, oldestAt ? Date.parse(oldestAt) || 0 : 0);
    const want = max + skip;
    const found = [];
    let upper = top, span = DAY_MS, done = top < floor;
    while (!done && found.length < want + 1) {
        const lower = Math.max(upper - span, floor);
        const last = lower <= floor;
        const sql = `SELECT message_id, sender, subject, snippet, labels, received_at FROM oshal_email_messages
      WHERE user_sub = $1 AND received_at <= $2 AND received_at ${last ? '>=' : '>'} $3 AND labels LIKE '%INBOX%' LIMIT ${WINDOW_CAP}`;
        const rows = (await db.query(sql, [sub, new Date(upper).toISOString(), new Date(lower).toISOString()])).rows;
        if (rows.length >= WINDOW_CAP && span > WINDOW_MIN_MS) {
            span = Math.max(Math.floor(span / 2), WINDOW_MIN_MS);
            continue;
        }
        for (const r of rows)
            found.push({ r, at: toMs(r.received_at), id: String(r.message_id) });
        upper = lower;
        span = Math.min(span * 2, WINDOW_MAX_MS);
        done = last;
    }
    found.sort(newestFirst);
    let dropped = 0;
    const rest = found.filter((f) => !(dropped < skip && f.at === top && ++dropped));
    const page = rest.slice(0, max);
    const tail = page[page.length - 1];
    const more = rest.length > max || !done;
    const atTail = tail ? page.filter((f) => f.at === tail.at).length + (tail.at === top ? skip : 0) : 0;
    return {
        messages: page.map((f) => toMessage(f.r)),
        next: more && tail ? { before: new Date(tail.at).toISOString(), skip: atTail } : null,
        reach: new Date(floor).toISOString(),
    };
}
//# sourceMappingURL=mail-store.js.map