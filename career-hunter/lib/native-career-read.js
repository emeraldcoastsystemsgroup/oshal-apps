/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read retained Career evidence through the original native owner's read-only namespace and existing board ranking.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {findUserStoreLayout} = require('./user-store-path');
const {fetchBoardPage} = require('../routes/career-board-feed');
const AGENT = 'cb000000-0000-0000-0000-000000000001';
const FACTS = Object.freeze(['profile.present', 'profile.roles', 'matches.sample_count', 'signals.total',
  'pipeline.applied', 'pipeline.generated', 'pipeline.promoted', 'source.corpus_modified_ms', 'source.owner_modified_ms']);
const fail = () => Object.assign(new Error('career_saved_source_unavailable'), {code:'career_saved_source_unavailable'});
const clip = (v, n = 240) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : null;
const number = v => v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/** Only existing regular files inside the host-admitted namespace are sources. */
function sourceFile(filename, required = true) {
  if (!fs.existsSync(filename)) { if (required) throw fail(); return null; }
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail();
  return stat;
}

/** No CLI, provenance migration, model, network, or persisted write is involved. */
function readCareerSnapshot(principal) {
  if (!principal?.subject || !principal.issuer || !principal.id || !principal.tenant || principal.state !== 'active'
      || process.env.OSHAL_CAREER_OWNER_MOUNT !== '1' || process.env.JOBHUNTER_STORE_ROOT !== '/career') throw fail();
  const layout = findUserStoreLayout('/career', 'default', principal.subject);
  if (!layout) throw fail();
  const corpus = path.join(layout.tenantDir, 'corpus.db');
  const corpusStat = sourceFile(corpus), ownerStat = sourceFile(layout.userDb);
  const profilePath = path.join(layout.userDir, 'career_db.json'), profileStat = sourceFile(profilePath, false);
  let raw = {};
  if (profileStat) {
    if (profileStat.size > 4 * 1024 * 1024) throw fail();
    raw = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw fail();
  }
  const db = new Database(layout.userDb, {readonly:true, fileMustExist:true});
  try {
    // The retained corpus has views explicitly referring to its existing `corpus` alias.
    db.prepare('ATTACH DATABASE ? AS corpus').run(corpus);
    db.pragma('query_only = true');
    db.pragma('busy_timeout = 1000');
    const board = fetchBoardPage(db, {sort:'ai', per:'10', page:'1'});
    const project = r => ({postingId:Number(r.id), title:clip(r.title), company:clip(r.company),
      fit:number(r.ai_fit_score ?? r.fit_score), status:clip(r.status, 64), salaryMax:number(r.salary_max),
      posted:clip(r.posted_date, 80), firstSeen:clip(r.first_seen_at, 80), appliedAt:clip(r.applied_at, 80)});
    const topMatches = board.jobs.map(project);
    const recentApplied = db.prepare(`SELECT p.id,p.title,c.name AS company,s.fit_score,s.ai_fit_score,
      s.status,p.salary_max,p.posted_date,p.first_seen_at,s.applied_at FROM
      (SELECT * FROM user_signals WHERE status='applied' ORDER BY applied_at DESC LIMIT 8) s
      JOIN corpus.postings_corpus p ON p.id=s.posting_id JOIN corpus.companies c ON c.id=p.company_id
      ORDER BY s.applied_at DESC`).all().map(project);
    const pipeline = {applied:0, generated:0, promoted:0, other:0};
    for (const row of db.prepare("SELECT status,count(*) AS n FROM user_signals WHERE status IS NOT NULL AND status<>'new' GROUP BY status").all()) {
      if (['applied','generated','promoted'].includes(row.status)) pipeline[row.status] = Number(row.n);
      else pipeline.other += Number(row.n);
    }
    const total = Number(db.prepare('SELECT count(*) AS n FROM user_signals').get().n);
    const fresh = Number(db.prepare(`SELECT count(*) AS n FROM user_signals s
      JOIN corpus.postings_corpus p ON p.id=s.posting_id WHERE p.active=1 AND p.target_role=1
      AND coalesce(s.ai_fit_score,s.fit_score,0)>=70 AND p.first_seen_at>=date('now','-3 days')`).get().n);
    const roles = Array.isArray(raw.roles) ? raw.roles.slice(0,12).map(r => ({title:clip(r?.title), org:clip(r?.org), start:clip(r?.start,80), end:clip(r?.end,80)})) : [];
    const groups = raw.skills && typeof raw.skills === 'object' ? Object.values(raw.skills) : [];
    const skills = groups.flatMap(g => Array.isArray(g?.items) ? g.items : []).filter(v => typeof v === 'string').slice(0,60).map(v => clip(v,120));
    // External source replacement is observable; reject a mixed snapshot.
    if (sourceFile(corpus).mtimeMs !== corpusStat.mtimeMs || sourceFile(layout.userDb).mtimeMs !== ownerStat.mtimeMs
        || (profileStat && sourceFile(profilePath).mtimeMs !== profileStat.mtimeMs)) throw fail();
    return {asOf:new Date().toISOString(), source:{kind:'retained_owner_sqlite', corpusModifiedAt:corpusStat.mtime.toISOString(),
      ownerModifiedAt:ownerStat.mtime.toISOString(), profileModifiedAt:profileStat?.mtime.toISOString() ?? null},
      profile:{present:Boolean(profileStat), roles, skills}, freshHighFit:{days:3,minFit:70,count:fresh},
      topMatches, recentApplied, pipeline, signalsTotal:total,
      ranking:{scoredOnly:board.scoredOnly, pooled:board.pooled, poolSize:board.poolSize},
      topGaps:{status:'unavailable',reason:'native_gap_projection_not_registered'}};
  } catch { throw fail(); } finally { db.close(); }
}

/** Activation binds the declared reader/tool; every call obtains current native identity. */
function createNativeCareerReadRoutes(ctx) {
  ctx.tools.register('career_database', async () => {
    const before = await ctx.intent('auth.application', {}), principal = before?.principal;
    const snapshot = readCareerSnapshot(principal);
    const after = await ctx.intent('auth.application', {});
    if (JSON.stringify(after?.principal) !== JSON.stringify(principal)) throw fail();
    return snapshot;
  });
  ctx.specialistContext.register({agentId:AGENT, toolName:'career_database', facts:[...FACTS], read:async actor => {
    const authority = await ctx.intent('auth.application', {}), principal = authority?.principal;
    if (principal?.subject !== actor.sub || principal?.issuer !== actor.issuer || actor.signal.aborted) throw fail();
    const value = readCareerSnapshot(principal);
    return {'profile.present':value.profile.present, 'profile.roles':value.profile.roles.length,
      'matches.sample_count':value.topMatches.length, 'signals.total':value.signalsTotal,
      'pipeline.applied':value.pipeline.applied, 'pipeline.generated':value.pipeline.generated, 'pipeline.promoted':value.pipeline.promoted,
      'source.corpus_modified_ms':Date.parse(value.source.corpusModifiedAt), 'source.owner_modified_ms':Date.parse(value.source.ownerModifiedAt)};
  }});
  return function nativeReadRegistration(_req, _res, next) { next(); };
}
module.exports = {createNativeCareerReadRoutes, readCareerSnapshot, FACTS};
