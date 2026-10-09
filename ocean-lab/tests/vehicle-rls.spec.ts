/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 (D3): ocean-lab's first migration proven against a REAL PostgreSQL, as the
 *                     |                             | role that OWNS the tables — the installed condition, under which an ENABLEd-but-not-FORCEd
 *                     |                             | policy never filters a row. The framework's disposable PostgreSQL fixture starts a private
 *                     |                             | server (no DSN is ever read from the environment) and mints a NOSUPERUSER NOBYPASSRLS app role;
 *                     |                             | the migration is applied AS that role twice (idempotent) so it owns the tables; then: all
 *                     |                             | three tables are enabled AND forced with one owner_or_operator policy each; the store's
 *                     |                             | vehicle-and-limits statement writes the vehicle and its eight limit rows in one statement; the
 *                     |                             | run statement numbers runs in sequence; a stranger's stamp, no stamp and the empty stamp read
 *                     |                             | nothing and cannot write in the owner's name; the operator arm reads all; the constraints hold;
 *                     |                             | and a delete cascades to the limits and runs. Needs Docker and a framework checkout
 *                     |                             | (OSHAL_CORE_DIR); it FAILS without them, it never skips.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPLORER_KIND } from '../src-routes/engine/vehicle';
import { deleteVehicle, getVehicle, insertRun, insertVehicleWithLimits, listLimits, listRuns, listVehicles, updateDesignVector, type Pool } from '../src-routes/vehicle-store';

const CORE = process.env.OSHAL_CORE_DIR || process.env.OSHAL_CORE_ROOT || process.env.OSHAL_FRAMEWORK || '';
const MIGRATION = path.resolve(__dirname, '..', 'migrations', '001-ocean-lab.sql');
const TABLES = ['ocean_lab_vehicle', 'ocean_lab_vehicle_limit', 'ocean_lab_vehicle_run'];
const APP_ROLE = 'ocean_lab_app';
const OWNER = 'fixture-owner-sub';
const STRANGER = 'fixture-stranger-sub';

/** The slice of pg's Pool the cases use: a pooled query and a dedicated client for a stamped transaction. */
type RolePool = { connect(): Promise<any>; query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> };
type Fixture = { start(): Promise<unknown>; stop(): Promise<void>; pool: RolePool; rolePool(name: string): RolePool };

/** Run work on one connection stamped as the framework stamps a request, rolled back after. */
async function stamped(pool: RolePool, identity: { sub?: string; operator?: boolean } | null, work: (client: any) => Promise<any>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (identity?.sub !== undefined) await client.query("SELECT set_config('oshal.current_sub', $1, true)", [identity.sub]);
    if (identity?.operator) await client.query("SELECT set_config('oshal.is_operator', 'on', true)");
    return await work(client);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

/** Count rows in a table as seen through one identity. */
const countAs = async (app: RolePool, identity: { sub?: string; operator?: boolean } | null, table: string): Promise<number> =>
  (await stamped(app, identity, (c) => c.query(`SELECT count(*)::int AS n FROM ${table}`))).rows[0].n;

const DRAFT = { mediumId: 'seawater', plant: 'ocean-lab.wave-propulsion', vectorFingerprint: 'a'.repeat(64), engineFingerprints: { package: 'ocean-lab', packageVersion: '1.2.0' }, result: { figures: {} } };

describe('ocean-lab migration 001: owner RLS is FORCEd and really filters the owning role', () => {
  let fixture: Fixture;
  let app: RolePool;

  beforeAll(async () => {
    expect(CORE, 'OSHAL_CORE_DIR must name a framework checkout: this spec uses its disposable PostgreSQL fixture').not.toBe('');
    const helper = await import(path.join(CORE, 'tests', 'helpers', 'disposable-postgres.ts'));
    fixture = new helper.DisposablePostgres({ purpose: 'ocean-lab-vehicle-rls', roles: [APP_ROLE], memory: '256m' });
    await fixture.start();
    await fixture.pool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${APP_ROLE}`);
    app = fixture.rolePool(APP_ROLE);
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await app.query(sql);
    await app.query(sql); // idempotent: IF NOT EXISTS everywhere, the policies created once
  }, 180_000);

  afterAll(async () => { await fixture?.stop(); }, 60_000);

  it('the app role OWNS all three tables, and each is ENABLEd and FORCEd with one owner_or_operator policy', async () => {
    const state = await app.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[]) ORDER BY 1`, [TABLES]);
    expect(state.rows.map((r) => r.relname)).toEqual(TABLES);
    for (const row of state.rows) {
      expect(row.owner, `${row.relname} owner`).toBe(APP_ROLE);
      expect(row.relrowsecurity, `${row.relname} enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} forced — an unforced policy never runs for the owner`).toBe(true);
    }
    const policies = await app.query('SELECT polname FROM pg_policy WHERE polrelid = ANY($1::regclass[]) ORDER BY 1', [TABLES]);
    expect(policies.rows.map((r) => r.polname)).toEqual(TABLES.map((t) => `${t}_owner_or_operator`).sort());
  });

  it('as the owner, the store writes a vehicle with its eight limits in ONE statement, numbers runs, updates and reads', async () => {
    await stamped(app, { sub: OWNER }, async (client) => {
      const v = await insertVehicleWithLimits(client as Pool, OWNER, 'wave-explorer', 'Explorer', { wings: { stopAngleDeg: 20 } }, { source: 'spec' }, EXPLORER_KIND.limits);
      expect(Object.keys(v)).not.toContain('limit_count');
      const limits = await listLimits(client as Pool, OWNER, v.vehicle_id);
      expect(limits.map((l) => l.limit_id)).toEqual([...EXPLORER_KIND.limits.map((l) => l.id)].sort());
      expect(limits.every((l) => l.status === 'open' && l.retired_evidence === null)).toBe(true);
      expect((await insertRun(client as Pool, OWNER, v.vehicle_id, DRAFT)).sequence).toBe(1);
      expect((await insertRun(client as Pool, OWNER, v.vehicle_id, { ...DRAFT, plant: 'embodied:analytic', mediumId: 'air' })).sequence).toBe(2);
      expect((await listRuns(client as Pool, OWNER, v.vehicle_id)).map((r) => `${r.sequence}:${r.plant}`)).toEqual(['1:ocean-lab.wave-propulsion', '2:embodied:analytic']);
      expect((await updateDesignVector(client as Pool, OWNER, v.vehicle_id, { wings: { stopAngleDeg: 25 } }))?.design_vector).toEqual({ wings: { stopAngleDeg: 25 } });
      expect((await listVehicles(client as Pool, OWNER)).map((r) => r.vehicle_id)).toEqual([v.vehicle_id]);
      // The policy, not only the WHERE clause: a stranger's stamp on the same connection sees nothing.
      await client.query("SELECT set_config('oshal.current_sub', $1, true)", [STRANGER]);
      for (const table of TABLES) expect((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, table).toBe(0);
      expect(await getVehicle(client as Pool, STRANGER, v.vehicle_id)).toBeNull();
      await expect(client.query('INSERT INTO ocean_lab_vehicle (owner_sub, kind, name, design_vector) VALUES ($1, $2, $3, $4::jsonb)', [OWNER, 'wave-explorer', 'Forged', '{}'])).rejects.toThrow(/row-level security/);
    });
  });

  it('committed rows: no stamp and the empty stamp read nothing, a stranger reads nothing, the owner reads own, the operator arm reads all', async () => {
    const committed = await app.connect();
    try {
      await committed.query('BEGIN');
      await committed.query("SELECT set_config('oshal.current_sub', $1, true)", [OWNER]);
      const v = await insertVehicleWithLimits(committed as Pool, OWNER, 'wave-explorer', 'Explorer', {}, {}, EXPLORER_KIND.limits);
      await insertRun(committed as Pool, OWNER, v.vehicle_id, DRAFT);
      await committed.query('COMMIT');
    } finally { committed.release(); }
    for (const table of TABLES) {
      expect(await countAs(app, null, table), `${table}: no stamp`).toBe(0);
      expect(await countAs(app, { sub: '' }, table), `${table}: the empty stamp`).toBe(0);
      expect(await countAs(app, { sub: STRANGER }, table), `${table}: a stranger`).toBe(0);
      expect(await countAs(app, { sub: STRANGER, operator: true }, table), `${table}: the operator arm`).toBeGreaterThan(0);
    }
    expect(await countAs(app, { sub: OWNER }, 'ocean_lab_vehicle_limit')).toBe(8);
  });

  it('the constraints hold: a positive, unique sequence, a 64-hex fingerprint, a named plant, a known limit status with evidence to retire', async () => {
    await stamped(app, { sub: OWNER }, async (client) => {
      const vehicleId = (await client.query('SELECT vehicle_id FROM ocean_lab_vehicle WHERE owner_sub = $1', [OWNER])).rows[0].vehicle_id;
      const raw = (sequence: number, fingerprint: string, plant = 'x:y') => client.query(
        'INSERT INTO ocean_lab_vehicle_run (vehicle_id, owner_sub, sequence, medium_id, plant, vector_fingerprint, engine_fingerprints, result) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)',
        [vehicleId, OWNER, sequence, 'seawater', plant, fingerprint, '{}', '{}']);
      const refused = async (work: () => Promise<unknown>, pattern: RegExp) => {
        await client.query('SAVEPOINT refusal');
        try { await expect(work()).rejects.toThrow(pattern); } finally { await client.query('ROLLBACK TO SAVEPOINT refusal'); }
      };
      await refused(() => raw(1, 'b'.repeat(64)), /ocean_lab_vehicle_run_sequence/);
      await refused(() => raw(0, 'b'.repeat(64)), /sequence_positive/);
      await refused(() => raw(7, 'not-a-fingerprint'), /fingerprint_shape/);
      await refused(() => raw(7, 'b'.repeat(64), ''), /plant_nonempty/);
      await refused(() => client.query("UPDATE ocean_lab_vehicle_limit SET status = 'retired' WHERE vehicle_id = $1", [vehicleId]), /retired_has_evidence/);
      await refused(() => client.query("UPDATE ocean_lab_vehicle_limit SET status = 'gone', retired_evidence = '{}'::jsonb WHERE vehicle_id = $1", [vehicleId]), /limit_status/);
    });
  });

  it('deleting a vehicle cascades to its limits and runs', async () => {
    await stamped(app, { sub: OWNER }, async (client) => {
      const vehicleId = (await client.query('SELECT vehicle_id FROM ocean_lab_vehicle WHERE owner_sub = $1', [OWNER])).rows[0].vehicle_id;
      expect(await deleteVehicle(client as Pool, STRANGER, vehicleId)).toBe(false);
      expect(await deleteVehicle(client as Pool, OWNER, vehicleId)).toBe(true);
      expect((await client.query('SELECT count(*)::int AS n FROM ocean_lab_vehicle_limit WHERE vehicle_id = $1', [vehicleId])).rows[0].n).toBe(0);
      expect((await client.query('SELECT count(*)::int AS n FROM ocean_lab_vehicle_run WHERE vehicle_id = $1', [vehicleId])).rows[0].n).toBe(0);
    });
  });
});
