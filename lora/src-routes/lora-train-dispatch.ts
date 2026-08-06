/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Await the durable remote-task journal enqueue so dispatch returns the accepted task identity and catches asynchronous rejection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep remote enqueue exception text out of API responses and structured logs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Bind every box callback command to the initiating owner through the canonical base64url service-identity argument.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Remove the fleet secret from durable shell-task command payloads and quote all data-derived PowerShell arguments as literals.
 */

/**
 * LoRA Studio — ticket-gated box dispatch. Training and validation run on the GPU edge box; per the
 * ADR-070 privilege rule, the box is reached ONLY through the queue/worker path on an authorized
 * action — never a direct endpoint call. This module builds the box-side command and enqueues it as
 * an embedded `mcp.call-tool` → `shell.exec` task on the edge worker via the shared remote-client
 * registry (the same queue the oshal-chat worker polls). The worker runs it only with
 * `allowSystemControl` enabled; results flow back to the controller via /api/lora/ingest.
 *
 * Training = a separate kohya PROCESS (not a ComfyUI workflow), so shell.exec is the only transport.
 * Validation runs over ComfyUI HTTP inside the box script, but is dispatched the same gated way so the
 * GPU box is driven through one authorized path.
 *
 * VENDORED into the lora store package 2026-07-17 (ADR-085 Wave 1 carve #3) — this module is
 * app-owned (only lora imports it). The remote-client registry + logger stay core and are imported
 * via @/ aliases the loader resolves at runtime. Box script names (train-lora.py etc.) refer to the
 * FRAMEWORK repo's scripts/comfyui-edge/ deployed on the box — unchanged by the carve.
 *
 * @module lora-train-dispatch
 */

import { createChildLogger } from '@/shared/logger';
import { remoteClientRegistry } from '@/app/routes/remote-client-routes';
import type { RemoteClientRecord } from '@/features/remote-client';

const logger = createChildLogger({ module: 'lora-train-dispatch' });

/** The LoRA Studio bot identity (the task's fromAgentId). */
const LORA_DIRECTOR_AGENT_ID = 'a0000000-0000-0000-0000-000000000049';

/*
 * ── BOX FACTS (verified by driving the GPU box DIRECTLY end-to-end) ──────────────────────────────
 * The commands here are executed on the GPU edge box via the worker's gated PowerShell shell.exec.
 * They MUST match what actually runs on that box, which differs from the early assumptions:
 *
 *  1. REPO PATH. The box's open-shal clone lives at  %USERPROFILE%\Documents\oshal-client\open-shal
 *     (NOT ~/open-shal). So the box scripts are under  <repo>\scripts\comfyui-edge\ . Overridable via
 *     LORA_BOX_REPO.
 *  2. PYTHON. Bare `python` on the box is the Windows Store ALIAS STUB and is non-functional. Every
 *     box python script must be run with the kohya venv interpreter at
 *     %USERPROFILE%\kohya_ss\venv\Scripts\python.exe  (it has torch / PIL / open_clip + everything
 *     train-lora.py / validate-lora.py / make-targeted-batch.py / overnight-loop.py need). Overridable
 *     via LORA_BOX_VENV_PY.
 *  3. UTF-8. Training/validation CRASH on Windows cp1252 stdout unless PYTHONUTF8=1 is set, so every
 *     dispatched command sets `$env:PYTHONUTF8="1"` first.
 *  4. TRANSPORT QUOTING. shell.exec mangles a bare leading `$var=` and a bare `$env:USERPROFILE`
 *     intermittently; the reliable pattern is to reference paths inside DOUBLE QUOTES so PowerShell
 *     expands $env:USERPROFILE itself (e.g. "$env:USERPROFILE/kohya_ss/...") and to keep commands well
 *     under the 32KB transport limit. Forward slashes work fine on Windows PowerShell.
 *  5. DATASET. train-lora.py --dataset accepts a FOLDER of <name>.png / <name>.txt pairs (the curated
 *     run used a folder, not the old ~/overnight/curated.zip default which was not present on the box).
 *     Default below is a folder; override per-box via LORA_BOX_DATASET.
 *  6. CALLBACK. The box reports results back to the controller at LORA_CONTROLLER_URL
 *     (http://localhost:35457). The edge worker supplies SWARM_SERVICE_SECRET from its own
 *     process environment; that fleet credential must never enter the durable shell-task command.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */

/** Box repo root. PowerShell-expanded ($env:USERPROFILE) — shell.exec runs PowerShell on the box. */
const BOX_REPO = process.env.LORA_BOX_REPO || '$env:USERPROFILE/Documents/oshal-client/open-shal';
/** The kohya venv python — the ONLY working interpreter on the box (bare `python` is a Store stub). */
const BOX_VENV_PY = process.env.LORA_BOX_VENV_PY || '$env:USERPROFILE/kohya_ss/venv/Scripts/python.exe';
/** Training dataset — a FOLDER of <name>.png/.txt pairs (override per-box via LORA_BOX_DATASET). */
const BOX_DATASET = process.env.LORA_BOX_DATASET || '$env:USERPROFILE/overnight/curated';
/** Where the box reports results back to (the controller, reachable from the box). */
const CONTROLLER_URL = process.env.LORA_CONTROLLER_URL || 'http://localhost:35457';

export interface DispatchResult {
  ok: boolean;
  clientId?: string;
  taskId?: string;
  error?: string;
}

/**
 * Pick the GPU edge worker to drive — the REMOTE box (e.g. edge-node-1), never this controller's
 * own local oshal-chat node. Selection order: an explicit client id (LORA_EDGE_CLIENT_ID) → a
 * tailnet hostname match (LORA_EDGE_HOSTNAME, default 'edge-node-1') → any online worker that has a
 * tailnetHostname (a real remote box) → last resort, the first online worker. The hostname/remote
 * preference matters because the controller runs its OWN worker node with NO tailnetHostname, and
 * dispatching training there would have no GPU/ComfyUI/dataset.
 */
function pickEdgeClient(): RemoteClientRecord | null {
  const preferredId = (process.env.LORA_EDGE_CLIENT_ID || '').trim();
  const preferredHost = (process.env.LORA_EDGE_HOSTNAME || 'edge-node-1').trim().toLowerCase();
  let clients: RemoteClientRecord[] = [];
  try { clients = remoteClientRegistry.listClients(); } catch { clients = []; }
  const host = (c: RemoteClientRecord): string => String((c as { tailnetHostname?: string }).tailnetHostname || '').trim().toLowerCase();
  const online = clients.filter((c) =>
    (c.status ?? 'online') === 'online' && (c.healthy ?? true) &&
    ((c.capabilities ?? []).includes('shell.exec') || (c.tags ?? []).some((t) => /worker/i.test(t))));
  if (preferredId) return online.find((c) => c.clientId === preferredId) ?? null;
  if (preferredHost) {
    const match = online.find((c) => host(c) === preferredHost);
    if (match) return match;
  }
  // Prefer a real REMOTE box (advertises a tailnetHostname) over the controller's own local node.
  return online.find((c) => host(c).length > 0) ?? online[0] ?? null;
}

/** A bare box-script python invocation (kohya venv interpreter, double-quoted for $env expansion). */
function pyScript(script: string, args: string): string {
  return `& "${BOX_VENV_PY}" "${BOX_REPO}/scripts/comfyui-edge/${script}" ${args}`.trim();
}

/** Quote an untrusted argument as one literal PowerShell token (single quotes escape by doubling). */
function psLiteral(value: string): string {
  if (value.includes('\0') || Buffer.byteLength(value, 'utf8') > 2048) {
    throw new Error('LoRA command argument is invalid or too large');
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Accept only an HTTP(S) callback origin without credentials, query data, or fragments. */
function controllerCallbackUrl(): string {
  let parsed: URL;
  try { parsed = new URL(CONTROLLER_URL); } catch { throw new Error('LORA_CONTROLLER_URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('LORA_CONTROLLER_URL must be an HTTP(S) URL without credentials, query, or fragment');
  }
  return parsed.toString().replace(/\/$/, '');
}

/**
 * Single-line python invocation on the box (PowerShell), with the controller callback + owner.
 * Always sets PYTHONUTF8=1 first (cp1252 stdout otherwise crashes train/validate) and invokes the
 * kohya venv python (bare `python` on the box is a non-functional Store stub). The edge process,
 * not this persisted command, owns SWARM_SERVICE_SECRET. See BOX FACTS above.
 */
function pyCommand(script: string, args: string, ownerSub: string): string {
  const ownerSubB64 = Buffer.from(ownerSub, 'utf8').toString('base64url');
  const tail = `--controller ${psLiteral(controllerCallbackUrl())} --owner-sub-b64 ${psLiteral(ownerSubB64)}`;
  return `$env:PYTHONUTF8="1"; ${pyScript(script, `${args} ${tail}`)}`.trim();
}

/** The kohya training command for one version (improve passes the parent it builds on). */
export function buildTrainCommand(
  subject: string,
  version: number,
  parentVersion: number | null | undefined,
  ownerSub: string,
): string {
  const parent = parentVersion != null ? ` --parent-version ${parentVersion}` : '';
  return pyCommand(
    'train-lora.py',
    `--character ${psLiteral(subject)} --version ${version} --dataset "${BOX_DATASET}"${parent}`,
    ownerSub,
  );
}

/** The ComfyUI validation command for one trained version. */
export function buildValidateCommand(subject: string, version: number, ownerSub: string): string {
  const loraName = `${subject}_v${version}.safetensors`;
  return pyCommand(
    'validate-lora.py',
    `--character ${psLiteral(subject)} --version ${version} --lora-name ${psLiteral(loraName)}`,
    ownerSub,
  );
}

/**
 * The improve command: regenerate training data BIASED to the weak axis-values, then train the next
 * version on the augmented set (PowerShell `;` sequences the two steps on the box).
 * @param weakValues - the scorecard's weak_cells[].value list to over-sample
 */
export function buildImproveCommand(
  subject: string,
  version: number,
  parentVersion: number,
  weakValues: string[],
  ownerSub: string,
): string {
  const weak = weakValues.join('||');
  // PYTHONUTF8 is set once at the front; the venv interpreter runs the batch step, then training.
  const batch = `$env:PYTHONUTF8="1"; ${pyScript('make-targeted-batch.py', `--character ${psLiteral(subject)} --weak ${psLiteral(weak)} --count 60`)}`;
  // buildTrainCommand already re-asserts $env:PYTHONUTF8 + the venv python, so the two steps are independent.
  return `${batch}; ${buildTrainCommand(subject, version, parentVersion, ownerSub)}`;
}

/** The autonomous overnight loop (improve→validate until plateau / max hours, then park a review ticket). */
export function buildOvernightCommand(
  subject: string,
  startVersion: number,
  maxHours: number,
  plateau: number,
  ownerSub: string,
): string {
  return pyCommand(
    'overnight-loop.py',
    `--character ${psLiteral(subject)} --start-version ${startVersion} --max-hours ${maxHours} --plateau ${plateau} --dataset "${BOX_DATASET}"`,
    ownerSub,
  );
}

/**
 * @description Enqueue a box-side command to the edge worker as a gated shell.exec task. Returns the
 * dispatch outcome (clientId + taskId on success). Never throws — a missing/offline box returns
 * `{ ok: false, error }` so the route can surface a clean "box not connected" message.
 * @param command - the box-side shell command (built by buildTrainCommand/buildValidateCommand)
 * @param correlationId - ties the task to its ticket (the ticket id)
 * @returns The accepted remote-task identity or a sanitized dispatch failure.
 */
export async function dispatchBoxCommand(command: string, correlationId: string): Promise<DispatchResult> {
  const client = pickEdgeClient();
  if (!client) {
    return { ok: false, error: 'No online GPU edge worker — the oshal-chat node on the box is not connected.' };
  }
  const taskId = `lora-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const envelope = {
    taskId,
    correlationId: correlationId || taskId,
    fromAgentId: LORA_DIRECTOR_AGENT_ID,
    toAgentId: client.agentId || client.clientId,
    intent: 'mcp.call-tool' as const,
    input: { name: 'shell.exec', arguments: { command } },
    createdAt: new Date().toISOString(),
  };
  try {
    const task = await remoteClientRegistry.enqueueTask(client.clientId, envelope);
    logger.info({ clientId: client.clientId, taskId: task.taskId }, 'lora box command dispatched');
    return { ok: true, clientId: client.clientId, taskId: task.taskId };
  } catch (err) {
    const errorType = err instanceof Error ? err.name : 'UnknownError';
    logger.error({ errorType, clientId: client.clientId }, 'lora box dispatch failed');
    return { ok: false, error: 'The GPU edge worker could not accept the task.' };
  }
}
