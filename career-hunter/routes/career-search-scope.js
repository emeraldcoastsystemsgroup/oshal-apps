"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_SCOPE_FILE = void 0;
exports.fullyRemoteSql = fullyRemoteSql;
exports.readJobSearchScope = readJobSearchScope;
exports.saveJobSearchScope = saveJobSearchScope;
exports.jobSearchScopeSql = jobSearchScopeSql;
/**
 * CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Recheck ambiguous legacy remote flags before radius bypass and keep genuine local matches eligible without rewriting shared postings.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retain an owner's local-radius and remote preference separately from the shared corpus and build the existing exact geographic predicate for their matched board.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const career_geo_1 = require("./career-geo");
const career_file_transaction_1 = require("./career-file-transaction");
exports.SEARCH_SCOPE_FILE = 'job-search-scope.json';
// Keep parity with engine/jobhunter/work_arrangement.py. Shared fixtures execute both SQLs.
const SEPARATORS = '!"#$&\'()*+,-./:;<=>?@[\\]^_`{|}~–—\t\n\r\u00a0\u202f\u2009';
const OCCUPATIONS = ['remote sensing', 'hybrid cloud', 'hybrid electric', 'hybrid vehicle'];
const DAYS = ['1 day', '2 days', '3 days', '4 days', '5 days', '6 days',
    'one day', 'two days', 'three days', 'four days', 'five days', 'six days'];
const CONFLICTS = ['hybrid', 'onsite', 'on site', 'in office', 'office based',
    'not remote', 'not a remote', 'non remote', 'nonremote', 'no remote', 'not fully remote', 'not 100% remote',
    'remote unavailable', 'remote not', 'remote is not', 'remote work not', 'remote work is not', 'remote work unavailable',
    'no work from home', 'not work from home', 'no telework', 'not telework',
    'telework not', 'partial remote', 'partially remote', 'occasional remote',
    ...DAYS.flatMap(days => [`remote ${days}`, `${days} remote`])];
const POSITIVES = ['remote', 'work from home', 'work from anywhere', 'telework', 'telecommute', 'anywhere'];
function workplaceWords(value) {
    for (const term of OCCUPATIONS)
        value = `REPLACE(${value},' ${term} ',' ')`;
    return value;
}
function containsWords(value, terms) {
    return '(' + terms.map(term => {
        const escaped = term.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
        return `${value} LIKE '% ${escaped} %' ESCAPE '!'`;
    }).join(' OR ') + ')';
}
/** Narrow legacy flags; occupational remote sensing needs independent location evidence. */
function fullyRemoteSql(alias = 'p') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))
        throw new Error('Invalid posting alias.');
    const fields = { title_words: `${alias}.title`, location_words: `${alias}.location`,
        words: `COALESCE(${alias}.title,'') || ' ' || COALESCE(${alias}.location,'')` };
    const stages = ['workplace0 AS (SELECT ' + Object.entries(fields)
            .map(([key, value]) => `LOWER(COALESCE(${value},'')) AS ${key}`).join(', ') + ')'];
    // Small CTE stages stay within SQLite's parser limit; no custom functions or writes.
    for (let offset = 0; offset < SEPARATORS.length; offset += 5) {
        const columns = Object.keys(fields).map(key => {
            let value = key;
            for (const separator of SEPARATORS.slice(offset, offset + 5))
                value = `REPLACE(${value},'${separator.replace(/'/g, "''")}',' ')`;
            return `${value} AS ${key}`;
        });
        stages.push(`workplace${stages.length} AS (SELECT ${columns.join(', ')} FROM workplace${stages.length - 1})`);
    }
    const columns = Object.keys(fields).map(key => {
        let value = key;
        for (let pass = 0; pass < 3; pass++)
            value = `REPLACE(${value},'  ',' ')`;
        return `(' ' || TRIM(${value}) || ' ') AS ${key}`;
    });
    stages.push(`workplace${stages.length} AS (SELECT ${columns.join(', ')} FROM workplace${stages.length - 1})`);
    // Normalize once per posting instead of repeating the expression for every LIKE.
    stages.push(`workplace AS MATERIALIZED (SELECT title_words, ${workplaceWords('location_words')} AS location_words, `
        + `${workplaceWords('words')} AS words FROM workplace${stages.length - 1})`);
    const conflicts = containsWords('workplace.words', CONFLICTS);
    const partial = "(workplace.words LIKE '%!%%' ESCAPE '!' AND REPLACE(workplace.words,'100%','') LIKE '%!%%' ESCAPE '!')";
    const occupational = containsWords('workplace.title_words', ['remote sensing']);
    const separate = containsWords('workplace.location_words', POSITIVES);
    return `(COALESCE(${alias}.remote,0)=1 AND EXISTS (WITH ${stages.join(', ')} SELECT 1 FROM workplace `
        + `WHERE (TRIM(workplace.words)='' OR workplace.words NOT LIKE '%  %') AND NOT ${conflicts} AND NOT ${partial} AND (NOT ${occupational} OR ${separate})))`;
}
function valid(value) {
    return value?.version === 1 && typeof value.near === 'string' && value.near.length > 0 && value.near.length <= 160
        && !/[\u0000-\u001f\u007f]/.test(value.near)
        && typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
        && typeof value.lon === 'number' && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180
        && typeof value.radiusMiles === 'number' && Number.isFinite(value.radiusMiles) && value.radiusMiles >= 1 && value.radiusMiles <= 250
        && typeof value.includeRemote === 'boolean';
}
/** Read only the exact owner's small preference file; unavailable preferences never widen a search. */
function readJobSearchScope(userDir) {
    const file = path_1.default.join(userDir, exports.SEARCH_SCOPE_FILE);
    try {
        const stat = fs_1.default.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048)
            throw new Error('Stored search scope is unavailable.');
        const value = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
        if (!valid(value))
            throw new Error('Stored search scope is unavailable.');
        return value;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
/** Resolve a city or ZIP offline and atomically save this caller's explicit hunt scope. */
async function saveJobSearchScope(userDir, input) {
    if (!input || typeof input.near !== 'string' || typeof input.radiusMiles !== 'number' || typeof input.includeRemote !== 'boolean') {
        throw new career_geo_1.CareerLocationError('Enter a city or ZIP, a radius from 1 to 250 miles, and your remote preference.');
    }
    const location = (0, career_geo_1.resolveCareerLocation)({ near: input.near, radius_miles: String(input.radiusMiles) });
    if (!location)
        throw new career_geo_1.CareerLocationError('Enter a city and state or ZIP for local work.');
    const value = { version: 1, near: location.label, lat: location.center.lat, lon: location.center.lon,
        radiusMiles: location.radius_miles, includeRemote: input.includeRemote };
    await fs_1.default.promises.mkdir(userDir, { recursive: true, mode: 0o700 });
    const file = path_1.default.join(userDir, exports.SEARCH_SCOPE_FILE);
    await (0, career_file_transaction_1.writeFileAtomicAsync)(file, JSON.stringify(value) + '\n');
    await fs_1.default.promises.chmod(file, 0o600);
    return value;
}
/** Remote jobs do not need local coordinates; local and hybrid jobs must satisfy the exact radius. */
function jobSearchScopeSql(scope, alias = 'p') {
    if (!valid(scope))
        throw new Error('Stored search scope is unavailable.');
    const local = (0, career_geo_1.careerRadiusPredicate)({ center: { lat: scope.lat, lon: scope.lon }, label: scope.near,
        radius_miles: scope.radiusMiles, accuracy: 'city-centroid' }, alias);
    const remote = fullyRemoteSql(alias);
    return scope.includeRemote ? `(${remote} OR (${local}))`
        : `(NOT ${remote} AND (${local}))`;
}
//# sourceMappingURL=career-search-scope.js.map