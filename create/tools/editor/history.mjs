/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retain independent undo snapshots with explicit count and byte ceilings.
 */
import { serializeProject, parseProject } from './model.mjs';
import { demand } from './model-validation.mjs';

/** @description Keep undo/redo state bounded and isolate the stored snapshots from caller mutation.
 * @param {object} initial Initial validated project.
 * @param {{limit?:number,maxBytes?:number}} options Total retained snapshots and UTF-8 byte ceiling.
 * @returns {object} current, commit, undo, redo, canUndo, canRedo and reset methods. */
export function createHistory(initial, options = {}) {
  const limit = options.limit ?? 50, maxBytes = options.maxBytes ?? 67108864;
  demand(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'History count is out of range');
  demand(Number.isInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 268435456, 'History budget is out of range');
  const encode = project => {
    const source = serializeProject(project), bytes = new TextEncoder().encode(source).length;
    demand(bytes <= maxBytes, 'This project exceeds the undo history budget'); return { source, bytes };
  };
  let rows = [encode(initial)], cursor = 0;
  const current = () => parseProject(rows[cursor].source);
  const commit = project => {
    const entry = encode(project); if (entry.source === rows[cursor].source) return current();
    rows = rows.slice(0, cursor + 1); rows.push(entry);
    let bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    while (rows.length > 1 && (rows.length > limit || bytes > maxBytes)) bytes -= rows.shift().bytes;
    cursor = rows.length - 1; return current();
  };
  return { current, commit, canUndo: () => cursor > 0, canRedo: () => cursor < rows.length - 1,
    undo: () => { cursor = Math.max(0, cursor - 1); return current(); },
    redo: () => { cursor = Math.min(rows.length - 1, cursor + 1); return current(); },
    reset: project => { const entry = encode(project); rows = [entry]; cursor = 0; return current(); } };
}
