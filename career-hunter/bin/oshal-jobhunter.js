#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add a per-user provider CLI around the vendored jobhunter engine and shared corpus.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Add bounded target-title scoring that refuses an empty title set.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Add admin-gated controller refresh and refresh-status commands.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Relocate the wrapper, engine, and local data anchors into the installable package.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Require real SESSION_SECRET material for encrypted legacy connector credentials.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Add one-child absorb-batch serialization for multi-file profile updates.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Restrict engine environments to required configuration and brokered credentials.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Map OIDC subjects through the shared reversible contained-path mapper.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Serialize API and direct CLI mutations with heartbeat-backed filesystem leases, validated child adoption, and asynchronous Python children.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | Keep adopted filesystem leases alive from the CLI child when a detached worker outlives its API parent.
 * 11 | maintainer@emeraldcoastsystemsgroup.com  | Add one-child guide action sequencing and make failed resume ingestion return a truthful nonzero lifecycle result.
 * 12 | maintainer@emeraldcoastsystemsgroup.com  | Share in-place raw-directory aliases and legacy database compatibility with the controller runtime.
 * 13 | maintainer@emeraldcoastsystemsgroup.com  | Preserve the exact OIDC subject across the controller-to-CLI boundary instead of trimming identity whitespace.
 * 14 | maintainer@emeraldcoastsystemsgroup.com  | Enforce the adopted parent's absolute deadline in the surviving wrapper and terminate hung Python process trees.
 * 15 | maintainer@emeraldcoastsystemsgroup.com  | Persist resume-ingest terminal state from the adopted wrapper so API parent loss cannot strand successful work as pending.
 * 16 | maintainer@emeraldcoastsystemsgroup.com  | Treat profile augmentation as successful only when it reports an actual persisted changelog.
 * 17 | maintainer@emeraldcoastsystemsgroup.com  | Self-fence the active Python process tree when an adopted or direct filesystem lease loses ownership.
 * 18 | maintainer@emeraldcoastsystemsgroup.com  | Execute the complete validated job-guide sequence in one child, including backend-parameterized status updates, and fail-stop dependent actions.
 * 19 | maintainer@emeraldcoastsystemsgroup.com  | Apply the configured global engine capacity to direct CLI leases while inherited parent proofs retain their already-owned capacity slot.
 * 20 | maintainer@emeraldcoastsystemsgroup.com  | Send exact refresh identities through the kernel's canonical base64url trusted-service header.
 * 21 | maintainer@emeraldcoastsystemsgroup.com  | Clarify that legacy raw stores retain their existing absolute paths as compatibility aliases.
 * 22 | maintainer@emeraldcoastsystemsgroup.com  | Honor the parent's end-to-end deadline during credential fallback and skip duplicate brokerage when the controller supplied a complete credential set.
 * 23 | maintainer@emeraldcoastsystemsgroup.com  | Propagate explicit profile mutation results and make artifact batches fail nonzero while retaining every bounded item outcome.
 * 24 | maintainer@emeraldcoastsystemsgroup.com  | Stop dropping each gap theme's interviewer question at the CLI boundary and expose the bounded enrichment audit tail. The strengthen list projection whitelisted seven fields and omitted prompt/desc, so the real per-theme question the engine has always carried never reached the surface, which substituted a generic sentence; strengthen changelog lets a caller read the bullets a detached augmentation actually wrote, whose stdout the asynchronous dispatch cannot return.
 * 25 | maintainer@emeraldcoastsystemsgroup.com  | Add the Resume Studio master-document verbs: `resume base` (straight profile-to-editor mapping, no LLM) and `resume base-save` (bounded CH_RESUME_DOC whitelist write-back through profile.replace_resume_fields), so the durable career profile has a first-class editor path.
 *
 * Verbs (each forwards extra args to the engine):
 *   pull      -> scrape --all  then  match.rescore_recent  (nightly corpus refresh + keyword index)
 *   score     -> score [--days N --min-keyword N --limit N]   (per-user AI fit)
 *   draft     -> apply --job <id> [--oshal]                   (tailored resume+cover PDFs)
 *   discover  -> discover --all-missing | --company NAME
 *   enrich    -> enrich --missing
 *   board     -> dashboard --no-browser --host 127.0.0.1 --port <port>
 *   resume    -> base (master editor document) | base-save (whitelist profile write-back)
 *
 * Per-user data lives under {STORE}/{tenant}/{user_segment}/; portable lowercase subjects retain
 * their legacy segment and every unsafe subject is reversibly encoded. The jobs corpus is shared
 * at {STORE}/{tenant}/corpus.db. Exit 2 = no user identity (set OSHAL_USER_SUB).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  decryptSessionValue,
  isSessionEncryptedValue,
} = require('../lib/session-crypto');
const { resolveContainedPath, resolveUserStoreLayout } = require('../lib/user-store-path');
const {
  RUN_LOCK_ADOPTION_ENV,
  adoptRunLocks,
  buildRunResources,
  releaseRunLocks,
  tryAcquireRunLocks,
} = require('../lib/career-run-lock');

// Engine lives beside this wrapper in the package (../engine). The real per-user store is
// always JOBHUNTER_STORE_ROOT (the api-output volume); the package-relative path is only a
// local-dev fallback and never holds shipped data.
const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');
const STORE_ROOT = process.env.JOBHUNTER_STORE_ROOT
  || path.resolve(__dirname, '..', 'engine', 'data');
const PYTHON = process.env.JOBHUNTER_PYTHON || 'python3';
let activeEngineChild;
let cliLeaseLost = false;
const ENGINE_ENV_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE', 'DATABASE_URL', 'PLAYWRIGHT_CHROMIUM_PATH', 'CHROMIUM_PATH',
  'JOBHUNTER_STORE', 'JOBHUNTER_APP_DIR', 'JOBHUNTER_UA', 'JOBHUNTER_TIMEOUT',
  'JOBHUNTER_DELAY', 'JOBHUNTER_RETRIES', 'JOBHUNTER_ANTHROPIC_MODEL',
  'JOBHUNTER_SCORE_MODEL', 'JOBHUNTER_OPENAI_MODEL', 'JOBHUNTER_RESUME_PREFIX',
]);

/** Copy only engine runtime/config values; CH_* values are controller-built command inputs. */
function inheritedEngineEnv(verb) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    const googleDiscovery = verb === 'discover' && /^(GOOGLE_API_KEY|GOOGLE_SEARCH_API_KEY|GOOGLE_CX|GOOGLE_SEARCH_CX)$/.test(upper);
    if ((ENGINE_ENV_KEYS.has(upper) || upper.startsWith('CH_') || googleDiscovery) && value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/** OSHAL_USER_SUB env, or the cwd-relative file the codex wrapper drops (sandbox may not forward env). */
function resolveUserSub() {
  const environmentSubject = process.env.OSHAL_USER_SUB;
  if (environmentSubject !== undefined && environmentSubject !== '') return environmentSubject;
  try {
    const fileSubject = fs.readFileSync(path.join(process.cwd(), '.oshal-user-sub'), 'utf8');
    return fileSubject === '' ? undefined : fileSubject;
  }
  catch { return undefined; }
}

/**
 * @description Reads one optional legacy connector token when no brokered credential was staged.
 * Database availability is optional, while decryption failures remain fatal in resolveSecret.
 * @param {string} provider - Career credential provider name.
 * @param {string} userSub - Authenticated owner of the connector row.
 * @param {Function} [createPool] - Injectable Postgres pool factory for dependency-free tests.
 * @param {number} [deadlineAt] - Absolute command deadline that also bounds query and pool close.
 * @returns {Promise<string|undefined>} Stored token envelope, or undefined when unavailable.
 */
async function readStoredSecret(provider, userSub, createPool = () => {
  const { Pool } = require('pg');
  return new Pool();
}, deadlineAt) {
  let pool;
  try {
    pool = createPool();
    const text = 'SELECT access_token FROM oshal_connections WHERE provider=$1 AND user_sub=$2 ORDER BY updated_at DESC LIMIT 1';
    const query = deadlineAt
      ? pool.query({
        text, values: [provider, userSub],
        query_timeout: Math.max(1, deadlineAt - Date.now()),
        statement_timeout: Math.max(1, deadlineAt - Date.now()),
      })
      : pool.query(text, [provider, userSub]);
    const result = deadlineAt
      ? await beforeCliDeadline(query, deadlineAt, 'credential database query') : await query;
    const row = result.rows[0];
    return row?.access_token;
  } catch (error) {
    if (error?.exitCode === 124) throw error;
    // No DB / no pg / not connected is fine because both engine credentials are optional.
    return undefined;
  } finally {
    if (pool) {
      const close = pool.end().catch(() => undefined);
      if (deadlineAt) await beforeCliDeadline(close, deadlineAt, 'credential database close');
      else await close;
    }
  }
}

/**
 * @description Resolves one provider credential from staged file, scoped environment, or the
 * caller's legacy database row, in that order, without accepting encrypted data as plaintext.
 * @param {string} provider - Career credential provider name.
 * @param {string} userSub - Authenticated owner of the credential.
 * @param {Function} [readStored] - Injectable legacy token reader.
 * @returns {Promise<string|undefined>} Plaintext brokered credential, or undefined when absent.
 */
async function resolveSecret(provider, userSub, readStored = readStoredSecret) {
  const fileName = `.oshal-cred-${provider}`;
  try {
    const staged = fs.readFileSync(path.join(process.cwd(), fileName), 'utf8').trim();
    if (staged) return isSessionEncryptedValue(staged) ? decryptSessionValue(staged) : staged;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const envName = `OSHAL_CRED_${provider.toUpperCase()}`;
  const staged = process.env[envName];
  if (staged) return isSessionEncryptedValue(staged) ? decryptSessionValue(staged) : staged;
  if (!userSub) return undefined;
  const value = await readStored(provider, userSub);
  if (!value) return undefined;
  const stored = String(value);
  // This runs outside the optional DB catch: missing/wrong key, invalid auth tag, and kernel v2
  // are deployment/security failures and must never become a missing credential or plaintext.
  return isSessionEncryptedValue(stored) ? decryptSessionValue(stored) : stored;
}

/** Attach a stable CLI exit status without terminating before lease cleanup can run. */
function cliError(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

/** Encode one exact bounded UTF-8 subject for the kernel trusted-service identity contract. */
function trustedUserSubHeader(userSub) {
  const bytes = Buffer.from(userSub, 'utf8');
  if (!userSub || userSub.includes('\0') || bytes.length > 512
      || bytes.toString('utf8') !== userSub) {
    throw cliError('Career refresh user identity is invalid', 2);
  }
  return bytes.toString('base64url');
}

/** Call the controller-owned refresh endpoint; refresh never touches package engine data. */
async function runRefresh(verb, userSub) {
  const port = (process.env.PORT || '5000').trim();
  const secret = (process.env.SWARM_SERVICE_SECRET || '').trim();
  if (!secret) {
    console.log(JSON.stringify({ ok: false, error: 'service secret not configured on this node' }));
    return 1;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/career-hunter/run/refresh`, {
      method: verb === 'refresh' ? 'POST' : 'GET',
      headers: {
        'X-Service-Secret': secret,
        'X-Oshal-User-Sub-B64': trustedUserSubHeader(userSub),
      },
    });
    const body = await response.text();
    console.log(body || JSON.stringify({ ok: response.ok }));
    return response.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    return 1;
  }
}

/** Resolve contained store paths and seed the optional initial profile exactly once. */
function prepareStore(userSub, tenant) {
  const { tenantDir, userDir, userDb } = resolveUserStoreLayout(STORE_ROOT, tenant, userSub);
  fs.mkdirSync(userDir, { recursive: true });
  const careerDb = path.join(userDir, 'career_db.json');
  const template = process.env.JOBHUNTER_CAREER_DB_DEFAULT;
  if (!fs.existsSync(careerDb) && template && fs.existsSync(template)) {
    try { fs.copyFileSync(template, careerDb); } catch { /* optional seed only */ }
  }
  return {
    userDir,
    careerDb,
    corpusDb: process.env.JOBHUNTER_CORPUS_DB || path.join(tenantDir, 'corpus.db'),
    userDb,
  };
}

/** Build the least-privilege Python environment and add only this user's brokered secrets. */
async function buildEngineEnv(userSub, tenant, verb, store, deadlineAt) {
  const authRoot = path.join(store.userDir, '.brokered-auth-only');
  const env = {
    ...inheritedEngineEnv(verb),
    PYTHONPATH: ENGINE_DIR,
    PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_MULTIUSER: '1',
    OSHAL_USER_SUB: userSub,
    OSHAL_TENANT: tenant,
    JOBHUNTER_DATA: store.userDir,
    JOBHUNTER_CORPUS_DB: store.corpusDb,
    JOBHUNTER_USER_DB: store.userDb,
    JOBHUNTER_CAREER_DB: store.careerDb,
    CLAUDE_CONFIG_DIR: path.join(authRoot, 'claude'),
    CODEX_HOME: path.join(authRoot, 'codex'),
  };
  let anthropic;
  let firecrawl;
  if (process.env.CAREER_HUNTER_BROKER_COMPLETE === '1') {
    anthropic = process.env.OSHAL_CRED_ANTHROPIC;
    firecrawl = process.env.OSHAL_CRED_FIRECRAWL;
  } else {
    const credentials = Promise.all([
      resolveSecret('anthropic', userSub, (provider, sub) => (
        readStoredSecret(provider, sub, undefined, deadlineAt)
      )),
      resolveSecret('firecrawl', userSub, (provider, sub) => (
        readStoredSecret(provider, sub, undefined, deadlineAt)
      )),
    ]);
    [anthropic, firecrawl] = await beforeCliDeadline(
      credentials, deadlineAt, 'credential brokerage',
    );
  }
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;
  if (firecrawl) env.FIRECRAWL_API_KEY = firecrawl;
  return env;
}

/** Clamp the direct-CLI engine ceiling while treating missing or invalid configuration as three. */
function directCapacitySlots() {
  const raw = process.env.CAREER_HUNTER_MAX_RUNS;
  const parsed = raw?.trim() ? Number(raw) : 3;
  const configured = Number.isFinite(parsed) ? Math.floor(parsed) : 3;
  return Math.max(1, Math.min(64, configured));
}

/** Acquire a direct lease or validate the exact opaque lease inherited from the API runner. */
function acquireCliLease(userSub, tenant, verb) {
  const resources = buildRunResources(userSub, verb);
  const onLost = (error) => {
    cliLeaseLost = true;
    console.error(`Career engine lease lost: ${error?.message || error}`);
    if (activeEngineChild) terminateEngineTree(activeEngineChild);
  };
  const inherited = process.env[RUN_LOCK_ADOPTION_ENV];
  if (inherited) {
    const adopted = adoptRunLocks(STORE_ROOT, tenant, resources, inherited, {
      onError: (error) => console.error(`Career engine lease heartbeat failed: ${error?.message || error}`),
      onLost,
    });
    if (adopted.status !== 'ok') throw cliError('Career engine lease adoption was rejected');
    return adopted.lease;
  }
  const result = tryAcquireRunLocks(STORE_ROOT, tenant, resources, {
    capacitySlots: directCapacitySlots(),
    onError: (error) => console.error(`Career engine lease heartbeat failed: ${error?.message || error}`),
    onLost,
  });
  return result.status === 'ok' ? result.lease : null;
}

/** Return shared-corpus command mappings or null when another mapper owns the verb. */
function corpusRuns(verb, rest) {
  switch (verb) {
    case 'pull': return [
      ['-m', 'jobhunter', 'scrape', '--all', ...rest],
      ['-c', 'from jobhunter import match; print("keyword-indexed", match.rescore_recent(14), "recent")'],
    ];
    case 'score': return [['-m', 'jobhunter', 'score', ...rest]];
    case 'score-titles': return [['-c', 'import os, json\nfrom jobhunter import db, score\n'
      + 'db.init_db()\n'
      + 'terms=[t.strip() for t in os.environ.get("CH_TITLES","").split("\\n") if t.strip()]\n'
      + 'limit=int(os.environ.get("CH_LIMIT","0") or 0) or None\n'
      + 'done,skipped=(score.score_batch(limit=limit,min_keyword=0,title_any=terms) if terms else (0,0))\n'
      + 'print(json.dumps({"scored":done,"skipped":skipped,"terms":len(terms)}))']];
    case 'discover': return [['-m', 'jobhunter', 'discover', ...(rest.length ? rest : ['--all-missing'])]];
    case 'seturl': return [['-m', 'jobhunter', 'seturl', ...rest]];
    case 'enrich': return [['-m', 'jobhunter', 'enrich', ...(rest.length ? rest : ['--missing'])]];
    default: return null;
  }
}

/** Build one bounded artifact batch that reports each result before choosing its exit status. */
function absorbBatchRun() {
  const python = [
    'import os,json',
    'from jobhunter import profile',
    'try:\n items=json.loads(os.environ.get("CH_ARTIFACTS","[]"))',
    'except Exception:\n items=None',
    'out=[]',
    'if not isinstance(items,list):',
    ' out=[{"ok":False,"error":"invalid artifact batch"}]',
    'else:',
    ' for item in items[:20]:',
    '  try:',
    '   if not isinstance(item,dict): raise ValueError("invalid artifact item")',
    '   result=profile.absorb(str(item.get("path","")),str(item.get("kind","other")))',
    '   row=result if isinstance(result,dict) else {"ok":False,"error":"invalid artifact result"}',
    '  except Exception as exc:',
    '   row={"ok":False,"error":"artifact absorb raised "+type(exc).__name__}',
    '  out.append(row)',
    ' if len(items)>20:',
    '  out.append({"ok":False,"error":"artifact batch exceeds 20-item limit"})',
    'print(json.dumps(out))',
    'failed=any(not isinstance(row,dict) or row.get("ok") is not True for row in out)',
    'raise SystemExit(1 if failed else 0)',
  ].join('\n');
  return ['-c', python];
}

/** Return profile/store command mappings; each command remains inside one acquired user lease. */
function profileRuns(verb) {
  switch (verb) {
    case 'ingest': return [['-c', 'import os, json\nfrom jobhunter import profile\n'
      + 'result=profile.build_from_resume(os.environ.get("CH_RESUME",""))\n'
      + 'ok=isinstance(result,dict) and result.get("ok") is not False\n'
      + 'error=(result.get("error","resume ingestion failed") if isinstance(result,dict) else "resume ingestion failed")\n'
      + 'safe=({"ok":True,"roles":int(result.get("roles",0)),"skills":int(result.get("skills",0))} if ok else {"ok":False,"error":str(error)[:1000]})\n'
      + 'print(json.dumps(safe))\nraise SystemExit(0 if ok else 1)']];
    case 'absorb': return [['-c', 'import os, json\nfrom jobhunter import profile\n'
      + 'print(json.dumps(profile.absorb(os.environ.get("CH_ARTIFACT",""), os.environ.get("CH_KIND","other"))))']];
    case 'absorb-batch': return [absorbBatchRun()];
    case 'augment': return [['-c', 'import os, json\nfrom jobhunter import profile\n'
      + 'print(json.dumps(profile.augment(os.environ.get("CH_FACTS",""))))']];
    case 'match': return [['-c', 'import os\nfrom jobhunter import match\n'
      + 'print("matched", match.rescore_recent(int(os.environ.get("CH_MATCH_DAYS","45"))))']];
    default: return null;
  }
}

/** Build the read-only Career database snapshot Python invocation. */
function queryRun() {
  const cutoff = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  return ['-c', 'import json\nfrom jobhunter import db\n'
    + 'with db.connect() as conn:\n'
    + ' fresh=conn.execute("SELECT COUNT(*) FROM postings WHERE active=1 AND COALESCE(target_role,0)=1 AND COALESCE(ai_fit_score,fit_score,0)>=70 AND first_seen_at >= \'' + cutoff + '\'").fetchone()[0]\n'
    + ' top=[dict(title=r[0],company=r[1],fit=r[2],status=r[3],salary_max=r[4],posted=r[5]) for r in conn.execute("SELECT p.title,c.name,COALESCE(p.ai_fit_score,p.fit_score),p.status,p.salary_max,p.posted_date FROM postings p JOIN companies c ON c.id=p.company_id WHERE p.active=1 AND COALESCE(p.target_role,0)=1 ORDER BY COALESCE(p.ai_fit_score,-1) DESC LIMIT 10").fetchall()]\n'
    + ' pipe={r[0]:r[1] for r in conn.execute("SELECT status,COUNT(*) FROM postings WHERE status IS NOT NULL AND status<>\'new\' GROUP BY status").fetchall()}\n'
    + ' recent_applied=[dict(title=r[0],company=r[1],fit=r[2],salary_max=r[3],applied_at=r[4]) for r in conn.execute("SELECT p.title,c.name,COALESCE(p.ai_fit_score,p.fit_score),p.salary_max,p.applied_at FROM postings p JOIN companies c ON c.id=p.company_id WHERE p.status=\'applied\' ORDER BY p.applied_at DESC LIMIT 8").fetchall()]\n'
    + 'gaps_top=[]\n'
    + 'try:\n from jobhunter import gaps\n if gaps.is_scanned():\n  t,_=gaps.themes_with_stats(); gaps_top=[dict(title=gaps.title_of(x["key"]),n_jobs=x.get("n_jobs",0)) for x in sorted([x for x in t if x.get("addressable") and x.get("n_jobs",0)>0],key=lambda x:-x.get("n_jobs",0))[:5]]\n'
    + 'except Exception: pass\n'
    + 'print(json.dumps({"freshHighFit":{"days":3,"minFit":70,"count":fresh},"topMatches":top,"recentApplied":recent_applied,"pipeline":pipe,"topGaps":gaps_top}, default=str))'];
}

/** Build one bounded Python child that reports a truthful result row for every guide action. */
function guideActionsRun() {
  const python = [
    'import os,json',
    'from jobhunter import profile,generate',
    'ALLOWED_STATUS=("applied","dismissed","promoted","deferred","generated")',
    'try:\n actions=json.loads(os.environ.get("CH_GUIDE_ACTIONS",""))\nexcept Exception:\n actions=None',
    'try:\n job=int(os.environ.get("CH_JOB","0"))\nexcept Exception:\n job=0',
    'def run_action(action):',
    ' op=action.get("op") if isinstance(action,dict) else None',
    ' row={"op":op if op in ("augment_profile","generate","set_status") else "invalid","ok":False}',
    ' try:',
    '  if op=="augment_profile":',
    '   facts=action.get("facts")',
    '   changed=profile.augment(facts.strip()) if isinstance(facts,str) and 0<len(facts.strip())<=16000 else {}',
    '   row["changed"]=isinstance(changed,dict) and changed.get("changed") is True',
    '   row["ok"]=row["changed"] and changed.get("ok") is True',
    '  elif op=="generate":',
    '   guidance=action.get("guidance","")',
    '   valid=isinstance(guidance,str) and len(guidance)<=16000 and job>0',
    '   profile.augment(guidance.strip()) if valid and guidance.strip() else None',
    '   made=generate.generate_for(job,include_oshal=action.get("oshal") is True) if valid else None',
    '   row["ok"]=bool(made and (not isinstance(made,dict) or made.get("dir")))',
    '  elif op=="set_status":',
    '   status=action.get("status")',
    '   row["status"]=status if isinstance(status,str) else ""',
    '   if status in ALLOWED_STATUS and job>0:',
    '    from jobhunter import db',
    '    with db.connect() as conn:\n     db.set_status(conn,job,status)',
    '    row["ok"]=True',
    ' except Exception:\n  row["ok"]=False',
    ' return row',
    'rows=[]',
    'if not isinstance(actions,list) or not actions or len(actions)>4:',
    ' rows=[{"op":"invalid","ok":False}]',
    'else:',
    ' blocked=False',
    ' for action in actions:',
    '  if blocked:',
    '   op=action.get("op") if isinstance(action,dict) else None',
    '   row={"op":op if op in ("augment_profile","generate","set_status") else "invalid","ok":False,"skipped":True}',
    '   if op=="set_status": row["status"]=action.get("status") if isinstance(action.get("status"),str) else ""',
    '  else:\n   row=run_action(action)\n   blocked=not row["ok"]',
    '  rows.append(row)',
    'print("GUIDE_ACTIONS_RESULT="+json.dumps(rows,separators=(",",":")))',
  ].join('\n');
  return ['-c', python];
}

/** Return application-generation and board command mappings. */
function applicationRuns(verb, rest) {
  switch (verb) {
    case 'draft': return [['-m', 'jobhunter', 'apply', ...rest]];
    case 'rerender': return [['-c', 'import os, json\nfrom jobhunter import generate\n'
      + 'print(json.dumps({"dir": generate.rerender_packet(int(os.environ.get("CH_JOB","0")))}))']];
    case 'tailor': return [['-c', 'import os, json\nfrom jobhunter import profile, generate\n'
      + 'pid=int(os.environ.get("CH_JOB","0"))\noshal=os.environ.get("CH_OSHAL")=="1"\ng=os.environ.get("CH_GUIDANCE","").strip()\n'
      + 'cl=(profile.augment(g) or {}).get("changelog",[]) if g else []\n'
      + 'res=generate.generate_for(pid, include_oshal=oshal)\n'
      + 'print(json.dumps({"dir":res.get("dir"),"changelog":cl}))']];
    case 'guide-actions': return [guideActionsRun()];
    case 'query': return [queryRun()];
    case 'board': return [['-m', 'jobhunter', 'dashboard', '--no-browser', ...rest]];
    default: return null;
  }
}

/** Build the bounded master-resume save leg: refuse oversize payloads, then whitelist-write. */
function resumeBaseSaveRun() {
  const python = [
    'import os,json',
    'from jobhunter import profile',
    'raw=os.environ.get("CH_RESUME_DOC","")',
    'if len(raw.encode("utf-8","replace"))>262144:',
    ' print(json.dumps({"ok":False,"error":"master resume payload exceeds the 256 KiB input limit"}))',
    ' raise SystemExit(1)',
    'try:\n doc=json.loads(raw)\nexcept Exception:\n doc=None',
    'result=profile.replace_resume_fields(doc) if isinstance(doc,dict) else {"ok":False,"error":"invalid master resume payload"}',
    'print(json.dumps(result,ensure_ascii=False))',
    'raise SystemExit(0 if result.get("ok") is True else 1)',
  ].join('\n');
  return ['-c', python];
}

/** Map the Resume Studio master-document subcommands onto the profile engine's exact mappers. */
function resumeRuns(rest) {
  const sub = rest[0] || '';
  if (sub === 'base') {
    return [['-c', 'import json\nfrom jobhunter import profile\n'
      + 'print(json.dumps(profile.base_document(), ensure_ascii=False))']];
  }
  if (sub === 'base-save') return [resumeBaseSaveRun()];
  throw cliError('resume: base|base-save', 2);
}

/** Read the bounded tail of this user's enrichment audit log as JSON, without touching the DB. */
function strengthenChangelogRun() {
  return ['-c', 'import json\nfrom pathlib import Path\nfrom jobhunter import config\n'
    + 'p=Path(config.CAREER_DB).parent / "enrichment_log.jsonl"\n'
    + 'lines=p.read_text(encoding="utf-8", errors="replace").splitlines()[-8:] if p.exists() else []\n'
    + 'out=[]\n'
    + 'for line in lines:\n'
    + ' try:\n'
    + '  r=json.loads(line)\n'
    + ' except Exception:\n'
    + '  continue\n'
    + ' if not isinstance(r, dict):\n'
    + '  continue\n'
    + ' entries=[str(c)[:500] for c in (r.get("changelog") or []) if str(c).strip()][:25]\n'
    + ' out.append({"at": str(r.get("at",""))[:32], "facts": str(r.get("facts",""))[:240],'
    + ' "changelog": entries})\n'
    + 'print(json.dumps({"entries": out}, ensure_ascii=False))'];
}

/** Map the resume-strengthening subcommands while rejecting misspelled state changes. */
function strengthenRuns(rest) {
  const sub = rest[0] || 'list';
  if (sub === 'scan') return [['-c', 'from jobhunter import gaps; print("scanned", gaps.scan())']];
  if (sub === 'list') return [['-c', 'import json\nfrom jobhunter import gaps\n'
    + 'gaps.scan() if not gaps.is_scanned() else None\n'
    + 't,total=gaps.themes_with_stats()\n'
    + 'out=[dict(key=x["key"], title=gaps.title_of(x["key"]), n_jobs=x.get("n_jobs",0), avg_fit=x.get("avg_fit"), status=x.get("status"), response=x.get("response"), addressable=x.get("addressable"), prompt=x.get("prompt",""), desc=x.get("desc","")) for x in t]\n'
    + 'print(json.dumps({"themes":out,"total":total}, default=str))']];
  if (sub === 'answer') return [['-c', 'import os, json\nfrom jobhunter import gaps, profile\n'
    + 'k=os.environ.get("CH_KEY","").strip()\nr=os.environ.get("CH_RESP","").strip()\n'
    + 'gaps.save_answer(k, r)\n'
    + 'a = profile.augment(gaps.title_of(k)+": "+r) if r else {}\n'
    + 'print(json.dumps({"changelog": (a or {}).get("changelog", [])}))']];
  if (sub === 'status') return [['-c', 'import os\nfrom jobhunter import gaps\n'
    + 'gaps.set_status(os.environ.get("CH_KEY","").strip(), os.environ.get("CH_STATUS","open").strip())']];
  if (sub === 'changelog') return [strengthenChangelogRun()];
  throw cliError('strengthen: scan|list|answer|status|changelog', 2);
}

/** Resolve one supported CLI verb through small domain-specific mapping helpers. */
function engineRuns(verb, rest) {
  if (verb === 'strengthen') return strengthenRuns(rest);
  if (verb === 'resume') return resumeRuns(rest);
  for (const mapper of [corpusRuns, applicationRuns]) {
    const runs = mapper(verb, rest);
    if (runs) return runs;
  }
  const profile = profileRuns(verb);
  if (profile) return profile;
  throw cliError(`unknown verb: ${verb}`, 2);
}

/** Reject any wrapper-side async preparation when the inherited command budget expires. */
function beforeCliDeadline(operation, deadlineAt, label) {
  const remaining = Math.max(0, deadlineAt - Date.now());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(cliError(`Career ${label} timed out`, 124)), remaining);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Derive a bounded direct-CLI deadline when no API parent supplied an adopted deadline. */
function directEngineDeadline() {
  const configured = Number(process.env.CAREER_HUNTER_CLI_TIMEOUT_MS) || 2 * 60 * 60_000;
  const timeoutMs = Math.min(24 * 60 * 60_000, Math.max(1_000, configured));
  return Date.now() + timeoutMs;
}

/** Terminate a Python worker and all browser/process descendants on the current platform. */
function terminateEngineTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  const fallback = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
    killer.once('error', fallback);
    killer.once('close', (code) => { if (code !== 0) fallback(); });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { fallback(); }
}

/** Spawn one deadline-bound Python engine leg while the filesystem lease heartbeat can run. */
function runEngineCommand(args, env, deadlineAt) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      cwd: ENGINE_DIR, env, stdio: 'inherit', detached: process.platform !== 'win32',
    });
    activeEngineChild = child;
    let settled = false;
    let timedOut = false;
    let killGrace;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (killGrace) clearTimeout(killGrace);
      if (activeEngineChild === child) activeEngineChild = undefined;
      resolve(timedOut ? 124 : (code === null ? 1 : code));
    };
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      console.error('Career engine child exceeded its adopted deadline');
      terminateEngineTree(child);
      killGrace = setTimeout(() => finish(124), 5_000);
    }, Math.max(0, deadlineAt - Date.now()));
    child.once('error', (error) => {
      if (timedOut) { finish(124); return; }
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (killGrace) clearTimeout(killGrace);
      if (activeEngineChild === child) activeEngineChild = undefined;
      reject(error);
    });
    child.once('close', finish);
  });
}

/** Execute multi-leg verbs sequentially beneath one user/corpus filesystem lease. */
async function runEngineCommands(runs, env, deadlineAt) {
  for (const args of runs) {
    if (cliLeaseLost) return 75;
    if (Date.now() >= deadlineAt) return 124;
    const code = await runEngineCommand(args, env, deadlineAt);
    if (cliLeaseLost) return 75;
    if (code !== 0) return code;
  }
  return 0;
}

/** Atomically persist an ingest result only while its durable operation remains current. */
function persistResumeTerminalState(store, operationId, code) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(operationId || ''))) return false;
  const statusPath = resolveContainedPath(store.userDir, '.resume-ingest.json');
  const markerPath = resolveContainedPath(store.userDir, '.indexing');
  let current;
  try { current = JSON.parse(fs.readFileSync(statusPath, 'utf8')); }
  catch (error) { console.error(`Career resume status read failed: ${error?.message || error}`); return false; }
  if (current?.operationId !== operationId || current.state !== 'pending') return false;
  const succeeded = code === 0;
  const terminal = {
    ...current,
    state: succeeded ? 'succeeded' : 'failed',
    finishedAt: Date.now(),
    error: succeeded ? undefined : (code === 124 ? 'resume ingest timed out' : 'resume ingest failed'),
  };
  const temporary = resolveContainedPath(
    store.userDir, `.resume-ingest-${process.pid}-${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, JSON.stringify(terminal), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, statusPath);
    fs.rmSync(markerPath, { force: true });
    return true;
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    console.error(`Career resume status write failed: ${error?.message || error}`);
    return false;
  }
}

/** Validate identity, claim canonical resources, then run every engine leg under that lease. */
async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  if (!verb) throw cliError('usage: oshal-jobhunter <pull|score|draft|discover|enrich|board> [args]', 2);
  const userSub = resolveUserSub();
  if (!userSub) throw cliError('No user identity. Set OSHAL_USER_SUB (the signed-in user).', 2);
  const tenant = (process.env.OSHAL_TENANT || 'default').trim();
  if (verb === 'refresh' || verb === 'refresh-status') return runRefresh(verb, userSub);
  const runs = engineRuns(verb, rest);
  const directDeadlineAt = directEngineDeadline();
  const lease = acquireCliLease(userSub, tenant, verb);
  if (!lease) throw cliError('Career engine is already running for this resource', 75);
  try {
    const deadlineAt = lease.deadlineAt || directDeadlineAt;
    if (Date.now() >= deadlineAt) throw cliError('Career command deadline expired', 124);
    const store = prepareStore(userSub, tenant);
    const env = await buildEngineEnv(userSub, tenant, verb, store, deadlineAt);
    const code = await runEngineCommands(runs, env, deadlineAt);
    if (verb === 'ingest') persistResumeTerminalState(
      store, process.env.CH_RESUME_OPERATION_ID, code,
    );
    return code;
  } finally {
    releaseRunLocks(lease);
  }
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = Number.isInteger(code) ? code : 0; })
    .catch((error) => {
      console.error(error?.stack || String(error));
      process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
    });
}

module.exports = { readStoredSecret, resolveSecret };
