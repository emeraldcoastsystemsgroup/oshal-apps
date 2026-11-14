/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First career-summary.v1 projection (0.1.0): the fixed, bounded summary a job seeker may share with one coach. Counts by default (Saved, Getting ready, Applied, Interviewing, Offer, Closed and applications recorded in the past seven days, each a whole number or unknown, never a guessed zero); the up-to-25 application list and up to three seeker-written next steps only when the seeker opts in. Every object is closed (an extra property is refused), every string and list is bounded, a future or day-old source time is refused, and a next step may not carry a link. The coach's view is projected to the summary-v1 field set and labelled a seeker-shared snapshot.
 */
'use strict';
const crypto = require('node:crypto');

/** The one schema this package shares; a new schema needs a new consent. */
const SCHEMA = 'career-summary.v1';
/** What the coach's page calls every snapshot: the seeker provided it, the server did not certify it. */
const LABEL = 'Seeker-shared snapshot';
/** authorization.yaml's coaching-summary field set summary-v1, exactly (a test holds the two together). */
const SUMMARY_FIELDS = Object.freeze(['alias', 'schema', 'label', 'sourceAsOf', 'publishedAt', 'expiresAt',
  'pipeline', 'activity', 'applications', 'nextSteps']);
/** Career's own stage words, in the order a job moves (career-hunter tools/career-stages.js). */
const PIPELINE_KEYS = Object.freeze(['saved', 'gettingReady', 'applied', 'interviewing', 'offer', 'closed']);
const STAGES = Object.freeze(['Applied', 'Interviewing', 'Offer', 'Closed']);
const GROUPS = Object.freeze(['applications', 'counts', 'next-steps']);
const LIMITS = Object.freeze({applications: 25, nextSteps: 3, nextStepText: 160, alias: 60, employer: 120,
  title: 160, count: 100000, timeZone: 64});
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const MAX_SKEW_MS = 2 * MINUTE;
const MAX_SOURCE_AGE_MS = DAY;
const LINK = /(:\/\/|\bwww\.|\bmailto:|\btel:)/i;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const ITEM = /^a(?:[1-9]|1\d|2[0-5])$/;

/**
 * @description Refuse an input with a stable code the route answers as 400; nothing is partly kept.
 * @param {string} code - Machine-readable refusal.
 * @param {string} message - Words the page can show.
 * @returns {never} Always throws.
 */
function refuse(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  throw error;
}

/**
 * @description A plain object holding only the named keys (each required unless listed optional).
 * @param {unknown} value - Untrusted input.
 * @param {string[]} keys - Every allowed key.
 * @param {string[]} [optional] - Allowed keys that may be absent.
 * @param {string} where - Name used in the refusal.
 * @returns {object} The same object.
 */
function closed(value, keys, optional, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.prototype.toString.call(value) !== '[object Object]') {
    refuse('invalid_shape', `${where} must be an object.`);
  }
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) refuse('extra_fields', `${where} has fields this share cannot carry: ${extra.slice(0, 5).join(', ')}.`);
  const missing = keys.filter((key) => !(optional || []).includes(key) && !Object.hasOwn(value, key));
  if (missing.length) refuse('missing_fields', `${where} is missing ${missing.join(', ')}.`);
  return value;
}

/**
 * @description Bounded single-line text with no control characters.
 * @param {unknown} value - Untrusted text.
 * @param {number} max - Longest allowed length in characters.
 * @param {string} where - Name used in the refusal.
 * @returns {string} The trimmed text.
 */
function text(value, max, where) {
  if (typeof value !== 'string') refuse('invalid_text', `${where} must be text.`);
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > max || CONTROL.test(trimmed) || /[\n\r\t]/.test(trimmed)) {
    refuse('invalid_text', `${where} must be 1 to ${max} characters on one line.`);
  }
  return trimmed;
}

/**
 * @description A count, or null when Career could not say (unknown is never turned into zero).
 * @param {unknown} value - Untrusted count.
 * @param {string} where - Name used in the refusal.
 * @returns {number|null} The count or null.
 */
function count(value, where) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > LIMITS.count) refuse('invalid_count', `${where} must be a whole number or unknown.`);
  return value;
}

/**
 * @description An instant in ISO-8601 form, normalized to UTC milliseconds.
 * @param {unknown} value - Untrusted instant.
 * @param {string} where - Name used in the refusal.
 * @returns {string} Normalized ISO text.
 */
function instant(value, where) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) refuse('invalid_time', `${where} must be a time.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) refuse('invalid_time', `${where} must be a time.`);
  return new Date(ms).toISOString();
}

/**
 * @description A calendar day YYYY-MM-DD, or null.
 * @param {unknown} value - Untrusted day.
 * @param {string} where - Name used in the refusal.
 * @returns {string|null} The day or null.
 */
function day(value, where) {
  if (value === null) return null;
  if (typeof value !== 'string' || !DAY_TEXT.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    refuse('invalid_day', `${where} must be a date.`);
  }
  return value;
}

/**
 * @description The pipeline counts, all six present, each a count or unknown.
 * @param {unknown} value - Untrusted pipeline.
 * @returns {object} Normalized pipeline.
 */
function pipeline(value) {
  closed(value, PIPELINE_KEYS, [], 'Pipeline');
  return Object.fromEntries(PIPELINE_KEYS.map((key) => [key, count(value[key], key)]));
}

/**
 * @description Applications recorded in the past seven days, with Career's own cutoff and as-of instants.
 * @param {unknown} value - Untrusted activity.
 * @param {number} now - Server time in milliseconds.
 * @returns {object} Normalized activity.
 */
function activity(value, now) {
  closed(value, ['period', 'since', 'asOf', 'applied'], [], 'Activity');
  if (value.period !== 'past7days') refuse('invalid_period', 'Activity covers the past 7 days only.');
  const since = instant(value.since, 'Activity start'), asOf = instant(value.asOf, 'Activity time');
  const span = Date.parse(asOf) - Date.parse(since);
  if (Math.abs(span - 7 * DAY) > 2 * 60 * MINUTE) refuse('invalid_period', 'Activity covers the past 7 days only.');
  if (Date.parse(asOf) > now + MAX_SKEW_MS) refuse('future_time', 'Activity time is in the future.');
  return {period: 'past7days', since, asOf, applied: count(value.applied, 'Applied in the past 7 days')};
}

/**
 * @description The optional application list: public employer and title, stage and an optional date only.
 * @param {unknown} value - Untrusted list.
 * @returns {object[]} Normalized entries.
 */
function applications(value) {
  if (!Array.isArray(value) || value.length > LIMITS.applications) refuse('invalid_list', `Applications must be a list of at most ${LIMITS.applications}.`);
  const seen = new Set();
  return value.map((entry, index) => {
    closed(entry, ['item', 'employer', 'title', 'stage', 'date'], [], `Application ${index + 1}`);
    if (typeof entry.item !== 'string' || !ITEM.test(entry.item) || seen.has(entry.item)) refuse('invalid_item', 'Each application needs its own item number.');
    seen.add(entry.item);
    if (!STAGES.includes(entry.stage)) refuse('invalid_stage', `Stage must be one of ${STAGES.join(', ')}.`);
    return {item: entry.item, employer: text(entry.employer, LIMITS.employer, 'Employer'),
      title: text(entry.title, LIMITS.title, 'Job title'), stage: entry.stage, date: day(entry.date, 'Application date')};
  });
}

/**
 * @description Up to three seeker-written next steps; links, meeting addresses and mailbox text are refused.
 * @param {unknown} value - Untrusted list.
 * @returns {object[]} Normalized steps.
 */
function nextSteps(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.nextSteps) refuse('invalid_list', `Add 1 to ${LIMITS.nextSteps} next steps.`);
  return value.map((entry, index) => {
    closed(entry, ['text', 'due', 'timeZone'], [], `Next step ${index + 1}`);
    const words = text(entry.text, LIMITS.nextStepText, `Next step ${index + 1}`);
    if (LINK.test(words)) refuse('link_in_step', 'Next steps cannot contain links or meeting addresses.');
    return {text: words, due: day(entry.due, 'Due date'), timeZone: zone(entry.timeZone)};
  });
}

/**
 * @description An IANA time zone the runtime recognises, or null.
 * @param {unknown} value - Untrusted zone.
 * @returns {string|null} The zone or null.
 */
function zone(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > LIMITS.timeZone || !ZONE.test(value)) refuse('invalid_zone', 'Time zone is not recognised.');
  try { new Intl.DateTimeFormat('en-US', {timeZone: value}); } catch { refuse('invalid_zone', 'Time zone is not recognised.'); }
  return value;
}

/**
 * @description The field groups a share carries, from the seeker's two opt-in choices. Counts are always in.
 * @param {{applications: boolean, nextSteps: boolean}} include - The seeker's choices.
 * @returns {string[]} Sorted group names.
 */
function fieldGroups(include) {
  closed(include, ['applications', 'nextSteps'], [], 'Include');
  if (typeof include.applications !== 'boolean' || typeof include.nextSteps !== 'boolean') refuse('invalid_include', 'Choose yes or no for each optional part.');
  return GROUPS.filter((group) => group === 'counts' || (group === 'applications' && include.applications)
    || (group === 'next-steps' && include.nextSteps));
}

/**
 * @description Validate the browser-carried snapshot against the chosen field groups and the server clock.
 * @param {unknown} snapshot - Untrusted snapshot the seeker's page read from their own Career data.
 * @param {string[]} groups - The field groups from fieldGroups().
 * @param {number} now - Server time in milliseconds.
 * @returns {object} The normalized snapshot.
 */
function snapshotFor(snapshot, groups, now) {
  const wantsList = groups.includes('applications');
  closed(snapshot, ['schema', 'sourceAsOf', 'pipeline', 'activity', 'applications'], wantsList ? [] : ['applications'], 'Snapshot');
  if (!wantsList && Object.hasOwn(snapshot, 'applications')) refuse('extra_fields', 'Turn on "Include my applications" to share them.');
  if (snapshot.schema !== SCHEMA) refuse('invalid_schema', 'This snapshot is not a career-summary.v1 snapshot.');
  const sourceAsOf = instant(snapshot.sourceAsOf, 'Snapshot time'), at = Date.parse(sourceAsOf);
  if (at > now + MAX_SKEW_MS) refuse('future_time', 'Snapshot time is in the future.');
  if (now - at > MAX_SOURCE_AGE_MS) refuse('stale_snapshot', 'This snapshot is more than a day old. Read it again.');
  const out = {schema: SCHEMA, sourceAsOf, pipeline: pipeline(snapshot.pipeline), activity: activity(snapshot.activity, now)};
  if (wantsList) out.applications = applications(snapshot.applications);
  return out;
}

/**
 * @description The exact payload a consent binds: alias, groups, snapshot and (when chosen) next steps.
 * @param {{alias: unknown, groups: string[], snapshot: object, steps: unknown}} input - Validated parts.
 * @returns {object} Payload with sorted keys.
 */
function payloadFor({alias, groups, snapshot, steps}) {
  const payload = {alias: text(alias, LIMITS.alias, 'Your name for your coach'), fieldGroups: [...groups], ...snapshot};
  if (groups.includes('next-steps')) payload.nextSteps = nextSteps(steps);
  else if (steps !== undefined && steps !== null) refuse('extra_fields', 'Turn on "Add next steps" to share them.');
  return payload;
}

/**
 * @description JSON with object keys sorted at every depth, so equal payloads have equal digests.
 * @param {unknown} value - A JSON value.
 * @returns {string} Canonical JSON text.
 */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * @description SHA-256 of the canonical JSON.
 * @param {unknown} value - A JSON value.
 * @returns {string} Lowercase hex digest.
 */
function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * @description What a coach may see of one consented snapshot: the summary-v1 fields, the groups the consent
 * names, and the snapshot's own times. No seeker account, id, path or address is in it.
 * @param {object} link - The consent row the coach is linked by.
 * @param {object} snapshot - The snapshot row at the link's revision.
 * @returns {object} The coach-facing projection.
 */
function coachView(link, snapshot) {
  const payload = JSON.parse(snapshot.payload), groups = String(link.field_groups).split(',');
  const view = {alias: payload.alias, schema: payload.schema, label: LABEL, sourceAsOf: payload.sourceAsOf,
    publishedAt: snapshot.published_at, expiresAt: link.expires_at, pipeline: payload.pipeline, activity: payload.activity};
  if (groups.includes('applications') && Array.isArray(payload.applications)) view.applications = payload.applications;
  if (groups.includes('next-steps') && Array.isArray(payload.nextSteps)) view.nextSteps = payload.nextSteps;
  return Object.fromEntries(Object.entries(view).filter(([key]) => SUMMARY_FIELDS.includes(key)));
}

module.exports = {SCHEMA, LABEL, SUMMARY_FIELDS, PIPELINE_KEYS, STAGES, GROUPS, LIMITS, MAX_SOURCE_AGE_MS,
  refuse, closed, text, fieldGroups, snapshotFor, payloadFor, canonical, digest, coachView};
