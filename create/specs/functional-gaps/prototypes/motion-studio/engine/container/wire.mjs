/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify one bounded real engine exchange without any package/owner authority substitution.
 */
import { connect } from 'node:net';
const MAX = 12 * 1024 * 1024;
export async function exchange(request, expected, { host = '127.0.0.1', port = 7414 } = {}) {
  const message = Buffer.from(JSON.stringify({ id: 1, cmd: 'motion', args: request }) + '\n');
  if (message.length > MAX) throw new Error('motion_selftest_request_limit');
  return new Promise((done, reject) => {
    const socket = connect(port, host); let parts = [], size = 0, hello, ended = false;
    const timer = setTimeout(() => finish(new Error('motion_selftest_deadline')), 50000);
    function finish(error, reply) { if (ended) return; ended = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : done(reply); }
    socket.on('error', finish); socket.on('close', () => { if (!ended) finish(new Error('motion_selftest_incomplete_reply')); });
    socket.on('data', data => {
      for (;;) {
        const end = data.indexOf(10), chunk = end < 0 ? data : data.subarray(0, end);
        size += chunk.length;
        if (size > (hello ? MAX : 4096)) return finish(new Error('motion_selftest_output_limit'));
        parts.push(chunk); if (end < 0) return;
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
        catch { return finish(new Error('motion_selftest_invalid_frame')); }
        parts = []; size = 0;
        if (!hello) {
          hello = value.bridge;
          if (!hello || ['protocol', 'buildHash', 'upstream'].some(key => hello[key] !== expected[key])) return finish(new Error('motion_engine_source_mismatch'));
          socket.write(message);
        } else {
          if (!value || value.id !== 1 || value.buildHash !== expected.buildHash || value.ok !== true || value.result?.upstream !== expected.upstream) return finish(new Error(value?.error || 'motion_selftest_invalid_result'));
          return finish(null, value.result);
        }
        data = data.subarray(end + 1); if (!data.length) return;
      }
    });
  });
}
