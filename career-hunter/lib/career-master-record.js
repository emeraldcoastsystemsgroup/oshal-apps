/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The master record (1.51.0, Roger 2026-11-09: "give me every bullet and skill with the addendum history"). One read of everything Career keeps for a person: every role with its numbered bullets, skills and stories, skills by group, additional experience, education and certifications, evidence, the dated history of what was added with the person's own words, Strengthen answers and snapshot dates, and the documents kept outside Career. It is rendered once as Markdown (the page's Download) and served to the concierge as pages of at most 12 KB that together are that Markdown. It reads only the caller's own folder: no write, no engine run, no model. A link or an oversized file is refused, never followed. Career's private writing notes (framing notes, gaps to collect, locked facts) stay on screen and out of the Markdown until Roger decides (plan section 5, question 3).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. What a person reads names the pages as they are now called: other experience, the answers on Improve it, and Saved from My résumé. Words only; what is read and how is unchanged.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.55.0: the page is named Improve my résumé. "Improve it" says nothing where the name stands alone (the workspace group's toolbar, the cockpit's main menu, a sentence that sends a person there); the line about answers that could not be read says the whole name.
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Database = require('better-sqlite3');

const MIB = 1024 * 1024;
/** The ceilings Career's own writers keep: profile.py (4 MiB profile, 1 MiB history) and career-experience-bank.js (512 KiB). */
const LIMITS = Object.freeze({ profile: 4 * MIB, history: MIB, bank: 512 * 1024, themes: 512 * 1024 });
/** A concierge page, the whole JSON answer, is at most this many bytes (the master-section page size). */
const PAGE_BYTES = 12 * 1024;
const LINK = '/cockpit/?app=career-hunter&screen=career-master-record';
/** What profile.replace_resume_fields records as the words of a Resume Studio save: a label, not the person's words. */
const STUDIO_SAVE = 'resume-studio master edit';
const PORTFOLIO_ID = 'saved-portfolio';
const SNAPSHOT = /^career_db\.(\d{8}-\d{6}(?:-\d{6})?)\.json$/;
const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;
const THEMES_SOURCE = path.join(__dirname, '..', 'engine', 'jobhunter', 'gaps.py');
const KINDS = Object.freeze({ project: 'Independent project / product', work: 'Additional employment', volunteer: 'Volunteer work', skills: 'Additional skills' });
const LABEL = Object.freeze({
  profile: 'Your saved career profile', history: 'Your history of what you added', bank: 'Your other experience',
  snapshots: 'Your snapshot folder', strengthen: 'Your answers on Improve my résumé',
});

const refuse = (message) => Object.assign(new Error(message), { status: 503, code: 'master_record_unavailable' });
const text = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const list = (v) => (Array.isArray(v) ? v : []);
const texts = (v) => list(v).map(text).filter(Boolean);
const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const httpUrl = (v) => (/^https?:\/\/\S+$/i.test(text(v)) ? text(v) : '');
const join = (parts, glue) => parts.filter(Boolean).join(glue);
const human = (key) => text(key).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * One regular file of the person's own folder, at most `limit` bytes; absent is null. A link, a folder
 * or an oversized file is refused before a byte is read, and the open itself never follows a link.
 */
function readOwnFile(dir, name, limit, label) {
  const file = path.join(dir, name);
  let stat;
  try { stat = fs.lstatSync(file); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw refuse(`${label} could not be read.`);
  }
  if (stat.isSymbolicLink()) throw refuse(`${label} is a link, so it was not read.`);
  if (!stat.isFile()) throw refuse(`${label} is not a regular file, so it was not read.`);
  if (stat.size > limit) throw refuse(`${label} is larger than Career keeps, so it was not read.`);
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch {
    throw refuse(`${label} could not be read.`);
  }
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino) throw refuse(`${label} changed while it was read.`);
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) throw refuse(`${label} is larger than Career keeps, so it was not read.`);
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** The JSON a file holds; malformed is refused (a record that silently drops a source is not a record). */
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw refuse(`${label} could not be read.`); }
}

/** "20261109-023536-891855" as "2026-11-09 02:35:36"; anything else is shown as recorded. */
function stampWhen(at) {
  const m = STAMP.exec(text(at));
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : text(at);
}

/** An ISO instant as "2026-08-11 14:02:09 UTC"; anything else is shown as recorded. */
function isoWhen(at) {
  const ms = Date.parse(text(at));
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC` : text(at);
}

function storiesOf(role) {
  return list(role.stories).map(record).map((s) => ({
    title: text(s.title), story: text(s.story), bullet: text(s.bullet), weak: s.weak === true,
  })).filter((s) => s.story);
}

function experienceOf(raw) {
  return list(raw.roles).map(record).map((role) => ({
    title: text(role.title), org: text(role.org), start: text(role.start), end: text(role.end),
    bullets: texts(role.deliverables), skills: texts(role.skills), stories: storiesOf(role), notPublic: role.public === false,
  }));
}

function skillsOf(raw) {
  if (Array.isArray(raw.skills)) return [{ group: 'Skills', proficiency: '', note: '', items: texts(raw.skills) }];
  return Object.entries(record(raw.skills)).map(([group, entry]) => ({
    group: text(group) || 'Skills', proficiency: text(record(entry).proficiency), note: text(record(entry).note),
    items: texts(record(entry).items),
  }));
}

/** The person's saved independent portfolio, the one entry the library makes from the master itself. */
function portfolioEntry(portfolio) {
  const entry = record(portfolio.entry);
  return {
    id: PORTFOLIO_ID, title: text(portfolio.name) || text(entry.org) || text(portfolio.label) || 'Saved independent work',
    role: text(entry.title), kind: KINDS.project, organization: text(entry.org), period: text(entry.span),
    summary: text(portfolio.scoring_blurb), bullets: texts(entry.bullets), facts: '', skills: texts(portfolio.skills),
    tech: texts(entry.tech), applications: texts(entry.applications),
    links: ['person_url', 'platform_url', 'product_url'].map((key) => httpUrl(entry[key])).filter(Boolean),
    archived: false, source: 'Saved career portfolio',
  };
}

function bankEntry(entry) {
  return {
    id: text(entry.id), title: text(entry.title), role: '', kind: KINDS[entry.kind] || text(entry.kind),
    organization: text(entry.organization), period: text(entry.period), summary: '', bullets: [], facts: text(entry.facts),
    skills: texts(entry.skills), tech: [], applications: [], links: [], archived: entry.archived === true,
    source: text(entry.source) || 'Your recorded work',
  };
}

/** The additional experience library exactly as its screen lists it: its own file, then the saved portfolio. */
function additionalOf(dir, raw) {
  const bytes = readOwnFile(dir, 'experience-bank.json', LIMITS.bank, LABEL.bank);
  const entries = [];
  if (bytes) {
    const data = record(parseJson(bytes, LABEL.bank));
    if (data.version !== 1 || !Array.isArray(data.entries)) throw refuse(`${LABEL.bank} could not be read.`);
    entries.push(...data.entries.map(record).map(bankEntry));
  }
  const portfolio = record(raw.oss_portfolio);
  if (!entries.some((e) => e.id === PORTFOLIO_ID) && Object.keys(portfolio).length) entries.unshift(portfolioEntry(portfolio));
  return { entries, bytes: bytes || Buffer.alloc(0) };
}

/** Every scalar or list value of an item whose shape no section names, so nothing saved is dropped. */
function genericLine(item) {
  return join(Object.entries(record(item)).filter(([key]) => !key.startsWith('_') && !['id', 'public', 'confidence'].includes(key))
    .map(([, value]) => (Array.isArray(value) ? texts(value).join(', ') : text(value))), ' · ');
}

/** A text item as it is; an object item through its section's format, or every value when that format finds none. */
const lineOf = (format) => (item) => (item && typeof item === 'object' ? format(record(item)) || genericLine(item) : text(item));

const qualificationLine = lineOf((e) => {
  const span = join([text(e.start), text(e.end)], '–'), head = join([text(e.degree), text(e.school)], ' — ');
  return head ? join([head + (span ? ` (${span})` : ''), text(e.note)], '. ') : '';
});

const projectLine = lineOf((p) => {
  const months = text(p.duration_months);
  const head = join([text(p.project), join([text(p.role), text(p.industry), months && `${months} months`], ' · ')], ' — ');
  return head ? join([head, texts(p.tech).length ? `Technology: ${texts(p.tech).join(', ')}` : '',
    p.public === false ? '(marked not public)' : ''], '. ') : '';
});

const speakingLine = lineOf((s) => {
  const head = join([text(s.event), join([text(s.topic), text(s.location), text(s.year)], ' · ')], ' — ');
  return head ? join([head, text(s.note)], '. ') : '';
});

const employerLine = lineOf((e) => {
  const unconfirmed = text(e.confidence) && text(e.confidence) !== 'confirmed';
  const head = join([text(e.name), join([text(e.industry), text(e.location), text(e.span)], ' · ')], ' — ');
  return head ? join([head, text(e.note), unconfirmed ? `(${human(e.confidence).toLowerCase()})` : '',
    e.public === false ? '(marked not public)' : ''], '. ') : '';
});

function evidenceOf(raw) {
  return {
    metrics: list(raw.metrics_bank).map(lineOf(() => '')).filter(Boolean),
    projects: list(raw.project_ledger).map(projectLine).filter(Boolean),
    accounts: Object.entries(record(raw.named_accounts)).map(([group, items]) => ({ group: human(group), items: texts(items) })),
    speaking: list(raw.speaking).map(speakingLine).filter(Boolean),
    employers: list(raw.employers).map(employerLine).filter(Boolean),
  };
}

/** The dated history of what was added (profile.augment's audit), newest first. */
function historyOf(dir) {
  const bytes = readOwnFile(dir, 'enrichment_log.jsonl', LIMITS.history, LABEL.history);
  const records = [];
  let unreadable = 0;
  (bytes ? bytes.toString('utf8').split('\n') : []).forEach((line, index) => {
    if (!line.trim()) return;
    let item;
    try { item = JSON.parse(line); } catch { unreadable += 1; return; }
    if (!item || typeof item !== 'object' || typeof item.at !== 'string') { unreadable += 1; return; }
    const words = text(item.facts), studio = words === STUDIO_SAVE;
    records.push({ index, at: item.at, when: stampWhen(item.at), source: studio ? 'Saved from My résumé' : text(item.source),
      added: texts(item.changelog), words: studio ? '' : words });
  });
  records.sort((a, b) => (a.at === b.at ? b.index - a.index : a.at < b.at ? 1 : -1));
  return { records: records.map(({ index, ...rest }) => rest), unreadable, bytes: bytes || Buffer.alloc(0) };
}

/** Snapshot dates only: the copies taken before a change are listed by name and never opened. */
function snapshotsOf(dir) {
  const folder = path.join(dir, 'backups');
  let stat;
  try { stat = fs.lstatSync(folder); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw refuse(`${LABEL.snapshots} could not be read.`);
  }
  if (!stat.isDirectory()) throw refuse(`${LABEL.snapshots} is not a folder, so it was not read.`);
  return fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && SNAPSHOT.test(entry.name))
    .map((entry) => SNAPSHOT.exec(entry.name)[1]).sort().reverse().map((at) => ({ at, when: stampWhen(at) }));
}

let themeTitles = null;
/**
 * Strengthen's theme names, read once from the engine's own taxonomy (engine/jobhunter/gaps.py THEMES),
 * so an answer shows under the name its screen uses. Without that file an answer shows its theme key.
 */
function themes() {
  if (themeTitles) return themeTitles;
  let source = '';
  try { source = fs.statSync(THEMES_SOURCE).size <= LIMITS.themes ? fs.readFileSync(THEMES_SOURCE, 'utf8') : ''; } catch { source = ''; }
  const pairs = [...source.matchAll(/\{"key": "([^"\\]+)", "title": "((?:[^"\\]|\\.)*)"/g)];
  themeTitles = new Map(pairs.map((m) => [m[1], m[2].replace(/\\(.)/g, '$1')]));
  return themeTitles;
}

/**
 * The owner database, read-only. On the native kernel's read-only pin, a database with no pending
 * write-ahead log opens immutable (no lock, no -shm), as native-career-read.js opens it.
 */
function openOwnerDatabase(userDb) {
  const wal = `${userDb}-wal`, pending = fs.existsSync(wal) && fs.lstatSync(wal).size > 0;
  const immutable = process.env.OSHAL_CAREER_OWNER_MOUNT === '1' && !pending;
  try { return new Database(immutable ? `${pathToFileURL(userDb).href}?immutable=1` : userDb, { readonly: true }); } catch {
    throw refuse(`${LABEL.strengthen} could not be read.`);
  }
}

/** The Strengthen answers the person wrote (gap_themes rows marked answered), newest first. */
function strengthenOf(userDb) {
  if (!userDb) return [];
  let stat;
  try { stat = fs.lstatSync(userDb); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw refuse(`${LABEL.strengthen} could not be read.`);
  }
  if (!stat.isFile()) throw refuse(`${LABEL.strengthen} could not be read.`);
  const titles = themes(), db = openOwnerDatabase(userDb);
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gap_themes'").get()) return [];
    return db.prepare("SELECT key, response, answered_at FROM gap_themes WHERE status = 'answered' ORDER BY answered_at DESC, key").all()
      .map((row) => ({ at: text(row.answered_at), when: isoWhen(row.answered_at), theme: titles.get(row.key) || text(row.key),
        answer: text(row.response) }));
  } catch (err) {
    if (err?.code === 'master_record_unavailable') throw err;
    throw refuse(`${LABEL.strengthen} could not be read.`);
  } finally { db.close(); }
}

function personOf(raw) {
  const p = record(raw.profile), web = record(p.web_presence);
  return {
    name: text(p.name), credential: text(p.credential), headline: text(p.headline), location: text(p.location),
    citizenship: text(p.citizenship), clearance: text(p.clearance), email: text(p.email), phone: text(p.phone),
    linkedin: text(p.linkedin), summary: text(p.experience_summary), headlineOptions: texts(p.headline_options),
    links: ['person', 'platform', 'product'].map((key) => record(web[key])).map((link) => ({ label: text(link.label), url: httpUrl(link.url) }))
      .filter((link) => link.url),
  };
}

/** The documents the profile links that live outside Career (the résumé and the detailed work addendum). */
function linkedOf(raw) {
  const web = record(record(raw.profile).web_presence);
  return [['resume', 'Your résumé'], ['addendum', 'Detailed work addendum']]
    .map(([key, label]) => ({ label, url: httpUrl(web[key]), note: 'Kept outside Career' })).filter((doc) => doc.url);
}

/** Career's private writing notes: shown on the page only, never in the Markdown or a concierge page. */
function notesOf(raw) {
  return {
    framing: texts(raw.framing_notes), gaps: texts(raw.gaps_to_collect),
    locked: Object.entries(record(raw.locked_facts)).map(([name, fact]) => ({
      name: human(name), display: text(record(fact).display), scope: text(record(fact).scope),
    })),
  };
}

function countsOf(r) {
  const sum = (items, key) => items.reduce((n, item) => n + item[key].length, 0);
  return {
    roles: r.experience.length, bullets: sum(r.experience, 'bullets'), roleSkills: sum(r.experience, 'skills'),
    stories: sum(r.experience, 'stories'), skills: sum(r.skills, 'items'), skillGroups: r.skills.length,
    competencies: r.competencies.length, headlineOptions: r.person.headlineOptions.length, additional: r.additional.length,
    education: r.education.length, certifications: r.certifications.length, licenses: r.licenses.length,
    metrics: r.evidence.metrics.length, projects: r.evidence.projects.length, accountGroups: r.evidence.accounts.length,
    accounts: sum(r.evidence.accounts, 'items'), speaking: r.evidence.speaking.length, employers: r.evidence.employers.length,
    history: r.history.length, unreadableHistory: r.unreadableHistory, strengthenAnswers: r.strengthen.length,
    strengthenThemes: themes().size, snapshots: r.snapshots.length, linked: r.linked.length,
    framingNotes: r.notes.framing.length, gapsToCollect: r.notes.gaps.length, lockedFacts: r.notes.locked.length,
  };
}

/**
 * @description Read everything Career keeps for one person into one record. Only the caller's own
 * folder is read (the route resolves it from the caller's subject); nothing is written, no engine
 * runs and no model is called. A link or an oversized source refuses the whole record (status 503)
 * rather than showing a record that silently lacks it.
 * @param {{userDir: string, userDb?: string}|null} paths The caller's store, or null when the caller has none yet.
 * @returns {object} The record: person, experience, skills, additional, qualifications, evidence,
 *   history, strengthen, snapshots, linked documents, on-screen notes, counts, revision and markdown.
 */
function readMasterRecord(paths) {
  const dir = paths && paths.userDir;
  const profile = dir ? readOwnFile(dir, 'career_db.json', LIMITS.profile, LABEL.profile) : null;
  const raw = profile ? record(parseJson(profile, LABEL.profile)) : {};
  const additional = dir ? additionalOf(dir, raw) : { entries: [], bytes: Buffer.alloc(0) };
  const history = dir ? historyOf(dir) : { records: [], unreadable: 0, bytes: Buffer.alloc(0) };
  const r = {
    version: 1, link: LINK, asOf: new Date().toISOString(), present: Boolean(profile), person: personOf(raw),
    competencies: texts(raw.competencies), experience: experienceOf(raw), skills: skillsOf(raw), additional: additional.entries,
    education: list(raw.education).map(qualificationLine).filter(Boolean),
    certifications: list(raw.certifications).map(qualificationLine).filter(Boolean),
    licenses: list(raw.licenses).map(qualificationLine).filter(Boolean), evidence: evidenceOf(raw), history: history.records,
    unreadableHistory: history.unreadable, strengthen: dir ? strengthenOf(paths.userDb) : [], snapshots: dir ? snapshotsOf(dir) : [],
    linked: linkedOf(raw), notes: notesOf(raw),
  };
  r.counts = countsOf(r);
  r.revision = crypto.createHash('sha256').update(profile || Buffer.alloc(0)).update(history.bytes).update(additional.bytes)
    .update(JSON.stringify([r.strengthen, r.snapshots])).digest('hex');
  r.markdown = require('./career-master-record-markdown').toMarkdown(r);
  return r;
}

/** The encoded size of a string inside a JSON answer (escaping is per character, so sizes add up). */
const encodedSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') - 2;

function page(r, number, total, chunk) {
  return { link: LINK, revision: r.revision, counts: r.counts, page: number, pages: total, nextPage: number < total ? number + 1 : null, text: chunk };
}

/** Cut one line longer than a page into code-point pieces that each fit. */
function splitLine(line, budget) {
  const pieces = [];
  let piece = '', size = 0;
  for (const point of line) {
    const add = encodedSize(point);
    if (size + add > budget && piece) { pieces.push(piece); piece = ''; size = 0; }
    piece += point; size += add;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** The record's Markdown cut on line boundaries into chunks that each make a page of at most PAGE_BYTES. */
function chunksOf(r) {
  const budget = PAGE_BYTES - Buffer.byteLength(JSON.stringify(page(r, 99999, 99999, '')), 'utf8') - 16;
  const chunks = [];
  let chunk = '', size = 0;
  for (const line of r.markdown.split(/(?<=\n)/)) {
    for (const piece of encodedSize(line) > budget ? splitLine(line, budget) : [line]) {
      const add = encodedSize(piece);
      if (size + add > budget && chunk) { chunks.push(chunk); chunk = ''; size = 0; }
      chunk += piece; size += add;
    }
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks;
}

/**
 * @description One concierge page of the record: the counts, the page link and the next part of the
 * Markdown. The pages together are the Markdown, each item exactly once, and every page's whole JSON
 * answer is at most 12 KB.
 * @param {object} r A record from readMasterRecord.
 * @param {number} number The page, from 1.
 * @returns {object|null} The page, or null when the record has no such page.
 */
function pageOf(r, number) {
  const chunks = chunksOf(r);
  if (!Number.isInteger(number) || number < 1 || number > chunks.length) return null;
  return page(r, number, chunks.length, chunks[number - 1]);
}

module.exports = { readMasterRecord, pageOf, LINK, PAGE_BYTES, LIMITS };
