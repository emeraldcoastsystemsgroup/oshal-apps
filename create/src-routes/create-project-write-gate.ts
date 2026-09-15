/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bound concurrent Create transactions before checkout so their current authorization can use the shared pool.
 */
import { ProjectError, type ProjectContext } from './create-project-types';

interface Waiter { resolve: (release: () => void) => void; timer: ReturnType<typeof setTimeout> }
interface WriteGate { active: boolean; waiting: Waiter[] }
const gates = new WeakMap<ProjectContext['pool'], WriteGate>();
export const PROJECT_WRITE_QUEUE = Object.freeze({ maximum: 32, timeoutMs: 5000 });

/** Hand the single write admission to the oldest live waiter, without retaining a database client. */
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

/** Queue at most 32 writers for five seconds; authorization is repeated after this wait. */
export function acquireProjectWrite(pool: ProjectContext['pool']): Promise<() => void> {
  let gate = gates.get(pool);
  if (!gate) { gate = { active: false, waiting: [] }; gates.set(pool, gate); }
  if (!gate.active) { gate.active = true; return Promise.resolve(releaseAdmission(gate)); }
  if (gate.waiting.length >= PROJECT_WRITE_QUEUE.maximum) return Promise.reject(new ProjectError(503, 'project_write_queue_full'));
  const current = gate;
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { resolve, timer: setTimeout(() => {
      const index = current.waiting.indexOf(waiter);
      if (index >= 0) current.waiting.splice(index, 1);
      reject(new ProjectError(503, 'project_write_queue_timeout'));
    }, PROJECT_WRITE_QUEUE.timeoutMs) };
    current.waiting.push(waiter);
  });
}
