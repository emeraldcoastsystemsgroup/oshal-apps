/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The master record's fixtures (1.51.0): a made-up person's Career store written the way Career writes it (career_db.json, enrichment_log.jsonl, experience-bank.json, the owner database's gap_themes table and backups/ snapshots), with a marker on every item so a test can find each one exactly once, and better-sqlite3's read interface over node:sqlite as the native bridge serves it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * @description better-sqlite3's synchronous interface over node:sqlite, as the native bridge's
 * sqlite_compat serves it. Every open is recorded (file and read-only flag) for the isolation checks.
 * @param {Array<{filename:string, readonly:boolean}>} opened Receives one entry per open.
 * @returns {Function} The Database class to hand the code under test as 'better-sqlite3'.
 */
export function sqliteAdapter(opened = []) {
  return class SqliteAdapter {
    constructor(filename, options = {}) {
      opened.push({ filename: String(filename), readonly: Boolean(options.readonly) });
      this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly) });
    }
    prepare(sql) {
      const statement = this.db.prepare(sql);
      return { get: (...a) => statement.get(...a), all: (...a) => statement.all(...a), run: (...a) => statement.run(...a) };
    }
    exec(sql) { this.db.exec(sql); return this; }
    pragma(sql) { return this.prepare(`PRAGMA ${sql}`).all(); }
    close() { this.db.close(); }
  };
}

/**
 * @description A made-up person's career profile. Every bullet, skill and evidence line carries the
 * person's mark so a test can tell one person's record from another's.
 * @param {string} mark Upper-case marker, e.g. ALEX.
 * @returns {object} A career_db.json body.
 */
export function madeUpProfile(mark = 'ALEX') {
  return {
    _meta: { owner: `${mark} fixture` },
    profile: { name: `${mark} Fixture`, credential: `${mark} Fixture, PMP`, headline: `${mark} platform engineering leader`,
      location: 'Testville, FL', citizenship: 'US citizen', clearance: 'None stated', email: `${mark.toLowerCase()}@example.test`,
      phone: '555-0100', linkedin: `https://www.linkedin.com/in/${mark.toLowerCase()}-fixture`,
      experience_summary: `${mark}-SUMMARY builds platforms.\n\nLeads teams.`, headline_options: [`${mark}-HEADLINE-1`, `${mark}-HEADLINE-2`],
      web_presence: { person: { label: 'Portfolio', url: `https://${mark.toLowerCase()}.example.test` },
        resume: `https://${mark.toLowerCase()}.example.test/resume.pdf`, addendum: `https://${mark.toLowerCase()}.example.test/addendum.pdf` },
      application_contact: { address1: `${mark}-STREET 1 Fixture Way` } },
    roles: [
      { id: 'r1', title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null, skills: [`${mark}-ROLESKILL-Kubernetes`, `${mark}-ROLESKILL-Go`],
        deliverables: [`[${mark}-R1-B1] shipped the platform`, `[${mark}-R1-B2] cut deploys 60%`, `[${mark}-R1-B3] mentored 6 engineers`] },
      { id: 'r2', title: 'SRE', org: 'Beta Corp', start: '2015-05', end: '2018-12', public: false, skills: [`${mark}-ROLESKILL-Linux`],
        deliverables: [`[${mark}-R2-B1] ran on-call`, `[${mark}-R2-B2] wrote runbooks`],
        stories: [{ title: 'Outage', story: `${mark}-STORY restored service in 9 minutes`, bullet: `[${mark}-R2-B1] ran on-call` }] },
    ],
    skills: { Cloud: { items: [`${mark}-SKILL-AWS`, `${mark}-SKILL-Terraform`], proficiency: 'expert' }, Leadership: { items: [`${mark}-SKILL-Mentoring`] } },
    education: [{ degree: 'BS Computer Science', school: `${mark}-SCHOOL Fixture University`, start: 2001, end: 2005 }],
    certifications: [`${mark}-CERT PMP`],
    metrics_bank: [`${mark}-METRIC 60% faster deploys`],
    project_ledger: [{ project: `${mark}-PROJECT Atlas`, role: 'Lead', industry: 'Retail', tech: ['Go', 'Kafka'], duration_months: 18 }],
    named_accounts: { early_consulting: [`${mark}-ACCOUNT Initech`] },
    speaking: [{ event: `${mark}-TALK DevConf`, topic: 'Platforms', location: 'Austin', year: 2022 }],
    employers: [{ id: 'e1', name: `${mark}-EMPLOYER Acme`, industry: 'Retail', location: 'Remote', span: '2019-present', confidence: 'needs_confirmation' }],
    framing_notes: [`${mark}-NOTE frame the platform as a product`], gaps_to_collect: [`${mark}-GAP collect the deploy metric`],
    locked_facts: { program_revenue: { display: `${mark}-LOCKED $2M`, scope: 'program', value: 2000000, locked: true } },
    oss_portfolio: { _note: `${mark}-PRIVATE-NOTE`, label: 'Saved independent work',
      entry: { title: 'Founder', org: `${mark} Labs`, span: '2024-present', bullets: [`[${mark}-OSS-1] built the platform`, `[${mark}-OSS-2] shipped 12 apps`],
        tech: [`${mark}-TECH Rust`], applications: [`${mark}-APP Ledger`], product_url: `https://${mark.toLowerCase()}-labs.example.test` },
      skills: [`${mark}-OSSSKILL Rust`], scoring_blurb: `${mark}-BLURB independent platform work` },
  };
}

/** The dated history of what was added, oldest first as profile.augment appends it, plus one unreadable line. */
export function madeUpHistory(mark = 'ALEX') {
  return [
    JSON.stringify({ at: '20260605-101500', facts: `${mark}-WORDS first fact\nsecond line`, changelog: [`${mark}-ADDED a`, `${mark}-ADDED b`] }),
    JSON.stringify({ at: '20260615-090000', facts: `${mark}-WORDS second fact`, changelog: [`${mark}-ADDED c`], source: `${mark}-SOURCE review` }),
    '{not json',
    JSON.stringify({ at: '20261109-023536-891855', facts: 'resume-studio master edit', changelog: ['headline updated'] }),
  ].join('\n') + '\n';
}

/**
 * @description Write one person's store into `dir`, the files Career itself writes.
 * @param {string} dir The person's folder (created).
 * @param {object} [options] profile, history (text), bank (object), answers ([key, status, response, at]), snapshots (names), userDb (file name).
 * @returns {{userDir: string, userDb: string}} The paths the route resolves for this person.
 */
export function writeStore(dir, options = {}) {
  const mark = options.mark || 'ALEX';
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  if (options.profile !== null) fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(options.profile || madeUpProfile(mark), null, 2));
  if (options.history !== null) fs.writeFileSync(path.join(dir, 'enrichment_log.jsonl'), options.history ?? madeUpHistory(mark));
  if (options.bank !== null) {
    fs.writeFileSync(path.join(dir, 'experience-bank.json'), JSON.stringify(options.bank || { version: 1, entries: [{
      id: 'aaaaaaaa-0001', title: `${mark}-BANK Volunteer coach`, kind: 'volunteer', organization: 'Youth league', period: '2020',
      facts: `${mark}-BANKFACT coached 12 kids`, skills: [`${mark}-BANKSKILL Coaching`], archived: false, source: 'Your recorded work' }] }));
  }
  for (const name of options.snapshots || ['career_db.20261109-023536-891855.json', 'career_db.20261001-120000.json', 'notes.txt']) {
    fs.writeFileSync(path.join(dir, 'backups', name), '{}');
  }
  const userDb = path.join(dir, options.userDb || `user-${mark.toLowerCase()}.db`);
  if (options.answers !== null) {
    const db = new DatabaseSync(userDb);
    db.exec(`CREATE TABLE gap_themes (key TEXT PRIMARY KEY, n_jobs INTEGER DEFAULT 0, avg_fit INTEGER DEFAULT 0, sample_gaps TEXT,
      status TEXT DEFAULT 'open', response TEXT, answered_at TEXT, updated_at TEXT)`);
    const insert = db.prepare('INSERT INTO gap_themes (key, status, response, answered_at) VALUES (?, ?, ?, ?)');
    for (const row of options.answers || [['k8s', 'answered', `${mark}-ANSWER ran Kubernetes at scale`, '2026-08-11T14:02:09+00:00'], ['docker', 'open', null, null]]) insert.run(...row);
    db.close();
  }
  return { userDir: dir, userDb };
}

/**
 * @description Every file under a folder with its size, modification time and bytes, to prove a read wrote nothing.
 * @param {string} dir The folder.
 * @returns {Record<string, string>} Relative path to "size:mtimeMs:content(base64)".
 */
export function treeState(dir) {
  const state = {};
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), stat = fs.lstatSync(file);
      if (entry.isDirectory()) { state[path.relative(dir, file) + '/'] = `${stat.mtimeMs}`; walk(file); continue; }
      state[path.relative(dir, file)] = `${stat.size}:${stat.mtimeMs}:${entry.isFile() ? fs.readFileSync(file).toString('base64') : 'link'}`;
    }
  };
  walk(dir);
  return state;
}
