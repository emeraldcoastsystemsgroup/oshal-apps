/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S4 (D3): the first migration's owner RLS proven against
 *                     |                             | a REAL PostgreSQL, as the role that OWNS the tables — the
 *                     |                             | installed condition, under which an ENABLEd-but-not-FORCEd
 *                     |                             | policy never filters a row. The framework's disposable
 *                     |                             | PostgreSQL fixture starts a private server (no DSN is ever read
 *                     |                             | from the environment), mints a NOSUPERUSER NOBYPASSRLS app role,
 *                     |                             | the migration is applied AS that role (twice — idempotent) so it
 *                     |                             | owns the tables, and then: both tables are enabled AND forced;
 *                     |                             | the store functions insert and read through the stamped
 *                     |                             | identity; a stranger's stamp, no stamp and the empty stamp read
 *                     |                             | nothing; the operator arm reads all; and the evaluation's
 *                     |                             | constraints hold. Needs Docker and a framework checkout
 *                     |                             | (OSHAL_CORE_DIR); it FAILS without them, it never skips.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertEvaluation, insertVehicle, listEvaluations, listVehicles, getVehicle, updateDesignVector, type Pool } from '../src-routes/vehicle-store';

const CORE = process.env.OSHAL_CORE_DIR || process.env.OSHAL_CORE_ROOT || process.env.OSHAL_FRAMEWORK || '';
const PACKAGE_DIR = path.resolve(__dirname, '..');
const MIGRATION = path.join(PACKAGE_DIR, 'migrations', '001-aero-lab.sql');
const TABLES = ['aero_lab_vehicle', 'aero_lab_vehicle_evaluation'];
const APP_ROLE = 'aero_lab_app';
const OWNER = 'fixture-owner-sub';
const STRANGER = 'fixture-stranger-sub';

/** The slice of pg's Pool the cases use: a pooled query and a dedicated client for a stamped transaction. */
type RolePool = { connect(): Promise<any>; query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> };
type Fixture = { start(): Promise<unknown>; stop(): Promise<void>; pool: RolePool; rolePool(name: string): RolePool };

/** Run work on one connection stamped as the framework stamps a request (oshal.current_sub, optionally the operator arm), rolled back after. */
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

describe('aero-lab migration 001: owner RLS is FORCEd and really filters the owning role', () => {
  let fixture: Fixture;
  let app: ReturnType<Fixture['rolePool']>;

  beforeAll(async () => {
    expect(CORE, 'OSHAL_CORE_DIR must name a framework checkout: this spec uses its disposable PostgreSQL fixture').not.toBe('');
    const helper = await import(path.join(CORE, 'tests', 'helpers', 'disposable-postgres.ts'));
    fixture = new helper.DisposablePostgres({ purpose: 'aero-lab-vehicle-rls', roles: [APP_ROLE], memory: '256m' });
    await fixture.start();
    await fixture.pool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${APP_ROLE}`);
    app = fixture.rolePool(APP_ROLE);
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await app.query(sql);
    await app.query(sql); // idempotent: IF NOT EXISTS everywhere, the policy created once
  }, 120_000);

  afterAll(async () => { await fixture?.stop(); }, 60_000);

  it('the app role OWNS both tables, and both are ENABLEd and FORCEd', async () => {
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
    const policies = await app.query(`SELECT polname FROM pg_policy WHERE polrelid = ANY($1::regclass[]) ORDER BY 1`, [TABLES]);
    expect(policies.rows.map((r) => r.polname)).toEqual(['aero_lab_vehicle_evaluation_owner_or_operator', 'aero_lab_vehicle_owner_or_operator']);
  });

  it('as the owner, through the stamped identity, the store functions write and read; a stranger, no stamp and the empty stamp read nothing', async () => {
    let vehicleId = '';
    await stamped(app, { sub: OWNER }, async (client) => {
      const row = await insertVehicle(client as Pool, OWNER, 'solar-dynastat', 'Floater', { f_buoyancy: 0.8 }, { source: 'spec' });
      vehicleId = row.vehicle_id;
      await insertEvaluation(client as Pool, OWNER, vehicleId, { sequence: 1, mediumId: 'air', vectorFingerprint: 'a'.repeat(64), engineFingerprints: { packageVersion: '1.3.0', generator: 'spec' }, result: { figures: {} } });
      expect((await listVehicles(client as Pool, OWNER)).map((v) => v.vehicle_id)).toEqual([vehicleId]);
      expect((await listEvaluations(client as Pool, OWNER, vehicleId)).map((e) => e.sequence)).toEqual([1]);
      expect((await updateDesignVector(client as Pool, OWNER, vehicleId, { f_buoyancy: 0.7 }))?.design_vector).toEqual({ f_buoyancy: 0.7 });
      // The policy, not only the WHERE clause: a raw read stamped as the owner sees the row.
      expect((await client.query('SELECT count(*)::int AS n FROM aero_lab_vehicle')).rows[0].n).toBe(1);
      // A stranger's stamp on the same connection sees nothing, WHERE clause or not.
      await client.query("SELECT set_config('oshal.current_sub', $1, true)", [STRANGER]);
      expect((await client.query('SELECT count(*)::int AS n FROM aero_lab_vehicle')).rows[0].n).toBe(0);
      expect(await getVehicle(client as Pool, STRANGER, vehicleId)).toBeNull();
      expect((await client.query('SELECT count(*)::int AS n FROM aero_lab_vehicle_evaluation')).rows[0].n).toBe(0);
      // And the stranger cannot write a row in the owner's name: WITH CHECK refuses it.
      await expect(client.query('INSERT INTO aero_lab_vehicle (owner_sub, kind, name, design_vector) VALUES ($1, $2, $3, $4::jsonb)', [OWNER, 'solar-dynastat', 'Forged', '{}'])).rejects.toThrow(/row-level security/);
    });
    // Committed? No — rolled back. Seed one row for real for the cross-connection cases.
    const committed = await app.connect();
    try {
      await committed.query('BEGIN');
      await committed.query("SELECT set_config('oshal.current_sub', $1, true)", [OWNER]);
      await committed.query('INSERT INTO aero_lab_vehicle (owner_sub, kind, name, design_vector) VALUES ($1, $2, $3, $4::jsonb)', [OWNER, 'solar-dynastat', 'Floater', '{"f_buoyancy":0.8}']);
      await committed.query('COMMIT');
    } finally { committed.release(); }
    expect((await stamped(app, null, (c) => c.query('SELECT count(*)::int AS n FROM aero_lab_vehicle'))).rows[0].n, 'no stamp reads nothing').toBe(0);
    expect((await stamped(app, { sub: '' }, (c) => c.query('SELECT count(*)::int AS n FROM aero_lab_vehicle'))).rows[0].n, 'the empty stamp reads nothing').toBe(0);
    expect((await stamped(app, { sub: STRANGER }, (c) => c.query('SELECT count(*)::int AS n FROM aero_lab_vehicle'))).rows[0].n, 'a stranger reads nothing').toBe(0);
    expect((await stamped(app, { sub: OWNER }, (c) => c.query('SELECT count(*)::int AS n FROM aero_lab_vehicle'))).rows[0].n, 'the owner reads own').toBe(1);
    expect((await stamped(app, { sub: STRANGER, operator: true }, (c) => c.query('SELECT count(*)::int AS n FROM aero_lab_vehicle'))).rows[0].n, 'the operator arm reads all').toBe(1);
  });

  it('the evaluation constraints hold: a positive sequence, a 64-hex vector fingerprint, one sequence per vehicle', async () => {
    await stamped(app, { sub: OWNER }, async (client) => {
      const { rows } = await client.query('SELECT vehicle_id FROM aero_lab_vehicle WHERE owner_sub = $1', [OWNER]);
      const vehicleId = rows[0].vehicle_id;
      const insert = (sequence: number, fingerprint: string) => client.query(
        'INSERT INTO aero_lab_vehicle_evaluation (vehicle_id, owner_sub, sequence, medium_id, vector_fingerprint, engine_fingerprints, result) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [vehicleId, OWNER, sequence, 'air', fingerprint, '{}', '{}']);
      // A refused statement aborts the enclosing transaction, so each refusal is observed inside its own savepoint.
      const refused = async (work: () => Promise<unknown>, pattern: RegExp) => {
        await client.query('SAVEPOINT refusal');
        try { await expect(work()).rejects.toThrow(pattern); } finally { await client.query('ROLLBACK TO SAVEPOINT refusal'); }
      };
      await insert(1, 'b'.repeat(64));
      await refused(() => insert(1, 'b'.repeat(64)), /aero_lab_vehicle_evaluation_sequence/);
      await refused(() => insert(0, 'b'.repeat(64)), /sequence_positive/);
      await refused(() => insert(2, 'not-a-fingerprint'), /fingerprint_shape/);
      await insert(2, 'c'.repeat(64));
      expect((await client.query('SELECT count(*)::int AS n FROM aero_lab_vehicle_evaluation WHERE vehicle_id = $1', [vehicleId])).rows[0].n).toBe(2);
    });
  });
});
