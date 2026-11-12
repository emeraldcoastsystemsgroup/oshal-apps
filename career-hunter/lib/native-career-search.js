/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Search the shared openings through the original owner's read-only namespace, with explicit city/ZIP or saved-home radius and real pagination.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The refusal with no saved place names where to save it as the page does: Settings, What I'm looking for, Matching area (was Career Settings). Words only.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const Database = require('better-sqlite3');
const {findUserStoreLayout} = require('./user-store-path');
const {fetchBrowsePage} = require('../routes/career-browse-feed');
const {resolveCareerLocation, CareerLocationError} = require('../routes/career-geo');
const {readJobSearchScope} = require('../routes/career-search-scope');
const KEYS = new Set(['q','title','company','description','state','near','useHome','radiusMiles','remote','days','sort','per','page']);

/** Validate independent of model/tool-schema validation; unknown owner/path inputs never confer access. */
function searchQuery(input, layout) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !KEYS.has(k))) {
    throw new CareerLocationError('Use the declared job-search fields.');
  }
  const query = {};
  for (const k of ['q','title','company','description','state','near']) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== 'string' || input[k].length > 240 || /[\u0000-\u001f\u007f]/.test(input[k])) throw new CareerLocationError('Enter a valid '+k+'.');
    if (input[k].trim()) query[k] = input[k].trim();
  }
  for (const [k,lo,hi] of [['per',1,200],['page',1,2001],['days',1,365],['radiusMiles',1,250]]) {
    if (input[k] !== undefined && (!Number.isFinite(input[k]) || input[k]<lo || input[k]>hi || (k!=='radiusMiles'&&!Number.isInteger(input[k])))) {
      throw new CareerLocationError('Choose '+k+' between '+lo+' and '+hi+'.');
    }
  }
  if (input.useHome !== undefined && typeof input.useHome !== 'boolean') throw new CareerLocationError('useHome must be true or false.');
  if (input.remote !== undefined && !['any','remote','on-site'].includes(input.remote)) throw new CareerLocationError('Choose any, remote or on-site jobs.');
  if (input.sort !== undefined && !['recent','posted','salary','title'].includes(input.sort)) throw new CareerLocationError('Choose a supported sort order.');
  const home = input.useHome === true || /^(home|my home)$/i.test(query.near || '');
  let homeLabel = null;
  if (home) {
    if (query.near && !/^(home|my home)$/i.test(query.near)) throw new CareerLocationError('Choose home or an explicit city/ZIP.');
    const scope = layout && readJobSearchScope(layout.userDir);
    if (!scope) throw new CareerLocationError('Save your home city or ZIP in Settings → What I\'m looking for → Matching area, or provide a city/ZIP for this search.');
    delete query.near;
    query.lat = String(scope.lat); query.lon = String(scope.lon);
    query.radius_miles = String(input.radiusMiles ?? scope.radiusMiles);
    homeLabel = scope.near;
  } else if (input.radiusMiles !== undefined) query.radius_miles = String(input.radiusMiles);
  if (input.remote && input.remote !== 'any') query.remote = input.remote === 'remote' ? '1' : '0';
  if (input.days !== undefined) query.days = String(input.days);
  query.sort = input.sort || 'recent'; query.per = String(input.per ?? 25); query.page = String(input.page ?? 1);
  // A radius without a known center is a refusal, never a nationwide fallback.
  resolveCareerLocation(query);
  return {query, homeLabel};
}

/** No resume, model call, network geocoder, indexing or saved-preference mutation is required. */
function searchCareerOpenings(principal, input, root = '/career') {
  if (!principal?.subject || !principal.issuer || !principal.id || !principal.tenant || principal.state !== 'active'
      || process.env.OSHAL_CAREER_OWNER_MOUNT !== '1' || process.env.JOBHUNTER_STORE_ROOT !== root) {
    throw new Error('career_search_identity_unavailable');
  }
  const layout = findUserStoreLayout(root, 'default', principal.subject);
  const {query, homeLabel} = searchQuery(input, layout);
  const corpus = path.join(root, 'default', 'corpus.db');
  const stat = fs.lstatSync(corpus);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('career_search_source_unavailable');
  const db = new Database(':memory:');
  let result;
  try {
    const uri = pathToFileURL(corpus).href+'?mode=ro&immutable=1';
    db.prepare('ATTACH DATABASE ? AS corpus').run(uri);
    db.pragma('query_only = true');
    db.pragma('busy_timeout = 1000');
    result = fetchBrowsePage(db, query, layout?require('./career-job-feedback').read(layout.userDir):[]);
  } finally { db.close(); }
  const after = fs.lstatSync(corpus);
  if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size || after.ino !== stat.ino) throw new Error('career_search_source_changed');
  const location = result.location && {...result.location, label:homeLabel || result.location.label};
  const linkQuery = {...query, view:'list'};
  // Keep saved-home coordinates private; share the selected city and radius in the UI link.
  if (homeLabel) { delete linkQuery.lat; delete linkQuery.lon; linkQuery.near = homeLabel.replace(/^ZIP (\d{5})$/, '$1'); }
  return {...result, location, asOf:new Date().toISOString(), sourcePublishedAt:stat.mtime.toISOString(),
    locationSource:homeLabel ? 'saved_matching_area' : location ? 'explicit_location' : 'nationwide',
    note:location ? 'Distances are straight-line city/ZIP approximations, not driving miles. Jobs without coordinates are excluded from a radius search.' : 'Public employer openings; these results are not resume fit scores.',
    ...(homeLabel ? {homeReference:'Home uses your saved Career matching area: '+homeLabel+'. This search does not change that preference.'} : {}),
    searchUrl:'/api/career-hunter/search-ui?'+new URLSearchParams(linkQuery).toString()};
}

module.exports = {searchCareerOpenings, searchQuery};
