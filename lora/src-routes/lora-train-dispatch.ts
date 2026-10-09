/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Await the durable remote-task journal enqueue so dispatch returns the accepted task identity and catches asynchronous rejection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep remote enqueue exception text out of API responses and structured logs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Bind every box callback command to the initiating owner through the canonical base64url service-identity argument.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Remove the fleet secret from durable shell-task command payloads and quote all data-derived PowerShell arguments as literals.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Carry the WHOLE character into every box command instead of its subject alone, and give each character its own box directory. The box scripts took their trigger word, hero, identity sentence, negative prompt and structural guard from constants, and every character on a box shared one dataset folder, so a second character trained on the first one's images and overwrote its curated set. The subject now has to be a slug, because it names a directory.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Isolate worker paths and model stems by immutable character id, preserve explicit legacy model validation and stop dependent commands after failure.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Carry the originating overnight review ticket into the final worker callback so scheduled runs can close their dispatch ticket and the next opted-in cadence can start a fresh loop.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Point the dataset import command at the controller's exact-owner staging route instead of the artifact handle (core refuses the service rail for handle content, and the 15-minute handle usually expired before an offline worker ran), and post a failed callback from a catch so a failed fetch, check or write never leaves the receipt queued.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Sign the dataset import's download and callbacks with the per-dispatch callback grant the task receives in OSHAL_LORA_CALLBACK_GRANT (fresh nonce, timestamp, HMAC over method, path and body hash) instead of sending the fleet SWARM_SERVICE_SECRET; the callback body now travels as the exact signed bytes. Export the director id for the ingest module.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Download the staged image with an empty signed POST to /api/lora/ingest/dataset-download/:id. The worker's GET was refused by the kernel's application-authorization layer under ADR-149 enforce (authorization_identity_required), and the signed-package-callbacks rail that now admits worker requests accepts POST only.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Quote box-side paths as PowerShell expandable strings through one validating helper (psBoxPath). The dataset import wrapped its curated directory, image and caption paths in psLiteral (single quotes), so the default box root "$env:USERPROFILE/lora-characters" reached the worker unexpanded and the first live run failed New-Item with DriveNotFound ($env:String); the training and validation commands had always double-quoted the same root. The helper admits exactly a box path (an optional leading $env:NAME, then letters, digits, space and _ . : ( ) - / \), refuses every quote, backtick, further $, newline, control character and "..", and now also quotes the interpreter, script, --box-root and --dataset paths so a malformed root fails at dispatch instead of being pasted into a shell. The write fragment is exported so a real-PowerShell guard can run the shipped statements.
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

/** The LoRA Studio bot identity (the task's fromAgentId and the owner of review tickets). */
export const LORA_DIRECTOR_AGENT_ID = 'a0000000-0000-0000-0000-000000000049';

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
 *     under the 32KB transport limit. Forward slashes work fine on Windows PowerShell. Every box
 *     path goes through psBoxPath(), which validates the charset and emits that double-quoted
 *     form; psLiteral() (single quotes, NO expansion) is for data: URLs, captions, subjects, names.
 *     A box path in single quotes is the 1.7.0 dataset-import defect: New-Item saw the literal
 *     text "$env:USERPROFILE/..." and failed DriveNotFound ($env:String) on the live GPU box.
 *  5. DATASET. train-lora.py --dataset accepts a FOLDER of <name>.png / <name>.txt pairs. It is the
 *     curated subdirectory of the CHARACTER's own box directory, so two characters on one box never
 *     share a pool, a curated set or a scorecard directory. The parent directory of all of them is
 *     overridable per box via LORA_BOX_ROOT.
 *  6. CALLBACK. The box reports results back to the controller at LORA_CONTROLLER_URL
 *     (http://localhost:35457). Each dispatch hands its task a short-lived callback grant in the
 *     OSHAL_LORA_CALLBACK_GRANT environment variable (lora-callback-grants.ts); the box scripts sign
 *     every callback with it. The fleet SWARM_SERVICE_SECRET is no longer a callback credential.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */

/** Box repo root. PowerShell-expanded ($env:USERPROFILE) — shell.exec runs PowerShell on the box. */
const BOX_REPO = process.env.LORA_BOX_REPO || '$env:USERPROFILE/Documents/oshal-client/open-shal';
/** The kohya venv python — the ONLY working interpreter on the box (bare `python` is a Store stub). */
const BOX_VENV_PY = process.env.LORA_BOX_VENV_PY || '$env:USERPROFILE/kohya_ss/venv/Scripts/python.exe';
/** Parent of every character's own box directory (override per-box via LORA_BOX_ROOT). */
const BOX_ROOT = process.env.LORA_BOX_ROOT || '$env:USERPROFILE/lora-characters';

/**
 * Public subjects remain slugs for URLs and legacy model compatibility. New worker paths and
 * filenames use the immutable character UUID, not these potentially colliding public names.
 */
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Where the box reports results back to (the controller, reachable from the box). */
const CONTROLLER_URL = process.env.LORA_CONTROLLER_URL || 'http://localhost:35457';

/**
 * One character's identity, as `oshal_lora_characters` holds it. The box scripts have no character
 * constants left, so everything they need to generate, curate, train and validate is here.
 */
export interface LoraCharacterConfig {
  /** Immutable database identity; owns the worker directory and model stems. */
  id: string;
  /** Public slug; independent of the worker storage name. */
  subject: string;
  /** LoRA trigger word (defaults to the subject). */
  triggerWord?: string | null;
  /** Locked hero image filename on the box — the identity anchor CLIP scores against. */
  heroImage?: string | null;
  /** Canonical look sentence used in generation prompts. */
  identPrompt?: string | null;
  /** This character's negative prompt. */
  negativePrompt?: string | null;
  /** Contrastive prompt this character SHOULD match (its own anatomy). */
  identityStructure?: string | null;
  /** Contrastive prompt that means the identity broke. */
  identityViolation?: string | null;
  /** Checkpoint to generate and validate against. */
  baseModel?: string | null;
}

/** The `oshal_lora_characters` row shape the routes select. */
export interface LoraCharacterRow {
  id: string;
  subject: string;
  trigger_word?: string | null;
  hero_image?: string | null;
  ident_prompt?: string | null;
  negative_prompt?: string | null;
  identity_structure?: string | null;
  identity_violation?: string | null;
  base_model?: string | null;
}

export interface DispatchResult {
  ok: boolean;
  clientId?: string;
  taskId?: string;
  error?: string;
}

/** Largest source image the worker may place in a curated training set. */
export const MAX_DATASET_IMAGE_BYTES = 10 * 1024 * 1024;

const DATASET_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(?:png|jpe?g|webp)$/i;

/** Keep a dataset entry a basename; the worker never receives a user-selected directory. */
export function isSafeDatasetFilename(value: string): boolean {
  return DATASET_FILENAME_RE.test(value) && !value.includes('..');
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
  return `& ${psBoxPath(BOX_VENV_PY)} ${psBoxPath(`${BOX_REPO}/scripts/comfyui-edge/${script}`)} ${args}`.trim();
}

/**
 * @description Carry a complete owner-resolved character row into the command builders.
 * @param row - The `oshal_lora_characters` row.
 * @returns The configuration every box command is built from.
 */
export function characterConfigFromRow(row: LoraCharacterRow): LoraCharacterConfig {
  return {
    id: row.id,
    subject: row.subject,
    triggerWord: row.trigger_word,
    heroImage: row.hero_image,
    identPrompt: row.ident_prompt,
    negativePrompt: row.negative_prompt,
    identityStructure: row.identity_structure,
    identityViolation: row.identity_violation,
    baseModel: row.base_model,
  };
}

/**
 * @description Keep public character names compatible with URL and legacy filename contracts.
 * @param subject - The proposed subject.
 * @returns True when it is a safe slug.
 */
export function isValidCharacterSubject(subject: string): boolean {
  return SUBJECT_PATTERN.test(subject);
}

/**
 * @description This character's own directory on the box. Per character by construction: it is
 * what stops a second character consuming and overwriting the first one's dataset.
 * @param config - The owner-resolved character including its immutable id.
 * @returns A PowerShell-expandable path.
 */
export function boxRootFor(config: LoraCharacterConfig): string {
  return `${BOX_ROOT}/${boxSubjectFor(config)}`;
}

/**
 * @description Give every persisted character a Windows-safe, owner-independent storage key.
 * @param config - Character loaded under its exact owner's database predicate.
 * @returns The immutable worker subject, never a user-selected directory name.
 */
export function boxSubjectFor(config: LoraCharacterConfig): string {
  if (!SUBJECT_PATTERN.test(config.subject)) {
    throw new Error('LoRA character subject must be a slug (letters, digits, dot, dash, underscore)');
  }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(config.id || '')) {
    throw new Error('LoRA character id must be a persisted UUID');
  }
  return `lora-${config.id.replace(/-/g, '').toLowerCase()}`;
}

/**
 * @description The per-character arguments every box script reads its identity from. Each value is
 * quoted as one literal PowerShell token, so nothing in a character row can become a command.
 * @param config - The character configuration.
 * @returns The argument string, beginning with --character.
 */
export function characterArguments(config: LoraCharacterConfig): string {
  const root = boxRootFor(config);
  const parts = [`--character ${psLiteral(boxSubjectFor(config))}`, `--box-root ${psBoxPath(root)}`];
  const optional: Array<[string, string | null | undefined]> = [
    ['--trigger', config.triggerWord || config.subject],
    ['--hero', config.heroImage],
    ['--ident', config.identPrompt],
    ['--negative', config.negativePrompt],
    ['--identity-structure', config.identityStructure],
    ['--identity-violation', config.identityViolation],
    ['--base-model', config.baseModel],
  ];
  for (const [flag, value] of optional) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) parts.push(`${flag} ${psLiteral(trimmed)}`);
  }
  return parts.join(' ');
}

/** Quote an untrusted argument as one literal PowerShell token (single quotes escape by doubling). */
function psLiteral(value: string): string {
  if (value.includes('\0') || Buffer.byteLength(value, 'utf8') > 2048) {
    throw new Error('LoRA command argument is invalid or too large');
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The one place a box path may start with an environment reference: `$env:NAME`, ended by a path
 * separator or the end of the path, so PowerShell cannot read the next segment as part of the name.
 */
const BOX_PATH_ENV_PREFIX = /^\$env:[A-Za-z_][A-Za-z0-9_]*(?=[\\/]|$)/i;
/** What the rest of a box path may contain: letters, digits, space and `_ . : ( ) - / \`. */
const BOX_PATH_BODY = /^[\p{L}\p{N} _.:()\\/-]*$/u;

/**
 * @description Quote a box-side PATH as a PowerShell double-quoted string, so the box expands a
 * leading `$env:NAME` (the default roots are `$env:USERPROFILE/...`). This is a validator, not an
 * escaper: a path is admitted only when it is an optional leading `$env:NAME` followed by letters,
 * digits, space and `_ . : ( ) - / \`. Every `"`, backtick, further `$`, newline, control character
 * and `..` is refused, so nothing that could end the string or start an expression is ever emitted.
 * Data (URLs, captions, subjects, model names) keeps psLiteral(): single quotes, no expansion.
 * @param value - The path: a configured box root, or that root plus the character's immutable
 *   `lora-<id>/curated/<filename>` where the filename already passed isSafeDatasetFilename.
 * @returns The path inside double quotes, unchanged otherwise.
 */
export function psBoxPath(value: string): string {
  if (!value || Buffer.byteLength(value, 'utf8') > 2048) {
    throw new Error('LoRA box path is empty or too large');
  }
  const body = value.replace(BOX_PATH_ENV_PREFIX, '');
  if (!BOX_PATH_BODY.test(body) || body.includes('..') || /^\s|\s$/.test(value)) {
    throw new Error('LoRA box path contains characters a box path cannot contain');
  }
  return `"${value}"`;
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
 * kohya venv python (bare `python` on the box is a non-functional Store stub). The callback grant
 * reaches the script through the environment the dispatcher sets, never as an argument. See BOX FACTS above.
 */
function pyCommand(script: string, args: string, ownerSub: string, extraArgs = ''): string {
  const ownerSubB64 = Buffer.from(ownerSub, 'utf8').toString('base64url');
  const tail = `--controller ${psLiteral(controllerCallbackUrl())} --owner-sub-b64 ${psLiteral(ownerSubB64)}`;
  return `$env:PYTHONUTF8="1"; ${pyScript(script, `${args} ${tail} ${extraArgs}`)}`.trim();
}

/**
 * @description The kohya training command for one version, trained on THIS character's curated set.
 * @param config - The character configuration.
 * @param version - The version being produced.
 * @param parentVersion - The version it improves from, when it improves from one.
 * @param ownerSub - The initiating owner, carried as the canonical encoded identity.
 * @returns The box-side PowerShell command.
 */
export function buildTrainCommand(
  config: LoraCharacterConfig,
  version: number,
  parentVersion: number | null | undefined,
  ownerSub: string,
): string {
  const parent = parentVersion != null ? ` --parent-version ${parentVersion}` : '';
  const dataset = `${boxRootFor(config)}/curated`;
  const base = String(config.baseModel ?? '').trim();
  return pyCommand(
    'train-lora.py',
    `--character ${psLiteral(boxSubjectFor(config))} --version ${version} --dataset ${psBoxPath(dataset)}`
    + `${base ? ` --base ${psLiteral(base)}` : ''}${parent}`,
    ownerSub,
  );
}

/**
 * @description The ComfyUI validation command for one trained version, scored against THIS
 * character's hero, negative prompt and structural guard.
 * @param config - The character configuration.
 * @param version - The version to validate.
 * @param ownerSub - The initiating owner.
 * @param modelName - Optional filename from this owner's existing model row, including legacy models.
 * @returns The box-side PowerShell command.
 */
export function buildValidateCommand(config: LoraCharacterConfig, version: number, ownerSub: string, modelName?: string): string {
  const loraName = modelName ?? `${boxSubjectFor(config)}_v${version}.safetensors`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.safetensors$/.test(loraName)) {
    throw new Error('LoRA model filename must be a safetensors basename');
  }
  return pyCommand(
    'validate-lora.py',
    `${characterArguments(config)} --version ${version} --lora-name ${psLiteral(loraName)}`,
    ownerSub,
  );
}

/**
 * The improve command: regenerate training data BIASED to the weak axis-values, then train the next
 * version on the augmented set (PowerShell `;` sequences the two steps on the box).
 * @param weakValues - the scorecard's weak_cells[].value list to over-sample
 */
export function buildImproveCommand(
  config: LoraCharacterConfig,
  version: number,
  parentVersion: number,
  weakValues: string[],
  ownerSub: string,
): string {
  const weak = weakValues.join('||');
  // PYTHONUTF8 is set once at the front; the venv interpreter runs the batch step, then training.
  const batch = `$env:PYTHONUTF8="1"; ${pyScript('make-targeted-batch.py', `${characterArguments(config)} --weak ${psLiteral(weak)} --count 60`)}`;
  // A failed batch must not train on an old or partial curated set.
  return `${batch}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${buildTrainCommand(config, version, parentVersion, ownerSub)}`;
}

/**
 * The autonomous overnight loop (improve→validate until plateau / max hours, then park a review
 * ticket). It forwards the character's whole identity, so every nested step it spawns on the box
 * works on this character rather than falling back to a script default.
 * @param config - The character configuration.
 * @param startVersion - The version the loop improves from.
 * @param maxHours - Wall-clock budget.
 * @param plateau - The gain below which the loop stops.
 * @param ownerSub - The initiating owner.
 * @param startModelName - Existing model basename when the starting version predates namespaced storage.
 * @param reviewTicketId - Optional controller ticket completed by the final review callback.
 * @returns The box-side PowerShell command.
 */
export function buildOvernightCommand(
  config: LoraCharacterConfig,
  startVersion: number,
  maxHours: number,
  plateau: number,
  ownerSub: string,
  startModelName?: string,
  reviewTicketId?: string,
): string {
  const dataset = `${boxRootFor(config)}/curated`;
  const loop = pyCommand(
    'overnight-loop.py',
    `${characterArguments(config)} --start-version ${startVersion} --max-hours ${maxHours}`
    + ` --plateau ${plateau} --dataset ${psBoxPath(dataset)}`,
    ownerSub,
    reviewTicketId ? `--review-ticket-id ${psLiteral(reviewTicketId)}` : '',
  );
  if (!startModelName || startModelName === `${boxSubjectFor(config)}_v${startVersion}.safetensors`) return loop;
  // The existing loop reads its starting score from the character's validate directory. Populate
  // that directory using the original model before starting; never rename or copy shared models.
  return `${buildValidateCommand(config, startVersion, ownerSub, startModelName)}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${loop}`;
}

/**
 * PowerShell that signs one request under the task's callback grant (lora-callback-grants.ts
 * contract): it reads OSHAL_LORA_CALLBACK_GRANT, derives the key, and defines Get-LoraHeaders,
 * which returns fresh grant/owner/timestamp/nonce/signature headers for METHOD|path|ts|nonce|sha256(body).
 */
function psCallbackSigner(ownerSubB64: string): string {
  return `$grant=[string]$env:OSHAL_LORA_CALLBACK_GRANT; $gp=$grant.Split('.'); `
    + `if ($gp.Length -ne 2) { throw 'LoRA callback grant is missing' }; `
    + `$sha=[Security.Cryptography.SHA256]::Create(); `
    + `$key=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('oshal-lora-callback-grant-v1:'+$gp[1])); `
    + `function Get-LoraHeaders([string]$m,[string]$p,[byte[]]$b) { `
    + `$ts=[string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $n=[Guid]::NewGuid().ToString('N'); `
    + `$bh=-join ($sha.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }); `
    + `$mac=[Security.Cryptography.HMACSHA256]::new($key); `
    + `$sig=-join ($mac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$m|$p|$ts|$n|$bh")) | ForEach-Object { $_.ToString('x2') }); `
    + `@{'x-lora-callback-grant'=$gp[0];'x-lora-callback-owner'=${psLiteral(ownerSubB64)};'x-lora-callback-timestamp'=$ts;'x-lora-callback-nonce'=$n;'x-lora-callback-signature'=$sig} }`;
}

/** Magic-byte and size check that keeps a mislabeled or non-image artifact out of the training set. */
function psImageCheck(): string {
  return `$png=($bytes.Length -ge 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4e -and $bytes[3] -eq 0x47 -and $bytes[4] -eq 0x0d -and $bytes[5] -eq 0x0a -and $bytes[6] -eq 0x1a -and $bytes[7] -eq 0x0a); `
    + `$jpg=($bytes.Length -ge 3 -and $bytes[0] -eq 0xff -and $bytes[1] -eq 0xd8 -and $bytes[2] -eq 0xff); `
    + `$webp=($bytes.Length -ge 12 -and [Text.Encoding]::ASCII.GetString($bytes,0,4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($bytes,8,4) -eq 'WEBP'); `
    + `if ($bytes.Length -eq 0 -or $bytes.Length -gt ${MAX_DATASET_IMAGE_BYTES} -or !($png -or $jpg -or $webp)) { throw 'dataset artifact is not a bounded PNG, JPEG, or WebP' }`;
}

/**
 * @description The box-side statements that place a downloaded image in the character's curated
 * directory: create the directory, move the checked temp file (`$temp`) to its final name, and
 * write the caption beside it as UTF-8 without a BOM. The three paths are PowerShell double-quoted
 * expandable strings (psBoxPath), because the box root defaults to `$env:USERPROFILE/...` and the
 * worker must expand it; the caption is user content and stays a single-quoted literal. Exported
 * so the real-PowerShell regression guard runs exactly the shipped statements.
 * @param config - The owner-resolved character whose immutable curated directory receives the image.
 * @param filename - A safe basename (isSafeDatasetFilename) chosen by the controller.
 * @param caption - The bounded caption paired with the image.
 * @returns Three `;`-joined PowerShell statements that expect `$temp` to name the downloaded file.
 */
export function buildDatasetWriteFragment(config: LoraCharacterConfig, filename: string, caption: string): string {
  if (!isSafeDatasetFilename(filename)) throw new Error('dataset filename is invalid');
  if (caption.includes('\0') || Buffer.byteLength(caption, 'utf8') > 2048) throw new Error('dataset caption is invalid or too large');
  const dataset = `${boxRootFor(config)}/curated`;
  const imagePath = `${dataset}/${filename}`;
  const captionPath = imagePath.replace(/\.[^.]+$/, '.txt');
  // New-Item has no -LiteralPath on Windows PowerShell 5.1; the charset psBoxPath admits holds no
  // wildcard character, so -Path cannot glob. Move-Item and the .NET call take the path literally.
  return `New-Item -ItemType Directory -Force -Path ${psBoxPath(dataset)} | Out-Null; `
    + `Move-Item -Force -LiteralPath $temp -Destination ${psBoxPath(imagePath)}; `
    + `[IO.File]::WriteAllText(${psBoxPath(captionPath)}, ${psLiteral(caption)}, [Text.UTF8Encoding]::new($false))`;
}

/**
 * @description Download one staged dataset image from the controller's exact-owner worker route,
 * validate its image bytes before the final move, write the caption beside it, then report the
 * durable dataset entry. Any failure (fetch, validation, write) posts a `failed` callback before the
 * task ends in error, so the receipt never stays queued. Every request is signed with the task's
 * callback grant, which the dispatcher places in the environment; neither the fleet secret nor a
 * user directory enters this task.
 * @param config - The owner-resolved character whose immutable curated directory receives the image.
 * @param imageId - The owner's staged receipt id (served by POST /api/lora/ingest/dataset-download/:imageId).
 * @param filename - A safe basename chosen by the controller from the sniffed image type.
 * @param caption - The bounded caption paired with the image.
 * @param ownerSub - The exact owner carried to both the download and the callback.
 * @returns A gated PowerShell command for shell.exec.
 */
export function buildDatasetImportCommand(
  config: LoraCharacterConfig,
  imageId: string,
  filename: string,
  caption: string,
  ownerSub: string,
): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) throw new Error('dataset image id is invalid');
  const write = buildDatasetWriteFragment(config, filename, caption);
  const controller = controllerCallbackUrl();
  const ownerSubB64 = Buffer.from(ownerSub, 'utf8').toString('base64url');
  const stagedUrl = `${controller}/api/lora/ingest/dataset-download/${imageId.toLowerCase()}`;
  const callbackUrl = `${controller}/api/lora/ingest`;
  // The signed target is the path the controller receives, so it is derived from the same URL.
  const stagedPath = new URL(stagedUrl).pathname;
  const callbackPath = new URL(callbackUrl).pathname;
  const identity = `kind='dataset'; character=${psLiteral(boxSubjectFor(config))}; filename=${psLiteral(filename)}`;
  const report = (fields: string) => `$cb=[Text.Encoding]::UTF8.GetBytes((@{${identity}; ${fields}} | ConvertTo-Json -Compress)); `
    + `Invoke-RestMethod -Method Post -Uri ${psLiteral(callbackUrl)} -Headers (Get-LoraHeaders 'POST' ${psLiteral(callbackPath)} $cb) `
    + `-ContentType 'application/vnd.oshal.lora-callback+json' -Body $cb | Out-Null`;
  return `$ErrorActionPreference='Stop'; ${psCallbackSigner(ownerSubB64)}; $temp=[IO.Path]::GetTempFileName(); try { `
    + `Invoke-WebRequest -UseBasicParsing -Method Post -Uri ${psLiteral(stagedUrl)} -Headers (Get-LoraHeaders 'POST' ${psLiteral(stagedPath)} ([byte[]]@())) -OutFile $temp; `
    + `$bytes=[IO.File]::ReadAllBytes($temp); ${psImageCheck()}; `
    + `${write}; `
    + `${report("status='ready'; byte_size=$bytes.Length")}; `
    + `} catch { $failure=$_; try { ${report("status='failed'")} } catch { Write-Warning 'dataset failure callback was not delivered' }; throw $failure } `
    + `finally { if (Test-Path -LiteralPath $temp) { Remove-Item -Force -LiteralPath $temp } }`;
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
