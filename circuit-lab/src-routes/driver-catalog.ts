/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the shaft-driver catalog (catalog/drivers.json):
 *                     |                             | motors, servos and steppers with a nameplate that VALIDATES
 *                     |                             | against the part contract, the mass and price other packages
 *                     |                             | share, and a `source` line per row saying where each number
 *                     |                             | came from. Loaded once, refused loudly when a row drifts from
 *                     |                             | the contract; the surface and the concierge read the same list.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A row may name another package as the OWNER of a real part and
 *                     |                             | READ it (`sharedPart`) instead of restating it. A servo bought
 *                     |                             | once should be describable once: animatronics publishes the
 *                     |                             | SG90 with its identity, mass, price, source and the pulse /
 *                     |                             | travel / speed / torque / current block, and this catalog kept
 *                     |                             | a second, already-drifting description of the same part (its
 *                     |                             | own name, $3 against $2). Now the row declares only the block
 *                     |                             | this lab understands — the operating point it solves at and the
 *                     |                             | reflected rotor inertia — plus the reference, and the shared
 *                     |                             | fields are read from the owner's catalog FILE at load time. The
 *                     |                             | row travels as data, not as an imported runtime: nothing here
 *                     |                             | requires a sibling package's module, so the scoped route
 *                     |                             | compile is unchanged. Store packages install one at a time, so
 *                     |                             | the read is fail-closed — an absent or unreadable owner
 *                     |                             | WITHHOLDS the row with a reason naming the owner, never a
 *                     |                             | locally invented substitute, and every row this package owns
 *                     |                             | outright still loads. Restating a field the owner declares, or
 *                     |                             | choosing an operating point outside the owner's voltage
 *                     |                             | window, is refused at load with the field named.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A MOTOR row reads its owner too. The two brushless motors
 *                     |                             | embodied's drone fits fly were restated here (name, mass,
 *                     |                             | price, KV) with a source line saying they came from embodied;
 *                     |                             | embodied now publishes them as data rows
 *                     |                             | (routes/engine/design/parts-catalog.json, list `motors`), so
 *                     |                             | the rows carry `sharedPart` and only this lab's electrical
 *                     |                             | block: the operating point it solves at, the winding, the
 *                     |                             | no-load current, the inductance and the rotor inertia. The
 *                     |                             | owner supplies name, mass, price, source and the propulsion
 *                     |                             | block's KV; noLoadRpm is DERIVED as KV x this lab's
 *                     |                             | nominalVolts, so restating it is refused like any owned
 *                     |                             | field. Readers are per type now: each names the row and
 *                     |                             | nameplate fields its owner publishes and the ones this lab
 *                     |                             | must declare itself. Same data-not-runtime rule, same
 *                     |                             | fail-closed withholding when embodied is absent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ContractError, DRIVER_TYPES, validateProps, type CircuitPart } from './circuit-contract';

/** @description Where a shared row is published: which package, which file in it, which list, which row. */
export interface SharedPartRef {
  owner: string;
  file: string;
  list: string;
  id: string;
}

/** @description One catalog row as published. */
export interface DriverRow {
  id: string;
  type: string;
  name: string;
  kind: string;
  massG: number;
  approxUsd: number;
  kv?: number;
  cells?: number;
  nameplate: CircuitPart['props'];
  source: string;
  usedBy: string[];
  sharedFrom?: SharedPartRef;
}

/** @description A row whose owner could not answer: named, with the reason, and offered to nobody. */
export interface UnresolvedRow {
  id: string;
  type: string;
  owner: string;
  ref: SharedPartRef;
  reason: string;
}

/** @description The catalog as loaded: the rows that resolved, and the shared rows that did not. */
export interface DriverCatalog {
  drivers: DriverRow[];
  unresolved: UnresolvedRow[];
}

/** @description Options for the load; `packagesRoot` is where sibling packages sit. */
export interface LoadDriverCatalogOpts {
  packagesRoot?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const OWNER = /^[a-z0-9][a-z0-9-]{1,60}$/;
const REL_FILE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

/** Fields every shared row's owner supplies, which this package therefore may not restate. */
const OWNED_FIELDS = ['name', 'massG', 'approxUsd', 'source'] as const;
/** Nameplate fields a shared servo's owner supplies, for the same reason. */
const OWNED_SERVO_PROPS = ['minPulseMs', 'maxPulseMs', 'travelDeg', 'noLoadDegPerS', 'stallTorqueMnm', 'idleAmps', 'runAmps', 'stallAmps'] as const;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** @description What a reader takes from an owner's row: the identity block, the nameplate fields it derives, and what else the row carries. */
interface SharedReading {
  shared: { name: string; massG: number; approxUsd: number; source: string };
  props: Record<string, number>;
  /** The motor constant, when the owner publishes one. */
  kv?: number;
  /** The supply window the owner publishes, when it publishes one; an operating point outside it is refused. */
  window?: { voltsMin: number; voltsMax: number };
}

/** @description How one part type is read from another package: which fields are the owner's, which this lab must declare, and the read. */
interface SharedReader {
  /** Row fields, beyond OWNED_FIELDS, that the owner publishes. */
  ownedRow: readonly string[];
  /** Nameplate fields the read derives from the owner. */
  ownedProps: readonly string[];
  /** Nameplate fields this lab must declare itself because the read needs them. */
  localRequired: readonly string[];
  read(row: Obj, local: Obj): SharedReading | { reason: string };
}

/** One kg*cm of torque in mN*m. */
const KGCM_TO_MNM = 98.0665;

const round = (v: number, places: number): number => { const f = 10 ** places; return Math.round(v * f) / f; };

/**
 * @description Read a shared reference off a row, refusing a malformed one — this package's own
 * mistake, so it is a refusal rather than a missing sibling.
 * @param r - The raw row.
 * @param field - The row's field path, for the refusal.
 * @returns The reference, or null when the row does not claim one.
 */
function readSharedRef(r: Record<string, unknown>, field: string): SharedPartRef | null {
  if (r.sharedPart === undefined) return null;
  const s = (r.sharedPart && typeof r.sharedPart === 'object' && !Array.isArray(r.sharedPart) ? r.sharedPart : {}) as Record<string, unknown>;
  const owner = s.owner;
  const file = s.file;
  const list = s.list;
  const id = s.id;
  if (typeof owner !== 'string' || !OWNER.test(owner)) throw new ContractError('sharedPart.owner must be a package directory name', `${field}.sharedPart.owner`);
  if (typeof file !== 'string' || !REL_FILE.test(file) || file.split('/').includes('..')) throw new ContractError('sharedPart.file must be a relative path inside the owner package', `${field}.sharedPart.file`);
  if (typeof list !== 'string' || !list.trim()) throw new ContractError('sharedPart.list names the array the row lives in', `${field}.sharedPart.list`);
  if (typeof id !== 'string' || !ID.test(id)) throw new ContractError('sharedPart.id must be the owner row id', `${field}.sharedPart.id`);
  return { owner, file, list, id };
}

/**
 * @description Find the owner's row on disk. Every failure is a REASON, not a throw: a store
 * package installs on its own, so a missing or unreadable owner withholds one catalog row rather
 * than taking the catalog down.
 * @param ref - What to read and from where.
 * @param packagesRoot - Where packages sit beside each other.
 * @returns The owner's raw row, or the reason it could not be had.
 */
function readOwnerRow(ref: SharedPartRef, packagesRoot: string): { row: Record<string, unknown> } | { reason: string } {
  const file = path.join(packagesRoot, ref.owner, ...ref.file.split('/'));
  if (!fs.existsSync(file)) return { reason: `${ref.owner} owns this part and is not installed beside this package (${ref.owner}/${ref.file})` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { reason: `${ref.owner}/${ref.file} could not be read: ${(err as Error).message}` };
  }
  const lists = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const rows = lists[ref.list];
  if (!Array.isArray(rows)) return { reason: `${ref.owner}/${ref.file} has no ${ref.list} list` };
  const row = rows.find((candidate) => !!candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === ref.id);
  if (!row) return { reason: `${ref.owner}/${ref.file} has no row ${ref.id}` };
  return { row: row as Record<string, unknown> };
}

/** A finite positive number off the owner's row, or the field name that is wrong. */
function ownerNumber(row: Record<string, unknown>, key: string): number | { bad: string } {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : { bad: key };
}

/**
 * @description Read the identity block every owner row carries: name, one unit's mass and price, and the source line.
 * @param row - The owner's raw row.
 * @returns The identity block, or the reason it cannot be used.
 */
function readIdentity(row: Obj): SharedReading['shared'] | { reason: string } {
  const name = row.name;
  const source = row.source;
  if (typeof name !== 'string' || !name.trim()) return { reason: 'the owner row has no name' };
  if (typeof source !== 'string' || !source.trim()) return { reason: 'the owner row has no source line' };
  const massG = ownerNumber(row, 'massG');
  if (typeof massG !== 'number') return { reason: `the owner row is missing a usable ${massG.bad}` };
  const approxUsd = ownerNumber(row, 'approxUsd');
  if (typeof approxUsd !== 'number') return { reason: `the owner row is missing a usable ${approxUsd.bad}` };
  return { name, massG, approxUsd, source };
}

/**
 * @description Translate the owner's servo block into this lab's nameplate. The owner publishes
 * microseconds, seconds per 60 degrees, kg*cm and milliamps because that is what a rig is built
 * from; the solver wants milliseconds, degrees per second, mN*m and amps. The translation lives
 * here, once, so the owner never has to carry this lab's units.
 * @param row - The owner's raw row.
 * @returns The owner's identity block, the derived nameplate fields and the supply window, or the reason it cannot be used.
 */
function readServoPart(row: Obj): SharedReading | { reason: string } {
  const shared = readIdentity(row);
  if ('reason' in shared) return shared;
  const numbers: Record<string, number> = {};
  for (const key of ['voltsMin', 'voltsMax', 'pulseMinUs', 'pulseMaxUs', 'travelDeg', 'secondsPer60', 'stallKgCm', 'idleMa', 'movingMa', 'stallMa']) {
    const v = ownerNumber(row, key);
    if (typeof v !== 'number') return { reason: `the owner row is missing a usable ${v.bad}` };
    numbers[key] = v;
  }
  return {
    shared,
    props: {
      minPulseMs: round(numbers.pulseMinUs / 1000, 4),
      maxPulseMs: round(numbers.pulseMaxUs / 1000, 4),
      travelDeg: numbers.travelDeg,
      noLoadDegPerS: Math.round(60 / numbers.secondsPer60),
      stallTorqueMnm: round(numbers.stallKgCm * KGCM_TO_MNM, 1),
      idleAmps: round(numbers.idleMa / 1000, 4),
      runAmps: round(numbers.movingMa / 1000, 4),
      stallAmps: round(numbers.stallMa / 1000, 4),
    },
    window: { voltsMin: numbers.voltsMin, voltsMax: numbers.voltsMax },
  };
}

/**
 * @description Read a motor the owner publishes with a propulsion block. The owner gives the part
 * (name, mass, price, source) and its KV; this lab keeps its own electrical model and the operating
 * point it solves at, so the only nameplate field derived here is the no-load speed: KV times that
 * operating voltage.
 * @param row - The owner's raw row.
 * @param local - This lab's declared nameplate block (nominalVolts is checked before the read).
 * @returns The owner's identity block, the KV and the derived noLoadRpm, or the reason it cannot be used.
 */
function readMotorPart(row: Obj, local: Obj): SharedReading | { reason: string } {
  const shared = readIdentity(row);
  if ('reason' in shared) return shared;
  if (!isObj(row.propulsion)) return { reason: 'the owner row has no propulsion block' };
  const kv = ownerNumber(row.propulsion, 'kv');
  if (typeof kv !== 'number') return { reason: 'the owner row is missing a usable propulsion.kv' };
  return { shared, kv, props: { noLoadRpm: Math.round(kv * (local.nominalVolts as number)) } };
}

/** The part types this lab knows how to read from another package's catalog, and what each one owns. */
const SHARED_READERS: Record<string, SharedReader> = {
  servo: { ownedRow: [], ownedProps: OWNED_SERVO_PROPS, localRequired: [], read: (row) => readServoPart(row) },
  motor: { ownedRow: ['kv'], ownedProps: ['noLoadRpm'], localRequired: ['nominalVolts'], read: readMotorPart },
};

/** The fields a row carries whether or not it is shared. */
type CommonFields = Pick<DriverRow, 'id' | 'type' | 'kind' | 'usedBy' | 'kv' | 'cells'>;

/**
 * @description Refuse what a shared row may not say: a field its owner publishes, a missing
 * operating point the read needs, or a missing note. These are this package's own mistakes, so they
 * throw at load rather than withholding the row.
 * @param r - The raw row.
 * @param field - The row's field path, for the refusal.
 * @param ref - The owner reference.
 * @param reader - The reader for the row's type.
 * @returns This lab's declared nameplate block.
 */
function checkSharedDeclaration(r: Obj, field: string, ref: SharedPartRef, reader: SharedReader): Obj {
  for (const key of [...OWNED_FIELDS, ...reader.ownedRow]) if (r[key] !== undefined) throw new ContractError(`${key} is ${ref.owner}'s to publish; this row reads it`, `${field}.${key}`);
  const local = isObj(r.nameplate) ? r.nameplate : {};
  for (const key of reader.ownedProps) if (local[key] !== undefined) throw new ContractError(`${key} is ${ref.owner}'s to publish; this row reads it`, `${field}.nameplate.${key}`);
  for (const key of reader.localRequired) {
    const v = local[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new ContractError(`${key} is the operating point this lab solves a shared ${r.type as string} at; the row declares it`, `${field}.nameplate.${key}`);
  }
  if (typeof r.note !== 'string' || !r.note.trim()) throw new ContractError('note says what this package adds to the shared row', `${field}.note`);
  return local;
}

/**
 * @description Resolve a row that names another package as the part's owner: check what the row
 * declares, read the owner's row, and merge the owner's fields with this lab's block.
 * @param r - The raw row.
 * @param field - The row's field path, for refusals.
 * @param ref - The owner reference.
 * @param common - The fields the row carries either way.
 * @param packagesRoot - Where packages sit beside each other.
 * @returns The resolved row, or the unresolved entry naming the owner and the reason.
 */
function resolveSharedRow(r: Obj, field: string, ref: SharedPartRef, common: CommonFields, packagesRoot: string): { row: DriverRow } | { unresolved: UnresolvedRow } {
  const reader = SHARED_READERS[common.type];
  if (!reader) throw new ContractError(`a ${common.type} row cannot be read from another package yet`, `${field}.sharedPart`);
  const local = checkSharedDeclaration(r, field, ref, reader);
  const withheld = (reason: string) => ({ unresolved: { id: common.id, type: common.type, owner: ref.owner, ref, reason } });
  const owned = readOwnerRow(ref, packagesRoot);
  if ('reason' in owned) return withheld(owned.reason);
  const part = reader.read(owned.row, local);
  if ('reason' in part) return withheld(`${ref.owner}/${ref.file}#${ref.id}: ${part.reason}`);
  const nameplate = validateProps(common.type, { ...local, ...part.props }, field);
  const volts = nameplate.nominalVolts as number;
  if (part.window && (volts < part.window.voltsMin || volts > part.window.voltsMax)) {
    throw new ContractError(`${ref.owner} publishes ${ref.id} at ${part.window.voltsMin}-${part.window.voltsMax} V; this lab solves it at ${volts} V`, `${field}.nameplate.nominalVolts`);
  }
  return { row: {
    ...common,
    ...(part.kv !== undefined ? { kv: part.kv } : {}),
    ...part.shared,
    nameplate,
    source: `${part.shared.source} [read from ${ref.owner}/${ref.file}#${ref.id}] ${r.note as string}`,
    sharedFrom: ref,
  } };
}

/**
 * @description Parse and validate the catalog file: every row a known driver type, an id, a mass,
 * a price, a source line and a nameplate the contract accepts (defaults fill the rest) — or, for a
 * row that names another package as the part's owner, the reference plus only the block this lab
 * adds, with the shared fields read from the owner.
 * @param file - Path to catalog/drivers.json.
 * @param opts - Where sibling packages sit; defaults to this package's parent directory.
 * @returns The rows that resolved and the shared rows whose owner could not answer.
 */
export function loadDriverCatalog(file: string, opts: LoadDriverCatalogOpts = {}): DriverCatalog {
  const packagesRoot = opts.packagesRoot ?? path.resolve(path.dirname(file), '..', '..');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { drivers?: unknown };
  if (!Array.isArray(raw.drivers)) throw new ContractError('catalog has no drivers list', 'drivers');
  const seen = new Set<string>();
  const drivers: DriverRow[] = [];
  const unresolved: UnresolvedRow[] = [];
  raw.drivers.forEach((row, i) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const field = `drivers[${i}]`;
    if (typeof r.id !== 'string' || !ID.test(r.id) || seen.has(r.id)) throw new ContractError('each row needs a unique kebab-case id', `${field}.id`);
    seen.add(r.id);
    if (typeof r.type !== 'string' || !DRIVER_TYPES.includes(r.type)) throw new ContractError(`type must be one of ${DRIVER_TYPES.join(', ')}`, `${field}.type`);
    if (typeof r.kind !== 'string' || !r.kind.trim()) throw new ContractError('kind is required', `${field}.kind`);
    const usedBy = Array.isArray(r.usedBy) ? r.usedBy.filter((u): u is string => typeof u === 'string') : [];
    const common = { id: r.id, type: r.type, kind: r.kind as string, usedBy, ...(typeof r.kv === 'number' ? { kv: r.kv } : {}), ...(typeof r.cells === 'number' ? { cells: r.cells } : {}) };
    const ref = readSharedRef(r, field);

    if (!ref) {
      for (const key of ['name', 'source'] as const) if (typeof r[key] !== 'string' || !(r[key] as string).trim()) throw new ContractError(`${key} is required`, `${field}.${key}`);
      for (const key of ['massG', 'approxUsd'] as const) if (typeof r[key] !== 'number' || !((r[key] as number) >= 0)) throw new ContractError(`${key} must be a number`, `${field}.${key}`);
      drivers.push({ ...common, name: r.name as string, massG: r.massG as number, approxUsd: r.approxUsd as number, nameplate: validateProps(r.type, r.nameplate, field), source: r.source as string });
      return;
    }

    const resolved = resolveSharedRow(r, field, ref, common, packagesRoot);
    if ('row' in resolved) drivers.push(resolved.row);
    else unresolved.push(resolved.unresolved);
  });
  return { drivers, unresolved };
}

/** @description The rows of one driver type, or all of them. */
export function listDrivers(rows: DriverRow[], type?: string): DriverRow[] {
  return type ? rows.filter((r) => r.type === type) : rows;
}
