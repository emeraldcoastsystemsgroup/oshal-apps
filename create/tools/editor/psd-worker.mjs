/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Isolate bounded Photoshop parsing from request handling; no host services enter this worker.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readPsd } from './psd-reader.mjs';
try {
  const parsed = readPsd(new Uint8Array(workerData));
  parentPort.postMessage({ parsed }, [parsed.merged.buffer, ...parsed.layers.filter(l => l.rgba).map(l => l.rgba.buffer)]);
} catch (error) { parentPort.postMessage({ error: typeof error.code === 'string' ? error.code : 'invalid_psd' }); }
