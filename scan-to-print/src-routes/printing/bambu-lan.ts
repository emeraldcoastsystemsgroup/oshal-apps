/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the Bambu Lab printer host, reached directly
 *                     |                             | on the LAN (no vendor cloud, no vendor plugin): the sliced
 *                     |                             | `.gcode.3mf` goes to the printer's storage over implicit FTPS,
 *                     |                             | and state and the start command travel over the printer's MQTT
 *                     |                             | broker. Registration reads the serial (certificate CN), model
 *                     |                             | code (device-CA name) and certificate fingerprint from the
 *                     |                             | printer itself; every later session refuses any other device.
 *                     |                             | A start is refused, never attempted, while the printer accepts
 *                     |                             | only vendor-signed commands (its `fun` flags carry
 *                     |                             | MQTT_SIGNATURE_REQUIRED unless LAN-only + Developer Mode is on),
 *                     |                             | while it is busy, or when no loaded AMS slot holds the sliced
 *                     |                             | material. Each start request carries its own sequence id and
 *                     |                             | only the printer's answer to THAT request (or a state push
 *                     |                             | naming this job) counts as started; starts on one printer are
 *                     |                             | serialised so two never race for the same idle state.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Second review: a caller's start decision (the service's re-read
 *                     |                             | of the owner's auto-start) is evaluated INSIDE the serialised
 *                     |                             | start, after the printer checks, immediately before the command
 *                     |                             | is published, and a failure to read it starts nothing; after an
 *                     |                             | acknowledged start the queue is held until the printer reports
 *                     |                             | it is busy (a printer may answer before its state moves), so the
 *                     |                             | next start sees the job; report predicates read only primitive
 *                     |                             | fields, so a malformed relayed report is simply no match.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The identity probe offers the broker TLS 1.2 at most, like the
 *                     |                             | session (BAMBU_MAX_TLS): P2S firmware 01.02.00.00 was
 *                     |                             | reported never to answer a TLS 1.3 hello, and registration would
 *                     |                             | report that nothing answered at the printer's address.
 */

import tls from 'node:tls';
import { randomInt } from 'node:crypto';
import { BAMBU_MAX_TLS, type BambuReport, BambuMqttSession, type TlsConnect } from './bambu-mqtt';
import { type TcpConnect, ftpsUpload } from './bambu-ftps';

/** @description Everything a Bambu session needs. */
export interface BambuProfile {
  /** LAN host or IP. */
  host: string;
  /** Printer serial (certificate CN). */
  serial: string;
  /** Certificate fingerprint pinned at registration. */
  certSha256: string;
  /** LAN access code. */
  accessCode: string;
  /** Vendor model code (P2S = N7), from the device CA. */
  modelId: string | null;
}

/** @description Normalised printer state. */
export interface BambuState {
  /** idle | preparing | printing | paused | finished | failed | unknown. */
  state: string;
  /** The vendor's own state word. */
  gcodeState: string | null;
  /** Percent complete. */
  percent: number | null;
  /** Minutes left. */
  remainingMinutes: number | null;
  /** Current layer. */
  layer: number | null;
  /** Layers in the job. */
  totalLayers: number | null;
  /** Job name on the printer. */
  job: string | null;
  /** True when storage (USB stick / SD card) is inserted. */
  storage: boolean | null;
  /** True when the printer accepts only vendor-signed commands. */
  signatureRequired: boolean;
  /** The vendor error code (hex) when one is set. */
  printError: string | null;
  /** Active health (HMS) codes, `AAAA-BBBB-CCCC-DDDD`. */
  hms: string[];
  /** Nozzle diameter the printer reports. */
  nozzle: string | null;
  /** AMS slots holding filament (global index) with their reported type. */
  trays: Array<{ index: number; type: string | null }>;
}

/** @description The `fun` bit a printer sets while it requires vendor-signed MQTT commands. */
export const MQTT_SIGNATURE_REQUIRED = 0x20000000;

/** @description Models that address their storage as `file:///sdcard/`; every newer one uses `ftp:///`. */
const SDCARD_URL_MODELS = new Set(['BL-P001', 'BL-P002', 'C13', 'C11', 'C12', 'N2S', 'N1']);

/** @description States in which a new job must not be started. */
const BUSY = new Set(['preparing', 'printing', 'paused']);

const STATE_WORDS: Record<string, string> = {
  IDLE: 'idle', PREPARE: 'preparing', SLICING: 'preparing', RUNNING: 'printing', PAUSE: 'paused', FINISH: 'finished', FAILED: 'failed',
};

/** @description A number or null. */
function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * @description Whether the printer's 64-bit `fun` flags carry the signature-required bit. Only the
 * low 32 bits are parsed (exactly: eight hex digits fit a double), so rounding of the full
 * 16-digit value can never flip the bit; a missing or malformed value reads as not set.
 * @param fun - The report's `fun` hex string.
 * @returns True when the printer requires vendor-signed commands.
 */
export function signatureRequired(fun: unknown): boolean {
  const hex = String(fun ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(hex)) return false;
  return (parseInt(hex.slice(-8), 16) & MQTT_SIGNATURE_REQUIRED) !== 0;
}

/** @description Loaded AMS trays as global indices with their reported filament type. */
function traysOf(ams: unknown): Array<{ index: number; type: string | null }> {
  const block = (ams && typeof ams === 'object' ? ams : {}) as Record<string, unknown>;
  const exist = parseInt(String(block.tray_exist_bits ?? '0'), 16) || 0;
  const types = new Map<number, string>();
  for (const unit of Array.isArray(block.ams) ? block.ams as Array<Record<string, unknown>> : []) {
    for (const tray of Array.isArray(unit.tray) ? unit.tray as Array<Record<string, unknown>> : []) {
      const index = Number(unit.id) * 4 + Number(tray.id);
      if (typeof tray.tray_type === 'string' && tray.tray_type) types.set(index, tray.tray_type);
    }
  }
  const out: Array<{ index: number; type: string | null }> = [];
  for (let index = 0; index < 32; index++) if (exist & (1 << index)) out.push({ index, type: types.get(index) ?? null });
  return out;
}

/** @description Active HMS codes as `AAAA-BBBB-CCCC-DDDD`. */
function hmsCodes(hms: unknown): string[] {
  if (!Array.isArray(hms)) return [];
  return (hms as Array<{ attr?: number; code?: number }>).map((h) => {
    const a = Number(h.attr) >>> 0, c = Number(h.code) >>> 0;
    return [a >>> 16, a & 0xffff, c >>> 16, c & 0xffff].map((v) => v.toString(16).toUpperCase().padStart(4, '0')).join('-');
  });
}

/**
 * @description Normalise a full `push_status` report.
 * @param print - The report's `print` object.
 * @returns The state the routes and tools speak.
 */
export function normaliseState(print: Record<string, unknown>): BambuState {
  const gcodeState = typeof print.gcode_state === 'string' ? print.gcode_state : null;
  const error = num(print.print_error);
  return {
    state: gcodeState ? STATE_WORDS[gcodeState] ?? gcodeState.toLowerCase() : 'unknown',
    gcodeState, percent: num(print.mc_percent), remainingMinutes: num(print.mc_remaining_time),
    layer: num(print.layer_num), totalLayers: num(print.total_layer_num),
    job: typeof print.subtask_name === 'string' && print.subtask_name ? print.subtask_name : null,
    storage: typeof print.sdcard === 'boolean' ? print.sdcard : null,
    signatureRequired: signatureRequired(print.fun),
    printError: error ? (error >>> 0).toString(16).toUpperCase().padStart(8, '0') : null,
    hms: hmsCodes(print.hms), nozzle: typeof print.nozzle_diameter === 'string' ? print.nozzle_diameter : null, trays: traysOf(print.ams),
  };
}

/** @description True for a full status push (it carries the job state). */
function isFullStatus(report: BambuReport): boolean {
  const print = report.print as Record<string, unknown> | undefined;
  return !!print && print.command === 'push_status' && typeof print.gcode_state === 'string';
}

let sequence = randomInt(1, 1_000_000);
/** @description A request id unique within this process and unlikely to collide with any other client's. */
function nextSequenceId(): string {
  sequence = (sequence + 1) % 1_000_000_000;
  return `${sequence}${randomInt(0, 1000).toString().padStart(3, '0')}`;
}

/** @description Ask for a full status push and wait for it on an open session. */
async function pushAll(session: BambuMqttSession, timeoutMs: number): Promise<BambuState | null> {
  session.clearReports();
  session.publish({ pushing: { sequence_id: nextSequenceId(), command: 'pushall' } });
  const report = await session.waitFor(isFullStatus, timeoutMs);
  return report ? normaliseState(report.print as Record<string, unknown>) : null;
}

/**
 * @description The AMS tray a job of `filamentType` should feed from, or why none may.
 * @param trays - Loaded trays.
 * @param filamentType - The sliced filament's type (PLA, PETG, …), when known.
 * @returns The tray (null = external spool), or a refusal when every typed tray holds another material.
 */
export function chooseTray(trays: BambuState['trays'], filamentType: string | null): { tray: BambuState['trays'][number] | null } | { refusal: string } {
  if (!trays.length) return { tray: null };
  if (!filamentType) return { tray: trays[0] };
  const wanted = filamentType.toUpperCase();
  const match = trays.find((t) => t.type && t.type.toUpperCase() === wanted);
  if (match) return { tray: match };
  const unknown = trays.find((t) => !t.type);
  if (unknown) return { tray: unknown };
  return { refusal: `no loaded AMS slot holds ${filamentType} (loaded: ${trays.map((t) => t.type).join(', ')}); load it or change this printer's filament in slice settings, then start it from the printer screen` };
}

/**
 * @description The `project_file` command that starts a stored `.gcode.3mf` (plate 1).
 * @param fileName - Name on the printer's storage.
 * @param modelId - Vendor model code (decides the storage URL form).
 * @param tray - The AMS tray to feed from, or null for the external spool.
 * @param sequenceId - This request's id; the printer echoes it in its answer.
 * @returns The request payload.
 */
export function projectFileCommand(fileName: string, modelId: string | null, tray: { index: number } | null, sequenceId: string): Record<string, unknown> {
  return {
    print: {
      sequence_id: sequenceId, command: 'project_file', param: 'Metadata/plate_1.gcode',
      url: modelId && SDCARD_URL_MODELS.has(modelId) ? `file:///sdcard/${fileName}` : `ftp:///${fileName}`,
      subtask_name: subtaskOf(fileName), project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0',
      bed_type: 'auto', bed_leveling: true, flow_cali: true, vibration_cali: true, layer_inspect: true, timelapse: false,
      use_ams: !!tray, ams_mapping: tray ? [tray.index] : [],
    },
  };
}

/** @description The job name a printer shows for a stored file. */
function subtaskOf(fileName: string): string { return fileName.replace(/\.gcode\.3mf$/i, ''); }

/** @description Socket factories and timeouts, injectable for specs. */
export interface BambuIo {
  /** TLS socket factory (MQTT, FTPS control and data). */
  connect?: TlsConnect;
  /** TCP socket factory (FTPS data channel before TLS). */
  connectTcp?: TcpConnect;
  /** Wait this long for a status push. */
  statusTimeoutMs?: number;
  /** Wait this long for the printer to acknowledge a start. */
  startTimeoutMs?: number;
}

/** @description Open a pinned broker session for one profile. */
async function session(profile: BambuProfile, io: BambuIo): Promise<BambuMqttSession> {
  const s = new BambuMqttSession({ host: profile.host, serial: profile.serial, certSha256: profile.certSha256, accessCode: profile.accessCode }, { connect: io.connect });
  await s.open();
  return s;
}

/**
 * @description Read the printer's state.
 * @param profile - The printer.
 * @param io - Socket seam.
 * @returns The state, or a reason it could not be read.
 */
export async function bambuStatus(profile: BambuProfile, io: BambuIo = {}): Promise<{ ok: true; state: BambuState } | { ok: false; message: string }> {
  let s: BambuMqttSession | null = null;
  try {
    s = await session(profile, io);
    const state = await pushAll(s, io.statusTimeoutMs ?? 10_000);
    return state ? { ok: true, state } : { ok: false, message: 'the printer did not report its state in time' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    s?.close();
  }
}

/** @description Outcome of a start attempt. `declined` means the caller's decision said not to start (not a failure). */
export interface StartOutcome { started: boolean; message: string; state: BambuState | null; declined?: boolean }

/** @description A last-moment start decision, evaluated inside the serialised start. */
export type StartGate = () => Promise<boolean>;

/** @description A report field as a string, only when it is a primitive. */
function text(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/** @description True for a state push showing the printer has taken a job. */
function showsBusy(p: Record<string, unknown>): boolean {
  return p.command === 'push_status' && ['PREPARE', 'RUNNING', 'SLICING'].includes(text(p.gcode_state) ?? '');
}

/** @description Wait for the printer's answer to THIS request (or a state push naming this job). */
async function awaitStart(s: BambuMqttSession, sequenceId: string, subtask: string, timeoutMs: number): Promise<{ started: boolean; message: string }> {
  const ack = await s.waitFor((r) => {
    const p = r.print as Record<string, unknown> | undefined;
    if (!p) return false;
    if (p.command === 'project_file') return text(p.sequence_id) === sequenceId;
    return showsBusy(p) && p.subtask_name === subtask;
  }, timeoutMs);
  const p = (ack?.print ?? null) as Record<string, unknown> | null;
  if (!p) return { started: false, message: 'the printer did not acknowledge the start command; check its screen' };
  if (p.command === 'project_file' && (text(p.result) ?? '').toLowerCase() !== 'success') {
    const reason = text(p.reason);
    return { started: false, message: `the printer refused the start command${reason ? `: ${reason}` : ''}` };
  }
  return { started: true, message: 'Uploaded and print started.' };
}

/** @description Evaluate a caller's start decision; a failure to read it means do not start. */
async function decide(gate: StartGate | undefined): Promise<{ go: boolean; error?: string }> {
  if (!gate) return { go: true };
  try { return { go: (await gate()) === true }; } catch (error) {
    return { go: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** @description Check, then (if the caller still says so) start, on an open session. */
async function startOnSession(s: BambuMqttSession, profile: BambuProfile, fileName: string, filamentType: string | null, io: BambuIo, gate?: StartGate): Promise<StartOutcome> {
  const state = await pushAll(s, io.statusTimeoutMs ?? 10_000);
  if (!state) return { started: false, message: 'the printer did not report its state, so nothing was started', state: null };
  if (state.signatureRequired) {
    return { started: false, state, message: 'the file is on the printer, but this printer only accepts start commands signed by the vendor\'s own apps — start it from the printer screen, or turn on LAN-only mode with Developer Mode to let oshal start prints' };
  }
  if (BUSY.has(state.state)) return { started: false, state, message: `the file is on the printer, but the printer is ${state.state}; nothing was started` };
  const choice = chooseTray(state.trays, filamentType);
  if ('refusal' in choice) return { started: false, state, message: `the file is on the printer, but ${choice.refusal}` };
  const decision = await decide(gate);
  if (decision.error) return { started: false, state, message: `the file is on the printer, but whether to start it could not be read (${decision.error}); nothing was started` };
  if (!decision.go) return { started: false, state, declined: true, message: 'the start was not requested' };
  const sequenceId = nextSequenceId();
  s.clearReports();
  s.publish(projectFileCommand(fileName, profile.modelId, choice.tray, sequenceId));
  const outcome = await awaitStart(s, sequenceId, subtaskOf(fileName), io.startTimeoutMs ?? 20_000);
  // Hold the queue until the printer reports it took the job: it may acknowledge before its state moves,
  // and the next queued start must see it busy.
  if (outcome.started) await s.waitFor((r) => showsBusy((r.print ?? {}) as Record<string, unknown>), io.startTimeoutMs ?? 20_000);
  return { ...outcome, state };
}

const startQueues = new Map<string, Promise<unknown>>();
/** @description Run `work` after every earlier start on the same printer has finished. */
function serialised<T>(serial: string, work: () => Promise<T>): Promise<T> {
  const previous = startQueues.get(serial) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(() => undefined, () => undefined);
  startQueues.set(serial, tail);
  void tail.then(() => { if (startQueues.get(serial) === tail) startQueues.delete(serial); });
  return run;
}

/**
 * @description Start a file already on the printer's storage, unless the printer forbids it, is
 * busy, or holds no matching material — and, when `gate` is given, only if it still says yes at the
 * moment the command would be published. Starts on one printer run one at a time.
 * @param profile - The printer.
 * @param fileName - The stored `.gcode.3mf`.
 * @param filamentType - Sliced filament type, for AMS tray choice.
 * @param io - Socket seam.
 * @param gate - Optional last-moment decision (the service's re-read of the owner's auto-start).
 * @returns Whether it started and why not.
 */
export function bambuStart(profile: BambuProfile, fileName: string, filamentType: string | null, io: BambuIo = {}, gate?: StartGate): Promise<StartOutcome> {
  return serialised(profile.serial, async () => {
    let s: BambuMqttSession | null = null;
    try {
      s = await session(profile, io);
      return await startOnSession(s, profile, fileName, filamentType, io, gate);
    } catch (error) {
      return { started: false, message: error instanceof Error ? error.message : String(error), state: null };
    } finally {
      s?.close();
    }
  });
}

/**
 * @description Upload a sliced `.gcode.3mf` to the printer's storage.
 * @param profile - The printer.
 * @param fileName - Name to store.
 * @param bytes - The archive.
 * @param io - Socket seam.
 * @returns The FTPS outcome.
 */
export function bambuUpload(profile: BambuProfile, fileName: string, bytes: Uint8Array, io: BambuIo = {}) {
  return ftpsUpload({ host: profile.host, serial: profile.serial, certSha256: profile.certSha256, accessCode: profile.accessCode, connect: io.connect, connectTcp: io.connectTcp }, fileName, bytes);
}

/**
 * @description Identify a printer from its broker certificate: serial (CN), model code (the
 * `BBL Device CA <model>-V<n>` issuer) and the certificate fingerprint to pin. No credentials are sent.
 * @param host - LAN host or IP.
 * @param io - Socket seam.
 * @returns The identity, or why it could not be read.
 */
export function probeBambuPrinter(host: string, io: BambuIo = {}): Promise<{ ok: true; serial: string; modelId: string | null; certSha256: string } | { ok: false; message: string }> {
  const connect = io.connect ?? tls.connect;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: Parameters<typeof resolve>[0]) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value); };
    const socket = connect({ host, port: 8883, rejectUnauthorized: false, maxVersion: BAMBU_MAX_TLS });
    const timer = setTimeout(() => finish({ ok: false, message: `nothing answered at ${host}:8883 — is this the printer's address?` }), 8_000);
    socket.on('error', (error) => finish({ ok: false, message: `could not reach ${host}:8883 (${error.message})` }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const subject = (cert?.subject ?? {}) as unknown as Record<string, unknown>;
      const issuer = (cert?.issuer ?? {}) as unknown as Record<string, unknown>;
      const serial = typeof subject.CN === 'string' ? subject.CN : '';
      const model = /BBL Device CA ([A-Z0-9-]+?)-V\d+$/.exec(String(issuer.CN ?? ''));
      if (!/^[A-Z0-9]{8,20}$/.test(serial) || !cert?.fingerprint256) { finish({ ok: false, message: `the device at ${host} is not a Bambu Lab printer (certificate names ${serial || 'nothing'})` }); return; }
      finish({ ok: true, serial, modelId: model ? model[1] : null, certSha256: cert.fingerprint256 });
    });
  });
}
