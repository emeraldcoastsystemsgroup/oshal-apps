#!/usr/bin/env node
/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                          | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-16 16:40:00 | roger.murphy@agenticfederal.us | Career-Hunter provider CLI: per-user wrapper around the vendored jobhunter engine. Resolves the shared jobs corpus + a per-user/tenant DB from OSHAL_USER_SUB, stages anthropic + firecrawl creds (token-broker first, encrypted oshal_connections fallback), and shells `python -m jobhunter <verb>` in MULTIUSER mode. Mirrors scripts/oshal-gmail.js.
 * 2026-07-15 17:28:14 | roger.murphy@emeraldcoastsystemsgroup.com | New score-titles verb: bounded per-user title pass via score.score_batch(title_any=CH_TITLES, limit=CH_LIMIT) — the productized version of the one-off manual title_any run; refuses an empty term list so it can never degrade into an unbounded full score.
 * 2026-07-17 02:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | New refresh / refresh-status verbs (the career_refresh bot tool): POST/GET the controller's admin /run/refresh route via the in-container service secret + the acting user's sub — the route re-checks career-admin, so the tool lets the OPERATOR kick the full nightly scrape+index from cockpit chat while any other user gets 403. No engine spawn.
 * 2026-07-20 18:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | ENGINE-CARVE: relocated from core scripts/oshal-jobhunter.js into this app package (career-hunter is an application, not core — ADR-093 interim retired). ENGINE_DIR/STORE_ROOT fallback now resolve relative to this package's own engine/ (the jobhunter engine moved here too); manifest cliCommands invoke this via {packageDir}/bin/. No verb/logic change — only the engine + store path anchors moved.
 *
 * Verbs (each forwards extra args to the engine):
 *   pull      -> scrape --all  then  match.rescore_recent  (nightly corpus refresh + keyword index)
 *   score     -> score [--days N --min-keyword N --limit N]   (per-user AI fit)
 *   draft     -> apply --job <id> [--oshal]                   (tailored resume+cover PDFs)
 *   discover  -> discover --all-missing | --company NAME
 *   enrich    -> enrich --missing
 *   board     -> dashboard --no-browser --host 127.0.0.1 --port <port>
 *
 * Per-user data lives under {STORE}/{tenant}/{user_sub}/ ; the jobs corpus is shared at
 * {STORE}/{tenant}/corpus.db. Exit 2 = no user identity (set OSHAL_USER_SUB).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Engine lives beside this wrapper in the package (../engine). The real per-user store is
// always JOBHUNTER_STORE_ROOT (the api-output volume); the package-relative path is only a
// local-dev fallback and never holds shipped data.
const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');
const STORE_ROOT = process.env.JOBHUNTER_STORE_ROOT
  || path.resolve(__dirname, '..', 'engine', 'data');
const PYTHON = process.env.JOBHUNTER_PYTHON || 'python3';

/** OSHAL_USER_SUB env, or the cwd-relative file the codex wrapper drops (sandbox may not forward env). */
function resolveUserSub() {
  if (process.env.OSHAL_USER_SUB) return process.env.OSHAL_USER_SUB.trim();
  try { return fs.readFileSync(path.join(process.cwd(), '.oshal-user-sub'), 'utf8').trim() || undefined; }
  catch { return undefined; }
}

function sessionKey() {
  return crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'oshal-dev-secret').digest();
}
function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

/** A secret for `provider`, preferring a controller-staged token (file/env) over a DB decrypt,
 *  so the bot never needs SESSION_SECRET when the controller already brokered the token. */
async function resolveSecret(provider, userSub) {
  const fileName = `.oshal-cred-${provider}`;
  try { const t = fs.readFileSync(path.join(process.cwd(), fileName), 'utf8').trim(); if (t) return t; } catch { /* */ }
  const envName = `OSHAL_CRED_${provider.toUpperCase()}`;
  if (process.env[envName]) return process.env[envName];
  if (!userSub) return undefined;
  try {
    const { Pool } = require('pg');
    const pool = new Pool();
    const row = (await pool.query(
      `SELECT access_token FROM oshal_connections WHERE provider=$1 AND user_sub=$2 ORDER BY updated_at DESC LIMIT 1`,
      [provider, userSub])).rows[0];
    await pool.end();
    if (row && row.access_token) {
      try { return decrypt(row.access_token); } catch { return row.access_token; }
    }
  } catch { /* no DB / no pg / not connected — fine, creds are optional */ }
  return undefined;
}

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  if (!verb) { console.error('usage: oshal-jobhunter <pull|score|draft|discover|enrich|board> [args]'); process.exit(2); }

  const userSub = resolveUserSub();
  if (!userSub) { console.error('No user identity. Set OSHAL_USER_SUB (the signed-in user).'); process.exit(2); }
  const tenant = (process.env.OSHAL_TENANT || 'default').trim();

  // refresh: trigger the controller's FULL nightly scrape+index chain (admin-gated server-side).
  // No engine/python involved — this is the career_refresh bot tool's path: POST the internal
  // route with the trusted service headers; the route re-checks the acting user is a career
  // admin, so a non-admin user asking their bot to refresh gets a clean 403, not a scrape.
  if (verb === 'refresh' || (verb === 'refresh-status')) {
    const port = (process.env.PORT || '5000').trim();
    const secret = (process.env.SWARM_SERVICE_SECRET || '').trim();
    if (!secret) { console.log(JSON.stringify({ ok: false, error: 'service secret not configured on this node' })); process.exit(1); }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/career-hunter/run/refresh`, {
        method: verb === 'refresh' ? 'POST' : 'GET',
        headers: { 'X-Service-Secret': secret, 'X-Oshal-User-Sub': userSub },
      });
      const body = await r.text();
      console.log(body || JSON.stringify({ ok: r.ok }));
      process.exit(r.ok ? 0 : 1);
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
      process.exit(1);
    }
  }

  const tenantDir = path.join(STORE_ROOT, tenant);
  const userDir = path.join(tenantDir, userSub);
  fs.mkdirSync(userDir, { recursive: true });
  const corpusDb = process.env.JOBHUNTER_CORPUS_DB || path.join(tenantDir, 'corpus.db');
  const userDb = path.join(userDir, `user-${userSub}.db`);
  const careerDb = path.join(userDir, 'career_db.json');
  // Seed a per-user career DB from a default template the first time, if one is provided.
  if (!fs.existsSync(careerDb) && process.env.JOBHUNTER_CAREER_DB_DEFAULT
      && fs.existsSync(process.env.JOBHUNTER_CAREER_DB_DEFAULT)) {
    try { fs.copyFileSync(process.env.JOBHUNTER_CAREER_DB_DEFAULT, careerDb); } catch { /* */ }
  }

  // Stage creds the engine reads from the environment (both optional).
  const anthropic = await resolveSecret('anthropic', userSub);   // click-to-connect
  const firecrawl = await resolveSecret('firecrawl', userSub);   // per-user settings key

  const env = {
    ...process.env,
    PYTHONPATH: ENGINE_DIR,
    PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_MULTIUSER: '1',
    OSHAL_USER_SUB: userSub,
    OSHAL_TENANT: tenant,
    JOBHUNTER_DATA: userDir,
    JOBHUNTER_CORPUS_DB: corpusDb,
    JOBHUNTER_USER_DB: userDb,
    JOBHUNTER_CAREER_DB: careerDb,
  };
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;
  if (firecrawl) env.FIRECRAWL_API_KEY = firecrawl;

  // Map the verb to one or more engine invocations.
  const runs = [];
  switch (verb) {
    case 'pull':
      runs.push(['-m', 'jobhunter', 'scrape', '--all', ...rest]);
      runs.push(['-c', 'from jobhunter import match; print("keyword-indexed", match.rescore_recent(14), "recent")']);
      break;
    case 'score':   runs.push(['-m', 'jobhunter', 'score', ...rest]); break;
    // score-titles: the per-user TITLE pass — AI-score in-lane roles whose titles match the
    // user's own target list (CH_TITLES, newline-separated), regardless of keyword prefit.
    // The keyword prefilter is operator-calibrated, so other users' best roles can sit under
    // --min-keyword forever; this is the productized score_batch(title_any=[...]) run.
    // ALWAYS bounded: CH_LIMIT caps the run, and an empty CH_TITLES scores NOTHING (a falsy
    // title_any would drop the filter and score the whole backlog unbounded).
    case 'score-titles': runs.push(['-c', 'import os, json\nfrom jobhunter import db, score\n'
      + 'db.init_db()\n'
      + 'terms=[t.strip() for t in os.environ.get("CH_TITLES","").split("\\n") if t.strip()]\n'
      + 'limit=int(os.environ.get("CH_LIMIT","0") or 0) or None\n'
      + 'done,skipped=(score.score_batch(limit=limit,min_keyword=0,title_any=terms) if terms else (0,0))\n'
      + 'print(json.dumps({"scored":done,"skipped":skipped,"terms":len(terms)}))']); break;
    // ingest: build THIS user's career_db.json from their uploaded resume (CH_RESUME = file path).
    // The onboarding "Get Started" upload calls this; profile.build_from_resume parses PDF/DOCX
    // and writes the per-user profile that score/tailor read.
    case 'ingest':  runs.push(['-c', 'import os, json\nfrom jobhunter import profile\n'
      + 'print(json.dumps(profile.build_from_resume(os.environ.get("CH_RESUME",""))))']); break;
    // absorb: merge an uploaded NON-resume career artifact (email/LinkedIn export/status report/
    // work sample) into THIS user's profile — extract TRUE facts then profile.augment (add-only,
    // backed up, audited). CH_ARTIFACT = file path, CH_KIND = artifact kind.
    case 'absorb':  runs.push(['-c', 'import os, json\nfrom jobhunter import profile\n'
      + 'print(json.dumps(profile.absorb(os.environ.get("CH_ARTIFACT",""), os.environ.get("CH_KIND","other"))))']); break;
    // augment: merge free-text TRUE facts (from a conversation — "tell me about your career") into
    // THIS user's profile, add-only + backed up + audited. CH_FACTS = the facts string.
    case 'augment': runs.push(['-c', 'import os, json\nfrom jobhunter import profile\n'
      + 'print(json.dumps(profile.augment(os.environ.get("CH_FACTS",""))))']); break;
    // match: keyword-score the shared corpus into THIS user's signals (no re-scrape).
    // A new user has empty user_signals, so score finds nothing until this runs. Bounded
    // to recent postings (CH_MATCH_DAYS, default 45) so it stays fast over the big corpus.
    case 'match':   runs.push(['-c', 'import os\nfrom jobhunter import match\n'
      + 'print("matched", match.rescore_recent(int(os.environ.get("CH_MATCH_DAYS","45"))))']); break;
    case 'draft':   runs.push(['-m', 'jobhunter', 'apply', ...rest]); break;       // pass --job <id> [--oshal]
    // rerender: re-render an existing packet's PDFs from its (edited) application.json
    // generated.resume/cover — NO LLM call. The Resume Studio save-and-preview path.
    case 'rerender': runs.push(['-c', 'import os, json\nfrom jobhunter import generate\n'
      + 'print(json.dumps({"dir": generate.rerender_packet(int(os.environ.get("CH_JOB","0")))}))']); break;
    // tailor: one-off resume+cover for a job WITH free-text guidance (e.g. "make this cover
    // about my early career"). Guidance first ENRICHES the durable profile (so it persists),
    // then generate_for tailors to the posting. CH_JOB/CH_OSHAL/CH_GUIDANCE via env.
    case 'tailor':  runs.push(['-c', 'import os, json\nfrom jobhunter import profile, generate\n'
      + 'pid=int(os.environ.get("CH_JOB","0"))\noshal=os.environ.get("CH_OSHAL")=="1"\ng=os.environ.get("CH_GUIDANCE","").strip()\n'
      + 'cl=(profile.augment(g) or {}).get("changelog",[]) if g else []\n'
      + 'res=generate.generate_for(pid, include_oshal=oshal)\n'
      + 'print(json.dumps({"dir":res.get("dir"),"changelog":cl}))']); break;
    // query: the bot's read-the-career-database TOOL — a scoped JSON snapshot of THIS user's
    // hunt (fresh high-fit count, top matches, pipeline counts, top gap themes). Read-only.
    case 'query': {
      // freshHighFit keyed off posted_date via SQLite date('now',...). Both wrong: the
      // function is not valid Postgres, and posted_date is NULL for ~26% of postings
      // and holds the SCRAPE date for another 286,663 -- the count was meaningless in
      // either backend. Cutoff is computed here and compared against first_seen_at,
      // which is populated for 100% of rows and works verbatim in both.
      const _D3 = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
      runs.push(['-c', 'import json\nfrom jobhunter import db\n'
      + 'with db.connect() as conn:\n'
      + ' fresh=conn.execute("SELECT COUNT(*) FROM postings WHERE active=1 AND COALESCE(target_role,0)=1 AND COALESCE(ai_fit_score,fit_score,0)>=70 AND first_seen_at >= \'' + _D3 + '\'").fetchone()[0]\n'
      + ' top=[dict(title=r[0],company=r[1],fit=r[2],status=r[3],salary_max=r[4],posted=r[5]) for r in conn.execute("SELECT p.title,c.name,COALESCE(p.ai_fit_score,p.fit_score),p.status,p.salary_max,p.posted_date FROM postings p JOIN companies c ON c.id=p.company_id WHERE p.active=1 AND COALESCE(p.target_role,0)=1 ORDER BY COALESCE(p.ai_fit_score,-1) DESC LIMIT 10").fetchall()]\n'
      + ' pipe={r[0]:r[1] for r in conn.execute("SELECT status,COUNT(*) FROM postings WHERE status IS NOT NULL AND status<>\'new\' GROUP BY status").fetchall()}\n'
      + ' recent_applied=[dict(title=r[0],company=r[1],fit=r[2],salary_max=r[3],applied_at=r[4]) for r in conn.execute("SELECT p.title,c.name,COALESCE(p.ai_fit_score,p.fit_score),p.salary_max,p.applied_at FROM postings p JOIN companies c ON c.id=p.company_id WHERE p.status=\'applied\' ORDER BY p.applied_at DESC LIMIT 8").fetchall()]\n'
      + 'gaps_top=[]\n'
      + 'try:\n from jobhunter import gaps\n if gaps.is_scanned():\n  t,_=gaps.themes_with_stats(); gaps_top=[dict(title=gaps.title_of(x["key"]),n_jobs=x.get("n_jobs",0)) for x in sorted([x for x in t if x.get("addressable") and x.get("n_jobs",0)>0],key=lambda x:-x.get("n_jobs",0))[:5]]\n'
      + 'except Exception: pass\n'
      + 'print(json.dumps({"freshHighFit":{"days":3,"minFit":70,"count":fresh},"topMatches":top,"recentApplied":recent_applied,"pipeline":pipe,"topGaps":gaps_top}, default=str))']); break; }
    case 'discover':runs.push(['-m', 'jobhunter', 'discover', ...(rest.length ? rest : ['--all-missing'])]); break;
    // seturl: set an EXISTING company's careers URL — detect ATS + scrape now (JSON out).
    // The admin "Companies" surface calls this: `seturl --company-id N --url <careers-url>`.
    case 'seturl':  runs.push(['-m', 'jobhunter', 'seturl', ...rest]); break;
    case 'enrich':  runs.push(['-m', 'jobhunter', 'enrich', ...(rest.length ? rest : ['--missing'])]); break;
    case 'board':   runs.push(['-m', 'jobhunter', 'dashboard', '--no-browser', ...rest]); break;
    // Resume-strengthen flow (gap themes + profile augment). Sub: scan|list|answer|status.
    // answer/status read CH_KEY/CH_RESP/CH_STATUS from the env (set by the caller) to avoid
    // shell quoting; answer also enriches the durable profile (LLM) so future resumes pull it.
    case 'strengthen': {
      const sub = rest[0] || 'list';
      if (sub === 'scan') {
        runs.push(['-c', 'from jobhunter import gaps; print("scanned", gaps.scan())']);
      } else if (sub === 'list') {
        runs.push(['-c', 'import json\nfrom jobhunter import gaps\n'
          + 'gaps.scan() if not gaps.is_scanned() else None\n'
          + 't,total=gaps.themes_with_stats()\n'
          + 'out=[dict(key=x["key"], title=gaps.title_of(x["key"]), n_jobs=x.get("n_jobs",0), avg_fit=x.get("avg_fit"), status=x.get("status"), response=x.get("response"), addressable=x.get("addressable")) for x in t]\n'
          + 'print(json.dumps({"themes":out,"total":total}, default=str))']);
      } else if (sub === 'answer') {
        runs.push(['-c', 'import os, json\nfrom jobhunter import gaps, profile\n'
          + 'k=os.environ.get("CH_KEY","").strip()\nr=os.environ.get("CH_RESP","").strip()\n'
          + 'gaps.save_answer(k, r)\n'
          + 'a = profile.augment(gaps.title_of(k)+": "+r) if r else {}\n'
          + 'print(json.dumps({"changelog": (a or {}).get("changelog", [])}))']);
      } else if (sub === 'status') {
        runs.push(['-c', 'import os\nfrom jobhunter import gaps\ngaps.set_status(os.environ.get("CH_KEY","").strip(), os.environ.get("CH_STATUS","open").strip())']);
      } else { console.error('strengthen: scan|list|answer|status'); process.exit(2); }
      break;
    }
    default:
      console.error(`unknown verb: ${verb}`); process.exit(2);
  }

  for (const args of runs) {
    const r = spawnSync(PYTHON, args, { cwd: ENGINE_DIR, env, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
  }
}

main().catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); });
