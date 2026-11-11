#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The test search is one long-lived container shared by every gate run.
 *     |                                         | A run that is killed leaves its indices behind, and on 2026-11-10 they
 *     |                                         | filled a 512 MB engine until it answered HTTP 429: 721 refusals, 48
 *     |                                         | indices left over, and the Operations step of two lanes waited its full
 *     |                                         | 15 minutes for answers that never came. This removes what earlier runs
 *     |                                         | left (older than any run still going) and says how the engine's memory
 *     |                                         | stands, so a hang that does happen has its cause printed above it.
 * -----------------------------------------------------------------------------
 */
import { pathToFileURL } from 'node:url';

/** A gate run lasts minutes; an index this old belongs to no run still going. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * @description The indices an earlier run left behind.
 * @param {Array<{index: string, 'creation.date': string}>} rows The engine's index list with creation times.
 * @param {number} nowMs The time now, in milliseconds.
 * @param {number} [maxAgeMs] How old an index must be to count as left over.
 * @returns {string[]} Their names. The engine's own indices (a leading dot) are never among them.
 */
export function staleIndices(rows, nowMs, maxAgeMs = STALE_AFTER_MS) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row.index === 'string' && !row.index.startsWith('.'))
    .filter((row) => Number(row['creation.date']) > 0 && nowMs - Number(row['creation.date']) > maxAgeMs)
    .map((row) => row.index);
}

async function json(base, path, init) {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${init?.method || 'GET'} ${path}: HTTP ${response.status}`);
  return response.json();
}

/**
 * @description Remove what earlier runs left in the test search and read how its memory stands.
 * @param {string} base The test search address, such as http://127.0.0.1:35690.
 * @param {{nowMs?: number, maxAgeMs?: number}} [options] The time now and the age that counts as left over.
 * @returns {Promise<{removed: string[], failed: string[], heapPercent: number|null, heapMb: number|null, refused: number|null}>}
 * What was removed, what would not go, the engine's memory in use, its size, and how many requests it has refused
 * for lack of memory since it started.
 */
export async function sweep(base, options = {}) {
  const rows = await json(base, '/_cat/indices?h=index,creation.date&format=json');
  const removed = [];
  const failed = [];
  for (const name of staleIndices(rows, options.nowMs ?? Date.now(), options.maxAgeMs)) {
    try { await json(base, `/${encodeURIComponent(name)}`, { method: 'DELETE' }); removed.push(name); }
    catch { failed.push(name); }
  }
  let heapPercent = null; let heapMb = null; let refused = null;
  try {
    const stats = await json(base, '/_nodes/stats/breaker,jvm');
    const node = Object.values(stats.nodes || {})[0];
    heapPercent = Number(node?.jvm?.mem?.heap_used_percent ?? NaN);
    heapMb = Math.round(Number(node?.jvm?.mem?.heap_max_in_bytes ?? NaN) / 1048576);
    refused = Number(node?.breakers?.parent?.tripped ?? NaN);
  } catch { /* an engine that will not say is reported as unknown below */ }
  const known = (value) => (Number.isFinite(value) ? value : null);
  return { removed, failed, heapPercent: known(heapPercent), heapMb: known(heapMb), refused: known(refused) };
}

/**
 * @description The lines a person reads before the gate runs.
 * @param {{removed: string[], failed: string[], heapPercent: number|null, heapMb: number|null, refused: number|null}} result What sweep found.
 * @returns {string[]} One line per fact worth knowing; none when the engine is clean and has refused nothing.
 */
export function report(result) {
  const lines = [];
  if (result.removed.length) lines.push(`test search: removed ${result.removed.length} indices left by earlier runs`);
  if (result.failed.length) lines.push(`test search: ${result.failed.length} left-over indices would not be removed`);
  if (result.refused) {
    lines.push(`test search: it has refused ${result.refused} requests for lack of memory since it started`
      + ` (memory ${result.heapPercent ?? '?'}% of ${result.heapMb ?? '?'} MB). If the Operations step hangs, that is why:`
      + ' remove the container operations-contract-search while no gate is running and run store-push.sh again.');
  }
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const base = (process.argv[2] || process.env.OSHAL_TEST_SEARCH || 'http://127.0.0.1:35690').replace(/\/$/, '');
  try { for (const line of report(await sweep(base))) console.error(line); }
  catch (error) { console.error(`test search: could not be read (${error.message})`); process.exitCode = 1; }
}
