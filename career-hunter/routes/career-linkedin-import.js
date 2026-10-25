"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalLinkedInJob = canonicalLinkedInJob;
exports.parseLinkedInSavedJobs = parseLinkedInSavedJobs;
exports.readLinkedInSavedJobs = readLinkedInSavedJobs;
exports.importLinkedInSavedJobs = importLinkedInSavedJobs;
/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Parse bounded Saved Jobs CSV into caller-owned leads without an engine, profile mutation, shared corpus write or applied claim.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Normalize the optional provider prefix before matching export headers so source aliases remain ordinary field names.
 */
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const career_file_transaction_1 = require("./career-file-transaction");
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 32;
const MAX_FIELD = 4096;
const FILE_NAME = 'linkedin-saved-jobs.json';
/** An input refusal has an explicit HTTP status without including uploaded contents. */
function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}
/** Accept only LinkedIn HTTPS posting paths and discard query tracking and fragments. */
function canonicalLinkedInJob(value) {
    if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value))
        throw invalid('A job URL must be a LinkedIn HTTPS posting URL.');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw invalid('A job URL must be a LinkedIn HTTPS posting URL.');
    }
    const match = /^\/jobs\/view\/(?:[A-Za-z0-9_-]+-)?([0-9]{1,20})\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname)
        || url.username || url.password || url.port || !match)
        throw invalid('A job URL must be a LinkedIn HTTPS posting URL.');
    return { id: match[1], url: `https://www.linkedin.com/jobs/view/${match[1]}/` };
}
/** Read strict quoted CSV with bounded rows, columns and fields, including CRLF and escaped quotes. */
function csvRows(text) {
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    function fieldEnd() {
        row.push(field);
        field = '';
        closed = false;
        if (row.length > MAX_COLUMNS)
            throw invalid('Saved Jobs CSV exceeds 32 columns.', 413);
    }
    function rowEnd() {
        fieldEnd();
        if (row.some(value => value.trim()))
            rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS + 1)
            throw invalid('Saved Jobs CSV exceeds 500 rows.', 413);
    }
    for (let index = 0; index < text.length; index++) {
        const ch = text[index];
        if (quoted) {
            if (ch === '"' && text[index + 1] === '"') {
                field += '"';
                index++;
            }
            else if (ch === '"') {
                quoted = false;
                closed = true;
            }
            else
                field += ch;
        }
        else if (ch === ',')
            fieldEnd();
        else if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[index + 1] === '\n')
                index++;
            rowEnd();
        }
        else if (ch === '"' && !field && !closed)
            quoted = true;
        else {
            if (closed || ch === '"')
                throw invalid('Saved Jobs CSV has malformed quoting.');
            field += ch;
        }
        if (field.length > MAX_FIELD)
            throw invalid('Saved Jobs CSV has a field longer than 4096 characters.', 413);
    }
    if (quoted)
        throw invalid('Saved Jobs CSV has an unterminated quoted field.');
    if (field || row.length || closed)
        rowEnd();
    return rows;
}
/** Recognize the exported title, employer, posting URL and optional saved-date headers. */
function columns(header) {
    const aliases = {
        title: ['jobtitle', 'title', 'position', 'positiontitle'],
        company: ['companyname', 'company', 'employer', 'employername'],
        url: ['joburl', 'jobpostingurl', 'joblink', 'url', 'link'],
        savedAt: ['datesaved', 'saveddate', 'savedat', 'date'],
    };
    const result = {};
    for (const [name, names] of Object.entries(aliases)) {
        const matches = header.map((value, index) => names.includes(value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^linkedin/, '')) ? index : -1).filter(index => index >= 0);
        if (matches.length > 1)
            throw invalid('Saved Jobs CSV has ambiguous duplicate headers.');
        if (matches.length)
            result[name] = matches[0];
    }
    if (['title', 'company', 'url'].some(key => result[key] === undefined))
        throw invalid('Saved Jobs CSV requires job title, company name and job URL headers.');
    return result;
}
/** Parse one bounded CSV, deduplicating its leads by the canonical LinkedIn job ID. */
function parseLinkedInSavedJobs(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES)
        throw invalid('Saved Jobs CSV exceeds 2 MiB.', 413);
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    }
    catch {
        throw invalid('Saved Jobs CSV must be UTF-8 text.');
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
        throw invalid('Saved Jobs CSV contains unsupported control characters.');
    const rows = csvRows(text), header = rows.shift();
    if (!header)
        throw invalid('Saved Jobs CSV is empty.');
    const fields = columns(header), jobs = new Map();
    for (const row of rows) {
        if (row.length !== header.length)
            throw invalid('Saved Jobs CSV has inconsistent column counts.');
        const title = row[fields.title].trim(), company = row[fields.company].trim();
        if (!title || !company)
            throw invalid('Every saved job requires a title and company name.');
        const savedAt = fields.savedAt === undefined ? '' : row[fields.savedAt].trim();
        if (title.length > 500 || company.length > 500 || savedAt.length > 120)
            throw invalid('Saved job metadata exceeds its field limit.', 413);
        const posting = canonicalLinkedInJob(row[fields.url].trim());
        jobs.set(posting.id, { ...posting, title, company, ...(savedAt ? { savedAt } : {}) });
    }
    if (!jobs.size)
        throw invalid('Saved Jobs CSV contains no saved jobs.');
    return [...jobs.values()];
}
/** Assert the caller's already-resolved directory is regular and not redirected through a symlink. */
async function userRoot(userDir) {
    const root = path_1.default.resolve(userDir), entry = await fs_1.promises.lstat(root);
    if (!entry.isDirectory() || entry.isSymbolicLink() || await fs_1.promises.realpath(root) !== root)
        throw invalid('Saved jobs storage is unavailable.', 503);
    return root;
}
/** Validate persisted rows rather than accepting corrupted or unbounded stored objects. */
function storedJobs(bytes) {
    const body = JSON.parse(bytes.toString('utf8'));
    if (body.version !== 1 || !Array.isArray(body.jobs) || body.jobs.length > MAX_ROWS)
        throw invalid('Saved jobs storage is unavailable.', 503);
    const ids = new Set();
    return body.jobs.map(job => {
        const posting = canonicalLinkedInJob(job.url);
        if (posting.id !== job.id || ids.has(job.id) || typeof job.title !== 'string' || !job.title.trim() || job.title.length > 500
            || typeof job.company !== 'string' || !job.company.trim() || job.company.length > 500
            || (job.savedAt !== undefined && (typeof job.savedAt !== 'string' || job.savedAt.length > 120))
            || (job.importedAt !== undefined && (typeof job.importedAt !== 'string' || job.importedAt.length > 100)))
            throw invalid('Saved jobs storage is unavailable.', 503);
        ids.add(job.id);
        return { ...posting, title: job.title, company: job.company,
            ...(job.savedAt ? { savedAt: job.savedAt } : {}), ...(job.importedAt ? { importedAt: job.importedAt } : {}) };
    });
}
/** Read at most the owner-file ceiling through a no-follow descriptor; missing storage means no leads. */
async function readLinkedInSavedJobs(userDir) {
    let root;
    try {
        root = await userRoot(userDir);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const target = path_1.default.join(root, FILE_NAME);
    let handle;
    try {
        handle = await fs_1.promises.open(target, fs_1.constants.O_RDONLY | fs_1.constants.O_NOFOLLOW | fs_1.constants.O_NONBLOCK);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES)
            throw invalid('Saved jobs storage is unavailable.', 503);
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < bytes.length) {
            const part = await handle.read(bytes, length, bytes.length - length, length);
            if (!part.bytesRead)
                break;
            length += part.bytesRead;
        }
        const after = await handle.stat(), entry = await fs_1.promises.lstat(target);
        if (length > MAX_BYTES || length !== after.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
            || entry.dev !== after.dev || entry.ino !== after.ino || !entry.isFile())
            throw invalid('Saved jobs storage changed during read.', 503);
        try {
            return storedJobs(bytes.subarray(0, length));
        }
        catch {
            throw invalid('Saved jobs storage is unavailable.', 503);
        }
    }
    finally {
        await handle.close();
    }
}
/** Merge caller-owned leads while the route holds the user-store lease; identical repeats do not rewrite. */
async function importLinkedInSavedJobs(userDir, bytes) {
    const incoming = parseLinkedInSavedJobs(bytes);
    await fs_1.promises.mkdir(userDir, { recursive: true, mode: 0o700 });
    const root = await userRoot(userDir), existing = await readLinkedInSavedJobs(root);
    const jobs = new Map(existing.map(job => [job.id, job]));
    let added = 0, updated = 0;
    for (const job of incoming) {
        const old = jobs.get(job.id);
        if (!old) {
            added++;
            jobs.set(job.id, { ...job, importedAt: new Date().toISOString() });
        }
        else if (old.title !== job.title || old.company !== job.company || (old.savedAt || '') !== (job.savedAt || '')) {
            updated++;
            jobs.set(job.id, { ...job, ...(old.importedAt ? { importedAt: old.importedAt } : {}) });
        }
    }
    if (jobs.size > MAX_ROWS)
        throw invalid('Your saved-job library would exceed 500 leads.', 413);
    if (added || updated) {
        const target = path_1.default.join(root, FILE_NAME);
        const value = JSON.stringify({ version: 1, jobs: [...jobs.values()] }) + '\n';
        if (Buffer.byteLength(value) > MAX_BYTES)
            throw invalid('Your saved-job library exceeds 2 MiB.', 413);
        await (0, career_file_transaction_1.writeFileAtomicAsync)(target, value);
        await fs_1.promises.chmod(target, 0o600);
    }
    return { ok: true, imported: incoming.length, new: added, updated, total: jobs.size };
}
