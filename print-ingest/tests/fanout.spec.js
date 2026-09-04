/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-135 D15 guards for fan-out, against the COMPILED routes/*.js. The invariants tested are the ones whose violation is permanent: writing a destination the human did NOT tick, copies that do not share a doc_id (so a document can never be found or retracted as one thing), a partial fan-out reported as success or as total failure, and a shared destination written as private (or the reverse, which would publish someone's document to every signed-in user).
 */

'use strict';

const assert = require('node:assert');
const { planFanout, buildIngestPayload, executeFanout, ragDocId, stateForResults } =
  require('../routes/print-fanout.js');

const CATALOG = [
  { id: 'private', label: 'Private to me', kind: 'private', collection: 'my-knowledge', readableBy: 'only you' },
  { id: 'swarm', label: 'Swarm knowledge', kind: 'swarm', collection: 'swarm-knowledge', readableBy: 'everyone' },
  { id: 'maintenance', label: 'Maintenance bot', kind: 'bot', collection: 'agent-knowledge-maintenance', botId: 'maintenance', readableBy: 'everyone' },
];

const DOC = {
  title: 'Quarterly Operations Summary',
  text: 'Heat exchanger E-204 was serviced.',
  contentSha256: 'a'.repeat(64),
  sidecar: { printerName: 'oshal print', originatingComputer: 'PARENTPC', requestingUser: 'declared', receivedAt: '2026-09-03T20:10:52Z' },
};

/** A corpus double that records writes, and can be told to fail one collection. */
function recordingRag(failCollection) {
  const writes = [];
  return {
    writes,
    ingest: async (payload) => {
      if (payload.collection === failCollection) throw new Error('collection unavailable');
      writes.push(payload);
    },
  };
}

async function run() {
  let checks = 0;
  const check = async (fn) => { await fn(); checks += 1; };

  // --- the plan is what was TICKED, not what was recommended ---------------
  await check(() => {
    const plan = planFanout(['maintenance', 'swarm'], CATALOG);
    assert.deepStrictEqual(plan.map((w) => w.destinationId), ['swarm', 'maintenance'],
      'only ticked destinations, in catalog order');
  });
  await check(() => {
    assert.strictEqual(planFanout(['nonsense'], CATALOG).length, 0, 'unknown ids are dropped, never guessed');
  });
  await check(() => {
    assert.strictEqual(planFanout(['private', 'private'], CATALOG).length, 1,
      'approving the same destination twice is one copy');
  });

  // --- private vs shared --------------------------------------------------
  await check(() => {
    const plan = planFanout(['private', 'swarm', 'maintenance'], CATALOG);
    const by = Object.fromEntries(plan.map((w) => [w.destinationId, w.privateToOwner]));
    assert.strictEqual(by.private, true, 'the private destination is written owned');
    assert.strictEqual(by.swarm, false, 'a deliberately shared destination is not');
    assert.strictEqual(by.maintenance, false, 'nor is a bot corpus - it is routing, not privacy');
  });

  // --- one identity across copies -----------------------------------------
  await check(async () => {
    const rag = recordingRag(null);
    const results = await executeFanout(rag, planFanout(['private', 'swarm', 'maintenance'], CATALOG), DOC);
    assert.strictEqual(results.length, 3, 'three copies attempted');
    const ids = new Set(rag.writes.map((w) => w.metadata.doc_id));
    assert.strictEqual(ids.size, 1, 'every copy shares ONE doc_id, so results dedupe by document');
    assert.strictEqual([...ids][0], ragDocId(DOC.contentSha256));
    assert.strictEqual([...ids][0], `print:${'a'.repeat(64)}`, 'and it is content-addressed');
  });

  // --- provenance ---------------------------------------------------------
  await check(() => {
    const payload = buildIngestPayload(planFanout(['maintenance'], CATALOG)[0], DOC);
    assert.strictEqual(payload.metadata.provenance, 'print-drop', 'the copy says how it arrived');
    assert.strictEqual(payload.metadata.trust, 'untrusted',
      'printed content is data a LAN user chose to place in a model context');
    assert.strictEqual(payload.metadata.originating_computer, 'PARENTPC');
    assert.strictEqual(payload.collection, 'agent-knowledge-maintenance');
    assert.strictEqual(payload.content, DOC.text);
  });

  // --- partial failure is a real state ------------------------------------
  await check(async () => {
    const rag = recordingRag('swarm-knowledge');
    const results = await executeFanout(rag, planFanout(['private', 'swarm', 'maintenance'], CATALOG), DOC);
    assert.strictEqual(results.filter((r) => r.ok).length, 2, 'one failure does not abandon the others');
    const failed = results.find((r) => !r.ok);
    assert.strictEqual(failed.destinationId, 'swarm');
    assert.match(failed.error, /unavailable/, 'the failure names why');
    assert.strictEqual(stateForResults(results), 'partially_ingested',
      'reported as partial - a written copy cannot be un-written and a blind retry would duplicate it');
  });
  await check(async () => {
    const rag = recordingRag('my-knowledge');
    const results = await executeFanout(rag, planFanout(['private'], CATALOG), DOC);
    assert.strictEqual(stateForResults(results), 'failed', 'every copy failing is failed');
  });
  await check(async () => {
    const rag = recordingRag(null);
    const results = await executeFanout(rag, planFanout(['private'], CATALOG), DOC);
    assert.strictEqual(stateForResults(results), 'ingested', 'all copies written is ingested');
  });
  await check(() => {
    assert.strictEqual(stateForResults([]), 'failed', 'writing nowhere is never success');
  });

  // --- executeFanout never throws -----------------------------------------
  await check(async () => {
    const exploding = { ingest: async () => { throw new Error('boom'); } };
    const results = await executeFanout(exploding, planFanout(['private'], CATALOG), DOC);
    assert.strictEqual(results[0].ok, false, 'a throwing corpus becomes a recorded failure, not an exception');
  });

  return checks;
}

module.exports = run;
