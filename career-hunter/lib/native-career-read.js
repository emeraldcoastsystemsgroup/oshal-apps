/** CHANGE LOG
 * 14 | maintainer@emeraldcoastsystemsgroup.com | Preserve saved résumé presence without a corpus and share the bounded owner-profile reader with the concierge status tool.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | 1.57.2, T72: the facts' sample count starts from the person's own scored signals (CROSS JOIN, idx_user_scored) instead of walking every active posting of the 7.4 GB shared corpus. Measured on the test slot's corpus: 1,374 ms warm for a person with 7 signals and none scored, now under 1 ms; 179 ms for 5,000 signals with 2,000 scored, now 12 ms; 4 ms for 300,000 with 60,000 scored, now 18 ms. Cold, the old walk passed the kernel's 30 s deadline, so the first concierge question after each Career reload refused.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | 1.57.1, T9: the facts carry jobs.saved, the jobs the person saved (Home's Saved card, the board state's favourites). Asked on production "How many jobs have I saved", the concierge said none while Home showed 1 saved: no fact held that count. A saved-job file that cannot be read gives null (unknown), never 0, and never refuses the other facts.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0, T9: the same facts reader is registered for the front-desk concierge (career-concierge), the bot that now answers in the app, as well as for career-hunter.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Keep the legacy profile revision timestamp unknown: copied generation file mtimes do not prove a résumé content revision.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Use the saved matching area and remote preference for Jarvis's board/facts, carry assessment provenance and count only AI-scored fresh high-fit matches.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read retained Career evidence through the original native owner's read-only namespace and existing board ranking.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A person with no saved Career store yet (no owner directory, no corpus, or no owner database) gets an empty snapshot whose notice says to upload a resume on Career, and facts with profile.present false and zero counts, instead of career_saved_source_unavailable: the concierge's required specialist read refused every question with 503 for anyone who had not ingested a resume. A source that exists but is not a regular file, is unreadable or changes mid-read still refuses. Guard: tests/career-native-read-empty.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A saved store with no profile yet (the database exists, for example created by the first recruiter added) carries the same upload-a-resume notice; live the concierge answered "set up your profile" with nothing naming the resume upload.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The specialist and tool readers open the owner's published generation read-only and immutable. The engine keeps the owner database in WAL mode and the kernel pins that generation on a read-only mount, where SQLite cannot create the -shm it needs and refused with "unable to open database file": the Career concierge answered 503 on every question. A generation is never written in place (a write publishes a new one), so the checkpointed main file is the whole saved state; while a non-empty -wal sits beside it the ordinary read-only open is kept. Every refusal now logs one closed reason (no_identity, identity_changed, source_invalid, profile_invalid, owner_open_failed, query_failed, source_changed_during_read) so the next failure names its step; no path or SQLite text is logged. Guard: tests/career-native-read-wal.test.mjs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The existing read-only Career tool accepts structured opportunity search filters; an empty input retains the saved snapshot contract.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The specialist's facts skip the board ranking. Jarvis's job questions refused with "specialist context read timed out": the facts read ran the full AI board ranking (2.1 to 3.0 s on a 2.1M-signal store, warm) inside the kernel's 3 s specialist deadline, only to count up to 10 top matches. readCareerSnapshot(..., {factsOnly:true}) counts the scored active matches (capped at 10) in one query and leaves the board, recent applications and fresh count to the career_database tool. Guard: tests/career-native-read-facts.test.mjs.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | A saved resume with no owner database yet reads as a saved resume, not "no resume": a person who had uploaded one and not yet matched was told to upload it.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The line for a saved résumé with no matches yet says My jobs (was the Job Board). Words only.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const Database = require('better-sqlite3');
const {createChildLogger} = require('@/shared/logger');
const {findUserStoreLayout} = require('./user-store-path');
const {fetchBoardPage, splitBoardFilters} = require('../routes/career-board-feed');
const {readJobSearchScope, SEARCH_SCOPE_FILE} = require('../routes/career-search-scope');
const {readResumeSource} = require('./career-resume-source');
const {readRemoteOnly} = require('../routes/career-match-prefs');
const {assessment} = require('./career-fit');
const {readBoardState, favoriteIds} = require('./career-board-state');
const AGENT = 'cb000000-0000-0000-0000-000000000001';
/** Career's front-desk concierge (1.57.0, T9): the bot that answers in the app reads the same facts as the worker. */
const CONCIERGE = 'cb000000-0000-0000-0000-000000000005';
const FACTS = Object.freeze(['profile.present', 'profile.roles', 'matches.sample_count', 'signals.total',
  'pipeline.applied', 'pipeline.generated', 'pipeline.promoted', 'jobs.saved', 'source.corpus_modified_ms', 'source.owner_modified_ms']);
const logger = createChildLogger({module:'native-career-read'});
const REASONS = new Set(['no_identity', 'identity_changed', 'source_invalid', 'profile_invalid', 'owner_open_failed',
  'query_failed', 'source_changed_during_read']);
/** Every refusal carries one closed reason; the caller still sees only the one refusal code. */
const fail = reason => Object.assign(new Error('career_saved_source_unavailable'),
  {code:'career_saved_source_unavailable', reason:REASONS.has(reason) ? reason : 'query_failed'});
/** Log the closed reason (and SQLite's numeric code, never its text or a path), then refuse. */
function refused(err) {
  logger.error({reason:err?.reason ?? 'unexpected', sqlite:Number.isInteger(err?.errcode) ? err.errcode : null},
    'Career saved-source read refused');
  return err?.code === 'career_saved_source_unavailable' ? err : fail('query_failed');
}
const clip = (v, n = 240) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : null;
const number = v => v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const msOrNull = iso => (iso ? Date.parse(iso) : null);

function requireOwner(principal, root) {
  if (!principal?.subject || !principal.issuer || !principal.id || !principal.tenant || principal.state !== 'active'
      || process.env.OSHAL_CAREER_OWNER_MOUNT !== '1' || process.env.JOBHUNTER_STORE_ROOT !== root) throw fail('no_identity');
}

/** Only existing regular files inside the host-admitted namespace are sources. */
function sourceFile(filename, required = true) {
  if (!fs.existsSync(filename)) { if (required) throw fail('source_invalid'); return null; }
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('source_invalid');
  return stat;
}

const NO_RESUME = 'No resume has been ingested yet. Upload one on Career (Resume) and your scored matches, '
  + 'pipeline and fresh roles will appear here.';
const NOT_MATCHED = 'The résumé is saved. Scored matches appear after Find & score jobs in My jobs.';
const NO_CORPUS = 'The job corpus has not been built on this installation yet, so there are no openings to match.';

/** The jobs the person saved (Home's Saved card): the board state's favourites, or null when that file cannot be read. */
function savedJobs(userDir) {
  if (!userDir) return 0;
  try { return favoriteIds(readBoardState(userDir)).length; }
  catch (err) { logger.error({err}, 'Career saved jobs unreadable'); return null; }
}

/** The honest answer for a person with nothing saved yet: zero counts and what to do next. */
function emptySnapshot(reason, corpusStat) {
  return {asOf:new Date().toISOString(), source:{kind:'none', reason,
    corpusModifiedAt:corpusStat ? corpusStat.mtime.toISOString() : null, ownerModifiedAt:null, profileModifiedAt:null},
    notice:reason === 'no_corpus' ? NO_CORPUS : NO_RESUME,
    profile:{present:false, roles:[], skills:[]}, freshHighFit:{days:3,minFit:70,count:0,kind:'ai',basis:'first-seen'},
    topMatches:[], recentApplied:[], pipeline:{applied:0, generated:0, promoted:0, other:0}, signalsTotal:0, savedCount:0,
    ranking:null, topGaps:{status:'unavailable',reason:'native_gap_projection_not_registered'}};
}

/** The saved profile document, bounded; a malformed one refuses rather than reading as empty. */
function readProfile(profilePath, profileStat) {
  if (!profileStat) return {};
  if (profileStat.size > 4 * 1024 * 1024) throw fail('profile_invalid');
  let raw;
  try { raw = readResumeSource(path.dirname(profilePath)).raw; } catch { throw fail('profile_invalid'); }
  return raw;
}

/**
 * The kernel pins the owner's published generation on a read-only mount, and the engine keeps the
 * owner database in WAL mode: an ordinary read-only open must create `-shm` beside it, which that
 * mount forbids (SQLITE_CANTOPEN). A published generation is never written in place, so with no
 * pending `-wal` its main file is the whole saved state and opens immutable (no locks, no -shm).
 */
function openOwner(userDb) {
  const wal = `${userDb}-wal`;
  const pending = fs.existsSync(wal) && fs.lstatSync(wal).size > 0;
  try {
    return new Database(pending ? userDb : `${pathToFileURL(userDb).href}?immutable=1`, {readonly:true});
  } catch (err) {
    throw Object.assign(fail('owner_open_failed'), {errcode:err?.errcode});
  }
}

/** How many top matches the facts sample: the board's first page. */
const MATCH_SAMPLE = 10;

/** The pipeline by status and the signal total. */
function ownerCounts(db) {
  const pipeline = {applied:0, generated:0, promoted:0, other:0};
  for (const row of db.prepare("SELECT status,count(*) AS n FROM user_signals WHERE status IS NOT NULL AND status<>'new' GROUP BY status").all()) {
    if (['applied','generated','promoted'].includes(row.status)) pipeline[row.status] = Number(row.n);
    else pipeline.other += Number(row.n);
  }
  return {pipeline, total:Number(db.prepare('SELECT count(*) AS n FROM user_signals').get().n)};
}

/** The facts' sample count: at most MATCH_SAMPLE of the person's AI-scored signals that pass the board's default filters.
 * CROSS JOIN keeps SQLite on the person's own scored signals first (idx_user_scored) and looks each posting up by id. Left
 * to choose, it walked every active posting of the shared corpus through its geo index, running the workplace text test on
 * each: 1.4 s warm and past the kernel's 30 s deadline cold (7.4 GB corpus) for a person with few or no scored jobs, which
 * is why the first concierge question after a Career reload refused "specialist context read timed out" (T72).
 * @param {{scoredWhere:string, corpWhere:string}} parts Board filters. @returns {string} The SQL. */
function sampledMatchesSql(parts) {
  return `SELECT count(*) AS n FROM (SELECT 1 FROM user_signals s
      CROSS JOIN corpus.postings_corpus p ON p.id=s.posting_id CROSS JOIN corpus.companies c ON c.id=p.company_id
      WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere} AND ${parts.corpWhere} LIMIT ${MATCH_SAMPLE})`;
}

/** Board ranking, recent applications, pipeline and counts, read from one open owner connection; with
 * `factsOnly`, only the counts and the capped number of scored active matches. */
function readOwnerRows(db, corpus, factsOnly = false, scope = null, remoteOnly = false, exclusions = []) {
  // The retained corpus has views explicitly referring to its existing `corpus` alias.
  db.prepare('ATTACH DATABASE ? AS corpus').run(corpus);
  db.pragma('query_only = true');
  db.pragma('busy_timeout = 1000');
  const query = {lane:'all', ...(remoteOnly ? {remote:'1'} : {})};
  const parts = splitBoardFilters(query, scope, exclusions);
  if (factsOnly) {
    // The board's own default filters, so the count is the size of its first page.
    const sampled = db.prepare(sampledMatchesSql(parts)).get(...parts.scoredArgs, ...parts.corpArgs);
    return {...ownerCounts(db), sampleCount:Number(sampled.n)};
  }
  const board = fetchBoardPage(db, {...query, sort:'ai', per:'10', page:'1'}, scope, undefined, exclusions);
  const project = r => ({postingId:Number(r.id), title:clip(r.title), company:clip(r.company),
    fit:number(r.ai_fit_score ?? r.fit_score), status:clip(r.status, 64), salaryMax:number(r.salary_max),
    posted:clip(r.posted_date, 80), firstSeen:clip(r.first_seen_at, 80), appliedAt:clip(r.applied_at, 80),
    fitAssessment:assessment(r)});
  const recentApplied = db.prepare(`SELECT p.id,p.title,c.name AS company,s.fit_score,s.ai_fit_score,
    s.ai_scored_at,s.ai_model,s.ai_input_fingerprint,s.status,p.salary_max,p.posted_date,p.first_seen_at,s.applied_at FROM
    (SELECT * FROM user_signals WHERE status='applied' ORDER BY applied_at DESC LIMIT 8) s
    JOIN corpus.postings_corpus p ON p.id=s.posting_id JOIN corpus.companies c ON c.id=p.company_id
    ORDER BY s.applied_at DESC`).all().map(project);
  const {pipeline, total} = ownerCounts(db);
  const fresh = Number(db.prepare(`WITH fresh AS MATERIALIZED (
      SELECT id FROM corpus.postings_corpus INDEXED BY idx_corpus_seen WHERE first_seen_at>=datetime('now','-3 days'))
    SELECT count(*) AS n FROM fresh f
    CROSS JOIN corpus.postings_corpus p ON p.id=f.id
    CROSS JOIN user_signals s ON s.posting_id=p.id
    CROSS JOIN corpus.companies c ON c.id=p.company_id
    WHERE s.ai_fit_score>=70 AND ${parts.scoredWhere} AND ${parts.corpWhere}`)
    .get(...parts.scoredArgs,...parts.corpArgs).n);
  return {board, topMatches:board.jobs.map(project), recentApplied, pipeline, total, fresh};
}

/** Roles and skills as bounded display strings from the saved profile document. */
function profileView(raw) {
  const roles = Array.isArray(raw.roles) ? raw.roles.slice(0,12).map(r => ({title:clip(r?.title), org:clip(r?.org), start:clip(r?.start,80), end:clip(r?.end,80)})) : [];
  const groups = raw.skills && typeof raw.skills === 'object' ? Object.values(raw.skills) : [];
  const skills = groups.flatMap(g => Array.isArray(g?.items) ? g.items : []).filter(v => typeof v === 'string').slice(0,60).map(v => clip(v,120));
  return {roles, skills};
}

/**
 * No CLI, provenance migration, model, network, or persisted write is involved. `root` is the host's
 * Career mount and must be the configured store root (a test passes its own disposable mount).
 */
/** A saved resume with nothing matched yet: the database comes with the first match, the profile came first. */
function savedProfileOnly(layout, corpusStat) {
  const empty = emptySnapshot('no_owner_database', corpusStat);
  const profilePath = path.join(layout.userDir, 'career_db.json'), profileStat = sourceFile(profilePath, false);
  empty.savedCount = savedJobs(layout.userDir);
  if (!profileStat) return empty;
  const {roles, skills} = profileView(readProfile(profilePath, profileStat));
  // profileModifiedAt stays null, as on the full snapshot: a file clock is not a content revision.
  return {...empty, notice:NOT_MATCHED, profile:{present:true, roles, skills}};
}

function readCareerSnapshot(principal, root = '/career', {factsOnly = false, remoteOnly = false} = {}) {
  requireOwner(principal, root);
  const layout = findUserStoreLayout(root, 'default', principal.subject);
  // Absence is an answer (nothing saved yet); a source that exists but is unusable still refuses.
  const corpus = path.join(layout ? layout.tenantDir : path.join(root, 'default'), 'corpus.db');
  const corpusPresent = sourceFile(corpus, false);
  if (!corpusPresent) {
    const saved = layout ? savedProfileOnly(layout, null) : emptySnapshot('no_corpus', null);
    return {...saved, source:{...saved.source, reason:'no_corpus'}, notice:NO_CORPUS};
  }
  if (!layout) return emptySnapshot('no_owner_store', corpusPresent);
  if (!sourceFile(layout.userDb, false)) return savedProfileOnly(layout, corpusPresent);
  const corpusStat = sourceFile(corpus), ownerStat = sourceFile(layout.userDb);
  const profilePath = path.join(layout.userDir, 'career_db.json'), profileStat = sourceFile(profilePath, false);
  const raw = readProfile(profilePath, profileStat);
  if (typeof remoteOnly !== 'boolean') throw fail('query_failed');
  const scopePath=path.join(layout.userDir,SEARCH_SCOPE_FILE),scopeStat=sourceFile(scopePath,false);
  let scope;
  try { scope=readJobSearchScope(layout.userDir); } catch { throw fail('source_invalid'); }
  const db = openOwner(layout.userDb);
  let rows;
  try { rows = readOwnerRows(db, corpus, factsOnly, scope, remoteOnly, require('./career-job-feedback').read(layout.userDir)); }
  catch (err) { throw Object.assign(fail('query_failed'), {errcode:err?.errcode}); }
  finally { db.close(); }
  // External source replacement is observable; reject a mixed snapshot.
  if (sourceFile(corpus).mtimeMs !== corpusStat.mtimeMs || sourceFile(layout.userDb).mtimeMs !== ownerStat.mtimeMs
      || (profileStat && sourceFile(profilePath).mtimeMs !== profileStat.mtimeMs)
      || (sourceFile(scopePath,false)?.mtimeMs ?? null) !== (scopeStat?.mtimeMs ?? null)) throw fail('source_changed_during_read');
  const {roles, skills} = profileView(raw);
  if (factsOnly) return {source:{corpusModifiedAt:corpusStat.mtime.toISOString(), ownerModifiedAt:ownerStat.mtime.toISOString()},
    profile:{present:Boolean(profileStat), roles, skills}, matchesSampleCount:rows.sampleCount, signalsTotal:rows.total, pipeline:rows.pipeline,
    savedCount:savedJobs(layout.userDir)};
  const {board} = rows;
  return {asOf:new Date().toISOString(), source:{kind:'retained_owner_sqlite', corpusModifiedAt:corpusStat.mtime.toISOString(),
    ownerModifiedAt:ownerStat.mtime.toISOString(),
    // Published/exported file mtimes can change without any résumé content change.
    // Keep this legacy revision field unknown rather than exposing a false edit date.
    profileModifiedAt:null},
    profile:{present:Boolean(profileStat), roles, skills}, freshHighFit:{days:3,minFit:70,count:rows.fresh,kind:'ai',basis:'first-seen'},
    topMatches:rows.topMatches, recentApplied:rows.recentApplied, pipeline:rows.pipeline, signalsTotal:rows.total, savedCount:savedJobs(layout.userDir),
    ranking:{scoredOnly:board.scoredOnly, pooled:board.pooled, poolSize:board.poolSize, remoteOnly,
      scope:scope?{near:scope.near,radiusMiles:scope.radiusMiles,includeRemote:scope.includeRemote}:null,
      assessmentsRevalidated:false},
    topGaps:{status:'unavailable',reason:'native_gap_projection_not_registered'},
    ...(profileStat ? {} : {notice:NO_RESUME})};
}

/** The specialist's closed scalar facts from one snapshot. */
function snapshotFacts(value) {
  return {'profile.present':value.profile.present, 'profile.roles':value.profile.roles.length,
    'matches.sample_count':value.matchesSampleCount ?? value.topMatches.length, 'signals.total':value.signalsTotal,
    'pipeline.applied':value.pipeline.applied, 'pipeline.generated':value.pipeline.generated, 'pipeline.promoted':value.pipeline.promoted,
    'jobs.saved':value.savedCount ?? null,
    'source.corpus_modified_ms':msOrNull(value.source.corpusModifiedAt), 'source.owner_modified_ms':msOrNull(value.source.ownerModifiedAt)};
}

/** Activation binds the declared reader/tool; every call obtains current native identity. `root` is the
 * host's Career mount (a test passes its own disposable one). */
function createNativeCareerReadRoutes(ctx, root = '/career') {
  ctx.tools.register('career_database', async (input = {}) => {
    try {
      const before = await ctx.intent('auth.application', {}), principal = before?.principal;
      requireOwner(principal, root);
      const snapshot = Object.keys(input).length
        ? require('./native-career-search').searchCareerOpenings(principal, input, root)
        : readCareerSnapshot(principal, root, {remoteOnly:await readRemoteOnly(ctx.pool,principal.subject,{strict:true})});
      const after = await ctx.intent('auth.application', {});
      if (JSON.stringify(after?.principal) !== JSON.stringify(principal)) throw fail('identity_changed');
      return snapshot;
    } catch (err) {
      if (Object.keys(input).length && err?.code === 'invalid_location') throw err;
      throw refused(err);
    }
  });
  const readFacts = async actor => {
    try {
      const authority = await ctx.intent('auth.application', {}), principal = authority?.principal;
      if (principal?.subject !== actor.sub || principal?.issuer !== actor.issuer || actor.signal.aborted) throw fail('identity_changed');
      requireOwner(principal, root);
      return snapshotFacts(readCareerSnapshot(principal, root, {factsOnly:true,
        remoteOnly:await readRemoteOnly(ctx.pool,principal.subject,{strict:true})}));
    } catch (err) { throw refused(err); }
  };
  for (const agentId of [AGENT, CONCIERGE]) ctx.specialistContext.register({agentId, toolName:'career_database', facts:[...FACTS], read:readFacts});
  return function nativeReadRegistration(_req, _res, next) { next(); };
}
module.exports = {createNativeCareerReadRoutes, readCareerSnapshot, sampledMatchesSql, FACTS, NO_RESUME};
