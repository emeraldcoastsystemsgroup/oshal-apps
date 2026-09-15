/* CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep face finding local, bounded and cancellable without replacing newer manual edits.
 */
'use strict';
{
  function fingerprint(state) {
    return JSON.stringify([state.photo, state.mode, state.aspect, state.maxFaces, state.boxes]);
  }

  function pixels(image) {
    const ratio = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.floor(image.naturalWidth * ratio), height = Math.floor(image.naturalHeight * ratio);
    if (Math.min(width, height) < 24) throw new Error('Image too small');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data, gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round((2 * rgba[4 * i] + 7 * rgba[4 * i + 1] + rgba[4 * i + 2]) / 10);
    canvas.width = canvas.height = 0;
    return { pixels: gray.buffer, width, height, scaleX: image.naturalWidth / width, scaleY: image.naturalHeight / height };
  }

  function workerDetect(image, maxFaces, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Cancelled')); return; }
      const input = pixels(image), worker = new Worker('/api/portrait-studio/face-worker');
      const abort = () => finish(new Error('Cancelled'));
      const timer = setTimeout(() => finish(new Error('Detection timed out')), 8000);
      function finish(error, boxes) {
        clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate();
        if (error) reject(error); else resolve(boxes);
      }
      worker.onerror = () => finish(new Error('Local detection unavailable'));
      worker.onmessage = event => {
        if (!Array.isArray(event.data?.boxes)) { finish(new Error('Local detection unavailable')); return; }
        finish(null, event.data.boxes.map(box => ({ x: box.x * input.scaleX, y: box.y * input.scaleY,
          width: box.width * input.scaleX, height: box.height * input.scaleY })));
      };
      signal.addEventListener('abort', abort, { once: true });
      worker.postMessage({ pixels: input.pixels, width: input.width, height: input.height, maxFaces }, [input.pixels]);
    });
  }

  function nativeDetect(image, maxFaces, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => finish(new Error('Cancelled'));
      const timer = setTimeout(() => finish(new Error('Native detection timed out')), 1500);
      function finish(error, boxes) {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(boxes);
      }
      signal.addEventListener('abort', abort, { once: true });
      try {
        const detector = new window.FaceDetector({ fastMode: false, maxDetectedFaces: maxFaces });
        Promise.resolve(detector.detect(image)).then(rows => finish(null, rows.map(row => row.boundingBox)), finish);
      } catch (error) { finish(error); }
    });
  }

  async function detect(state, signal) {
    if (typeof window.FaceDetector === 'function') {
      try {
        const boxes = await nativeDetect(state.image, state.maxFaces, signal);
        const usable = boxes.filter(box => ['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) &&
          box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
          box.x + box.width <= state.image.naturalWidth && box.y + box.height <= state.image.naturalHeight);
        if (usable.length) return usable.slice(0, state.maxFaces);
      } catch (_) { /* Fall back to the bundled local detector. */ }
    }
    if (signal.aborted) throw new Error('Cancelled');
    return workerDetect(state.image, state.maxFaces, signal);
  }

  function install(options) {
    const control = { current: null, options };
    options.button.style.display = '';
    options.button.title = 'Find visible frontal faces locally. Review and adjust every box; this does not recognize people.';
    options.button.onclick = () => start(control);
    const cancel = () => cancelJob(control);
    const edit = event => { if (!options.button.contains(event.target)) cancel(); };
    options.host.addEventListener('pointerdown', edit, true);
    options.host.addEventListener('click', edit, true);
    options.host.addEventListener('change', edit, true);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
    return { cancel };
  }

  function cancelJob(control) {
    if (!control.current) return;
    control.current.abort(); control.current = null;
    control.options.button.textContent = 'Find faces';
    control.options.button.removeAttribute('aria-busy');
    control.options.status('Face finding cancelled. Your boxes are unchanged.');
  }

  async function start(control) {
    if (control.current) { cancelJob(control); return; }
    const options = control.options, before = options.read();
    if (!before.allowed || !before.image) return;
    const stamp = fingerprint(before), controller = new AbortController();
    control.current = controller;
    options.button.textContent = 'Cancel finding'; options.button.setAttribute('aria-busy', 'true');
    options.status('Looking for faces on this device… You can still adjust boxes.');
    try {
      const boxes = await detect(before, controller.signal), now = options.read();
      if (controller.signal.aborted || control.current !== controller || !now.allowed ||
          now.image !== before.image || fingerprint(now) !== stamp) return;
      if (!boxes.length) { options.status('No faces found. Your boxes are unchanged; add or adjust them by hand.'); return; }
      options.apply(boxes, before.maxFaces);
    } catch (_) {
      if (!controller.signal.aborted && control.current === controller) options.status('Face finding is unavailable. Your boxes are unchanged; add or adjust them by hand.');
    } finally {
      if (control.current === controller) {
        control.current = null; options.button.textContent = 'Find faces'; options.button.removeAttribute('aria-busy');
      }
    }
  }
  window.PortraitFaces = { install };
}
