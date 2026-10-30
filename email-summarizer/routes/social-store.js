/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | The Social desk's store and its pure rules (Roger, 2026-10-30: a publisher's queue for a person posting to two or three services). Posts (text, per-channel variants, channels, when, per-channel outcomes), the posting plan (days and times in the person's time zone; "Add to queue" takes the next free slot the way Buffer's queue does), the chosen Slack channel and Go Live events. Native-kernel safe: one-column keys, plain INSERTs, reads by key or by owner with a LIMIT, sorting here, no ON CONFLICT, ORDER BY or DISTINCT (the kernel copies a table for those).
 */
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

/** The plan a person starts with: weekday mornings, lunch and late afternoon, the three slots Buffer seeds. */
exports.DEFAULT_PLAN = Object.freeze({ days: [1, 2, 3, 4, 5], times: ['09:00', '12:30', '17:00'] });
/** How many posts a listing returns; the desk shows what is coming, not an archive. */
exports.LIST_LIMIT = 400;
/** Two posts closer than this on the same channel count as the same slot. */
const SLOT_GAP_MS = 60 * 1000;
const POST_STATUSES = new Set(['draft', 'scheduled', 'sending', 'sent', 'partial', 'failed']);

/**
 * @description A key for a new row: time-ordered so a listing sorted by id is roughly by creation, plus random bits.
 * @param {string} prefix - The row family (post, event).
 * @returns {string} The key.
 */
function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
exports.newId = newId;

/**
 * @description Is this the unique-violation a duplicate INSERT raises? Treated as "already stored".
 * @param {unknown} err - The thrown error.
 * @returns {boolean} True for 23505 in any of the shapes the kernel and pg report it.
 */
function duplicate(err) {
  const e = err;
  return e?.code === '23505' || /23505|unique (constraint|key)|duplicate key/i.test(String(e?.message || ''));
}
exports.duplicate = duplicate;

/**
 * @description The local parts of an instant in an IANA time zone (falls back to UTC for an unknown zone).
 * @param {Date} date - The instant.
 * @param {string} tz - The zone.
 * @returns {{y:number,m:number,d:number,hh:number,mm:number,ss:number,weekday:number}} The parts.
 */
function zonedParts(date, tz) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  } catch (_) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  }
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, weekday: weekdays[p.weekday] ?? 0 };
}
exports.zonedParts = zonedParts;

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(date, tz) {
  const p = zonedParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - date.getTime();
}

/**
 * @description The instant a wall-clock time in a zone names (two passes so a DST edge resolves).
 * @param {{y:number,m:number,d:number}} day - The calendar day.
 * @param {string} hhmm - The wall-clock time, "HH:MM".
 * @param {string} tz - The zone.
 * @returns {number} Milliseconds since the epoch.
 */
function instantOf(day, hhmm, tz) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(day.y, day.m - 1, day.d, hh, mm);
  let guess = wall - offsetMs(new Date(wall), tz);
  guess = wall - offsetMs(new Date(guess), tz);
  return guess;
}
exports.instantOf = instantOf;

/**
 * @description Normalize a saved plan: valid weekdays and "HH:MM" times only, sorted; the default when nothing is left.
 * @param {unknown} plan - What the person saved.
 * @returns {{days:number[],times:string[]}} A usable plan.
 */
function normalizePlan(plan) {
  const src = plan && typeof plan === 'object' ? plan : {};
  const days = [...new Set((Array.isArray(src.days) ? src.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const times = [...new Set((Array.isArray(src.times) ? src.times : []).map(String).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort();
  return { days: days.length ? days : [...exports.DEFAULT_PLAN.days], times: times.length ? times : [...exports.DEFAULT_PLAN.times] };
}
exports.normalizePlan = normalizePlan;

/**
 * @description The next free slot of the plan after now: the first plan time on a plan day that is at least a minute
 * ahead and not already taken by a scheduled post. Looks three weeks ahead; a plan with no reachable slot answers null.
 * @param {{days:number[],times:string[]}} plan - The posting plan.
 * @param {number} nowMs - The clock.
 * @param {string[]} takenIso - When the already scheduled posts go out.
 * @param {string} tz - The person's zone.
 * @returns {string|null} The slot as ISO, or null.
 */
function nextSlot(plan, nowMs, takenIso, tz) {
  const p = normalizePlan(plan);
  const taken = (takenIso || []).map((s) => Date.parse(s)).filter(Number.isFinite);
  const isTaken = (t) => taken.some((x) => Math.abs(x - t) < SLOT_GAP_MS);
  for (let offset = 0; offset < 21; offset += 1) {
    const day = zonedParts(new Date(nowMs + offset * 86400000), tz);
    if (!p.days.includes(day.weekday)) continue;
    for (const hhmm of p.times) {
      const t = instantOf(day, hhmm, tz);
      if (t >= nowMs + SLOT_GAP_MS && !isTaken(t)) return new Date(t).toISOString();
    }
  }
  return null;
}
exports.nextSlot = nextSlot;

/**
 * @description Bound a text field: a string, trimmed to the cap.
 * @param {unknown} value - The input.
 * @param {number} max - The cap.
 * @returns {string} The bounded text.
 */
function bounded(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}
exports.bounded = bounded;

/** Parse a stored JSON column, answering the fallback for anything unreadable. */
function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch (_) {
    return fallback;
  }
}
exports.parseJson = parseJson;

/**
 * @description One post row as the desk sees it.
 * @param {object} r - The SQL row.
 * @returns {object} The post.
 */
function toPost(r) {
  return {
    id: r.post_id, status: r.status, text: r.body, variants: parseJson(r.variants, {}), channels: parseJson(r.channels, []),
    mediaUrl: r.media_url || '', eventId: r.event_id || '', scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, outcomes: parseJson(r.outcomes, {}),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}
exports.toPost = toPost;

const POST_COLUMNS = 'post_id, user_sub, status, body, variants, channels, media_url, event_id, scheduled_at, sent_at, outcomes, created_at, updated_at';

/**
 * @description Store a new post.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {object} post - The post (id, status, text, variants, channels, mediaUrl, eventId, scheduledAt).
 * @returns {Promise<void>} Resolves when stored.
 */
async function insertPost(db, sub, post) {
  await db.query(
    `INSERT INTO oshal_email_social_posts (post_id, user_sub, status, body, variants, channels, media_url, event_id, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [post.id, sub, post.status, post.text, JSON.stringify(post.variants || {}), JSON.stringify(post.channels || []), post.mediaUrl || '', post.eventId || '', post.scheduledAt || null],
  );
}
exports.insertPost = insertPost;

/**
 * @description The owner's posts, newest scheduled first (sorted here, never in SQL).
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {string} [status] - One status, or every status when omitted.
 * @returns {Promise<object[]>} The posts.
 */
async function listPosts(db, sub, status) {
  const params = [sub, exports.LIST_LIMIT];
  let where = 'user_sub = $1';
  if (status && POST_STATUSES.has(status)) { params.push(status); where += ' AND status = $3'; }
  const r = await db.query(`SELECT ${POST_COLUMNS} FROM oshal_email_social_posts WHERE ${where} LIMIT $2`, params);
  return r.rows.map(toPost).sort((a, b) => Date.parse(a.scheduledAt || a.createdAt || 0) - Date.parse(b.scheduledAt || b.createdAt || 0));
}
exports.listPosts = listPosts;

/**
 * @description One post by key, the owner's only.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {string} id - The post key.
 * @returns {Promise<object|null>} The post or null.
 */
async function readPost(db, sub, id) {
  const r = await db.query(`SELECT ${POST_COLUMNS} FROM oshal_email_social_posts WHERE post_id = $1 AND user_sub = $2`, [id, sub]);
  return r.rows[0] ? toPost(r.rows[0]) : null;
}
exports.readPost = readPost;

/**
 * @description Change a post's fields.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {string} id - The post key.
 * @param {object} patch - Fields to set: status, text, variants, channels, mediaUrl, scheduledAt, sentAt, outcomes.
 * @returns {Promise<boolean>} True when a row changed.
 */
async function updatePost(db, sub, id, patch) {
  const sets = ['updated_at = NOW()'];
  const params = [id, sub];
  const set = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.text !== undefined) set('body', patch.text);
  if (patch.variants !== undefined) set('variants', JSON.stringify(patch.variants || {}));
  if (patch.channels !== undefined) set('channels', JSON.stringify(patch.channels || []));
  if (patch.mediaUrl !== undefined) set('media_url', patch.mediaUrl || '');
  if (patch.scheduledAt !== undefined) set('scheduled_at', patch.scheduledAt || null);
  if (patch.sentAt !== undefined) set('sent_at', patch.sentAt || null);
  if (patch.outcomes !== undefined) set('outcomes', JSON.stringify(patch.outcomes || {}));
  const r = await db.query(`UPDATE oshal_email_social_posts SET ${sets.join(', ')} WHERE post_id = $1 AND user_sub = $2`, params);
  return (r.rowCount || 0) > 0;
}
exports.updatePost = updatePost;

/**
 * @description Remove a post.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {string} id - The post key.
 * @returns {Promise<boolean>} True when a row went.
 */
async function deletePost(db, sub, id) {
  const r = await db.query('DELETE FROM oshal_email_social_posts WHERE post_id = $1 AND user_sub = $2', [id, sub]);
  return (r.rowCount || 0) > 0;
}
exports.deletePost = deletePost;

/**
 * @description The scheduled posts whose time has come, oldest first (sorted here).
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {string} nowIso - The clock.
 * @returns {Promise<object[]>} Up to 25 due posts.
 */
async function duePosts(db, sub, nowIso) {
  const r = await db.query(`SELECT ${POST_COLUMNS} FROM oshal_email_social_posts WHERE user_sub = $1 AND status = 'scheduled' AND scheduled_at <= $2 LIMIT 25`, [sub, nowIso]);
  return r.rows.map(toPost).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
}
exports.duePosts = duePosts;

/**
 * @description The person's settings: plan, Slack channel, zone. Defaults when nothing is saved.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @returns {Promise<{plan:object,slackChannel:string,slackLabel:string,timezone:string,saved:boolean}>} The settings.
 */
async function readSettings(db, sub) {
  const r = await db.query('SELECT plan, slack_channel, slack_label, timezone FROM oshal_email_social_settings WHERE settings_key = $1', [sub]);
  const row = r.rows[0];
  if (!row) return { plan: normalizePlan(null), slackChannel: '', slackLabel: '', timezone: '', saved: false };
  return { plan: normalizePlan(parseJson(row.plan, null)), slackChannel: row.slack_channel || '', slackLabel: row.slack_label || '', timezone: row.timezone || '', saved: true };
}
exports.readSettings = readSettings;

/**
 * @description Save settings: the given fields over the saved ones.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {object} patch - plan, slackChannel, slackLabel, timezone (each optional).
 * @returns {Promise<object>} The settings as saved.
 */
async function writeSettings(db, sub, patch) {
  const current = await readSettings(db, sub);
  const next = {
    plan: patch.plan !== undefined ? normalizePlan(patch.plan) : current.plan,
    slackChannel: patch.slackChannel !== undefined ? bounded(patch.slackChannel, 64) : current.slackChannel,
    slackLabel: patch.slackLabel !== undefined ? bounded(patch.slackLabel, 120) : current.slackLabel,
    timezone: patch.timezone !== undefined ? bounded(patch.timezone, 64) : current.timezone,
  };
  const params = [sub, JSON.stringify(next.plan), next.slackChannel, next.slackLabel, next.timezone];
  if (current.saved) {
    await db.query('UPDATE oshal_email_social_settings SET plan = $2, slack_channel = $3, slack_label = $4, timezone = $5, updated_at = NOW() WHERE settings_key = $1', params);
  } else {
    try {
      await db.query('INSERT INTO oshal_email_social_settings (settings_key, user_sub, plan, slack_channel, slack_label, timezone) VALUES ($1, $1, $2, $3, $4, $5)', params);
    } catch (err) {
      if (!duplicate(err)) throw err;
      await db.query('UPDATE oshal_email_social_settings SET plan = $2, slack_channel = $3, slack_label = $4, timezone = $5, updated_at = NOW() WHERE settings_key = $1', params);
    }
  }
  return { ...next, saved: true };
}
exports.writeSettings = writeSettings;

/** One Go Live event as the desk sees it. */
function toEvent(r) {
  return {
    id: r.event_id, title: r.title, description: r.description, startAt: new Date(r.start_at).toISOString(),
    destinations: parseJson(r.destinations, []), watchUrl: r.watch_url || '', status: r.status, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}
exports.toEvent = toEvent;

/**
 * @description Store a Go Live event.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {object} ev - id, title, description, startAt, destinations, watchUrl.
 * @returns {Promise<void>} Resolves when stored.
 */
async function insertEvent(db, sub, ev) {
  await db.query(
    'INSERT INTO oshal_email_social_events (event_id, user_sub, title, description, start_at, destinations, watch_url) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [ev.id, sub, ev.title, ev.description || '', ev.startAt, JSON.stringify(ev.destinations || []), ev.watchUrl || ''],
  );
}
exports.insertEvent = insertEvent;

/**
 * @description The owner's events, soonest first.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @returns {Promise<object[]>} The events.
 */
async function listEvents(db, sub) {
  const r = await db.query('SELECT event_id, user_sub, title, description, start_at, destinations, watch_url, status, created_at FROM oshal_email_social_events WHERE user_sub = $1 LIMIT 200', [sub]);
  return r.rows.map(toEvent).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
exports.listEvents = listEvents;

/**
 * @description Remove an event and the posts that were still waiting to announce it.
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {string} id - The event key.
 * @returns {Promise<boolean>} True when the event went.
 */
async function deleteEvent(db, sub, id) {
  await db.query("DELETE FROM oshal_email_social_posts WHERE user_sub = $1 AND event_id = $2 AND status IN ('draft', 'scheduled')", [sub, id]);
  const r = await db.query('DELETE FROM oshal_email_social_events WHERE event_id = $1 AND user_sub = $2', [id, sub]);
  return (r.rowCount || 0) > 0;
}
exports.deleteEvent = deleteEvent;
