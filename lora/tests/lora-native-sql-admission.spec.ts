/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Two live LoRA blockers on the native kernel. (a) Selecting a character answered 502 "dataset receipts unavailable": GET /dataset expired stale staging first (a DELETE and an UPDATE), and the kernel admits a GET as a reader and refuses every SQL mutation under it (crates/packages/src/sql_transaction.rs). The route runs here under a double of that admission rule with the character found, which the ownership spec's GET sweep never reached (its character lookup answers no row). (b) Creating a character answered 502 character_creation_failed: it opened its transaction with "BEGIN ISOLATION LEVEL READ COMMITTED", which the kernel's SQL bridge (crates/host-process/bridge/pg_pool.js) does not map to transaction control, so its SQL parser refused it "unsupported SQL statement". The creation runs against a client double that accepts exactly the bridge's transaction forms, and every transaction-control literal in the package source is checked against the same set.
 */

import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { createLoraDatasetRoutes, effectiveDatasetReceipts } from '../src-routes/lora-dataset-ingest';
import { createLoraCharacter } from '../src-routes/lora-character-create';

const SRC_ROUTES = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src-routes');

/** The kernel's refusal of a mutation under read admission, verbatim. */
const WRITER_REFUSAL = 'refused: SQL mutation requires original writer admission';
/** What read admission lets through: a query, or idempotent table setup. */
const READ_STATEMENT = /^\s*(?:SELECT|WITH|VALUES|TABLE)\b/i;
const IDEMPOTENT_DDL = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i;
/**
 * The transaction-control statements the native bridge maps (pg_pool.js `request`: the statement
 * is trimmed, a trailing ";" dropped and upper-cased, then looked up). Anything else that starts a
 * transaction reaches the kernel's SQL parser, which refuses it.
 */
const BRIDGE_TRANSACTION_FORMS = new Set(['BEGIN', 'BEGIN READ ONLY', 'START TRANSACTION', 'START TRANSACTION READ ONLY', 'COMMIT', 'END', 'ROLLBACK']);
const TRANSACTION_CONTROL = /^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\b/i;

const admission = new AsyncLocalStorage<'read' | 'write'>();
const CHARACTER = { id: '10000000-0000-4000-8000-0000000000cc', config: { subject: 'tin-drummer' } as never };

/** Receipts and live staging the listing reads; any write under read admission is refused. */
function datasetPool() {
  const refused: string[] = [];
  const pool = {
    query: vi.fn(async (text: string) => {
      if (admission.getStore() === 'read' && !READ_STATEMENT.test(text) && !IDEMPOTENT_DDL.test(text)) {
        refused.push(text.trim().replace(/\s+/g, ' ').slice(0, 120));
        throw new Error(WRITER_REFUSAL);
      }
      if (/FROM oshal_lora_dataset_images WHERE character_id/.test(text)) {
        return { rows: [
          { id: 'r-live', filename: 'a.png', status: 'queued' },
          { id: 'r-gone', filename: 'b.png', status: 'queued' },
          { id: 'r-done', filename: 'c.png', status: 'ready' },
        ], rowCount: 3 };
      }
      if (/FROM oshal_lora_dataset_staging s JOIN/.test(text)) return { rows: [{ image_id: 'r-live' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool, refused };
}

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
});

/** Serve the dataset routes as owner-a, admitting GET/HEAD as reads the way the kernel does. */
async function serveDataset(pool: unknown): Promise<string> {
  const app = express();
  app.use((req, _res, next) => admission.run(['GET', 'HEAD'].includes(req.method) ? 'read' : 'write', next));
  app.use(createLoraDatasetRoutes({ pool } as never, {
    callerSub: () => 'owner-a',
    loadCharacter: async (_ctx, subject, owner) => (subject === 'tin-drummer' && owner === 'owner-a' ? CHARACTER : null),
    directorAgentId: 'director',
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server!.once('listening', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('GET /dataset under the kernel read admission', () => {
  it('answers the receipts without attempting a SQL write', async () => {
    const { pool, refused } = datasetPool();
    const response = await fetch(`${await serveDataset(pool)}/dataset?subject=tin-drummer`);
    expect(refused).toEqual([]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subject).toBe('tin-drummer');
    expect(body.images).toEqual([
      { filename: 'a.png', status: 'queued' },
      { filename: 'b.png', status: 'failed' },
      { filename: 'c.png', status: 'ready' },
    ]);
  });

  it('reports a queued receipt with no live staged bytes as failed and leaves settled receipts alone', () => {
    const rows = [{ id: 1, status: 'queued' }, { id: 2, status: 'queued' }, { id: 3, status: 'failed' }, { id: 4, status: 'ready' }];
    expect(effectiveDatasetReceipts(rows, new Set(['1']))).toEqual([
      { status: 'queued' }, { status: 'failed' }, { status: 'failed' }, { status: 'ready' },
    ]);
  });
});

/** A connection that accepts exactly the bridge's transaction forms and records every statement. */
function bridgeClient() {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      const command = text.trim().replace(/;$/, '').toUpperCase();
      if (TRANSACTION_CONTROL.test(text) && !BRIDGE_TRANSACTION_FORMS.has(command)) {
        throw new Error('refused: unsupported SQL statement');
      }
      if (/^INSERT INTO oshal_lora_characters/.test(text.trim())) return { rows: [{ subject: 'tin-drummer' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { client, statements };
}

describe('character creation through the native SQL bridge', () => {
  it('creates the character in one bridge-accepted transaction with its lock deadline and owner lock', async () => {
    const { client, statements } = bridgeClient();
    const outcome = await createLoraCharacter({ pool: { connect: async () => client } } as never, 'owner-a', {
      subject: 'tin-drummer', heroImage: 'hero.png', identPrompt: 'a tin drummer, red coat',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[2]).toMatch(/^SELECT pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)$/);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('every transaction-control literal in the package routes is one the bridge accepts', () => {
    const literals: string[] = [];
    for (const file of readdirSync(SRC_ROUTES).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(SRC_ROUTES, file), 'utf8');
      for (const match of source.matchAll(/\.query\(\s*(['"`])((?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\b[^'"`]*)\1/gi)) {
        literals.push(`${file}: ${match[2]}`);
        expect(BRIDGE_TRANSACTION_FORMS.has(match[2].trim().replace(/;$/, '').toUpperCase()), `${file}: ${match[2]}`).toBe(true);
      }
    }
    expect(literals.some((literal) => literal.startsWith('lora-character-create.ts: '))).toBe(true);
  });
});
