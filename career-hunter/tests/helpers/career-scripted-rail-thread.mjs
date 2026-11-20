/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.25: a scripted model on the package's rail path (POST /api/career-hunter/engine/complete) that answers from its own thread. A suite that holds its own thread inside a route (tests/career-ready-with-documents.test.mjs keeps GET /jobs/:id between two of its reads until the engine finishes) cannot serve the engine's model calls from that thread; this keeps answering while it is held.
 */
import http from 'node:http';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

/** The one path the engine's rail client posts a completion to. */
const COMPLETE_PATH = '/api/career-hunter/engine/complete';

/**
 * @description Pick the scripted answer for one completion the engine asks for: the fit when the recruiter scores
 * the job, the letter when the cover editor is handed a draft, the whole packet for anything else.
 * @param {{system?: string, prompt?: string}} document The completion request the engine posted.
 * @param {{fit: object, cover: object, packet: object}} answers The scripted answers.
 * @returns {object} The answer to send back as the model's JSON.
 */
function scripted(document, answers) {
  if (String(document.system || '').startsWith('You are a recruiter')) return answers.fit;
  if (String(document.prompt || '').includes('DRAFT COVER')) return answers.cover;
  return answers.packet;
}

/**
 * @description Serve the scripted model on loopback from this thread and tell the parent the port.
 * @param {{fit: object, cover: object, packet: object}} answers The scripted answers.
 * @returns {void}
 */
function serve(answers) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const ok = req.method === 'POST' && req.url === COMPLETE_PATH;
      let reply = { ok: false, error: 'not-found' };
      if (ok) {
        try { reply = { ok: true, text: JSON.stringify(scripted(JSON.parse(body), answers)), model: 'scripted', provider: 'scripted' }; }
        catch (error) { reply = { ok: false, error: 'invalid-json', detail: String(error.message) }; }
      }
      res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
}

/**
 * @description Start the scripted model in its own thread.
 * @param {{fit: object, cover: object, packet: object}} answers The scripted answers (plain JSON).
 * @returns {Promise<{port: number, close: () => Promise<number>}>} The loopback port and a way to stop the thread.
 */
export function startRailThread(answers) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { answers } });
    worker.once('error', reject);
    worker.once('message', (port) => resolve({ port, close: () => worker.terminate() }));
  });
}

if (!isMainThread && workerData?.answers) serve(workerData.answers);
