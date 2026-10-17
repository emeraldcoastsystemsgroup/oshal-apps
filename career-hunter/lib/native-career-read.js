/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read retained Career evidence through the original native owner's read-only namespace and existing board ranking.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A person with no saved Career store yet (no owner directory, no corpus, or no owner database) gets an empty snapshot whose notice says to upload a resume on Career, and facts with profile.present false and zero counts, instead of career_saved_source_unavailable: the concierge's required specialist read refused every question with 503 for anyone who had not ingested a resume. A source that exists but is not a regular file, is unreadable or changes mid-read still refuses. Guard: tests/career-native-read-empty.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A saved store with no profile yet (the database exists, for example created by the first recruiter added) carries the same upload-a-resume notice; live the concierge answered "set up your profile" with nothing naming the resume upload.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The specialist and tool readers open the owner's published generation read-only and immutable. The engine keeps the owner database in WAL mode and the kernel pins that generation on a read-only mount, where SQLite cannot create the -shm it needs and refused with "unable to open database file": the Career concierge answered 503 on every question. A generation is never written in place (a write publishes a new one), so the checkpointed main file is the whole saved state; while a non-empty -wal sits beside it the ordinary read-only open is kept. Every refusal now logs one closed reason (no_identity, identity_changed, source_invalid, profile_invalid, owner_open_failed, query_failed, source_changed_during_read) so the next failure names its step; no path or SQLite text is logged. Guard: tests/career-native-read-wal.test.mjs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The specialist's facts skip the board ranking. Jarvis's job questions refused with "specialist context read timed out": the facts read ran the full AI board ranking (2.1 to 3.0 s on a 2.1M-signal store, warm) inside the kernel's 3 s specialist deadline, only to count up to 10 top matches. readCareerSnapshot(..., {factsOnly:true}) counts the scored active matches (capped at 10) in one query and leaves the board, recent applications and fresh count to the career_database tool. Guard: tests/career-native-read-facts.test.mjs.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const Database = require('better-sqlite3');
const {createChildLogger} = require('@/shared/logger');
const {findUserStoreLayout} = require('./user-store-path');
const {fetchBoardPage, splitBoardFilters} = require('../routes/career-board-feed');
const AGENT = 'cb000000-0000-0000-0000-000000000001';
const FACTS = Object.freeze(['profile.present', 'profile.roles', 'matches.sample_count', 'signals.total',
  'pipeline.applied', 'pipeline.generated', 'pipeline.promoted', 'source.corpus_modified_ms', 'source.owner_modified_ms']);
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

/** Only existing regular files inside the host-admitted namespace are sources. */
function sourceFile(filename, required = true) {
  if (!fs.existsSync(filename)) { if (required) throw fail('source_invalid'); return null; }
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('source_invalid');
  return stat;
}

const NO_RESUME = 'No resume has been ingested yet. Upload one on Career (Resume) and your scored matches, '
  + 'pipeline and fresh roles will appear here.';
const NO_CORPUS = 'The job corpus has not been built on this installation yet, so there are no openings to match.';

/** The honest answer for a person with nothing saved yet: zero counts and what to do next. */
function emptySnapshot(reason, corpusStat) {
  return {asOf:new Date().toISOString(), source:{kind:'none', reason,
    corpusModifiedAt:corpusStat ? corpusStat.mtime.toISOString() : null, ownerModifiedAt:null, profileModifiedAt:null},
    notice:reason === 'no_corpus' ? NO_CORPUS : NO_RESUME,
    profile:{present:false, roles:[], skills:[]}, freshHighFit:{days:3,minFit:70,count:0},
    topMatches:[], recentApplied:[], pipeline:{applied:0, generated:0, promoted:0, other:0}, signalsTotal:0,
    ranking:null, topGaps:{status:'unavailable',reason:'native_gap_projection_not_registered'}};
}

/** The saved profile document, bounded; a malformed one refuses rather than reading as empty. */
function readProfile(profilePath, profileStat) {
  if (!profileStat) return {};
  if (profileStat.size > 4 * 1024 * 1024) throw fail('profile_invalid');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch { throw fail('profile_invalid'); }
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw fail('profile_invalid');
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

/** Board ranking, recent applications, pipeline and counts, read from one open owner connection; with
 * `factsOnly`, only the counts and the capped number of scored active matches. */
function readOwnerRows(db, corpus, factsOnly = false) {
  // The retained corpus has views explicitly referring to its existing `corpus` alias.
  db.prepare('ATTACH DATABASE ? AS corpus').run(corpus);
  db.pragma('query_only = true');
  db.pragma('busy_timeout = 1000');
  if (factsOnly) {
    // The board's own default filters, so the count is the size of its first page.
    const parts = splitBoardFilters({});
    const sampled = db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM user_signals s
      JOIN corpus.postings_corpus p ON p.id=s.posting_id JOIN corpus.companies c ON c.id=p.company_id
      WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere} AND ${parts.corpWhere} LIMIT ${MATCH_SAMPLE})`)
      .get(...parts.scoredArgs, ...parts.corpArgs);
    return {...ownerCounts(db), sampleCount:Number(sampled.n)};
  }
  const board = fetchBoardPage(db, {sort:'ai', per:'10', page:'1'});
  const project = r => ({postingId:Number(r.id), title:clip(r.title), company:clip(r.company),
    fit:number(r.ai_fit_score ?? r.fit_score), status:clip(r.status, 64), salaryMax:number(r.salary_max),
    posted:clip(r.posted_date, 80), firstSeen:clip(r.first_seen_at, 80), appliedAt:clip(r.applied_at, 80)});
  const recentApplied = db.prepare(`SELECT p.id,p.title,c.name AS company,s.fit_score,s.ai_fit_score,
    s.status,p.salary_max,p.posted_date,p.first_seen_at,s.applied_at FROM
    (SELECT * FROM user_signals WHERE status='applied' ORDER BY applied_at DESC LIMIT 8) s
    JOIN corpus.postings_corpus p ON p.id=s.posting_id JOIN corpus.companies c ON c.id=p.company_id
    ORDER BY s.applied_at DESC`).all().map(project);
  const {pipeline, total} = ownerCounts(db);
  const fresh = Number(db.prepare(`SELECT count(*) AS n FROM user_signals s
    JOIN corpus.postings_corpus p ON p.id=s.posting_id WHERE p.active=1 AND p.target_role=1
    AND coalesce(s.ai_fit_score,s.fit_score,0)>=70 AND p.first_seen_at>=date('now','-3 days')`).get().n);
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
function readCareerSnapshot(principal, root = '/career', {factsOnly = false} = {}) {
  if (!principal?.subject || !principal.issuer || !principal.id || !principal.tenant || principal.state !== 'active'
      || process.env.OSHAL_CAREER_OWNER_MOUNT !== '1' || process.env.JOBHUNTER_STORE_ROOT !== root) throw fail('no_identity');
  const layout = findUserStoreLayout(root, 'default', principal.subject);
  // Absence is an answer (nothing saved yet); a source that exists but is unusable still refuses.
  const corpus = path.join(layout ? layout.tenantDir : path.join(root, 'default'), 'corpus.db');
  const corpusPresent = sourceFile(corpus, false);
  if (!corpusPresent) return emptySnapshot('no_corpus', null);
  if (!layout) return emptySnapshot('no_owner_store', corpusPresent);
  if (!sourceFile(layout.userDb, false)) return emptySnapshot('no_owner_database', corpusPresent);
  const corpusStat = sourceFile(corpus), ownerStat = sourceFile(layout.userDb);
  const profilePath = path.join(layout.userDir, 'career_db.json'), profileStat = sourceFile(profilePath, false);
  const raw = readProfile(profilePath, profileStat);
  const db = openOwner(layout.userDb);
  let rows;
  try { rows = readOwnerRows(db, corpus, factsOnly); }
  catch (err) { throw Object.assign(fail('query_failed'), {errcode:err?.errcode}); }
  finally { db.close(); }
  // External source replacement is observable; reject a mixed snapshot.
  if (sourceFile(corpus).mtimeMs !== corpusStat.mtimeMs || sourceFile(layout.userDb).mtimeMs !== ownerStat.mtimeMs
      || (profileStat && sourceFile(profilePath).mtimeMs !== profileStat.mtimeMs)) throw fail('source_changed_during_read');
  const {roles, skills} = profileView(raw);
  if (factsOnly) return {source:{corpusModifiedAt:corpusStat.mtime.toISOString(), ownerModifiedAt:ownerStat.mtime.toISOString()},
    profile:{present:Boolean(profileStat), roles, skills}, matchesSampleCount:rows.sampleCount, signalsTotal:rows.total, pipeline:rows.pipeline};
  const {board} = rows;
  return {asOf:new Date().toISOString(), source:{kind:'retained_owner_sqlite', corpusModifiedAt:corpusStat.mtime.toISOString(),
    ownerModifiedAt:ownerStat.mtime.toISOString(), profileModifiedAt:profileStat?.mtime.toISOString() ?? null},
    profile:{present:Boolean(profileStat), roles, skills}, freshHighFit:{days:3,minFit:70,count:rows.fresh},
    topMatches:rows.topMatches, recentApplied:rows.recentApplied, pipeline:rows.pipeline, signalsTotal:rows.total,
    ranking:{scoredOnly:board.scoredOnly, pooled:board.pooled, poolSize:board.poolSize},
    topGaps:{status:'unavailable',reason:'native_gap_projection_not_registered'},
    ...(profileStat ? {} : {notice:NO_RESUME})};
}

/** The specialist's closed scalar facts from one snapshot. */
function snapshotFacts(value) {
  return {'profile.present':value.profile.present, 'profile.roles':value.profile.roles.length,
    'matches.sample_count':value.matchesSampleCount ?? value.topMatches.length, 'signals.total':value.signalsTotal,
    'pipeline.applied':value.pipeline.applied, 'pipeline.generated':value.pipeline.generated, 'pipeline.promoted':value.pipeline.promoted,
    'source.corpus_modified_ms':msOrNull(value.source.corpusModifiedAt), 'source.owner_modified_ms':msOrNull(value.source.ownerModifiedAt)};
}

/** Activation binds the declared reader/tool; every call obtains current native identity. `root` is the
 * host's Career mount (a test passes its own disposable one). */
function createNativeCareerReadRoutes(ctx, root = '/career') {
  ctx.tools.register('career_database', async () => {
    try {
      const before = await ctx.intent('auth.application', {}), principal = before?.principal;
      const snapshot = readCareerSnapshot(principal, root);
      const after = await ctx.intent('auth.application', {});
      if (JSON.stringify(after?.principal) !== JSON.stringify(principal)) throw fail('identity_changed');
      return snapshot;
    } catch (err) { throw refused(err); }
  });
  ctx.specialistContext.register({agentId:AGENT, toolName:'career_database', facts:[...FACTS], read:async actor => {
    try {
      const authority = await ctx.intent('auth.application', {}), principal = authority?.principal;
      if (principal?.subject !== actor.sub || principal?.issuer !== actor.issuer || actor.signal.aborted) throw fail('identity_changed');
      return snapshotFacts(readCareerSnapshot(principal, root, {factsOnly:true}));
    } catch (err) { throw refused(err); }
  }});
  return function nativeReadRegistration(_req, _res, next) { next(); };
}
module.exports = {createNativeCareerReadRoutes, readCareerSnapshot, FACTS, NO_RESUME};
