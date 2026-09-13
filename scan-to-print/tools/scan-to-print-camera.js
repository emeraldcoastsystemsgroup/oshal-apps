/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — phone camera capture for the surface. The
 *                     |                             | six canonical views with per-view framing guidance
 *                     |                             | (matching the engine's view frames: top = front edge at
 *                     |                             | the bottom, right = front edge on the left, …), a
 *                     |                             | countdown-driven capture sequence with injectable timers,
 *                     |                             | and a getUserMedia stream wrapper that grabs a frame
 *                     |                             | into a bounded JPEG. Every piece takes its browser
 *                     |                             | objects as parameters so the whole module runs under
 *                     |                             | plain node in tests/surface-camera.test.js.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.ScanToPrintCamera = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /**
   * The capture order. The first three are the minimum for a solid (front, top, right); the guidance
   * states where the FRONT edge lands on the screen for each view so the photos agree with the
   * engine's third-angle frames (docs/ARCHITECTURE.md §3).
   */
  const SEQUENCE = Object.freeze([
    Object.freeze({ view: 'front', required: true, guide: 'Front face toward the camera. Object centred, camera level and square to the face.' }),
    Object.freeze({ view: 'top', required: true, guide: 'Look straight down. Keep the FRONT edge at the BOTTOM of the screen.' }),
    Object.freeze({ view: 'right', required: true, guide: 'Right side, square on. The FRONT edge is on the LEFT of the screen.' }),
    Object.freeze({ view: 'left', required: false, guide: 'Left side, square on. The FRONT edge is on the RIGHT of the screen.' }),
    Object.freeze({ view: 'back', required: false, guide: 'Back face toward the camera — the mirror image of the front.' }),
    Object.freeze({ view: 'bottom', required: false, guide: 'Underside. Keep the FRONT edge at the TOP of the screen.' }),
  ]);
  const VIEWS = Object.freeze(SEQUENCE.map((s) => s.view));

  /** Framing guidance for one view; unknown views get a generic line rather than a throw. */
  function guideFor(view) {
    const entry = SEQUENCE.find((s) => s.view === view);
    return entry ? entry.guide : 'Camera square to the face, object centred, plain background.';
  }

  /** The next view in capture order that is not yet in `done`; null when every view is covered. */
  function nextView(done) {
    const covered = new Set(done || []);
    const entry = SEQUENCE.find((s) => !covered.has(s.view));
    return entry ? entry.view : null;
  }

  /** Scale a frame so its long side is at most `maxLong`, keeping the aspect ratio; never below 1×1. */
  function frameSize(width, height, maxLong) {
    const w = Math.max(1, Math.floor(Number(width) || 0)), h = Math.max(1, Math.floor(Number(height) || 0));
    const bound = Math.max(1, Math.floor(Number(maxLong) || 1280));
    const long = Math.max(w, h);
    if (long <= bound) return { width: w, height: h };
    const k = bound / long;
    return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
  }

  /** A stable, filesystem-safe upload name: `<view>-<stamp>.jpg`. */
  function fileNameFor(view, stamp) {
    const safe = String(view || 'frame').replace(/[^a-z]/gi, '').toLowerCase() || 'frame';
    return safe + '-' + String(stamp === undefined ? Date.now() : stamp).replace(/[^0-9a-z]/gi, '') + '.jpg';
  }

  /** True when the browser can hand us a camera at all (secure context + mediaDevices). */
  function hasCamera(nav, secure) {
    const md = nav && nav.mediaDevices;
    return Boolean(md && typeof md.getUserMedia === 'function') && secure !== false;
  }

  /**
   * A countdown-driven capture sequence: for each view, tick down `countdownMs` in `tickMs` steps
   * (onTick with the remaining time), then await `onCapture(view)`, then move on. `skip` jumps to the
   * next view, `stop` halts. Timers are injected so the state machine runs under plain node.
   */
  function createSequence(options) {
    const o = Object.assign({
      views: VIEWS, countdownMs: 3000, tickMs: 1000,
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); }, clearTimeout: function (t) { clearTimeout(t); },
      onTick: function () {}, onCapture: function () {}, onDone: function () {}, onError: function () {},
    }, options || {});
    const views = o.views.slice();
    const st = { index: 0, remainingMs: 0, running: false, capturing: false, captured: [], timer: null };

    function tick() {
      if (!st.running) return;
      if (st.remainingMs <= 0) { fire(); return; }
      o.onTick(views[st.index], st.remainingMs, st.index, views.length);
      st.timer = o.setTimeout(function () { st.remainingMs -= o.tickMs; tick(); }, o.tickMs);
    }
    function fire() {
      const view = views[st.index];
      st.capturing = true;
      Promise.resolve().then(function () { return o.onCapture(view, st.index, views.length); }).then(function (shot) {
        st.captured.push({ view: view, shot: shot });
        st.capturing = false;
        if (st.running) advance();
      }, function (err) {
        st.capturing = false; st.running = false;
        o.onError(err, view);
      });
    }
    function advance() {
      st.index += 1;
      if (st.index >= views.length) { st.running = false; o.onDone(st.captured.slice()); return; }
      st.remainingMs = o.countdownMs;
      tick();
    }
    function start() {
      if (st.running || !views.length) return false;
      st.running = true; st.index = 0; st.captured = []; st.remainingMs = o.countdownMs;
      tick();
      return true;
    }
    function skip() {
      if (!st.running || st.capturing) return false;
      o.clearTimeout(st.timer);
      advance();
      return true;
    }
    function stop() { st.running = false; o.clearTimeout(st.timer); }
    function state() {
      return { index: st.index, view: views[st.index] || null, remainingMs: st.remainingMs, running: st.running, capturing: st.capturing, captured: st.captured.length, total: views.length };
    }
    return { start: start, skip: skip, stop: stop, state: state };
  }

  /**
   * Own one camera stream on a <video> element: start (rear camera by default), flip between rear
   * and front, stop, and capture the current frame as a bounded JPEG through a caller-supplied
   * canvas factory. `mediaDevices` and `video` are parameters so tests pass fakes.
   */
  function createCameraStream(mediaDevices, video) {
    let stream = null;
    let facing = 'environment';

    function release() {
      if (!stream) return;
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      video.srcObject = null;
    }
    function start(nextFacing) {
      if (nextFacing) facing = nextFacing;
      release();
      const constraints = { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
      return mediaDevices.getUserMedia(constraints).then(function (s) {
        stream = s;
        video.srcObject = s;
        const played = typeof video.play === 'function' ? Promise.resolve(video.play()).catch(function () {}) : Promise.resolve();
        return played.then(function () {
          const track = s.getVideoTracks ? s.getVideoTracks()[0] : null;
          const settings = track && typeof track.getSettings === 'function' ? track.getSettings() || {} : {};
          if (settings.facingMode) facing = settings.facingMode;
          return { facing: facing, width: settings.width, height: settings.height, label: track ? track.label || '' : '' };
        });
      });
    }
    function flip() { return start(facing === 'environment' ? 'user' : 'environment'); }
    function capture(createCanvas, maxLong, quality) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return Promise.reject(new Error('The camera has not delivered a frame yet.'));
      const size = frameSize(w, h, maxLong || 1280);
      const canvas = createCanvas(size.width, size.height);
      canvas.getContext('2d').drawImage(video, 0, 0, size.width, size.height);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve({ blob: blob, width: size.width, height: size.height, canvas: canvas });
          else reject(new Error('Frame encoding failed.'));
        }, 'image/jpeg', quality || 0.92);
      });
    }
    return { start: start, stop: release, flip: flip, capture: capture, active: function () { return Boolean(stream); }, facing: function () { return facing; } };
  }

  return { SEQUENCE: SEQUENCE, VIEWS: VIEWS, guideFor: guideFor, nextView: nextView, frameSize: frameSize, fileNameFor: fileNameFor, hasCamera: hasCamera, createSequence: createSequence, createCameraStream: createCameraStream };
});
