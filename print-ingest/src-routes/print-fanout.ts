/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-135 D15 — fan-out: one approved document written to several corpora on purpose. Retrieval fuses PER-COLLECTION rankings, so a document competes only with what shares its collection: the same page ranks high in a focused bot corpus and is buried in a large swarm one for the identical query. Three invariants are enforced here rather than trusted to callers. (1) Every copy carries the same content-hash doc_id, so results dedupe by document and every copy is reachable from one id. (2) Writes are attempted independently and the outcome of EACH is returned — a partial fan-out reports partially_ingested rather than pretending success or claiming total failure, because a written copy cannot be un-written and a blind retry would duplicate the ones that succeeded. (3) Only destinations the human actually ticked are written; the recommendation is not the instruction.
 *
 * @module print-fanout
 */

import type { Destination, PrintSidecar } from './print-classify';

/** One planned write. */
export interface FanoutWrite {
  destinationId: string;
  label: string;
  kind: Destination['kind'];
  collection: string;
  botId?: string;
  /** Owned-and-private unless the destination is deliberately shared. */
  privateToOwner: boolean;
}

/** The outcome of one attempted write. */
export interface FanoutResult extends FanoutWrite {
  ok: boolean;
  ragDocId: string;
  writtenAt: string;
  error?: string;
}

/** What the RAG ingest call needs. Injected so the planner stays testable. */
export interface RagIngestPort {
  ingest(payload: {
    format: 'text';
    content: string;
    title: string;
    collection: string;
    private: boolean;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * @description The document id every copy shares. Content-addressed, so the same
 * document printed twice is one document, and so a future retraction can find
 * every copy from a single value.
 * @param contentSha256 - SHA-256 of the extracted text.
 * @returns The corpus document id.
 */
export function ragDocId(contentSha256: string): string {
  return `print:${String(contentSha256 || '').trim().toLowerCase()}`;
}

/**
 * @description Turn the human's ticked destination ids into the exact set of
 * writes. Unknown ids are dropped rather than guessed at, and duplicates collapse
 * — approving the same destination twice is one copy, not two.
 * @param approvedIds - Destination ids the approver ticked.
 * @param catalog - The destination catalog.
 * @returns The writes to perform, in catalog order.
 */
export function planFanout(approvedIds: string[], catalog: Destination[]): FanoutWrite[] {
  const wanted = new Set((approvedIds || []).map((id) => String(id)));
  return catalog
    .filter((destination) => wanted.has(destination.id))
    .map((destination) => ({
      destinationId: destination.id,
      label: destination.label,
      kind: destination.kind,
      collection: destination.collection,
      botId: destination.botId,
      // Only a deliberately shared destination is written unowned; everything
      // else stays owned, because an operator's non-private ingest is readable
      // by every signed-in user.
      privateToOwner: destination.kind === 'private',
    }));
}

/**
 * @description Build the corpus payload for one copy. Provenance is explicit and
 * the content is marked untrusted: a printed document is something a person on the
 * network chose to place into a model's context, and a bot reading it must treat
 * it as data rather than instructions.
 * @param write - The planned write.
 * @param doc - Title, text, content hash and the printer's sidecar.
 * @returns The ingest payload.
 */
export function buildIngestPayload(
  write: FanoutWrite,
  doc: { title: string; text: string; contentSha256: string; sidecar: PrintSidecar },
): Parameters<RagIngestPort['ingest']>[0] {
  return {
    format: 'text',
    content: doc.text,
    title: doc.title,
    collection: write.collection,
    private: write.privateToOwner,
    metadata: {
      doc_id: ragDocId(doc.contentSha256),
      provenance: 'print-drop',
      trust: 'untrusted',
      destination: write.destinationId,
      printer_name: String(doc.sidecar.printerName || ''),
      originating_computer: String(doc.sidecar.originatingComputer || ''),
      printed_by_declared: String(doc.sidecar.requestingUser || ''),
      received_at: String(doc.sidecar.receivedAt || ''),
      fetched_on: new Date().toISOString(),
    },
  };
}

/**
 * @description Perform the fan-out. Every write is attempted independently and its
 * outcome recorded; one failure never abandons the copies that would have
 * succeeded, and never rolls back the ones that already did — a written copy
 * cannot be un-written. Never throws: the caller records the results and reports
 * a partial outcome honestly.
 * @param rag - The corpus ingest port.
 * @param writes - The planned writes.
 * @param doc - Title, text, content hash and sidecar.
 * @returns One result per attempted write, in order.
 */
export async function executeFanout(
  rag: RagIngestPort,
  writes: FanoutWrite[],
  doc: { title: string; text: string; contentSha256: string; sidecar: PrintSidecar },
): Promise<FanoutResult[]> {
  const results: FanoutResult[] = [];
  for (const write of writes) {
    const attempt: FanoutResult = {
      ...write,
      ok: false,
      ragDocId: ragDocId(doc.contentSha256),
      writtenAt: new Date().toISOString(),
    };
    try {
      await rag.ingest(buildIngestPayload(write, doc));
      attempt.ok = true;
    } catch (err) {
      attempt.error = (err as Error)?.message?.slice(0, 300) || 'ingest failed';
    }
    results.push(attempt);
  }
  return results;
}

/**
 * @description The intake state a fan-out produces. `partially_ingested` is a real
 * outcome, not an error dressed up: some copies exist and some do not, and a blind
 * retry would duplicate the ones that succeeded.
 * @param results - The fan-out results.
 * @returns The state to persist.
 */
export function stateForResults(results: FanoutResult[]): 'ingested' | 'partially_ingested' | 'failed' {
  if (!results.length) return 'failed';
  const succeeded = results.filter((r) => r.ok).length;
  if (succeeded === results.length) return 'ingested';
  return succeeded === 0 ? 'failed' : 'partially_ingested';
}
