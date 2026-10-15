/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bound fixture child JSON frames in bytes before decoding, buffering or parsing an entire line.
 */
import { EventEmitter } from 'node:events';
const decoder = new TextDecoder('utf-8', { fatal: true });
export function boundedJsonFrames(readable, { maxBytes, onError }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024 || typeof onError !== 'function') {
    throw new Error('Explicit bounded fixture frame policy required');
  }
  const frames = new EventEmitter();
  let pieces = [], bytes = 0, closed = false;
  function close() {
    if (closed) return;
    closed = true; pieces = []; bytes = 0;
    readable.off('data', data); readable.off('end', end); readable.off('error', failed);
  }
  function failed(error) { if (!closed) { close(); onError(error); } }
  function part(value) {
    if (bytes + value.length > maxBytes) { failed(new Error('Fixture frame exceeds bounded bytes')); return false; }
    if (value.length) { pieces.push(value); bytes += value.length; }
    return true;
  }
  function data(chunk) {
    if (closed) return;
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (!closed && offset < value.length) {
      const newline = value.indexOf(10, offset);
      if (newline === -1) { part(value.subarray(offset)); return; }
      if (!part(value.subarray(offset, newline))) return;
      const packet = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, bytes);
      pieces = []; bytes = 0; offset = newline + 1;
      let parsed;
      try { parsed = JSON.parse(decoder.decode(packet)); }
      catch { failed(new Error('Fixture frame is not valid UTF-8 JSON')); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        failed(new Error('Fixture frame must be a JSON object')); return;
      }
      frames.emit('frame', parsed);
    }
  }
  function end() {
    if (bytes) failed(new Error('Fixture frame ended without a newline'));
    else close();
  }
  frames.close = close;
  readable.on('data', data); readable.on('end', end); readable.on('error', failed);
  return frames;
}
