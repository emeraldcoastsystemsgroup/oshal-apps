/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the SQL-dispatching in-memory pool the route suite and the browser proof
 *                     |                             | share: it answers exactly the statements src-routes/vehicle-store.ts sends (recognised by
 *                     |                             | their leading text, so a new statement fails loudly instead of returning nothing), scoped by
 *                     |                             | the owner parameter each statement carries. It is a double of the STORE, not of row security:
 *                     |                             | the owner RLS itself is proven against a real PostgreSQL in tests/vehicle-rls.spec.ts.
 */

import { randomUUID } from 'node:crypto';

/** @description A row as the store functions return it. */
type Row = Record<string, unknown>;

/** @description The in-memory tables and the statement log. */
export class VehiclePoolDouble {
  vehicles: Row[] = [];
  limits: Row[] = [];
  runs: Row[] = [];
  log: string[] = [];
  private clock = Date.parse('2026-09-28T00:00:00Z');

  /** @description The next timestamp: strictly increasing so `updated_at DESC` is deterministic. @returns ISO time. */
  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  /**
   * @description Answer one statement the store sends.
   * @param sql - The statement. @param params - Its parameters.
   * @returns The rows, pg-shaped.
   * @throws Error for any statement this double does not recognise.
   */
  async query(sql: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.log.push(text.slice(0, 60));
    const rows = this.dispatch(text, params);
    return { rows, rowCount: rows.length };
  }

  /** @description Route a statement to its handler by its leading text. */
  private dispatch(text: string, p: unknown[]): Row[] {
    if (text.startsWith('WITH v AS ( INSERT INTO ocean_lab_vehicle ')) return this.insertVehicle(p);
    if (text.startsWith('SELECT vehicle_id') && text.includes('FROM ocean_lab_vehicle WHERE owner_sub = $1 AND vehicle_id = $2')) return this.vehicles.filter((v) => v.owner_sub === p[0] && v.vehicle_id === p[1]);
    if (text.startsWith('SELECT vehicle_id') && text.includes('AND kind = $2 AND name = $3')) return this.vehicles.filter((v) => v.owner_sub === p[0] && v.kind === p[1] && v.name === p[2]);
    if (text.startsWith('SELECT vehicle_id') && text.includes('ORDER BY updated_at DESC')) return this.vehicles.filter((v) => v.owner_sub === p[0]).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, Number(p[1]));
    if (text.startsWith('UPDATE ocean_lab_vehicle SET design_vector')) return this.update(p);
    if (text.startsWith('DELETE FROM ocean_lab_vehicle ')) return this.remove(p);
    if (text.startsWith('SELECT vehicle_id, owner_sub, limit_id')) return this.limits.filter((l) => l.owner_sub === p[0] && l.vehicle_id === p[1]);
    if (text.startsWith('INSERT INTO ocean_lab_vehicle_run')) return this.insertRun(p);
    if (text.startsWith('SELECT run_id')) return this.runs.filter((r) => r.owner_sub === p[0] && r.vehicle_id === p[1]).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    throw new Error(`VehiclePoolDouble: unrecognised statement: ${text.slice(0, 120)}`);
  }

  /** @description The vehicle-and-limits CTE: one vehicle, one limit row per posted limit, and the unique (owner, kind, name) index. */
  private insertVehicle(p: unknown[]): Row[] {
    if (this.vehicles.some((v) => v.owner_sub === p[0] && v.kind === p[1] && v.name === p[2])) throw new Error('duplicate key value violates unique constraint "uq_ocean_lab_vehicle_owner_kind_name"');
    const at = this.now();
    const vehicle: Row = { vehicle_id: randomUUID(), owner_sub: p[0], kind: p[1], name: p[2], design_vector: JSON.parse(String(p[3])), provenance: JSON.parse(String(p[4])), created_at: at, updated_at: at };
    this.vehicles.push(vehicle);
    const limits = JSON.parse(String(p[5])) as Array<{ id: string; sentence: string; retire_when: string; blocking: boolean }>;
    for (const l of limits) this.limits.push({ vehicle_id: vehicle.vehicle_id, owner_sub: p[0], limit_id: l.id, sentence: l.sentence, retire_when: l.retire_when, blocking: l.blocking, status: 'open', retired_evidence: null, created_at: at });
    return [{ ...vehicle, limit_count: limits.length }];
  }

  /** @description Replace a vector, owner-scoped. */
  private update(p: unknown[]): Row[] {
    const v = this.vehicles.find((x) => x.owner_sub === p[0] && x.vehicle_id === p[1]);
    if (!v) return [];
    v.design_vector = JSON.parse(String(p[2]));
    v.updated_at = this.now();
    return [{ ...v }];
  }

  /** @description Delete a vehicle and cascade to its limits and runs, owner-scoped. */
  private remove(p: unknown[]): Row[] {
    const v = this.vehicles.find((x) => x.owner_sub === p[0] && x.vehicle_id === p[1]);
    if (!v) return [];
    this.vehicles = this.vehicles.filter((x) => x !== v);
    this.limits = this.limits.filter((l) => l.vehicle_id !== v.vehicle_id);
    this.runs = this.runs.filter((r) => r.vehicle_id !== v.vehicle_id);
    return [{ vehicle_id: v.vehicle_id }];
  }

  /** @description A run at the next sequence of its vehicle. */
  private insertRun(p: unknown[]): Row[] {
    const sequence = this.runs.filter((r) => r.vehicle_id === p[0]).reduce((max, r) => Math.max(max, Number(r.sequence)), 0) + 1;
    const run: Row = { run_id: randomUUID(), vehicle_id: p[0], owner_sub: p[1], sequence, medium_id: p[2], plant: p[3], vector_fingerprint: p[4], engine_fingerprints: JSON.parse(String(p[5])), result: JSON.parse(String(p[6])), created_at: this.now() };
    this.runs.push(run);
    return [{ ...run }];
  }
}
