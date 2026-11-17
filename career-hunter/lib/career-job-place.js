/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Where a job is, for My jobs (Roger, 2026-11-16: "the job location doesnt transfer to the my jobs page and i cant look at jobs near me"). A saved job is a reference to its posting, so its place is read from the posting every time a page reads it: the place text, how the job is worked (remote, hybrid or on-site, only from the posting's own words), the city point Find jobs puts on its map, and straight-line miles from the person's home, which is their saved Matching area (the place Career's "near home" job search uses). A place the posting does not give stays empty; nothing here guesses one. It also builds the two SQL parts My jobs needs over every page, not one: "within N miles" (or remote only) and nearest first.
 */
'use strict';
const {careerDistanceSql, careerRadiusPredicate, EARTH_MILES} = require('../routes/career-geo');
const {fullyRemoteSql} = require('../routes/career-search-scope');

/** Where the person sets their home: Settings, What I'm looking for, Matching area. A query, because Today passes no hash. */
const SETTINGS_URL = '/api/career-hunter/settings?section=matching';
const HOME_REQUIRED = 'Set your home city or ZIP in Settings, What I\'m looking for, Matching area, to see the jobs near you.';
const NO_HOME_LINE = 'Set your home city or ZIP to see how far each job is from you.';
const MAX_MILES = 250;

// Keep parity with career-search-scope.ts and engine/jobhunter/work_arrangement.py: the same separators and the same
// occupations that only look like workplace words. Fully remote itself is decided by fullyRemoteSql (the row's `remote`).
const SEPARATORS = '!"#$&\'()*+,-./:;<=>?@[\\]^_`{|}~–—\t\n\r   ';
const OCCUPATIONS = ['remote sensing', 'hybrid cloud', 'hybrid electric', 'hybrid vehicle'];
const DAYS = ['1 day', '2 days', '3 days', '4 days', '5 days', '6 days',
  'one day', 'two days', 'three days', 'four days', 'five days', 'six days'];
const HYBRID = ['hybrid', 'partial remote', 'partially remote', 'occasional remote',
  ...DAYS.flatMap(days => [`remote ${days}`, `${days} remote`])];
const ONSITE = ['onsite', 'on site', 'in office', 'office based', 'in person', 'not remote', 'not a remote', 'non remote',
  'nonremote', 'no remote', 'remote unavailable', 'remote work unavailable', 'no work from home', 'not work from home',
  'no telework', 'not telework'];

/** A refusal of a near-me filter or sort, with the code and words the page shows. */
class PlaceFilterError extends Error {
  /**
   * @description A 400 the page can explain: what is missing and where to set it.
   * @param {string} code Closed refusal code (home_location_required or invalid_within).
   * @param {string} message The words a person reads.
   */
  constructor(code, message) {
    super(message);
    this.name = 'PlaceFilterError';
    this.status = 400;
    this.code = code;
  }
}

/**
 * @description The words of a title and a place, as the workplace rules compare them: lower case, separators as single
 *   spaces, padded with one space each side, occupations such as "hybrid cloud" removed.
 * @param {...unknown} parts Title, place text.
 * @returns {string} The padded words.
 */
function placeWords(...parts) {
  let value = parts.filter(part => typeof part === 'string').join(' ').toLowerCase();
  for (const separator of SEPARATORS) value = value.split(separator).join(' ');
  value = ' ' + value.replace(/ {2,}/g, ' ').trim() + ' ';
  for (const term of OCCUPATIONS) value = value.split(' ' + term + ' ').join(' ');
  return value;
}

/** @param {string} words Padded words. @param {string[]} terms Phrases. @returns {boolean} Whether any phrase is there whole. */
const says = (words, terms) => terms.some(term => words.includes(' ' + term + ' '));

/**
 * @description How a job is worked, only from what its posting states: "remote" exactly when the row is fully remote by the
 *   board's own rule (its `remote` is 1), "hybrid" or "onsite" from the posting's title and place words, else null.
 * @param {{remote?: unknown, title?: unknown, location?: unknown}} job A board or detail row.
 * @returns {'remote'|'hybrid'|'onsite'|null} The workplace type, or null when the posting does not say.
 */
function workplaceType(job) {
  if (job.remote === 1 || job.remote === true) return 'remote';
  const words = placeWords(job.title, job.location);
  if (says(words, HYBRID)) return 'hybrid';
  if (says(words, ONSITE)) return 'onsite';
  return null;
}

/** @param {unknown} value A stored coordinate. @param {number} limit 90 or 180. @returns {number|null} It, when real. */
function coordinate(value, limit) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * @description The posting's own city point, the same values Find jobs plots: both coordinates or neither.
 * @param {{lat?: unknown, lon?: unknown}} job A row.
 * @returns {{lat: number, lon: number}|null} The point, or null when the source has none.
 */
function pointOf(job) {
  const lat = coordinate(job.lat, 90), lon = coordinate(job.lon, 180);
  return lat === null || lon === null ? null : {lat, lon};
}

/**
 * @description Straight-line miles between two points: the haversine formula careerDistanceSql runs in SQL.
 * @param {{lat: number, lon: number}} a One point. @param {{lat: number, lon: number}} b The other.
 * @returns {number} Miles, unrounded.
 */
function milesBetween(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const half = Math.sin(radians(b.lat - a.lat) / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(Math.min(1, Math.max(0, half))));
}

/**
 * @description One job with where it is: `location` (the posting's place text, or null when it names none), `workplaceType`,
 *   `lat`/`lon` (or null), and `distanceMiles` from the person's home to one decimal. Distance is null with no home, no point,
 *   or a fully remote job, which has no trip to make. Every other field is kept as it was.
 * @param {object} job A board or detail row carrying title, location, remote, lat and lon.
 * @param {{lat: number, lon: number}|null|undefined} home The person's saved Matching area, or none.
 * @returns {object} The job with its place fields.
 */
function decorate(job, home) {
  const point = pointOf(job), type = workplaceType(job);
  const text = typeof job.location === 'string' && job.location.trim() ? job.location.trim() : null;
  const near = home && pointOf(home);
  return {...job, location: text, workplaceType: type, lat: point ? point.lat : null, lon: point ? point.lon : null,
    distanceMiles: near && point && type !== 'remote' ? Math.round(milesBetween(near, point) * 10) / 10 : null};
}

/**
 * @description What the page says about the person's home: whether Career knows it, its name and the person's own radius,
 *   the one line to show, and where to set it.
 * @param {{near: string, radiusMiles: number}|null|undefined} home The saved Matching area, or none.
 * @returns {{known: boolean, label: string|null, radiusMiles: number|null, line: string, settingsUrl: string}} The view.
 */
function homeView(home) {
  if (!home) return {known: false, label: null, radiusMiles: null, line: NO_HOME_LINE, settingsUrl: SETTINGS_URL};
  return {known: true, label: home.near, radiusMiles: home.radiusMiles,
    line: `Miles are straight-line from ${home.near}, not driving distance.`, settingsUrl: SETTINGS_URL};
}

/** @param {Record<string, unknown>} query Request query. @param {string} name Key. @returns {string} Its one value, or ''. */
function scalar(query, name) {
  const raw = query[name];
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new PlaceFilterError('invalid_within', `${name} must have one value.`);
  return String(raw).trim();
}

/**
 * @description Jobs whose point is within `miles` of home, the same rule the row's distance follows: not fully remote, a
 *   point inside the bounding box and the radius, and the distance to one decimal no more than `miles`.
 * @param {number} miles Whole miles, 1 to 250. @param {{lat: number, lon: number, near: string}} home Matching area.
 * @returns {string} A predicate over `p` with literal, validated numbers only.
 */
function withinSql(miles, home) {
  const center = {center: {lat: home.lat, lon: home.lon}, label: home.near, radius_miles: miles + 0.05, accuracy: 'city-centroid'};
  return `(${careerRadiusPredicate(center)} AND round(${careerDistanceSql(center)}, 1) <= ${miles} AND NOT ${fullyRemoteSql()})`;
}

/**
 * @description Nearest first: the same distance, no distance (fully remote or no point) after every placed job, then posting id.
 * @param {{lat: number, lon: number}} home Matching area. @returns {string} An ORDER BY over `p` and `s`.
 */
function distanceOrder(home) {
  const center = {center: {lat: home.lat, lon: home.lon}};
  return `CASE WHEN p.lat IS NULL OR p.lon IS NULL THEN NULL WHEN ${fullyRemoteSql()} THEN NULL `
    + `ELSE ${careerDistanceSql(center)} END ASC NULLS LAST, s.posting_id ASC`;
}

/**
 * @description The near-me part of one My jobs request: `within=N` (whole miles 1 to 250) or `within=remote`, and
 *   `sort=distance`. A distance with no home is refused, never widened to everywhere.
 * @param {Record<string, unknown>} query Request query.
 * @param {{lat: number, lon: number, near: string}|null|undefined} home The saved Matching area, or none.
 * @returns {{where: string, order: string, places: boolean}} A predicate over `p` (or ''), an ORDER BY (or ''), and whether
 *   either reads the corpus's place columns (a corpus without them cannot answer it).
 */
function nearQuery(query, home) {
  const within = scalar(query, 'within'), plan = {where: '', order: '', places: false};
  if (within === 'remote') plan.where = fullyRemoteSql();
  else if (within) {
    const miles = /^\d{1,3}$/.test(within) ? Number(within) : NaN;
    if (!(miles >= 1 && miles <= MAX_MILES)) throw new PlaceFilterError('invalid_within', 'Choose a distance from 1 to 250 miles, or Remote.');
    if (!home) throw new PlaceFilterError('home_location_required', HOME_REQUIRED);
    plan.where = withinSql(miles, home);
    plan.places = true;
  }
  if (query.sort === 'distance') {
    if (!home) throw new PlaceFilterError('home_location_required', HOME_REQUIRED);
    plan.order = distanceOrder(home);
    plan.places = true;
  }
  return plan;
}

module.exports = {PlaceFilterError, SETTINGS_URL, workplaceType, pointOf, milesBetween, decorate, homeView, nearQuery};
