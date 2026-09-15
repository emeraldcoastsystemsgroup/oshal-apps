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
 */

import fs from 'node:fs';
import { ContractError, DRIVER_TYPES, validateProps, type CircuitPart } from './circuit-contract';

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
}

const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;

/**
 * @description Parse and validate the catalog file: every row a known driver type, an id, a name, a
 * mass, a price, a source line, and a nameplate the contract accepts (defaults fill the rest).
 * @param file - Path to catalog/drivers.json.
 * @returns The rows.
 */
export function loadDriverCatalog(file: string): DriverRow[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { drivers?: unknown };
  if (!Array.isArray(raw.drivers)) throw new ContractError('catalog has no drivers list', 'drivers');
  const seen = new Set<string>();
  return raw.drivers.map((row, i) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const field = `drivers[${i}]`;
    if (typeof r.id !== 'string' || !ID.test(r.id) || seen.has(r.id)) throw new ContractError('each row needs a unique kebab-case id', `${field}.id`);
    seen.add(r.id);
    if (typeof r.type !== 'string' || !DRIVER_TYPES.includes(r.type)) throw new ContractError(`type must be one of ${DRIVER_TYPES.join(', ')}`, `${field}.type`);
    for (const key of ['name', 'kind', 'source'] as const) if (typeof r[key] !== 'string' || !(r[key] as string).trim()) throw new ContractError(`${key} is required`, `${field}.${key}`);
    for (const key of ['massG', 'approxUsd'] as const) if (typeof r[key] !== 'number' || !(r[key] as number >= 0)) throw new ContractError(`${key} must be a number`, `${field}.${key}`);
    const nameplate = validateProps(r.type, r.nameplate, field);
    const usedBy = Array.isArray(r.usedBy) ? r.usedBy.filter((u): u is string => typeof u === 'string') : [];
    return { id: r.id, type: r.type, name: r.name as string, kind: r.kind as string, massG: r.massG as number, approxUsd: r.approxUsd as number, ...(typeof r.kv === 'number' ? { kv: r.kv } : {}), ...(typeof r.cells === 'number' ? { cells: r.cells } : {}), nameplate, source: r.source as string, usedBy };
  });
}

/** @description The rows of one driver type, or all of them. */
export function listDrivers(rows: DriverRow[], type?: string): DriverRow[] {
  return type ? rows.filter((r) => r.type === type) : rows;
}
