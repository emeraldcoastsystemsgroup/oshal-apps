/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com | Bulk-load the SQLite stores (shared corpus + every per-user db) into the Postgres schema from migrations 095/096, so per-user isolation is enforced by FORCE RLS instead of by separate files on a volume.
 */

// Moves the career-hunter store from SQLite to Postgres.
//
//   corpus.companies        -> career_companies                 (SHARED, no RLS)
//   corpus.postings_corpus  -> career_postings                  (SHARED, no RLS)
//   user_signals            -> career_user_job_scores            (PER-USER, FORCE RLS)
//                            + career_user_applications          (PER-USER, FORCE RLS)
//   recruiter_firms         -> career_user_recruiter_firms       (PER-USER, FORCE RLS)
//   gap_themes              -> career_user_gap_themes            (PER-USER, FORCE RLS)
//   interview_assessments   -> career_user_interview_assessments (PER-USER, FORCE RLS)
//
// THE SPLIT. user_signals is one wide row per (user, posting) mixing two different things:
// a JUDGEMENT about the job (fit scores, AI rationale) and an APPLICATION LIFECYCLE (status,
// resume paths, timestamps). Postgres separates them because they have different lifetimes and
// different access patterns -- the board reads scores constantly and applications rarely.
// A signal row produces a scores row always, and an applications row only when it carries
// application state; otherwise 1.28M "new/unscored" rows would be written twice for nothing.
//
// target_role MOVES SIDES. In SQLite it is a column on the shared postings_corpus, which is
// wrong: whether a role is "in my lane" is an opinion about one person. It is read from the
// corpus here and written per-user into career_user_job_scores.
//
// IDS ARE PRESERVED. company_id / posting_id keep their SQLite values so every existing
// reference stays valid; the BIGSERIAL sequences are advanced past the max at the end. Without
// that, the first new posting after the cutover collides with an existing id.
//
// Idempotent (ON CONFLICT DO NOTHING / DO UPDATE) and resumable: re-running converges.
// Read-only against SQLite -- it never writes to the source.
//
//   node scripts/migrate-sqlite-to-postgres.js [--dry-run] [--only-user <sub>]

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const DATA_ROOT = process.env.CAREER_DATA_ROOT || '/app/output/career-hunter-data/default';
const DRY = process.argv.includes('--dry-run');
const ONLY_USER = (() => {
  const i = process.argv.indexOf('--only-user');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const BATCH = Number(process.env.MIGRATE_BATCH || 1000);

const log = (...a) => console.log(`[pg-migrate ${new Date().toISOString()}]`, ...a);

/** Open a per-user SQLite db with the shared corpus ATTACHed.
 *  The attach is mandatory, not a convenience: corpus.db cannot be opened standalone because
 *  company_view hardcodes a `corpus.` prefix, and SQLite validates the whole schema on first
 *  access -- so a direct open fails with "malformed database schema" on a healthy file. */
function openUser(userSub) {
  const corpusDb = path.join(DATA_ROOT, 'corpus.db');
  const userDb = path.join(DATA_ROOT, userSub, `user-${userSub}.db`);
  if (!fs.existsSync(corpusDb) || !fs.existsSync(userDb)) return null;
  const db = new Database(userDb, { readonly: true });
  db.exec(`ATTACH DATABASE '${corpusDb.replace(/'/g, "''")}' AS corpus`);
  return db;
}

/** Every user_sub with a store on disk. */
function listUsers() {
  return fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((sub) => fs.existsSync(path.join(DATA_ROOT, sub, `user-${sub}.db`)));
}

/** Insert rows in batches of multi-row VALUES. pg-copy-streams is not installed in this
 *  image, and batched INSERT is fast enough here (~1.4M rows in single-digit minutes) while
 *  keeping ON CONFLICT semantics, which a raw COPY cannot express. */
async function insertBatched(pg, table, cols, rows, conflict) {
  if (!rows.length) return 0;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = [];
    const tuples = chunk.map((r, ri) => {
      const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
      params.push(...cols.map((c) => r[c]));
      return `(${ph.join(',')})`;
    });
    await pg.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict}`,
      params,
    );
    done += chunk.length;
    if (done % 50000 < BATCH) log(`  ${table}: ${done}/${rows.length}`);
  }
  return done;
}

const bool = (v) => (v === null || v === undefined ? null : !!v);
const int = (v) => (v === null || v === undefined ? null : Number(v));


/** Pass through text that is already a JSON array; wrap a real array; else NULL.
 *  Guards the double-encoding bug described at the call site. */
function jsonArr(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  const s = String(v).trim();
  if (!s.startsWith('[') && !s.startsWith('{')) return null;
  try { JSON.parse(s); return s; } catch { return null; }
}

let tsDropped = 0;
/** Coerce a SQLite timestamp to something Postgres will accept, or NULL.
 *
 *  SQLite is untyped, so a column declared TIMESTAMP happily stores whatever the scraper
 *  put there. 286,663 rows (20% of the corpus) hold the ATS's UI label rather than a date:
 *  "Posted 30+ Days Ago", "Posted Today", "Posted 2 Days Ago". Postgres rejects them, which
 *  is how this was found at all.
 *
 *  These are NULLED, not parsed. Turning "Posted 8 Days Ago" into first_seen_at minus eight
 *  days would invent a precision the source never had, and the migration is not the place to
 *  manufacture data. It costs nothing real: `posted_at` drives no query, and freshness keys
 *  off first_seen_at (which is populated for 100% of rows and is the only column that can be
 *  trusted for it).
 *
 *  Note the sibling `posted_date` is NOT a safe fallback for these rows — spot-checked, it
 *  holds the SCRAPE date, not the posting date ("Posted 8 Days Ago" -> posted_date == the
 *  first_seen date). Same corruption, in a column whose type happened to accept it. */
function ts(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  // ISO-8601-ish only: YYYY-MM-DD, optionally with a time part.
  if (!/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s)) { tsDropped++; return null; }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) { tsDropped++; return null; }
  return s;
}

async function main() {
  // DATABASE_URL is how every other process in this container reaches Postgres; using it
  // keeps the loader on the same credentials and role as the app rather than inventing a
  // second connection story that works here and nowhere else.
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — run this inside the api container');
  }
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  // The loader legitimately writes rows for MANY users, so it runs as operator rather than
  // impersonating each sub. This is the one context where crossing the RLS boundary is
  // correct -- and it is exactly why the isolation test afterwards must run as a plain user.
  await pg.query(`SELECT set_config('oshal.is_operator','on',false)`);

  const users = ONLY_USER ? [ONLY_USER] : listUsers();
  log(`users: ${users.length}${ONLY_USER ? ` (restricted to ${ONLY_USER})` : ''}`);
  if (DRY) log('DRY RUN — no writes');

  // ── shared corpus (read through the first user's attach) ───────────────────
  const probe = openUser(users[0]);
  if (!probe) throw new Error(`no store for ${users[0]}`);

  const companies = probe.prepare('SELECT * FROM corpus.companies').all();
  log(`companies: ${companies.length}`);
  if (!DRY) {
    await insertBatched(
      pg, 'career_companies',
      ['id', 'name', 'ticker', 'domain', 'homepage', 'careers_url', 'ats_type', 'ats_token',
        'industry', 'hq', 'discover_status', 'gsearched', 'referral', 'source_lists', 'last_scraped_at'],
      companies.map((c) => ({
        id: c.id, name: c.name, ticker: c.ticker, domain: c.domain, homepage: c.homepage,
        careers_url: c.careers_url, ats_type: c.ats_type, ats_token: c.ats_token,
        industry: c.industry, hq: c.hq, discover_status: c.discover_status,
        gsearched: bool(c.gsearched), referral: int(c.referral) || 0,
        source_lists: c.source_lists || null, last_scraped_at: ts(c.last_scraped_at),
      })),
      'ON CONFLICT (id) DO NOTHING',
    );
  }

  const nPost = probe.prepare('SELECT COUNT(*) n FROM corpus.postings_corpus').get().n;
  log(`postings: ${nPost}`);
  if (!DRY) {
    const stmt = probe.prepare('SELECT * FROM corpus.postings_corpus LIMIT ? OFFSET ?');
    for (let off = 0; off < nPost; off += 20000) {
      const rows = stmt.all(20000, off);
      await insertBatched(
        pg, 'career_postings',
        ['id', 'company_id', 'ats_job_id', 'title', 'description', 'url', 'location', 'city',
          'state', 'lat', 'lon', 'remote', 'department', 'job_type', 'salary_min', 'salary_max',
          'salary_currency', 'salary_period', 'salary_raw', 'salary_source', 'posted_at',
          'posted_date', 'first_seen_at', 'last_seen_at', 'active'],
        rows.map((p) => ({
          id: p.id, company_id: p.company_id, ats_job_id: String(p.ats_job_id ?? ''),
          title: p.title || '(untitled)', description: p.description, url: p.url,
          location: p.location, city: p.city, state: p.state, lat: p.lat, lon: p.lon,
          remote: bool(p.remote), department: p.department, job_type: p.job_type,
          salary_min: p.salary_min, salary_max: p.salary_max, salary_currency: p.salary_currency,
          salary_period: p.salary_period, salary_raw: p.salary_raw, salary_source: p.salary_source,
          posted_at: ts(p.posted_at), posted_date: ts(p.posted_date),
          first_seen_at: ts(p.first_seen_at), last_seen_at: ts(p.last_seen_at),
          active: bool(p.active),
        })),
        'ON CONFLICT (id) DO NOTHING',
      );
      log(`  postings ${Math.min(off + 20000, nPost)}/${nPost}`);
    }
  }
  probe.close();

  // ── per-user ───────────────────────────────────────────────────────────────
  const summary = [];
  for (const sub of users) {
    const db = openUser(sub);
    if (!db) { log(`skip ${sub} (no db)`); continue; }

    // target_role lives on the shared corpus in SQLite but is a per-user judgement, so it is
    // joined in here and written into the per-user scores row.
    const nSig = db.prepare('SELECT COUNT(*) n FROM user_signals').get().n;
    // The candidate query INNER JOINs signals to the corpus, so a signal whose posting_id no
    // longer resolves is dropped. That is correct — a score for a posting that does not exist
    // is unreachable — but it must never be SILENT. User ...517 came out 14,937 rows short and
    // the loader reported success; every one turned out to be an orphan carrying no AI score,
    // no applied_at and no status, but nothing in the output said so. Count it, print it, and
    // say whether any of the dropped rows carried real work.
    const nOrphan = db.prepare(
      'SELECT COUNT(*) n FROM user_signals s LEFT JOIN corpus.postings_corpus p ' +
      'ON p.id = s.posting_id WHERE p.id IS NULL').get().n;
    const nOrphanReal = nOrphan === 0 ? 0 : db.prepare(
      "SELECT COUNT(*) n FROM user_signals s LEFT JOIN corpus.postings_corpus p " +
      "ON p.id = s.posting_id WHERE p.id IS NULL AND (s.ai_fit_score IS NOT NULL " +
      "OR s.applied_at IS NOT NULL OR s.status NOT IN ('new',''))").get().n;
    if (nOrphan) {
      log(`  ${sub}: ${nOrphan} orphaned signal(s) skipped (posting_id not in corpus)` +
          `${nOrphanReal ? ` -- WARNING: ${nOrphanReal} of them carry real work` : ' -- none carry real work'}`);
    }
    let scores = 0, apps = 0;

    if (!DRY && nSig) {
      const stmt = db.prepare(`
        SELECT s.*, COALESCE(p.target_role,0) AS target_role
          FROM user_signals s JOIN corpus.postings_corpus p ON p.id = s.posting_id
         LIMIT ? OFFSET ?`);
      for (let off = 0; off < nSig; off += 20000) {
        const rows = stmt.all(20000, off);
        scores += await insertBatched(
          pg, 'career_user_job_scores',
          ['user_sub', 'posting_id', 'fit_score', 'target_role', 'ai_fit_score',
            'ai_fit_rationale', 'ai_fit_matched', 'ai_fit_gaps', 'ai_model', 'ai_scored_at'],
          rows.map((s) => ({
            user_sub: sub, posting_id: s.posting_id, fit_score: int(s.fit_score),
            target_role: bool(s.target_role), ai_fit_score: int(s.ai_fit_score),
            ai_fit_rationale: s.ai_fit_rationale,
            // NOT JSON.stringify(): SQLite stores these as TEXT that ALREADY holds a JSON
            // array, so stringifying produced a jsonb *string* containing JSON rather than a
            // jsonb array — 84,962 rows landed double-encoded before this was caught by
            // `select jsonb_typeof(...)`. Postgres accepted it silently because a JSON string
            // is perfectly valid jsonb; only the TYPE was wrong, so nothing errored and
            // json.loads() downstream would have returned a str instead of a list.
            ai_fit_matched: jsonArr(s.ai_fit_matched),
            ai_fit_gaps: jsonArr(s.ai_fit_gaps),
            ai_model: s.ai_model, ai_scored_at: ts(s.ai_scored_at),
          })),
          // DO UPDATE, not DO NOTHING. Insert-only meant a re-run could add new rows but
          // never refresh changed ones: the nightly chain writes ai_fit_score onto EXISTING
          // signal rows, and a "re-sync" silently skipped every one of them. Postgres sat at
          // 431 rows with ai>=70 while SQLite had 616, and 316 rows still showed ai NULL
          // against a keyword score over 70. The loader looked like it had converged.
          'ON CONFLICT (user_sub, posting_id) DO UPDATE SET ' +
            'fit_score = EXCLUDED.fit_score, target_role = EXCLUDED.target_role, ' +
            'ai_fit_score = EXCLUDED.ai_fit_score, ai_fit_rationale = EXCLUDED.ai_fit_rationale, ' +
            'ai_fit_matched = EXCLUDED.ai_fit_matched, ai_fit_gaps = EXCLUDED.ai_fit_gaps, ' +
            'ai_model = EXCLUDED.ai_model, ai_scored_at = EXCLUDED.ai_scored_at',
        );
        // Only rows carrying real application state become application rows. Writing all
        // 1.28M would duplicate the corpus for no information.
        const appRows = rows.filter(
          (s) => (s.status && s.status !== 'new') || s.applied_at || s.resume_path ||
                 s.cover_path || s.generated_at || s.promoted_at || s.outreach_sent_at ||
                 s.confirmation_path || s.notes,
        );
        apps += await insertBatched(
          pg, 'career_user_applications',
          ['user_sub', 'posting_id', 'status', 'resume_path', 'cover_path', 'promoted_at',
            'generated_at', 'outreach_sent_at', 'applied_at', 'notes', 'apply_active',
            'confirmation_path'],
          appRows.map((s) => ({
            user_sub: sub, posting_id: s.posting_id, status: s.status || 'new',
            resume_path: s.resume_path, cover_path: s.cover_path, promoted_at: ts(s.promoted_at),
            generated_at: ts(s.generated_at), outreach_sent_at: ts(s.outreach_sent_at),
            applied_at: ts(s.applied_at), notes: s.notes,
            apply_active: s.apply_active === null || s.apply_active === undefined ? 1 : int(s.apply_active),
            confirmation_path: s.confirmation_path,
          })),
          // Same reasoning as the scores upsert above: status and the lifecycle timestamps
          // change on rows that already exist.
          'ON CONFLICT (user_sub, posting_id) DO UPDATE SET ' +
            'status = EXCLUDED.status, resume_path = EXCLUDED.resume_path, ' +
            'cover_path = EXCLUDED.cover_path, promoted_at = EXCLUDED.promoted_at, ' +
            'generated_at = EXCLUDED.generated_at, outreach_sent_at = EXCLUDED.outreach_sent_at, ' +
            'applied_at = EXCLUDED.applied_at, notes = EXCLUDED.notes, ' +
            'apply_active = EXCLUDED.apply_active, confirmation_path = EXCLUDED.confirmation_path',
        );
      }
    }

    const rf = db.prepare('SELECT * FROM recruiter_firms').all();
    if (!DRY && rf.length) {
      await insertBatched(
        pg, 'career_user_recruiter_firms',
        ['user_sub', 'id', 'firm', 'bucket', 'website', 'contact_name', 'contact_role', 'contact_link',
          'resume_label', 'channel', 'status', 'date_contacted', 'followup_date', 'next_action',
          'notes', 'sort_order'],
        rf.filter((r) => r.firm).map((r) => ({
          user_sub: sub, id: r.id, firm: r.firm, bucket: r.bucket ?? null, website: r.website ?? null,
          contact_name: r.contact_name ?? null, contact_role: r.contact_role ?? null,
          contact_link: r.contact_link ?? null, resume_label: r.resume_label ?? null,
          channel: r.channel ?? null, status: r.status ?? null,
          date_contacted: r.date_contacted ?? null, followup_date: r.followup_date ?? null,
          next_action: r.next_action ?? null, notes: r.notes ?? null,
          sort_order: int(r.sort_order),
        })),
        'ON CONFLICT (user_sub, id) DO NOTHING',
      );
    }

    const gt = db.prepare('SELECT * FROM gap_themes').all();
    if (!DRY && gt.length) {
      await insertBatched(
        pg, 'career_user_gap_themes',
        ['user_sub', 'key', 'n_jobs', 'avg_fit', 'sample_gaps', 'status', 'response', 'answered_at'],
        gt.filter((g) => g.key).map((g) => ({
          user_sub: sub, key: g.key, n_jobs: int(g.n_jobs), avg_fit: int(g.avg_fit),
          sample_gaps: g.sample_gaps ?? null, status: g.status ?? null,
          response: g.response ?? null, answered_at: ts(g.answered_at),
        })),
        'ON CONFLICT (user_sub, key) DO NOTHING',
      );
    }

    const ia = db.prepare('SELECT * FROM interview_assessments').all();
    if (!DRY && ia.length) {
      await insertBatched(
        pg, 'career_user_interview_assessments',
        ['user_sub', 'at', 'company', 'role', 'transcript', 'answers', 'result', 'finalized'],
        ia.map((a) => ({
          user_sub: sub, at: ts(a.at), company: a.company ?? null, role: a.role ?? null,
          transcript: a.transcript ?? null, answers: a.answers ?? null,
          result: a.result ?? null, finalized: int(a.finalized) || 0,
        })),
        'ON CONFLICT DO NOTHING',
      );
    }

    summary.push({ sub, signals: nSig, orphans: nOrphan, orphansWithWork: nOrphanReal, scores, apps, recruiters: rf.length, gaps: gt.length });
    log(`${sub}: signals=${nSig} scores=${scores} apps=${apps} recruiters=${rf.length} gaps=${gt.length}`);
    db.close();
  }

  // Advance the BIGSERIAL sequences past the preserved ids, or the next insert collides.
  if (!DRY) {
    for (const [t, c] of [['career_companies', 'id'], ['career_postings', 'id']]) {
      await pg.query(
        `SELECT setval(pg_get_serial_sequence('${t}','${c}'), GREATEST((SELECT COALESCE(MAX(${c}),0) FROM ${t}), 1))`,
      );
    }
    log('sequences advanced past preserved ids');
    await pg.query('ANALYZE career_postings');
    await pg.query('ANALYZE career_user_job_scores');
    await pg.query('ANALYZE career_user_applications');
    log('ANALYZE done');
  }

  console.log('\nSUMMARY');
  for (const s of summary) console.log(' ', JSON.stringify(s));
  await pg.end();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
