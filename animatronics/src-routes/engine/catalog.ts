/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the servo catalog (catalog/servos.json):
 *                     |                             | hobby and bus servos with the numbers a rig needs — pulse
 *                     |                             | range and travel (→ µs per degree), speed (→ deg/s), idle /
 *                     |                             | moving / stall current, voltage range, torque, mass, price —
 *                     |                             | and a `source` line per row saying where each came from.
 *                     |                             | Loaded once, refused loudly when a row is malformed; the
 *                     |                             | templates, the power budget and the surface read the same
 *                     |                             | rows. The circuit-lab driver catalog is the pattern.
 */

import fs from 'node:fs';
import { ContractError } from './rig-contract';

/** @description One servo row as published. */
export interface ServoRow {
  id: string;
  name: string;
  kind: 'hobby' | 'bus';
  massG: number;
  approxUsd: number;
  voltsMin: number;
  voltsMax: number;
  pulseMinUs: number;
  pulseMaxUs: number;
  travelDeg: number;
  secondsPer60: number;
  stallKgCm: number;
  idleMa: number;
  movingMa: number;
  stallMa: number;
  source: string;
  usedBy: string[];
}

/** @description A controller row (informational: what board, how many outputs, what it needs). */
export interface ControllerRow { id: string; name: string; outputs: number; logicVolts: number; notes: string; source: string }

const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;

function need(r: Record<string, unknown>, key: string, field: string, min = 0, max = Number.POSITIVE_INFINITY): number {
  const v = r[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ContractError(`${key} must be a number in ${min}…${max}`, `${field}.${key}`);
  return v;
}
function text(r: Record<string, unknown>, key: string, field: string): string {
  const v = r[key];
  if (typeof v !== 'string' || !v.trim()) throw new ContractError(`${key} is required`, `${field}.${key}`);
  return v;
}

/**
 * @description Parse and validate the catalog file.
 * @param file - Path to catalog/servos.json.
 * @returns Servo rows and controller rows.
 */
export function loadServoCatalog(file: string): { servos: ServoRow[]; controllers: ControllerRow[] } {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { servos?: unknown; controllers?: unknown };
  if (!Array.isArray(raw.servos) || !Array.isArray(raw.controllers)) throw new ContractError('catalog needs servos and controllers lists', 'catalog');
  const seen = new Set<string>();
  const servos = raw.servos.map((row, i) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const field = `servos[${i}]`;
    if (typeof r.id !== 'string' || !ID.test(r.id) || seen.has(r.id)) throw new ContractError('each row needs a unique kebab-case id', `${field}.id`);
    seen.add(r.id);
    if (r.kind !== 'hobby' && r.kind !== 'bus') throw new ContractError('kind must be hobby or bus', `${field}.kind`);
    const out: ServoRow = {
      id: r.id, name: text(r, 'name', field), kind: r.kind, massG: need(r, 'massG', field, 1, 5000), approxUsd: need(r, 'approxUsd', field, 0, 5000),
      voltsMin: need(r, 'voltsMin', field, 3, 48), voltsMax: need(r, 'voltsMax', field, 3, 48), pulseMinUs: need(r, 'pulseMinUs', field, 400, 2800), pulseMaxUs: need(r, 'pulseMaxUs', field, 400, 2800),
      travelDeg: need(r, 'travelDeg', field, 30, 360), secondsPer60: need(r, 'secondsPer60', field, 0.02, 5), stallKgCm: need(r, 'stallKgCm', field, 0.1, 500),
      idleMa: need(r, 'idleMa', field, 0, 5000), movingMa: need(r, 'movingMa', field, 1, 20000), stallMa: need(r, 'stallMa', field, 1, 50000), source: text(r, 'source', field),
      usedBy: Array.isArray(r.usedBy) ? r.usedBy.filter((u): u is string => typeof u === 'string') : [],
    };
    if (out.voltsMin > out.voltsMax) throw new ContractError('voltsMin must not exceed voltsMax', `${field}.voltsMin`);
    if (out.pulseMinUs >= out.pulseMaxUs) throw new ContractError('pulseMinUs must be below pulseMaxUs', `${field}.pulseMinUs`);
    if (out.idleMa > out.movingMa || out.movingMa > out.stallMa) throw new ContractError('currents must be idle ≤ moving ≤ stall', `${field}.movingMa`);
    return out;
  });
  const controllers = raw.controllers.map((row, i) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const field = `controllers[${i}]`;
    if (typeof r.id !== 'string' || !ID.test(r.id)) throw new ContractError('each controller needs a kebab-case id', `${field}.id`);
    return { id: r.id, name: text(r, 'name', field), outputs: need(r, 'outputs', field, 1, 254), logicVolts: need(r, 'logicVolts', field, 1, 12), notes: text(r, 'notes', field), source: text(r, 'source', field) } as ControllerRow;
  });
  return { servos, controllers };
}

/** @description Microseconds per degree a row implies. */
export function usPerDegOf(row: ServoRow): number { return Math.round(((row.pulseMaxUs - row.pulseMinUs) / row.travelDeg) * 100) / 100; }
/** @description Degrees per second a row implies (no load). */
export function maxDegPerSOf(row: ServoRow): number { return Math.round(60 / row.secondsPer60); }
/** @description Rows by id. */
export function servoMap(servos: ServoRow[]): Map<string, ServoRow> { return new Map(servos.map((s) => [s.id, s])); }
