/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the MECHANISM of a design as data. The
 *                     |                             | part that is ground, the joints between parts (hinge, slide or
 *                     |                             | fixed; axis; range in radians or metres; where the child sits
 *                     |                             | in the parent's frame, mm), which bought motor row drives each
 *                     |                             | joint through what stated gear ratio, the payload the brief
 *                     |                             | names and the task read from the brief's requirement line
 *                     |                             | ("lifts 2 kg to 300 mm in 5 s" -> a displacement of the
 *                     |                             | payload, the load, the time). Validation refuses by name: a
 *                     |                             | joint whose part is not among the design's bound parts
 *                     |                             | (part_not_bound), a motor row the mechanism does not declare
 *                     |                             | (unknown_motor), a part hung from two joints or a loop (cycle),
 *                     |                             | every field by name (bad_mechanism). The plant spec embodied's
 *                     |                             | engine builds is composed here from the mechanism, the parts'
 *                     |                             | kernel reports and the motor rows AS READ -- no number of any
 *                     |                             | machine lives in this file.
 */

import { ModelError, type Artifact, type Brief } from './phase-model';

/** @description The joint types a mechanism declares, as the engine builds them. */
export const JOINT_TYPES = ['hinge', 'slide', 'fixed'] as const;
export type JointType = typeof JOINT_TYPES[number];
/** @description Where a motor row comes from: this package reads both through the person's session. */
export const MOTOR_SOURCES = ['embodied', 'circuit-lab'] as const;
export type MotorSource = typeof MOTOR_SOURCES[number];

/** @description One part of the mechanism: the design's part id (a CAD Studio program id or a model id) and the name shown. */
export interface MechanismPart { id: string; name: string; modelId: string | null }
/** @description One joint: parent and child parts, the type, the axis in the parent's frame, the range (rad for a hinge, m for a slide), the child's origin in the parent's frame (mm), the motor row that drives it and the stated gear ratio. */
export interface MechanismJoint { id: string; parent: string; child: string; type: JointType; axis: [number, number, number]; rangeRad: [number, number] | null; rangeM: [number, number] | null; originMm: [number, number, number]; drivenBy: string | null; gearRatio: number | null }
/** @description A motor row the mechanism declares: a reference to a bought row another package publishes; its numbers are read when the plant is built, never stored. */
export interface MechanismMotor { rowId: string; source: MotorSource }
/** @description The payload the brief names and the part it rides. */
export interface MechanismPayload { massKg: number; attachedTo: string; atMm: [number, number, number] | null }
/** @description The task the brief's line asks for: the payload's displacement, the load and the time. */
export interface MechanismTask { line: string | null; deltaMm: [number, number, number]; timeS: number; loadKg: number | null }
/** @description The mechanism as stored. */
export interface Mechanism { parts: MechanismPart[]; base: string; joints: MechanismJoint[]; motors: MechanismMotor[]; payload: MechanismPayload | null; task: MechanismTask | null }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const refuse = (message: string, code: string, field: string, status = 400): never => { throw new ModelError(message, code, field, status); };

function ident(v: unknown, field: string): string {
  if (typeof v !== 'string' || !ID.test(v)) refuse(`${field} must be a short id of letters, digits, - and _`, 'bad_mechanism', field);
  return v as string;
}
function vec3(v: unknown, field: string, fallback?: [number, number, number]): [number, number, number] {
  if (v === undefined || v === null) { if (fallback) return fallback; refuse(`${field} must be [x, y, z]`, 'bad_mechanism', field); }
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isFinite(Number(x)))) refuse(`${field} must be three numbers`, 'bad_mechanism', field);
  return (v as unknown[]).map(Number) as [number, number, number];
}
function range(v: unknown, field: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => Number.isFinite(Number(x))) || Number(v[1]) <= Number(v[0])) refuse(`${field} must be [lo, hi] with hi above lo`, 'bad_mechanism', field);
  return [Number((v as unknown[])[0]), Number((v as unknown[])[1])];
}
function positive(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) refuse(`${field} must be a positive number`, 'bad_mechanism', field);
  return n;
}

function parts(value: unknown): MechanismPart[] {
  if (!Array.isArray(value) || !value.length) refuse('parts must be a non-empty list of {id, name?, modelId?}', 'bad_mechanism', 'parts');
  const seen = new Set<string>();
  return (value as unknown[]).map((raw, i) => {
    if (!isRecord(raw)) refuse(`parts[${i}] must be an object`, 'bad_mechanism', `parts[${i}]`);
    const r = raw as Record<string, unknown>;
    const id = ident(r.id, `parts[${i}].id`);
    if (seen.has(id)) refuse(`parts[${i}].id ${id} appears twice`, 'bad_mechanism', `parts[${i}].id`);
    seen.add(id);
    return { id, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : id, modelId: typeof r.modelId === 'string' && r.modelId ? r.modelId.slice(0, 80) : null };
  });
}

function joint(raw: unknown, i: number, ids: Set<string>): MechanismJoint {
  const field = `joints[${i}]`;
  if (!isRecord(raw)) refuse(`${field} must be an object`, 'bad_mechanism', field);
  const r = raw as Record<string, unknown>;
  const id = ident(r.id, `${field}.id`);
  const parent = ident(r.parent, `${field}.parent`); const child = ident(r.child, `${field}.child`);
  for (const [key, pid] of [['parent', parent], ['child', child]] as const) if (!ids.has(pid)) refuse(`${field}.${key} names ${pid}, which is not a part of the mechanism`, 'part_not_bound', `${field}.${key}`, 422);
  if (parent === child) refuse(`${field} joins ${parent} to itself`, 'cycle', field, 422);
  const type = r.type;
  if (!(JOINT_TYPES as readonly unknown[]).includes(type)) refuse(`${field}.type must be one of ${JOINT_TYPES.join(', ')}`, 'bad_mechanism', `${field}.type`);
  const t = type as JointType;
  const axis = t === 'fixed' ? [0, 0, 1] as [number, number, number] : vec3(r.axis, `${field}.axis`);
  if (t !== 'fixed' && axis.every((x) => x === 0)) refuse(`${field}.axis must not be zero`, 'bad_mechanism', `${field}.axis`);
  const rangeRad = t === 'hinge' ? range(r.rangeRad, `${field}.rangeRad`) : null;
  const rangeM = t === 'slide' ? range(r.rangeM, `${field}.rangeM`) : null;
  const drivenBy = r.drivenBy === undefined || r.drivenBy === null || r.drivenBy === '' ? null : ident(r.drivenBy, `${field}.drivenBy`);
  if (drivenBy && t === 'fixed') refuse(`${field} is fixed and cannot be driven`, 'bad_mechanism', `${field}.drivenBy`);
  const gearRatio = drivenBy ? positive(r.gearRatio, `${field}.gearRatio`) : null;
  return { id, parent, child, type: t, axis, rangeRad, rangeM, originMm: vec3(r.originMm, `${field}.originMm`, [0, 0, 0]), drivenBy, gearRatio };
}

/** The joints as a tree rooted at the base: every other part the child of exactly one joint, no loop, every part joined. */
function tree(base: string, ids: Set<string>, joints: MechanismJoint[]): void {
  const parentOf = new Map<string, string>(); const children = new Map<string, string[]>();
  for (const j of joints) {
    if (j.child === base) refuse(`joint ${j.id} makes the base ${base} a child; the base is ground`, 'cycle', 'joints', 422);
    if (parentOf.has(j.child)) refuse(`part ${j.child} is the child of two joints (${parentOf.get(j.child)} and ${j.id}): a part hangs from one joint`, 'cycle', 'joints', 422);
    parentOf.set(j.child, j.id);
    children.set(j.parent, [...(children.get(j.parent) ?? []), j.child]);
  }
  const seen = new Set<string>(); const stack = [base];
  while (stack.length) {
    const pid = stack.pop() as string;
    if (seen.has(pid)) refuse(`the joints loop back through ${pid}`, 'cycle', 'joints', 422);
    seen.add(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  const loose = [...ids].filter((id) => !seen.has(id)).sort();
  if (loose.length) refuse(loose.some((id) => parentOf.has(id)) ? `parts ${loose.join(', ')} hang from each other and never reach the base ${base}` : `parts ${loose.join(', ')} are not joined to the base ${base} (add a joint, fixed if it does not move)`, loose.some((id) => parentOf.has(id)) ? 'cycle' : 'bad_mechanism', 'joints', 422);
}

/** The bound design's part ids: a CAD Studio binding's program ids and model ids. Null when the binding names none (nothing to hold the mechanism to). */
export function boundPartIds(binding: Artifact | null | undefined): Set<string> | null {
  if (!binding || binding.engine !== 'cad-studio') return null;
  const out = new Set<string>();
  for (const p of Array.isArray(binding.parts) ? binding.parts : []) if (isRecord(p) && typeof p.id === 'string') out.add(p.id);
  for (const id of Array.isArray(binding.modelIds) ? binding.modelIds : []) if (typeof id === 'string') out.add(id);
  for (const m of Array.isArray(binding.models) ? binding.models : []) if (isRecord(m)) { if (typeof m.modelId === 'string') out.add(m.modelId); if (typeof m.partId === 'string') out.add(m.partId); }
  return out.size ? out : null;
}

/**
 * @description Validate a mechanism as the page or the tool sends it, held to the design's bound parts when the binding names them.
 * @param value - The body's `mechanism`. @param binding - The newest design binding, or null.
 * @returns The validated mechanism.
 * @throws ModelError bad_mechanism (400, naming the field), part_not_bound (422), unknown_motor (422), cycle (422).
 */
export function validateMechanism(value: unknown, binding?: Artifact | null): Mechanism {
  if (!isRecord(value)) refuse('mechanism must be an object {parts, base, joints, motors, payload, task}', 'bad_mechanism', 'mechanism');
  const v = value as Record<string, unknown>;
  const list = parts(v.parts);
  const ids = new Set(list.map((p) => p.id));
  const bound = boundPartIds(binding);
  if (bound) for (const p of list) if (!bound.has(p.id) && !(p.modelId && bound.has(p.modelId))) refuse(`part ${p.id} is not among the Design phase's bound parts (${[...bound].join(', ')})`, 'part_not_bound', 'parts', 422);
  const base = ident(v.base, 'base');
  if (!ids.has(base)) refuse(`base names ${base}, which is not a part of the mechanism`, 'part_not_bound', 'base', 422);
  const joints = Array.isArray(v.joints) ? (v.joints as unknown[]).map((j, i) => joint(j, i, ids)) : refuse('joints must be a list', 'bad_mechanism', 'joints');
  const jointIds = new Set<string>();
  for (const j of joints) { if (jointIds.has(j.id)) refuse(`joint id ${j.id} appears twice`, 'bad_mechanism', 'joints'); jointIds.add(j.id); }
  tree(base, ids, joints);
  const motors: MechanismMotor[] = (Array.isArray(v.motors) ? v.motors : []).map((m, i) => {
    if (!isRecord(m)) refuse(`motors[${i}] must be {rowId, source}`, 'bad_mechanism', `motors[${i}]`);
    const r = m as Record<string, unknown>;
    if (!(MOTOR_SOURCES as readonly unknown[]).includes(r.source)) refuse(`motors[${i}].source must be ${MOTOR_SOURCES.join(' | ')}`, 'bad_mechanism', `motors[${i}].source`);
    return { rowId: ident(r.rowId, `motors[${i}].rowId`), source: r.source as MotorSource };
  });
  const rows = new Set(motors.map((m) => m.rowId));
  for (const j of joints) if (j.drivenBy && !rows.has(j.drivenBy)) refuse(`joint ${j.id} is driven by ${j.drivenBy}, a motor row the mechanism does not declare (motors: ${[...rows].join(', ') || 'none'})`, 'unknown_motor', 'joints', 422);
  let payload: MechanismPayload | null = null;
  if (v.payload !== undefined && v.payload !== null) {
    if (!isRecord(v.payload)) refuse('payload must be {massKg, attachedTo, atMm?}', 'bad_mechanism', 'payload');
    const p = v.payload as Record<string, unknown>;
    const attachedTo = ident(p.attachedTo, 'payload.attachedTo');
    if (!ids.has(attachedTo)) refuse(`payload.attachedTo names ${attachedTo}, which is not a part of the mechanism`, 'part_not_bound', 'payload.attachedTo', 422);
    payload = { massKg: positive(p.massKg, 'payload.massKg'), attachedTo, atMm: p.atMm === undefined || p.atMm === null ? null : vec3(p.atMm, 'payload.atMm') };
  }
  return { parts: list, base, joints, motors, payload, task: v.task === undefined || v.task === null ? null : validateTask(v.task) };
}

/** @description Validate a task: the payload's displacement (mm), the time (s), the load (kg) and the line it came from. */
export function validateTask(value: unknown): MechanismTask {
  if (!isRecord(value)) refuse('task must be {deltaMm, timeS, loadKg?, line?}', 'bad_mechanism', 'task');
  const t = value as Record<string, unknown>;
  const deltaMm = vec3(t.deltaMm, 'task.deltaMm');
  if (deltaMm.every((x) => x === 0)) refuse('task.deltaMm must move the payload', 'bad_mechanism', 'task.deltaMm');
  return { line: typeof t.line === 'string' && t.line.trim() ? t.line.trim().slice(0, 300) : null, deltaMm, timeS: positive(t.timeS, 'task.timeS'), loadKg: t.loadKg === undefined || t.loadKg === null ? null : positive(t.loadKg, 'task.loadKg') };
}

const LIFT_LINE = /\b(?:lift|lifts|raise|raises|hoist|hoists)\b[^0-9]*?(\d+(?:\.\d+)?)\s*(kg|g)\b[^0-9]*?(\d+(?:\.\d+)?)\s*(mm|cm|m)\b[^0-9]*?(\d+(?:\.\d+)?)\s*(s|sec|seconds|second|min|minutes)\b/i;
const toMm = { mm: 1, cm: 10, m: 1000 } as const;

/**
 * @description The reach task a brief's requirement lines ask for: the first line of the form "lifts 2 kg to 300 mm in 5 s"
 * (raise / hoist; g or kg; mm, cm or m; s or min) becomes a +z displacement of the payload, the load and the time.
 * @param brief - The product's brief.
 * @returns The task, or null when no line states one.
 */
export function taskFromBrief(brief: Brief): MechanismTask | null {
  for (const line of brief.requirements || []) {
    const m = LIFT_LINE.exec(line);
    if (!m) continue;
    const loadKg = Number(m[1]) * (m[2].toLowerCase() === 'g' ? 0.001 : 1);
    const mm = Number(m[3]) * toMm[m[4].toLowerCase() as keyof typeof toMm];
    const timeS = Number(m[5]) * (/^min/i.test(m[6]) ? 60 : 1);
    if (loadKg > 0 && mm > 0 && timeS > 0) return { line: line.trim(), deltaMm: [0, 0, mm], timeS, loadKg };
  }
  return null;
}

/** @description A part as the kernel reported it (read through the person's session): mass in g and extents in mm. */
export interface PartRead { id: string; name?: string; modelId?: string; massG: number; extentsMm: [number, number, number]; route?: string; readAt?: string; revision?: number }
/** @description A motor row as read from the catalog route: the numbers a drive is built from. */
export interface MotorRead { rowId: string; source: MotorSource; name?: string; stallNm: number; noLoadRadS: number; continuousNm: number; route?: string; readAt?: string }
/** @description The spec embodied's engine builds a plant from (engine/embodied_plant.py validate_spec). */
export interface PlantSpec { parts: Record<string, unknown>[]; base: string; joints: Record<string, unknown>[]; actuators: Record<string, unknown>[]; payload: Record<string, unknown> | null; task: Record<string, unknown> | null; senses: string[] }

/**
 * @description Compose the plant spec from a mechanism, the parts' kernel reports and the motor rows as read. Every number
 * is one of those; a part or a row the reads do not carry is refused by name.
 * @param mechanism - The validated mechanism. @param partReads - The kernel's report per part. @param motorReads - The catalog rows read.
 * @returns The spec for POST /api/embodied/physics/plant/load.
 * @throws ModelError part_not_read (422), motor_not_read (422).
 */
export function plantSpecFrom(mechanism: Mechanism, partReads: PartRead[], motorReads: MotorRead[]): PlantSpec {
  const readOf = (p: MechanismPart): PartRead | undefined => partReads.find((r) => r.id === p.id || (p.modelId && r.modelId === p.modelId) || (p.modelId && r.id === p.modelId));
  const parts = mechanism.parts.map((p) => {
    const r = readOf(p);
    if (!r || !Number.isFinite(r.massG) || !Array.isArray(r.extentsMm)) refuse(`part ${p.id} has no kernel report (mass and extents): build it in CAD Studio first`, 'part_not_read', 'parts', 422);
    const read = r as PartRead;
    return { id: p.id, name: p.name, massKg: read.massG / 1000, extentsM: read.extentsMm.map((x) => x / 1000), source: { modelId: read.modelId ?? p.modelId ?? null, route: read.route ?? null, readAt: read.readAt ?? null, revision: read.revision ?? null } };
  });
  const joints = mechanism.joints.map((j) => ({ id: j.id, parent: j.parent, child: j.child, type: j.type, axis: j.axis, range: j.type === 'hinge' ? j.rangeRad : j.type === 'slide' ? j.rangeM : undefined, originM: j.originMm.map((x) => x / 1000) }));
  const actuators = mechanism.joints.filter((j) => j.drivenBy).map((j) => {
    const row = motorReads.find((m) => m.rowId === j.drivenBy);
    if (!row || !(row.stallNm > 0) || !(row.noLoadRadS > 0) || !(row.continuousNm > 0)) refuse(`joint ${j.id} is driven by ${j.drivenBy}, but that row was not read with a stall torque, a no-load speed and a continuous rating`, 'motor_not_read', 'joints', 422);
    const r = row as MotorRead;
    return { joint: j.id, stallNm: r.stallNm, noLoadRadS: r.noLoadRadS, gearRatio: j.gearRatio, continuousNm: r.continuousNm, row: { id: r.rowId, source: r.source, name: r.name ?? null, route: r.route ?? null, readAt: r.readAt ?? null } };
  });
  const payload = mechanism.payload ? { massKg: mechanism.payload.massKg, attachedTo: mechanism.payload.attachedTo, ...(mechanism.payload.atMm ? { atM: mechanism.payload.atMm.map((x) => x / 1000) } : {}) } : null;
  const task = mechanism.task ? { deltaM: mechanism.task.deltaMm.map((x) => x / 1000), timeS: mechanism.task.timeS, loadKg: mechanism.task.loadKg ?? (mechanism.payload ? mechanism.payload.massKg : null), line: mechanism.task.line } : null;
  return { parts, base: mechanism.base, joints, actuators, payload, task, senses: ['joints', 'imu', 'payload'] };
}
