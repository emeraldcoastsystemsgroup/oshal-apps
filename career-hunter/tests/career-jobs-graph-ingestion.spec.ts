/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the package-side ADR-045 jobs-to-graph mapping, tenant key, freshness bound, fail-open behavior, and database cleanup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin graph ingestion and score-cursor advancement beneath their respective successful engine outcomes.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove graph database lookup delegates traversal and case-sensitive subjects unchanged to the canonical mapper.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Recording fake for the kernel graph feature (the mocked graph boundary). The REAL service is
// kernel-guarded (tests/unit/graph-ingestion.spec.ts); this spec pins the PACKAGE-side call.
const ingestJobsForPerson = vi.fn(async () => undefined);
vi.mock('@/features/graph', () => ({
  createGraphConnector: () => null,
  getGraphIngestionService: () => ({ ingestJobsForPerson }),
}));

import { dbPaths, ingestJobsGraphForUser } from '../src-routes/career-graph-routes';

type Row = { id: number; title: string; company: string; location: string | null; url: string | null };

/** Fake openUserDb: records the SQL + args, returns the given rows, tracks close(). */
function fakeDb(rows: Row[]) {
  const state = { sql: '', args: [] as unknown[], closed: false, prepareThrows: false };
  const db = {
    prepare: (sql: string) => {
      if (state.prepareThrows) throw new Error('sqlite exploded');
      state.sql = sql;
      return { all: (...args: unknown[]) => { state.args = args; return rows; } };
    },
    close: () => { state.closed = true; },
  };
  return { db, state };
}

beforeEach(() => { ingestJobsForPerson.mockClear(); });

describe('ingestJobsGraphForUser — the package-side ADR-045 jobs→graph call', () => {
  it('maps fresh postings to JobGraphRecords and ingests them keyed by the OWNING sub', async () => {
    const { db, state } = fakeDb([
      { id: 7, title: 'SAP Architect', company: 'Acme', location: 'Remote', url: 'https://x/7' },
      { id: 9, title: 'SRE', company: 'Globex', location: null, url: null },
    ]);
    await ingestJobsGraphForUser('sub-123', () => db);
    expect(ingestJobsForPerson).toHaveBeenCalledTimes(1);
    expect(ingestJobsForPerson).toHaveBeenCalledWith('sub-123', [
      { id: 7, title: 'SAP Architect', company: 'Acme', location: 'Remote', url: 'https://x/7' },
      { id: 9, title: 'SRE', company: 'Globex', location: null, url: null },
    ]);
    // The NEW-jobs bound: first_seen_at gated (posted_date is null on many ATS rows — it can
    // never be the gate) and row-capped so the fire-and-forget mirror stays bounded.
    expect(state.sql).toContain('first_seen_at >=');
    expect(state.args[0]).toBe('-8 days');
    expect(state.args[1]).toBe(1000);
    expect(state.closed).toBe(true);
  });

  it('is a clean no-op when the user has no store yet', async () => {
    await ingestJobsGraphForUser('sub-123', () => null);
    expect(ingestJobsForPerson).not.toHaveBeenCalled();
  });

  it('skips the service call entirely when no fresh rows landed', async () => {
    const { db, state } = fakeDb([]);
    await ingestJobsGraphForUser('sub-123', () => db);
    expect(ingestJobsForPerson).not.toHaveBeenCalled();
    expect(state.closed).toBe(true);
  });

  it('NEVER rejects on a sqlite failure — and still closes the db (fail-open contract)', async () => {
    const { db, state } = fakeDb([]);
    state.prepareThrows = true;
    await expect(ingestJobsGraphForUser('sub-123', () => db)).resolves.toBeUndefined();
    expect(ingestJobsForPerson).not.toHaveBeenCalled();
    expect(state.closed).toBe(true);
  });

  it('NEVER rejects when the opener itself throws', async () => {
    await expect(ingestJobsGraphForUser('sub-123', () => { throw new Error('volume gone'); })).resolves.toBeUndefined();
  });

  it('NEVER rejects when the kernel ingestion service throws (host flow unaffected)', async () => {
    ingestJobsForPerson.mockImplementationOnce(() => { throw new Error('arango down'); });
    const { db } = fakeDb([{ id: 1, title: 't', company: 'c', location: null, url: null }]);
    await expect(ingestJobsGraphForUser('sub-123', () => db)).resolves.toBeUndefined();
  });

  it('does nothing for an empty sub (person-graph isolation key is mandatory)', async () => {
    const opener = vi.fn();
    await ingestJobsGraphForUser('', opener as never);
    expect(opener).not.toHaveBeenCalled();
    expect(ingestJobsForPerson).not.toHaveBeenCalled();
  });
});

describe('the cron evening chain fires the mirror at the jobs-write seam (source pin)', () => {
  const cron = readFileSync(resolve(__dirname, '..', 'src-routes', 'career-hunter-cron.ts'), 'utf8');
  it('mirrors the scrape-invoking user after a SUCCESSFUL shared pull', () => {
    expect(cron).toContain('if (r.ok) void ingestJobsGraphForUser(users[0])');
  });
  it('mirrors every other user only after a successful match step', () => {
    expect(cron).toContain('if (match.ok) void ingestJobsGraphForUser(users[i])');
  });
  it('advances the cron score cursor only after a successful score step', () => {
    expect(cron).toContain('if (scoreResult.ok) await markCronScore(ctx.pool, userSub)');
  });
});

describe('graph SQLite path resolution', () => {
  it.each(['../victim', 'Victim', 'victim'])('delegates the exact raw subject to userPaths: %s', (sub) => {
    const resolver = vi.fn((raw: string) => ({
      userDir: `contained:${raw}`,
      userDb: `contained:${raw}:user`,
      corpusDb: 'contained:corpus',
    }));
    expect(dbPaths(sub, resolver as never)).toEqual({
      userPath: `contained:${sub}:user`, corpusPath: 'contained:corpus',
    });
    expect(resolver).toHaveBeenCalledWith(sub);
  });
});
