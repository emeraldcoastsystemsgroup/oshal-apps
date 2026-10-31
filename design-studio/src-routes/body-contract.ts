/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D6, lane @ds-app: the body contract `design-studio-body/1`
 *                     |                             | a project publishes for any brain trained outside this swarm. Every value is
 *                     |                             | read from the bound artifacts' engine-reply excerpts (the
 *                     |                             | design's servo row and joint loads, the plant's joint ranges
 *                     |                             | and timestep from its MJCF, the node's tick, the certificate's
 *                     |                             | sha): a value no bound read supplies is NAMED in `missing`,
 *                     |                             | never filled with a literal, and a contract missing a required
 *                     |                             | value is refused as body_incomplete. The only literals are the
 *                     |                             | contract's own words: the schema, the command vector's names,
 *                     |                             | the plant door and the sense vocabulary.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: a product whose plant is generated
 *                     |                             | from its mechanism (the simulate read's plant.kind is `plant`)
 *                     |                             | publishes its actuators from the engine's load reply (the
 *                     |                             | joint, its range in its own unit, the row's continuous and
 *                     |                             | stall torque and no-load rpm, the stated gear ratio), its
 *                     |                             | senses from the plant when the chain has no sensors phase, the
 *                     |                             | certified reach policy as the walker (command [payloadTargetM],
 *                     |                             | door `plant.step {command}`) and the plant route as the node.
 */

import type { Artifact, PhaseKind } from './phase-model';
import type { BindingRow, ProjectRow } from './project-store';

/** @description The contract's schema name. */
export const BODY_SCHEMA = 'design-studio-body/1';
/** @description The walker's command vector, in order: the names the certified gait's `hexapod.step {command}` door takes. */
export const WALKER_COMMAND = ['vx', 'vy', 'vyaw'] as const;
/** @description A generated plant's command: where the payload must go, in the world frame (the reach policy's `plant.step {command}` door). */
export const PLANT_COMMAND = ['payloadTargetM'] as const;
/** @description The sense vocabulary of a body; a sense not present in the design is published as absent. */
export const SENSE_NAMES = ['lidar', 'imu', 'joints', 'vision', 'audio', 'thermal', 'touch'] as const;

/** @description One actuator: the plant's joint name and range (radians for a hinge; metres for a slide, said by `unit`), the design row's torques and speed, and for a generated plant the stated gear ratio. */
export interface BodyActuator { joint: string; rangeRad: [number, number]; continuousNm: number | null; stallNm: number | null; noLoadRpm: number | null; unit?: 'rad' | 'm'; gearRatio?: number | null; type?: string }

/** @description One sense, present or absent, with what the reads stated about it. */
export interface BodySense { name: string; present: boolean; [key: string]: unknown }

/** @description The published contract. */
export interface BodyContract {
  schema: typeof BODY_SCHEMA;
  project: string;
  name: string;
  revision: string | null;
  plant: { engine: string | null; mjcf: string | null; physicsDt: number | null; tickS: number | null; kind?: 'plant'; specSha256?: string | null };
  actuators: BodyActuator[];
  senses: BodySense[];
  walker: { kind: 'certified-gait' | 'certified-policy' | 'none'; policySha256: string | null; certificate: string | null; command: readonly string[]; door: string };
  node: { kind: string | null; endpoint: string | null };
  /** The values no bound read supplied, named with the phase that would supply them. */
  missing: string[];
  readAt: Record<string, string>;
}

type Reads = Partial<Record<PhaseKind, Record<string, unknown>>>;
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const RAD_PER_S_TO_RPM = 60 / (2 * Math.PI);

/** The engine-reply excerpts, by phase, from the newest binding of each. */
function readsOf(bindings: Partial<Record<PhaseKind, BindingRow>>): { reads: Reads; artifacts: Partial<Record<PhaseKind, Artifact>>; readAt: Record<string, string> } {
  const reads: Reads = {}; const artifacts: Partial<Record<PhaseKind, Artifact>> = {}; const readAt: Record<string, string> = {};
  for (const [phase, row] of Object.entries(bindings) as [PhaseKind, BindingRow][]) {
    artifacts[phase] = row.artifact;
    const read = rec(row.artifact.read);
    if (read) { reads[phase] = read; const at = str(read.readAt); if (at) readAt[phase] = at; }
  }
  return { reads, artifacts, readAt };
}

/** The plant's joints from the simulate read (parsed from the MJCF by the page): name and range in radians. */
function plantJoints(read: Record<string, unknown> | undefined): Array<{ name: string; rangeRad: [number, number] }> {
  const plant = rec(read?.plant);
  const joints = Array.isArray(plant?.joints) ? plant!.joints : [];
  return joints.flatMap((j) => {
    const r = rec(j); const range = Array.isArray(r?.rangeRad) ? r!.rangeRad : null;
    const name = str(r?.name);
    return name && range && range.length === 2 && num(range[0]) !== null && num(range[1]) !== null ? [{ name, rangeRad: [Number(range[0]), Number(range[1])] as [number, number] }] : [];
  });
}

/** A generated plant's read (tools/design-studio-stages.js records the engine's load reply): plant.kind is `plant`. */
const isGeneratedPlant = (read: Record<string, unknown> | undefined): boolean => rec(read?.plant)?.kind === 'plant';

/** The actuators of a generated plant, from the engine's load reply: every number the row's or the mechanism's. */
function plantActuators(read: Record<string, unknown> | undefined, missing: string[]): BodyActuator[] {
  const plant = rec(read?.plant);
  const rows = Array.isArray(plant?.actuators) ? plant!.actuators.map(rec).filter((r): r is Record<string, unknown> => !!r && typeof r.joint === 'string') : [];
  if (!rows.length) { missing.push('actuators: the simulate phase has no plant read (the engine\'s load reply with its actuators)'); return []; }
  return rows.map((r) => {
    const range = Array.isArray(r.range) && r.range.length === 2 ? [Number(r.range[0]), Number(r.range[1])] as [number, number] : [Number.NaN, Number.NaN] as [number, number];
    const radS = num(r.noLoadRadS);
    return { joint: String(r.joint), rangeRad: range, unit: r.type === 'slide' ? 'm' : 'rad', type: str(r.type) ?? undefined, continuousNm: num(r.continuousNm), stallNm: num(r.stallNm), noLoadRpm: radS === null ? null : Math.round(radS * RAD_PER_S_TO_RPM * 100) / 100, gearRatio: num(r.gearRatio) };
  });
}

/** The actuators: the plant's joints joined with the design's joint rows (by joint type, the name's last word) and the servo row. */
function actuatorsOf(reads: Reads, missing: string[]): BodyActuator[] {
  if (isGeneratedPlant(reads.simulate)) return plantActuators(reads.simulate, missing);
  const design = reads.design;
  const joints = plantJoints(reads.simulate);
  if (!joints.length) { missing.push('actuators: the simulate phase has no plant read (the MJCF joints and ranges)'); return []; }
  const servo = rec(design?.servo);
  const rows = Array.isArray(design?.joints) ? design!.joints.map(rec).filter((r): r is Record<string, unknown> => !!r) : [];
  if (!servo) missing.push('actuators.stallNm / noLoadRpm: the design phase has no servo row read');
  if (!rows.length) missing.push('actuators.continuousNm: the design phase has no joint-load rows read');
  return joints.map((j) => {
    const type = j.name.split(/[-_]/).pop();
    const row = rows.find((r) => r.joint === type);
    const radS = num(servo?.noLoadRadS);
    return { joint: j.name, rangeRad: j.rangeRad, continuousNm: num(row?.usableNm), stallNm: num(servo?.stallNm) ?? num(row?.stallNm), noLoadRpm: radS === null ? null : Math.round(radS * RAD_PER_S_TO_RPM * 100) / 100 };
  });
}

/** The senses: what the sensors read states, every vocabulary name present or absent. */
function sensesOf(reads: Reads, actuators: BodyActuator[], missing: string[]): BodySense[] {
  const read = reads.sensors;
  const plantSenses = isGeneratedPlant(reads.simulate) && Array.isArray(rec(reads.simulate?.plant)?.senses) ? (rec(reads.simulate?.plant)!.senses as unknown[]) : [];
  const stated = Array.isArray(read?.senses) ? read!.senses.map(rec).filter((r): r is Record<string, unknown> => !!r && typeof r.name === 'string') : plantSenses.map(rec).filter((r): r is Record<string, unknown> => !!r && typeof r.name === 'string');
  if (!stated.length) missing.push('senses: the sensors phase has no read (which senses the design mounts)');
  const extra = stated.filter((s) => !(SENSE_NAMES as readonly string[]).includes(String(s.name))).map((s) => ({ ...s, name: String(s.name), present: s.present !== false }));
  return [...SENSE_NAMES.map((name) => {
    const s = stated.find((r) => r.name === name);
    if (!s) return { name, present: false };
    const out: BodySense = { ...s, name, present: s.present !== false };
    if (name === 'joints' && out.count === undefined && actuators.length) out.count = actuators.length;
    if (out.present && out.rateHz === undefined) missing.push(`senses.${name}.rateHz: no engine reply stated the rate`);
    return out;
  }), ...extra];
}

/**
 * @description Build the body contract from a project and the newest binding of each phase.
 * @param project - The project. @param bindings - Newest binding per phase.
 * @returns The contract, with `missing` naming every value no read supplied; `required` lists the missing values that refuse publication.
 */
export function buildBodyContract(project: ProjectRow, bindings: Partial<Record<PhaseKind, BindingRow>>): { body: BodyContract; required: string[] } {
  const missing: string[] = [];
  const { reads, artifacts, readAt } = readsOf(bindings);
  const actuators = actuatorsOf(reads, missing);
  const senses = sensesOf(reads, actuators, missing);
  const plant = rec(reads.simulate?.plant);
  const generated = isGeneratedPlant(reads.simulate);
  const cert = rec(reads.simulate?.certificate);
  const node = rec(reads.controller?.node);
  const tickHz = num(node?.tickHz) ?? (generated && num(plant?.controlDtS) ? 1 / (num(plant?.controlDtS) as number) : null);
  const physicsDt = num(plant?.physicsDt);
  if (physicsDt === null) missing.push('plant.physicsDt: the simulate phase has no plant read (the MJCF timestep)');
  if (tickHz === null) missing.push('plant.tickS: no engine reply stated the node\'s tick rate (the rail listing carries no tickHz)');
  const policySha256 = str(cert?.policySha256);
  if (!policySha256) missing.push('walker.policySha256: the simulate phase has no certificate read');
  else if (cert?.ok !== true) missing.push('walker: the bound certificate did not pass (ok is not true)');
  const nodeKind = str(node?.kind) ?? str(artifacts.controller?.nodeKind) ?? (generated && str(plant?.route) ? 'plant' : null);
  if (!nodeKind) missing.push('node.kind: the controller phase has no node read');
  const body: BodyContract = {
    schema: BODY_SCHEMA, project: project.id, name: project.name, revision: str(reads.design?.revision),
    plant: { engine: artifacts.simulate?.engine ?? null, mjcf: str(plant?.route), physicsDt, tickS: tickHz === null ? null : Math.round((1 / tickHz) * 1e6) / 1e6, ...(generated ? { kind: 'plant', specSha256: str(plant?.specSha256) } : {}) },
    actuators, senses,
    walker: generated
      ? { kind: policySha256 && cert?.ok === true ? 'certified-policy' : 'none', policySha256, certificate: str(cert?.file) ?? str(artifacts.simulate?.certificate), command: PLANT_COMMAND, door: 'plant.step {command}' }
      : { kind: policySha256 && cert?.ok === true ? 'certified-gait' : 'none', policySha256, certificate: str(cert?.file) ?? str(artifacts.simulate?.certificate), command: WALKER_COMMAND, door: 'hexapod.step {command}' },
    node: { kind: nodeKind, endpoint: str(node?.endpoint) ?? (generated && nodeKind === 'plant' ? str(plant?.route) : null) },
    missing, readAt,
  };
  const required = missing.filter((m) => /^(actuators:|plant\.physicsDt|walker\.policySha256|walker:|node\.kind)/.test(m));
  return { body, required };
}
