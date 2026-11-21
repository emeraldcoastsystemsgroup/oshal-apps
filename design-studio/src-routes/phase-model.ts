/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D1, lane @ds-app: the process as data. The fixed phase
 *                     |                             | vocabulary (brief, design, mechanical, electrical, sensors,
 *                     |                             | controller, simulate, fabricate, build) in its one order, the
 *                     |                             | engines a phase may bind to, what each phase must produce and
 *                     |                             | what closes it (the phase brief the persona reads), the
 *                     |                             | proposal of a chain from a brief's requirement lines (the rules
 *                     |                             | are named per phase in the answer, so a person sees why a phase
 *                     |                             | is there), and the validation of a chain, a binding and a
 *                     |                             | closure. No number of any machine lives here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the fabricate brief says what the print
 *                     |                             | set is now that this package makes it (every part exported once
 *                     |                             | through CAD Studio, a sheet from the parts' own fields, the BOM,
 *                     |                             | a sha256 manifest) and what closes the phase (a finished set at
 *                     |                             | the current design revision with no part unprintable).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B15: add named Pi bay thermal solve option (`thermalSolve`)
 *                     |                             | on Brief and honest reasoned-phase closure helpers (`closureHonesty`,
 *                     |                             | `honestEvidence`) so reasoned closures explicitly state no engine measured them.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | 0.4.14 (found by the non-administrator proof, BACKLOG B12): a cad-models artifact must carry its list of parts (artifact.modelIds). The design partner, after its cad-create order had built and bound a part, bound the phase again with an artifact that named the part another way and carried no list; the bind was accepted, the list was gone, and the Design poster read no part bound. Such a bind is now refused by field, in words that say the order bound the part already; and a bind on Design that carries no list at all while parts are bound (the partner also used kinds of its own) is refused the same way by refuseDroppedParts, which the bind route calls with the newest binding.
 */

/** @description The phase vocabulary, in the one order a chain carries its subset. */
export const PHASE_KINDS = ['brief', 'design', 'mechanical', 'electrical', 'sensors', 'controller', 'simulate', 'fabricate', 'build'] as const;
export type PhaseKind = typeof PHASE_KINDS[number];

/** @description The engines a phase may bind to: the package whose artifact it produces, or `reasoned` when no engine on the swarm solves it. */
export const ENGINES = ['cad-studio', 'circuit-lab', 'embodied', 'scan-to-print', 'reasoned'] as const;
export type Engine = typeof ENGINES[number];


/** @description One phase of a project's chain: its kind, the engine bound to it and the engine-specific settings a page or a tool set. */
export interface PhaseEntry {
  kind: PhaseKind;
  engine: Engine;
  /** Why the proposal put the phase in the chain (the requirement lines that asked for it); kept so the page can say it. */
  why?: string;
  /** Fabricate only: the print service printer the set goes to. */
  printerId?: string;
}

/** @description What a phase must produce, which engines can, and what closes it - the phase brief (D3). */
export interface PhaseBrief {
  kind: PhaseKind;
  title: string;
  produces: string;
  engines: readonly Engine[];
  /** The engine a proposal binds first when nothing else is known. */
  defaultEngine: Engine;
  closes: string;
  /** The stage words the page computes on read, in order (D2). */
  stages: readonly string[];
  /** The poster's one action, in the ADR's words. */
  action: string;
}

/** @description Named thermal solve options in the brief (B15): no thermal engine exists on this shelf yet. */
export const THERMAL_SOLVE_MODES = ['none', 'pi-bay'] as const;
export type ThermalSolveMode = typeof THERMAL_SOLVE_MODES[number];
export interface ThermalSolveOption {
  mode: ThermalSolveMode;
  status: 'not-requested' | 'reasoned-unmeasured';
  note?: string;
}

/** @description Standard honesty notice attached to closures of reasoned phases with no measuring engine (B15). */
export const UNMEASURED_CLOSURE_NOTICE = 'no engine measured this phase (reasoned only)';

/** @description Honesty classification for a phase closure (B15). */
export interface ClosureHonesty {
  engine: Engine;
  measuredByEngine: boolean;
  reasonedOnly: boolean;
  unmeasuredNotice: string | null;
}

/** @description A product's brief: the walkthrough's answers (D4) and optional named thermal solve choice (B15). */
export interface Brief {
  what: string;
  requirements: string[];
  targets: { massG?: number; sizeMm?: string; costUsd?: number; runtimeMin?: number };
  thermalSolve?: ThermalSolveOption;
}

const brief = (kind: PhaseKind, title: string, produces: string, engines: readonly Engine[], defaultEngine: Engine, closes: string, stages: readonly string[], action: string): PhaseBrief =>
  Object.freeze({ kind, title, produces, engines, defaultEngine, closes, stages, action });

/** @description The phase briefs, one per kind: the ADR-203 table as data. */
export const PHASE_BRIEFS: Readonly<Record<PhaseKind, PhaseBrief>> = Object.freeze({
  brief: brief('brief', 'Brief', 'the product in words: what it is, what it must do (one requirement per line) and its targets (mass, size, cost, runtime)', ['reasoned'], 'reasoned',
    'the person says the brief is right (Confirm the brief); a later edit of the brief re-opens it', ['drafted', 'agreed'], 'Confirm the brief'),
  design: brief('design', 'Design', 'the parts model: every printed part as a CAD Studio program, the bought rows, the mass budget, the joint loads', ['cad-studio', 'embodied', 'reasoned'], 'cad-studio',
    'the budget closes, every load sits inside its rating, every printed part has a program (parts-complete)', ['concept', 'sized', 'parts-complete'], 'Open in CAD Studio'),
  mechanical: brief('mechanical', 'Mechanical spec', 'every actuator sized from its worst stance against the row it is built on', ['embodied', 'reasoned'], 'reasoned',
    'every joint sits inside its continuous torque', ['unsized', 'over-torque', 'sized'], 'Open the design'),
  electrical: brief('electrical', 'Electrical and power spec', 'the bus, the pack, the regulators, solved as one transient on the circuit engine', ['circuit-lab', 'reasoned'], 'circuit-lab',
    'the rails hold under stall and the runtime is stated by the solve', ['drafted', 'solved', 'holds'], 'Open in Circuit Lab'),
  sensors: brief('sensors', 'Sensors', 'each sense with where it is mounted, at what rate, and who reads it', ['embodied', 'reasoned'], 'reasoned',
    'each sense has a mount, a rate and a reader', ['unspecified', 'specified'], 'Open the design'),
  controller: brief('controller', 'Controller', 'one program for the plant and the hardware, a node on the rail speaking the body contract', ['embodied', 'reasoned'], 'embodied',
    'the node runs the contract on a body (a node of the kind is on the rail)', ['nothing-on-the-rail', 'engine-ready', 'on-the-rail'], 'Node status'),
  simulate: brief('simulate', 'Simulate and train', 'the plant, a deterministic baseline, a trained policy, and the certification gate', ['embodied', 'reasoned'], 'embodied',
    'a certificate bound to the policy hash and the engine build', ['baseline', 'trained', 'certified'], 'Run the baselines'),
  fabricate: brief('fabricate', 'Fabricate', 'the print set: every printed part exported once through CAD Studio\'s kernel as a watertight STL, a print sheet from the parts\' own fields (count, material, orientation, layer height, supports, notes), the BOM from the bought rows, and a manifest with the sha256 of every file; a printer registered with the print service takes one file at a time', ['scan-to-print', 'cad-studio', 'embodied', 'reasoned'], 'scan-to-print',
    'a finished print set exists for the current design revision, every file in it is watertight and no part is unprintable (the manifest says so); the closure records the manifest\'s sha256', ['unprintable', 'printable', 'fabricated'], 'Make the print set'),
  build: brief('build', 'Build and test', 'the physical assembly in order, bring-up on real actuators, the certified brain on the body', ['reasoned'], 'reasoned',
    'only the bench closes it: a person ticks every step; no software closes this phase', ['not-started', 'in-progress', 'bench-complete'], 'Start the build'),
});

/** The rules a proposal reads the requirement lines with: a phase appears when one of its patterns matches a line. */
const RULES: Readonly<Record<Exclude<PhaseKind, 'brief' | 'design' | 'fabricate' | 'build'>, RegExp>> = Object.freeze({
  mechanical: /\b(servo|motor|joint|leg|legs|arm|wheel|gear|actuat|torque|lift|carr(?:y|ies)|load|hinge|spring|jump)/i,
  electrical: /\b(motor|servo|batter|pack|power|volt|pi|raspberry|arduino|led|circuit|electr|charg|solar|usb|regulator|sensor|lidar|camera|comput)/i,
  sensors: /\b(sensor|lidar|camera|eye|eyes|imu|see|sees|detect|measur|microphone|hear|touch|rang)/i,
  controller: /\b(control|software|program|brain|autonom|walk|drive|fly|flies|navigat|jump|flip|balanc|self|node)/i,
  simulate: /\b(walk|run|jump|fly|flies|drive|balanc|gait|flip|swim|legs|hover|train|polic)/i,
});

/** A thermal need has no engine on this shelf (ADR-203 Consequences); it is named in the proposal, not silently dropped. */
const THERMAL = /\b(heat|thermal|cool|cold|freez|refrigerat|temperature)/i;

/** @description One proposed phase: the kind, the engine the proposal binds, and the lines that asked for it. */
export interface ProposedPhase extends PhaseEntry { why: string }

/** @description What a proposal answers: the chain, and the needs no engine on this shelf solves. */
export interface Proposal { phases: ProposedPhase[]; unsolved: string[] }

/** @description The requirement lines that match a rule, as one `why` sentence. */
function matched(lines: string[], rule: RegExp): string[] {
  return lines.filter((line) => rule.test(line));
}

/**
 * @description Propose the phase chain for a brief from its requirement lines: brief, design, fabricate and build are
 * every product's; mechanical, electrical, sensors, controller and simulate appear when a line asks for them, and each
 * says which lines did. A hanger ("holds a coat") gets four phases; a walking machine gets all nine.
 * @param b - The brief.
 * @returns The chain in vocabulary order with the engine per phase, and the needs no engine solves.
 */
export function proposePhases(b: Brief): Proposal {
  const lines = (b.requirements || []).map((l) => String(l).trim()).filter(Boolean);
  const all = [b.what, ...lines].filter(Boolean);
  const phases: ProposedPhase[] = [];
  const add = (kind: PhaseKind, why: string, engine?: Engine): void => { phases.push({ kind, engine: engine ?? PHASE_BRIEFS[kind].defaultEngine, why }); };
  add('brief', 'every product starts as words');
  add('design', 'every product has parts');
  const hits: Partial<Record<keyof typeof RULES, string[]>> = {};
  for (const kind of Object.keys(RULES) as (keyof typeof RULES)[]) hits[kind] = matched(all, RULES[kind]);
  const moving = (hits.controller || []).length > 0 && (hits.simulate || []).length > 0;
  if (hits.mechanical?.length) add('mechanical', `moving parts or loads: ${hits.mechanical.join('; ')}`, 'reasoned');
  if (hits.electrical?.length) add('electrical', `powered: ${hits.electrical.join('; ')}`);
  if (hits.sensors?.length) add('sensors', `senses: ${hits.sensors.join('; ')}`, 'reasoned');
  if (hits.controller?.length) add('controller', `behaviour: ${hits.controller.join('; ')}`, 'embodied');
  if (moving) add('simulate', `it moves, so the plant decides: ${(hits.simulate || []).join('; ')}`, 'embodied');
  add('fabricate', 'every product is made');
  add('build', 'every product is assembled and tested on the bench');
  const unsolved = matched(lines, THERMAL).map((line) => `${line} - a thermal phase has no engine on this shelf (ADR-203); it stays a requirement the brief carries`);
  if (b.thermalSolve?.mode === 'pi-bay') {
    unsolved.push('Pi bay thermal solve - no thermal engine exists on this shelf (B15); tracked in the brief as reasoned/unmeasured until a thermal engine is bound');
  }
  return { phases: orderPhases(phases), unsolved };
}

/**
 * @description The chain in vocabulary order, each kind at most once.
 * @param phases - Entries in any order.
 * @returns The same entries ordered by the vocabulary.
 */
export function orderPhases<T extends PhaseEntry>(phases: T[]): T[] {
  const seen = new Set<PhaseKind>();
  return PHASE_KINDS.flatMap((kind) => {
    const entry = phases.find((p) => p.kind === kind);
    if (!entry || seen.has(kind)) return [];
    seen.add(kind);
    return [entry];
  });
}

/** @description A refusal the routes answer with a status, a code and the field it names. */
export class ModelError extends Error {
  constructor(message: string, readonly code: string, readonly field: string, readonly status = 400) { super(message); this.name = 'ModelError'; }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const engineOf = (v: unknown): v is Engine => typeof v === 'string' && (ENGINES as readonly string[]).includes(v);
const kindOf = (v: unknown): v is PhaseKind => typeof v === 'string' && (PHASE_KINDS as readonly string[]).includes(v);
const CAP = 2000;

/**
 * @description Validate a chain as a tool or the page sends it: an array of {kind, engine, ...} with every kind in the
 * vocabulary and every engine one the phase brief allows; it is returned in vocabulary order. Brief and build are never absent.
 * @param value - The body's `phases`.
 * @returns The validated chain.
 * @throws ModelError naming the field.
 */
export function validatePhases(value: unknown): PhaseEntry[] {
  if (!Array.isArray(value) || !value.length) throw new ModelError('phases must be a non-empty array of {kind, engine}', 'bad_phases', 'phases');
  const out: PhaseEntry[] = value.map((raw, i) => {
    if (!isRecord(raw) || !kindOf(raw.kind)) throw new ModelError(`phases[${i}].kind must be one of ${PHASE_KINDS.join(', ')}`, 'unknown_phase', `phases[${i}].kind`);
    const engine = raw.engine === undefined ? PHASE_BRIEFS[raw.kind].defaultEngine : raw.engine;
    if (!engineOf(engine) || !PHASE_BRIEFS[raw.kind].engines.includes(engine)) throw new ModelError(`phases[${i}].engine must be one of ${PHASE_BRIEFS[raw.kind].engines.join(', ')} for ${raw.kind}`, 'unknown_engine', `phases[${i}].engine`);
    const entry: PhaseEntry = { kind: raw.kind, engine };
    if (typeof raw.why === 'string' && raw.why.trim()) entry.why = raw.why.trim().slice(0, CAP);
    if (raw.printerId !== undefined) {
      if (raw.kind !== 'fabricate' || typeof raw.printerId !== 'string') throw new ModelError('printerId is a string on the fabricate phase', 'bad_printer', `phases[${i}].printerId`);
      entry.printerId = raw.printerId.slice(0, 200);
    }
    return entry;
  });
  const ordered = orderPhases(out);
  if (ordered.length !== out.length) throw new ModelError('a phase kind appears twice', 'duplicate_phase', 'phases');
  if (!ordered.some((p) => p.kind === 'brief') || !ordered.some((p) => p.kind === 'build')) throw new ModelError('every chain starts with brief and ends with build', 'bad_phases', 'phases');
  return ordered;
}

/** The targets a brief may carry and how each is read. */
const TARGETS: ReadonlyArray<[keyof Brief['targets'], 'number' | 'string']> = [['massG', 'number'], ['sizeMm', 'string'], ['costUsd', 'number'], ['runtimeMin', 'number']];

/** Validate optional `brief.thermalSolve` (B15): accepts boolean, mode string, or `{mode, note?}`. */
export function validateThermalSolve(raw: unknown): ThermalSolveOption | undefined {
  if (raw === undefined || raw === null || raw === false || raw === '' || raw === 'none') return undefined;
  if (raw === true || raw === 'pi-bay') return { mode: 'pi-bay', status: 'reasoned-unmeasured' };
  if (isRecord(raw)) {
    const mode = raw.mode;
    if (typeof mode !== 'string' || !(THERMAL_SOLVE_MODES as readonly string[]).includes(mode)) {
      throw new ModelError(`brief.thermalSolve.mode must be one of ${THERMAL_SOLVE_MODES.join(', ')}`, 'bad_brief', 'brief.thermalSolve');
    }
    if (mode === 'none') return undefined;
    const note = typeof raw.note === 'string' ? raw.note.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
    return { mode: 'pi-bay', status: 'reasoned-unmeasured', ...(note ? { note } : {}) };
  }
  throw new ModelError(`brief.thermalSolve must be a boolean, one of ${THERMAL_SOLVE_MODES.join(', ')}, or {mode, note?}`, 'bad_brief', 'brief.thermalSolve');
}

/**
 * @description Validate a brief: `what` one line, `requirements` one per line (at most 60, each at most 300 characters), optional targets and optional thermalSolve.
 * @param value - The body's `brief`.
 * @returns The validated brief.
 * @throws ModelError naming the field.
 */
export function validateBrief(value: unknown): Brief {
  if (!isRecord(value)) throw new ModelError('brief must be an object {what, requirements, targets}', 'bad_brief', 'brief');
  const what = typeof value.what === 'string' ? value.what.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
  if (!what) throw new ModelError('brief.what is one line saying what the product is', 'bad_brief', 'brief.what');
  const raw = Array.isArray(value.requirements) ? value.requirements : typeof value.requirements === 'string' ? value.requirements.split(/\r?\n/) : [];
  const requirements = raw.map((l) => String(l).trim().slice(0, 300)).filter(Boolean).slice(0, 60);
  const targets: Brief['targets'] = {};
  const t = isRecord(value.targets) ? value.targets : {};
  for (const [key, type] of TARGETS) {
    const v = t[key];
    if (v === undefined || v === null || v === '') continue;
    if (type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new ModelError(`brief.targets.${key} must be a positive number`, 'bad_brief', `brief.targets.${key}`);
      (targets as Record<string, unknown>)[key] = n;
    } else (targets as Record<string, unknown>)[key] = String(v).trim().slice(0, 120);
  }
  const thermalSolve = validateThermalSolve(value.thermalSolve);
  return { what, requirements, targets, ...(thermalSolve ? { thermalSolve } : {}) };
}

/** @description A bound artifact: the engine, what kind of artifact, its reference by name/id, and the engine's reply as read (never a copy of a number typed by hand). */
export interface Artifact {
  engine: Engine;
  kind: string;
  /** The engine reply excerpt the binding was read from, with the route and the moment; what the body contract publishes. */
  read?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * @description Validate an artifact to bind: an engine from the vocabulary that the phase allows, a `kind` word, and at most 64 KB of reference.
 * @param kind - The phase being bound.
 * @param value - The body's `artifact`.
 * @returns The validated artifact.
 * @throws ModelError naming the field.
 */
export function validateArtifact(kind: PhaseKind, value: unknown): Artifact {
  if (!isRecord(value)) throw new ModelError('artifact must be an object {engine, kind, ...reference}', 'bad_artifact', 'artifact');
  if (!engineOf(value.engine) || !PHASE_BRIEFS[kind].engines.includes(value.engine)) throw new ModelError(`artifact.engine must be one of ${PHASE_BRIEFS[kind].engines.join(', ')} for ${kind}`, 'unknown_engine', 'artifact.engine');
  if (typeof value.kind !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(value.kind)) throw new ModelError('artifact.kind is a short lowercase word naming the artifact kind (design-fit, certificate, circuit-design, cad-models, node, print-set, ...)', 'bad_artifact', 'artifact.kind');
  if (value.read !== undefined && !isRecord(value.read)) throw new ModelError('artifact.read is the engine reply excerpt as an object', 'bad_artifact', 'artifact.read');
  // A cad-models artifact IS the list of the person's CAD Studio parts bound to Design: one without the list replaces the bound parts with none.
  if (value.kind === 'cad-models' && !(Array.isArray(value.modelIds) && value.modelIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 80))) {
    throw new ModelError('a cad-models artifact lists the bound CAD Studio parts in artifact.modelIds (their model ids); a part a cad-create order built is bound already, so read the product instead of binding it again', 'bad_artifact', 'artifact.modelIds');
  }
  const text = JSON.stringify(value);
  if (text.length > 64 * 1024) throw new ModelError('artifact is larger than 64 KB; bind a reference and the excerpt the contract needs, never a whole report', 'bad_artifact', 'artifact');
  return JSON.parse(text) as Artifact;
}

/**
 * @description Refuse a bind on Design that would unbind CAD Studio parts by leaving their list out. The list changes only by a
 * bind that carries one (an order that builds a part, Settings, an empty list to unbind on purpose); an artifact that names a
 * part another way would replace the list with nothing.
 * @param current - The newest Design artifact, or null. @param next - The validated artifact about to be bound.
 * @returns Nothing.
 * @throws ModelError `bad_artifact` on `artifact.modelIds` (409) when parts are bound and the new artifact carries no list.
 */
export function refuseDroppedParts(current: Artifact | null | undefined, next: Artifact): void {
  const held = current && current.engine === 'cad-studio' && Array.isArray(current.modelIds) ? current.modelIds : [];
  if (!held.length || next.engine !== 'cad-studio' || Array.isArray(next.modelIds)) return;
  throw new ModelError(`this bind would unbind the ${held.length} CAD Studio part${held.length === 1 ? '' : 's'} bound to Design: an artifact for Design on CAD Studio carries its parts in artifact.modelIds. A part a cad-create order built is bound already, so read the product instead of binding it again`, 'bad_artifact', 'artifact.modelIds', 409);
}

/** @description A closure as validated: the evidence line, the revision it was read at, an optional checklist step and who closed. */
export interface ClosureInput { evidence: string; revision: string; step: string | null; by: string }

/**
 * @description Validate a closure (D2): refused as `missing_evidence` without BOTH an evidence line and the artifact revision it was
 * read from; the build phase also needs the checklist step it ticks (D8).
 * @param kind - The phase being closed.
 * @param body - The request body.
 * @returns The validated closure.
 * @throws ModelError `missing_evidence` (422) or naming the field.
 */
export function validateClosure(kind: PhaseKind, body: Record<string, unknown>): ClosureInput {
  const evidence = typeof body.evidence === 'string' ? body.evidence.trim().replace(/\s+/g, ' ').slice(0, CAP) : '';
  const revision = body.revision === undefined || body.revision === null ? '' : String(body.revision).trim().slice(0, 200);
  if (!evidence || !revision) throw new ModelError('a closure needs the engine\'s evidence line AND the artifact revision it was read from', 'missing_evidence', !evidence ? 'evidence' : 'revision', 422);
  const step = typeof body.step === 'string' && body.step.trim() ? body.step.trim().slice(0, 120) : null;
  if (kind === 'build' && !step) throw new ModelError('the build phase closes one checklist step at a time: name the step', 'missing_step', 'step', 422);
  const by = typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 80) : 'person';
  return { evidence, revision, step, by };
}

/** @description True when a phase is reasoned with no verifying engine (excludes brief words and bench build). */
export function isReasonedPhase(entry: PhaseEntry): boolean {
  return entry.engine === 'reasoned' && entry.kind !== 'brief' && entry.kind !== 'build';
}

/** @description Compute honest measurement metadata for a phase closure (B15). */
export function closureHonesty(entry: PhaseEntry | undefined, hasEngineRead: boolean): ClosureHonesty {
  const engine: Engine = entry?.engine ?? 'reasoned';
  if (entry?.kind === 'brief' || entry?.kind === 'build') {
    return { engine, measuredByEngine: false, reasonedOnly: false, unmeasuredNotice: null };
  }
  if (engine !== 'reasoned' && hasEngineRead) {
    return { engine, measuredByEngine: true, reasonedOnly: false, unmeasuredNotice: null };
  }
  return { engine, measuredByEngine: false, reasonedOnly: true, unmeasuredNotice: UNMEASURED_CLOSURE_NOTICE };
}

/** @description Ensure a reasoned-only closure's persisted evidence line explicitly names that no engine measured it. */
export function honestEvidence(evidence: string, honesty: ClosureHonesty): string {
  if (!honesty.reasonedOnly || !honesty.unmeasuredNotice) return evidence;
  if (/no engine measured/i.test(evidence)) return evidence;
  return `${evidence} — ${honesty.unmeasuredNotice}`.slice(0, CAP);
}
