/* CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the bounded bundled detector locally; accept pixels, never caller-selected URLs.
 */
'use strict';
importScripts('/api/portrait-studio/face-cascade');
self.onmessage = async function (event) {
  try {
    const input = event.data;
    if (!input || !(input.pixels instanceof ArrayBuffer) || input.pixels.byteLength > 640 * 640) throw new Error('Invalid image');
    const response = await fetch('/api/portrait-studio/face-model', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error('Model unavailable');
    const text = await response.text();
    if (text.length > 1500000) throw new Error('Invalid model');
    const boxes = self.PortraitFaceCascade.detect(new Uint8Array(input.pixels), input.width, input.height, JSON.parse(text), input.maxFaces);
    self.postMessage({ boxes });
  } catch (_) {
    self.postMessage({ error: 'Local detection unavailable' });
  }
};
