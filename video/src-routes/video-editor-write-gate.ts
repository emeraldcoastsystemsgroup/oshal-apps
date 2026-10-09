/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Admit one editor write transaction per pool before a client is checked out, so the current-authorization reads a write repeats before commit can always get the pool's second connection. Waiters are bounded (32) and time out (5 s) without holding a database client.
 */
import { EditorError, type EditorContext } from './video-editor-types';

interface Waiter { resolve: (release: () => void) => void; timer: ReturnType<typeof setTimeout> }
interface WriteGate { active: boolean; waiting: Waiter[] }
const gates = new WeakMap<EditorContext['pool'], WriteGate>();
export const EDITOR_WRITE_QUEUE = Object.freeze({ maximum: 32, timeoutMs: 5000 });

/** Hand the single admission to the oldest live waiter; releasing twice is harmless. */
function releaseAdmission(gate: WriteGate): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = gate.waiting.shift();
    if (!next) { gate.active = false; return; }
    clearTimeout(next.timer);
    next.resolve(releaseAdmission(gate));
  };
}

/**
 * @description Wait for this pool's single write admission (at most 32 waiters, five seconds each).
 * @param pool - The package pool. @returns A release function.
 */
export function acquireEditorWrite(pool: EditorContext['pool']): Promise<() => void> {
  let gate = gates.get(pool);
  if (!gate) { gate = { active: false, waiting: [] }; gates.set(pool, gate); }
  if (!gate.active) { gate.active = true; return Promise.resolve(releaseAdmission(gate)); }
  if (gate.waiting.length >= EDITOR_WRITE_QUEUE.maximum) return Promise.reject(new EditorError(503, 'video_edit_write_queue_full'));
  const current = gate;
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { resolve, timer: setTimeout(() => {
      const index = current.waiting.indexOf(waiter);
      if (index >= 0) current.waiting.splice(index, 1);
      reject(new EditorError(503, 'video_edit_write_queue_timeout'));
    }, EDITOR_WRITE_QUEUE.timeoutMs) };
    current.waiting.push(waiter);
  });
}
