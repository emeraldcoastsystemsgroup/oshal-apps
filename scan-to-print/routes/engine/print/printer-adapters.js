"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printer boundary, pluggable the way TTS
 *                     |                             | and LLM providers are (CLAUDE.md "TTS / voice is pluggable"):
 *                     |                             | one adapter interface, three network hosts behind it —
 *                     |                             | OctoPrint, Moonraker (Klipper) and PrusaLink — chosen because
 *                     |                             | they are the HTTP faces of nearly every hobby and prosumer
 *                     |                             | printer (ADR-140 names exactly these). Each adapter does two
 *                     |                             | things only: upload a file (optionally starting it) and read
 *                     |                             | state. The API key rides a header, never a URL, and the base
 *                     |                             | URL is validated against loopback/metadata targets because it
 *                     |                             | is typed by a person and the request leaves the controller.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRINTER_KINDS = void 0;
exports.validatePrinterBaseUrl = validatePrinterBaseUrl;
exports.fileKindOf = fileKindOf;
exports.adapterFor = adapterFor;
exports.hostAccepts = hostAccepts;
/** @description Every supported kind. */
exports.PRINTER_KINDS = ['octoprint', 'moonraker', 'prusalink'];
/** @description Default request timeouts. */
const STATUS_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;
/** @description Hosts a person-typed printer URL must never point at. */
const FORBIDDEN_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '169.254.169.254']);
/**
 * @description Validate a printer base URL: http/https only, no embedded credentials, not
 * loopback or the cloud-metadata address, trailing slash removed.
 * @param raw - What the person typed.
 * @returns The normalised URL, or the reason it was refused.
 */
function validatePrinterBaseUrl(raw) {
    let parsed;
    try {
        parsed = new URL(String(raw).trim());
    }
    catch {
        return { ok: false, reason: 'not a valid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        return { ok: false, reason: 'only http and https are supported' };
    if (parsed.username || parsed.password)
        return { ok: false, reason: 'credentials in the URL are not allowed; use the API key field' };
    if (FORBIDDEN_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.hostname.startsWith('127.')) {
        return { ok: false, reason: 'loopback and metadata addresses are refused' };
    }
    if (parsed.search || parsed.hash)
        return { ok: false, reason: 'query strings and fragments are not allowed in the base URL' };
    const path = parsed.pathname.replace(/\/+$/, '');
    return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}` };
}
/**
 * @description Classify a file by extension the way the hosts do.
 * @param fileName - Name with extension.
 * @returns `stl`, `gcode` or `other`.
 */
function fileKindOf(fileName) {
    const ext = fileName.toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
    if (ext === '.stl')
        return 'stl';
    if (['.gcode', '.gco', '.g', '.bgcode'].includes(ext))
        return 'gcode';
    return 'other';
}
/** @description Fetch with a timeout, never throwing past the caller. */
async function request(fetchImpl, url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        const text = await response.text();
        let body = text;
        try {
            body = text ? JSON.parse(text) : null;
        }
        catch { /* keep text */ }
        return { status: response.status, body };
    }
    catch (error) {
        return { status: 0, body: null, error: error instanceof Error ? error.message : String(error) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** @description A fresh ArrayBuffer holding exactly the file bytes — what Blob and fetch bodies accept. */
function fileBuffer(file) {
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    return copy.buffer;
}
/** @description Multipart body with the file and extra fields. */
function multipart(file, fields) {
    const form = new FormData();
    form.append('file', new Blob([fileBuffer(file)], { type: 'application/octet-stream' }), file.fileName);
    for (const [k, v] of Object.entries(fields))
        form.append(k, v);
    return form;
}
/** @description Shape a submission result from a host response. */
function submission(result, started, okStatuses) {
    const ok = okStatuses.includes(result.status);
    return {
        ok,
        status: result.status,
        started: ok && started,
        message: ok ? (started ? 'Uploaded and print started.' : 'Uploaded.') : `Printer host answered ${result.status || 'no response'}${result.error ? `: ${result.error}` : ''}`,
        remote: result.body,
    };
}
/** @description Extract a state string from an arbitrary JSON body at a dotted path. */
function readPath(body, path) {
    let at = body;
    for (const key of path) {
        if (!at || typeof at !== 'object')
            return 'unknown';
        at = at[key];
    }
    return typeof at === 'string' ? at : 'unknown';
}
/** @description OctoPrint — `POST /api/files/local` multipart, `select`/`print` flags; `GET /api/job`. */
const octoprint = {
    kind: 'octoprint',
    accepts: ['.gcode', '.gco', '.g', '.stl'],
    async upload(profile, file, fetchImpl) {
        const start = file.startPrint && fileKindOf(file.fileName) === 'gcode';
        const result = await request(fetchImpl, `${profile.baseUrl}/api/files/local`, {
            method: 'POST', headers: { 'X-Api-Key': profile.apiKey }, body: multipart(file, { select: String(start), print: String(start) }),
        }, UPLOAD_TIMEOUT_MS);
        return submission(result, start, [200, 201]);
    },
    async status(profile, fetchImpl) {
        const result = await request(fetchImpl, `${profile.baseUrl}/api/job`, { headers: { 'X-Api-Key': profile.apiKey } }, STATUS_TIMEOUT_MS);
        return { ok: result.status === 200, status: result.status, state: result.status === 200 ? readPath(result.body, ['state']).toLowerCase() : 'offline', detail: result.body };
    },
};
/** @description Moonraker — `POST /server/files/upload` multipart with `print`; `GET /printer/objects/query?print_stats`. */
const moonraker = {
    kind: 'moonraker',
    accepts: ['.gcode'],
    async upload(profile, file, fetchImpl) {
        const start = file.startPrint;
        const result = await request(fetchImpl, `${profile.baseUrl}/server/files/upload`, {
            method: 'POST', headers: { 'X-Api-Key': profile.apiKey }, body: multipart(file, { root: 'gcodes', print: String(start) }),
        }, UPLOAD_TIMEOUT_MS);
        return submission(result, start, [200, 201]);
    },
    async status(profile, fetchImpl) {
        const result = await request(fetchImpl, `${profile.baseUrl}/printer/objects/query?print_stats`, { headers: { 'X-Api-Key': profile.apiKey } }, STATUS_TIMEOUT_MS);
        return { ok: result.status === 200, status: result.status, state: result.status === 200 ? readPath(result.body, ['result', 'status', 'print_stats', 'state']) : 'offline', detail: result.body };
    },
};
/** @description PrusaLink — `PUT /api/v1/files/usb/<name>` raw bytes with `Print-After-Upload`; `GET /api/v1/status`. */
const prusalink = {
    kind: 'prusalink',
    accepts: ['.gcode', '.bgcode'],
    async upload(profile, file, fetchImpl) {
        const start = file.startPrint;
        const headers = { 'X-Api-Key': profile.apiKey, 'Content-Type': 'application/octet-stream', Overwrite: '?1' };
        if (start)
            headers['Print-After-Upload'] = '?1';
        const result = await request(fetchImpl, `${profile.baseUrl}/api/v1/files/usb/${encodeURIComponent(file.fileName)}`, {
            method: 'PUT', headers, body: fileBuffer(file),
        }, UPLOAD_TIMEOUT_MS);
        return submission(result, start, [200, 201, 204]);
    },
    async status(profile, fetchImpl) {
        const result = await request(fetchImpl, `${profile.baseUrl}/api/v1/status`, { headers: { 'X-Api-Key': profile.apiKey } }, STATUS_TIMEOUT_MS);
        return { ok: result.status === 200, status: result.status, state: result.status === 200 ? readPath(result.body, ['printer', 'state']).toLowerCase() : 'offline', detail: result.body };
    },
};
const ADAPTERS = { octoprint, moonraker, prusalink };
/**
 * @description Look up the adapter for a host type.
 * @param kind - Host type.
 * @returns The adapter.
 * @throws RangeError for an unknown kind.
 */
function adapterFor(kind) {
    const adapter = ADAPTERS[kind];
    if (!adapter)
        throw new RangeError(`Unknown printer kind "${kind}"; expected one of ${exports.PRINTER_KINDS.join(', ')}`);
    return adapter;
}
/**
 * @description Whether a host accepts a file, by extension.
 * @param kind - Host type.
 * @param fileName - Name with extension.
 * @returns True when the extension is in the adapter's list.
 */
function hostAccepts(kind, fileName) {
    const ext = fileName.toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
    return adapterFor(kind).accepts.includes(ext);
}
//# sourceMappingURL=printer-adapters.js.map