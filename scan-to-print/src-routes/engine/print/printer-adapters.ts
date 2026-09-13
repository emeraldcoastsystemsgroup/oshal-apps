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

/** @description The printer hosts this package can talk to. */
export type PrinterKind = 'octoprint' | 'moonraker' | 'prusalink';

/** @description Every supported kind. */
export const PRINTER_KINDS: readonly PrinterKind[] = ['octoprint', 'moonraker', 'prusalink'];

/** @description What the adapter needs to reach a printer. */
export interface PrinterProfile {
  /** Host type. */
  kind: PrinterKind;
  /** `http(s)://host[:port]`, no trailing slash. */
  baseUrl: string;
  /** The host's API key, sent as `X-Api-Key`. */
  apiKey: string;
}

/** @description The file to send. */
export interface PrintFile {
  /** Name the host will store it under. */
  fileName: string;
  /** File bytes. */
  bytes: Uint8Array;
  /** Ask the host to start printing after upload (only meaningful for G-code). */
  startPrint: boolean;
}

/** @description Result of an upload attempt. */
export interface PrintSubmission {
  /** True when the host accepted the file. */
  ok: boolean;
  /** HTTP status the host answered with (0 when the request never completed). */
  status: number;
  /** True when the host reports the print started. */
  started: boolean;
  /** Human-readable outcome. */
  message: string;
  /** The host's decoded response body, when any. */
  remote?: unknown;
}

/** @description A printer's reported state. */
export interface PrinterStatus {
  /** True when the host answered. */
  ok: boolean;
  /** HTTP status. */
  status: number;
  /** Normalised state string (`idle`, `printing`, `error`, `offline`, …). */
  state: string;
  /** The host's decoded response body, when any. */
  detail?: unknown;
}

/** @description The `fetch` signature the adapters use — injected so specs never touch a network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** @description One printer host. */
export interface PrinterAdapter {
  /** Host type. */
  kind: PrinterKind;
  /** Lower-case file extensions the host accepts. */
  accepts: readonly string[];
  /** Upload (and optionally start) a file. */
  upload(profile: PrinterProfile, file: PrintFile, fetchImpl: FetchLike): Promise<PrintSubmission>;
  /** Read the host's state. */
  status(profile: PrinterProfile, fetchImpl: FetchLike): Promise<PrinterStatus>;
}

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
export function validatePrinterBaseUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'only http and https are supported' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'credentials in the URL are not allowed; use the API key field' };
  if (FORBIDDEN_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.hostname.startsWith('127.')) {
    return { ok: false, reason: 'loopback and metadata addresses are refused' };
  }
  if (parsed.search || parsed.hash) return { ok: false, reason: 'query strings and fragments are not allowed in the base URL' };
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}` };
}

/**
 * @description Classify a file by extension the way the hosts do.
 * @param fileName - Name with extension.
 * @returns `stl`, `gcode` or `other`.
 */
export function fileKindOf(fileName: string): 'stl' | 'gcode' | 'other' {
  const ext = fileName.toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
  if (ext === '.stl') return 'stl';
  if (['.gcode', '.gco', '.g', '.bgcode'].includes(ext)) return 'gcode';
  return 'other';
}

/** @description Fetch with a timeout, never throwing past the caller. */
async function request(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** @description A fresh ArrayBuffer holding exactly the file bytes — what Blob and fetch bodies accept. */
function fileBuffer(file: PrintFile): ArrayBuffer {
  const copy = new Uint8Array(file.bytes.byteLength);
  copy.set(file.bytes);
  return copy.buffer as ArrayBuffer;
}

/** @description Multipart body with the file and extra fields. */
function multipart(file: PrintFile, fields: Record<string, string>): FormData {
  const form = new FormData();
  form.append('file', new Blob([fileBuffer(file)], { type: 'application/octet-stream' }), file.fileName);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

/** @description Shape a submission result from a host response. */
function submission(result: { status: number; body: unknown; error?: string }, started: boolean, okStatuses: number[]): PrintSubmission {
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
function readPath(body: unknown, path: string[]): string {
  let at: unknown = body;
  for (const key of path) {
    if (!at || typeof at !== 'object') return 'unknown';
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === 'string' ? at : 'unknown';
}

/** @description OctoPrint — `POST /api/files/local` multipart, `select`/`print` flags; `GET /api/job`. */
const octoprint: PrinterAdapter = {
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
const moonraker: PrinterAdapter = {
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
const prusalink: PrinterAdapter = {
  kind: 'prusalink',
  accepts: ['.gcode', '.bgcode'],
  async upload(profile, file, fetchImpl) {
    const start = file.startPrint;
    const headers: Record<string, string> = { 'X-Api-Key': profile.apiKey, 'Content-Type': 'application/octet-stream', Overwrite: '?1' };
    if (start) headers['Print-After-Upload'] = '?1';
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

const ADAPTERS: Record<PrinterKind, PrinterAdapter> = { octoprint, moonraker, prusalink };

/**
 * @description Look up the adapter for a host type.
 * @param kind - Host type.
 * @returns The adapter.
 * @throws RangeError for an unknown kind.
 */
export function adapterFor(kind: string): PrinterAdapter {
  const adapter = ADAPTERS[kind as PrinterKind];
  if (!adapter) throw new RangeError(`Unknown printer kind "${kind}"; expected one of ${PRINTER_KINDS.join(', ')}`);
  return adapter;
}

/**
 * @description Whether a host accepts a file, by extension.
 * @param kind - Host type.
 * @param fileName - Name with extension.
 * @returns True when the extension is in the adapter's list.
 */
export function hostAccepts(kind: PrinterKind, fileName: string): boolean {
  const ext = fileName.toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
  return adapterFor(kind).accepts.includes(ext);
}
