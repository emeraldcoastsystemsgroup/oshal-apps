/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded undo/redo for the manual video timeline: independent serialized snapshots (a caller can never mutate history through a returned document), a count and a byte ceiling, and a no-op commit that records nothing.
 */
import { serializeTimeline, parseTimeline } from './timeline-model.mjs';
import { demand } from './timeline-validation.mjs';

/** @description Keep undo/redo state bounded and isolated from caller mutation.
 * @param {object} initial Initial validated timeline.
 * @param {{limit?:number,maxBytes?:number}} options Retained snapshot count (1-200) and UTF-8 byte ceiling.
 * @returns {object} current, commit, undo, redo, canUndo, canRedo, reset and size methods. */
export function createTimelineHistory(initial, options = {}) {
  const limit = options.limit ?? 100, maxBytes = options.maxBytes ?? 8388608;
  demand(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'History count is out of range');
  demand(Number.isInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 67108864, 'History budget is out of range');
  const encode = document => {
    const source = serializeTimeline(document), bytes = new TextEncoder().encode(source).length;
    demand(bytes <= maxBytes, 'This project exceeds the undo history budget'); return { source, bytes };
  };
  let rows = [encode(initial)], cursor = 0;
  const current = () => parseTimeline(rows[cursor].source);
  const commit = document => {
    const entry = encode(document);
    if (entry.source === rows[cursor].source) return current();
    rows = rows.slice(0, cursor + 1); rows.push(entry);
    let bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    while (rows.length > 1 && (rows.length > limit || bytes > maxBytes)) bytes -= rows.shift().bytes;
    cursor = rows.length - 1; return current();
  };
  return { current, commit, canUndo: () => cursor > 0, canRedo: () => cursor < rows.length - 1,
    undo: () => { cursor = Math.max(0, cursor - 1); return current(); },
    redo: () => { cursor = Math.min(rows.length - 1, cursor + 1); return current(); },
    reset: document => { rows = [encode(document)]; cursor = 0; return current(); },
    size: () => rows.length };
}
