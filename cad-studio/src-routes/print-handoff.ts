/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.5.0: honest HTTP printer status probe and confirmed 3MF/STL print-queue upload routes for OctoPrint, Moonraker, and PrusaLink with zero fake printing claims when unconfigured (RP-CAD-05).
 */

import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { artifactPath, requireUuid, revisionDir } from './data-dir';
import { getModel, type QueryablePool } from './model-store';
import { fromStl, to3mf } from './mesh-formats';

const logger = createChildLogger({ module: 'cad-studio-print-handoff' });

export type DirectPrinterKind = 'octoprint' | 'moonraker' | 'prusalink';

export interface DirectPrinterConfig {
  kind: DirectPrinterKind;
  baseUrl: string;
  apiKey: string;
}

export interface CadPrintRouteDeps {
  pool: QueryablePool;
  dataRoot: string;
  callerSub: (req: Request) => string | null;
  fetchImpl?: typeof fetch;
}

const SUPPORTED_KINDS = new Set<string>(['octoprint', 'moonraker', 'prusalink']);

export function validatePrinterTarget(raw: unknown): { ok: true; target: DirectPrinterConfig } | { ok: false; status: number; error: string; message: string } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = String(obj.kind ?? '').trim().toLowerCase();
  if (kind === 'bambu-lan') {
    return {
      ok: false,
      status: 400,
      error: 'bambu_uses_scan_to_print',
      message: 'Bambu Lab LAN printers use FTPS + MQTT with pinned device certificates in Scan to Print, or download 3MF for Bambu Studio.',
    };
  }
  if (!SUPPORTED_KINDS.has(kind)) {
    return { ok: false, status: 400, error: 'unsupported_printer_kind', message: 'Printer kind must be octoprint, moonraker, or prusalink.' };
  }
  const urlText = String(obj.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!urlText) {
    return {
      ok: false,
      status: 400,
      error: 'printer_not_configured',
      message: 'No printer URL is configured. Enter an OctoPrint, Moonraker, or PrusaLink http(s) URL, or download 3MF/STL for your slicer.',
    };
  }
  let parsed: URL;
  try { parsed = new URL(urlText); } catch {
    return { ok: false, status: 400, error: 'invalid_printer_url', message: 'Printer URL must be a valid http:// or https:// address.' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return { ok: false, status: 400, error: 'invalid_printer_url', message: 'Printer URL must use http:// or https:// and include a host.' };
  }
  const apiKey = String(obj.apiKey ?? '').trim();
  if ((kind === 'octoprint' || kind === 'prusalink') && !apiKey) {
    return { ok: false, status: 400, error: 'api_key_required', message: `${kind === 'octoprint' ? 'OctoPrint' : 'PrusaLink'} requires an API key.` };
  }
  return { ok: true, target: { kind: kind as DirectPrinterKind, baseUrl: parsed.origin + parsed.pathname.replace(/\/+$/, ''), apiKey } };
}

function authHeaders(target: DirectPrinterConfig): Record<string, string> {
  return target.apiKey ? { 'X-Api-Key': target.apiKey } : {};
}

async function probePrinterStatus(target: DirectPrinterConfig, fetchFn: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  const endpoint = target.kind === 'octoprint'
    ? `${target.baseUrl}/api/printer`
    : target.kind === 'moonraker'
      ? `${target.baseUrl}/printer/objects/query?print_stats`
      : `${target.baseUrl}/api/v1/status`;
  try {
    const res = await fetchFn(endpoint, { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(target) }, signal: AbortSignal.timeout(5000) });
    const data = await res.json().catch(() => ({})) as Record<string, any>;
    if (res.status === 401 || res.status === 403) {
      return { status: 401, body: { reachable: true, authenticated: false, error: 'printer_auth_failed', message: 'The printer rejected the API key.' } };
    }
    if (!res.ok) {
      return { status: 502, body: { reachable: false, error: 'printer_http_error', remoteStatus: res.status, message: `Printer answered HTTP ${res.status}.` } };
    }
    const printerState = target.kind === 'octoprint'
      ? String(data?.state?.text ?? 'online')
      : target.kind === 'moonraker'
        ? String(data?.result?.status?.print_stats?.state ?? 'online')
        : String(data?.printer?.state ?? 'online');
    return { status: 200, body: { reachable: true, authenticated: true, kind: target.kind, baseUrl: target.baseUrl, printerState } };
  } catch (error) {
    return {
      status: 502,
      body: {
        reachable: false,
        error: 'printer_unreachable',
        message: `Could not reach ${target.baseUrl} (${(error as Error).message || 'network unavailable'}). Download 3MF or STL to slice locally if this host cannot reach your LAN.`,
      },
    };
  }
}

function buildMultipartForm(fileName: string, mime: string, payload: Buffer, fields: Record<string, string>): { body: Buffer; contentType: string } {
  const boundary = `----oshalCadPrint${Date.now().toString(36)}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'));
  chunks.push(payload);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadToPrinterQueue(
  target: DirectPrinterConfig,
  fileName: string,
  format: '3mf' | 'stl',
  payload: Buffer,
  startPrint: boolean,
  fetchFn: typeof fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const mime = format === '3mf' ? 'model/3mf' : 'model/stl';
  try {
    let res: globalThis.Response;
    if (target.kind === 'prusalink') {
      res = await fetchFn(`${target.baseUrl}/api/v1/files/local/${encodeURIComponent(fileName)}`, {
        method: 'PUT',
        headers: { ...authHeaders(target), 'Content-Type': 'application/octet-stream', 'Print-After-Upload': startPrint ? '1' : '0', Overwrite: '?1' },
        body: new Uint8Array(payload),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      const endpoint = target.kind === 'octoprint' ? `${target.baseUrl}/api/files/local` : `${target.baseUrl}/server/files/upload`;
      const fields: Record<string, string> = target.kind === 'octoprint'
        ? { select: 'true', print: startPrint ? 'true' : 'false' }
        : { root: 'gcodes', print: startPrint ? 'true' : 'false' };
      const form = buildMultipartForm(fileName, mime, payload, fields);
      res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(target), 'Content-Type': form.contentType },
        body: new Uint8Array(form.body),
        signal: AbortSignal.timeout(15000),
      });
    }
    const remote = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      return { status: 401, body: { ok: false, printing: false, error: 'printer_auth_failed', message: 'The printer rejected the API key.' } };
    }
    if (!res.ok) {
      return { status: 502, body: { ok: false, printing: false, error: 'printer_upload_failed', remoteStatus: res.status, message: `Printer upload failed with HTTP ${res.status}.` } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        state: startPrint ? 'print_requested' : 'uploaded',
        printing: startPrint,
        kind: target.kind,
        baseUrl: target.baseUrl,
        format,
        fileName,
        bytes: payload.byteLength,
        message: startPrint
          ? `Uploaded ${fileName} and requested print start on ${target.baseUrl}.`
          : `Uploaded ${fileName} (${Math.max(1, Math.round(payload.byteLength / 1024))} KB) to ${target.baseUrl} queue. Slice or start on the printer when ready.`,
        remote,
      },
    };
  } catch (error) {
    return {
      status: 502,
      body: { ok: false, printing: false, error: 'printer_unreachable', message: `Could not upload to ${target.baseUrl}: ${(error as Error).message || 'network unavailable'}.` },
    };
  }
}

/** @description Build `/printers/status` and `/models/:modelId/print` routes under `/api/cad-studio`. */
export function createCadPrintRoutes(deps: CadPrintRouteDeps): Router {
  const router = Router();
  const fetchFn = deps.fetchImpl ?? globalThis.fetch;

  router.post('/printers/status', async (req: Request, res: Response) => {
    if (!deps.callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const checked = validatePrinterTarget((req.body ?? {}).printer ?? req.body);
    if (!checked.ok) { res.status(checked.status).json({ reachable: false, printing: false, error: checked.error, message: checked.message }); return; }
    const outcome = await probePrinterStatus(checked.target, fetchFn);
    res.status(outcome.status).json(outcome.body);
  });

  router.post('/models/:modelId/print', async (req: Request, res: Response) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirm !== true) {
      res.status(428).json({ error: 'confirmation_required', printing: false, message: 'Sending a model to a printer requires explicit confirmation (confirm: true).' });
      return;
    }
    const checked = validatePrinterTarget(body.printer ?? body);
    if (!checked.ok) { res.status(checked.status).json({ ok: false, printing: false, error: checked.error, message: checked.message }); return; }
    try {
      const model = await getModel(deps.pool, sub, requireUuid(req.params.modelId));
      if (!model) { res.status(404).json({ error: 'model_not_found' }); return; }
      if (model.revision < 1) { res.status(409).json({ error: 'model_not_built', printing: false, message: 'Build the part before sending it to a printer.' }); return; }
      const stlFile = artifactPath(revisionDir(deps.dataRoot, sub, model.model_id, model.revision), 'stl');
      if (!fs.existsSync(stlFile)) { res.status(404).json({ error: 'artifact_not_found', printing: false }); return; }
      const format = body.format === 'stl' ? 'stl' : '3mf';
      const stlBytes = fs.readFileSync(stlFile);
      const payload = format === 'stl' ? stlBytes : Buffer.from(to3mf(fromStl(new Uint8Array(stlBytes)), model.title));
      const safeBase = model.title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'part';
      const fileName = `${safeBase}-r${model.revision}.${format}`;
      const outcome = await uploadToPrinterQueue(checked.target, fileName, format, payload, body.startPrint === true, fetchFn);
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_id', message: error.message }); return; }
      logger.error({ err: error }, 'CAD printer handoff failed');
      res.status(500).json({ error: 'print_handoff_failed', printing: false });
    }
  });

  return router;
}
