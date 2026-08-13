/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Camera-source decision module for Step 1: capability probe, live/file-capture/upload-only mode choice, honest unavailability + permission messages, facing-mode preference per portrait mode, device labelling, and the ONE photo-validation rule shared by upload and capture. Pure functions only (no DOM writes, no stream handling) so the zero-dep node runner can cover the fallback branches the surface cannot test inline. Loaded by the surface via <script src="/api/portrait-studio/capture.js">.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Extend to the connected-asset picker over the framework's one storage rail (/api/files/roots|browse|download — OSHAL Storage, Career, Dropbox, Google Drive, GitHub): image filtering with a counted "hidden" line instead of a silently short list, MIME derived from the name because the download route streams octet-stream, HEIC-class formats flagged rather than failing as a mystery, provider-agnostic breadcrumbs (Drive's name~id segments collapse to the same shape), and an empty-folder message that names the drive.file scope as the cause instead of claiming there are no photos.
 */

/**
 * Portrait Studio — photo source decisions (camera + connected assets).
 *
 * Dual-target on purpose: `module.exports` for `node tests/run.js`, `window.PortraitCapture`
 * for the surface. Everything here is a pure function of its arguments — the stream lifecycle
 * (open/stop/track teardown) stays in the surface where the DOM is.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PortraitCapture = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Same ceiling the upload path has always enforced; capture must not get a softer rule. */
  var MAX_PHOTO_BYTES = 20 * 1024 * 1024;

  /**
   * @description The one validation gate for a photo, whatever produced it — a dropped file, a
   * file picker, or a frame frozen off the camera. Returns the operator-facing reason to refuse,
   * or null when the photo is acceptable.
   * @param {{type?:string,size?:number}|null} file Blob/File-shaped candidate.
   * @returns {string|null} Rejection reason, or null when acceptable.
   */
  function photoRejectReason(file) {
    if (!file) return 'No photo to use.';
    if (!/^image\//.test(file.type || '')) return 'That file is not an image.';
    if (typeof file.size === 'number' && file.size > MAX_PHOTO_BYTES) {
      return 'Image is over 20 MB — please use a smaller one.';
    }
    if (typeof file.size === 'number' && file.size === 0) return 'That photo came through empty — try again.';
    return null;
  }

  /**
   * @description Read the browser's camera capabilities into a plain object. Thin on purpose:
   * every decision made from it lives in {@link chooseCaptureMode}, which is testable.
   * @param {object} win A window-like object.
   * @param {object} doc A document-like object.
   * @returns {{secure:boolean,mediaApi:boolean,enumerate:boolean,canvasBlob:boolean,captureAttr:boolean}}
   */
  function readEnv(win, doc) {
    var md = win && win.navigator && win.navigator.mediaDevices;
    var canvasBlob = false;
    try { canvasBlob = typeof doc.createElement('canvas').toBlob === 'function'; } catch (e) { canvasBlob = false; }
    var captureAttr = false;
    try { captureAttr = 'capture' in doc.createElement('input'); } catch (e) { captureAttr = false; }
    return {
      secure: !!(win && win.isSecureContext),
      mediaApi: !!(md && typeof md.getUserMedia === 'function'),
      enumerate: !!(md && typeof md.enumerateDevices === 'function'),
      canvasBlob: canvasBlob,
      captureAttr: captureAttr,
    };
  }

  /**
   * @description Which camera path this browser actually supports.
   *   `live`         — in-page getUserMedia preview with a freeze-frame button.
   *   `file-capture` — no getUserMedia (or an insecure page): hand off to the OS camera app
   *                    through an `<input capture>`, which still produces a photo.
   *   `upload-only`  — neither is possible; the camera control must not be rendered at all.
   * A live preview needs BOTH a secure context and canvas.toBlob — without toBlob there is no
   * way to turn the frozen frame into a validated photo, so claiming "live" would be a lie.
   * @param {object} env Result of {@link readEnv}.
   * @returns {'live'|'file-capture'|'upload-only'}
   */
  function chooseCaptureMode(env) {
    var e = env || {};
    if (e.mediaApi && e.secure && e.canvasBlob) return 'live';
    if (e.captureAttr) return 'file-capture';
    return 'upload-only';
  }

  /**
   * @description Why the in-page camera is not available, in the operator's terms. Returns null
   * when `live` is available (nothing to explain).
   *
   * The insecure page is checked FIRST and deliberately: browsers gate `navigator.mediaDevices`
   * behind a secure context, so a perfectly camera-capable laptop opening the cockpit at a plain
   * `http://192.168.x.x` address looks *identical* to a browser with no camera API at all. Blaming
   * the browser there sends the operator chasing the wrong fix — the page is the problem, and the
   * fix is the https origin.
   * @param {object} env Result of {@link readEnv}.
   * @returns {string|null}
   */
  function unavailableReason(env) {
    var e = env || {};
    if (chooseCaptureMode(e) === 'live') return null;
    if (!e.secure) {
      return 'Browsers only allow the camera on a secure page (https:// or localhost) — this page is not one. ' +
        (e.captureAttr ? 'Opening your camera app instead.' : 'Choose a photo file instead.');
    }
    if (!e.mediaApi && !e.captureAttr) return 'This browser has no camera support — choose a photo file instead.';
    if (!e.mediaApi) return 'This browser has no in-page camera — opening your camera app instead.';
    if (!e.canvasBlob) {
      return e.captureAttr
        ? 'This browser cannot save a frame from the live preview — opening your camera app instead.'
        : 'This browser cannot save a frame from the live preview — choose a photo file instead.';
    }
    return 'Camera unavailable — choose a photo file instead.';
  }

  /**
   * @description Turn a getUserMedia failure into something a person can act on. Falls back to
   * the raw message rather than swallowing an unrecognised fault.
   * @param {{name?:string,message?:string}} err The rejection from getUserMedia.
   * @returns {string}
   */
  function permissionMessage(err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'Camera permission was denied — allow it in your browser, or choose a photo file.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return 'No camera found on this device — choose a photo file instead.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The camera is already in use by another app — close it and try again.';
    }
    return 'Could not open the camera: ' + ((err && err.message) || 'unknown error');
  }

  /**
   * @description Preferred lens for a portrait mode: a professional headshot is a self-portrait
   * (front camera), a character portrait is usually pointed at someone — or a pet — in the room.
   * @param {string} portraitMode `professional` or `character`.
   * @returns {'user'|'environment'}
   */
  function facingModeFor(portraitMode) {
    return portraitMode === 'character' ? 'environment' : 'user';
  }

  /**
   * @description Video constraints for a camera open. An explicit device wins over the facing
   * preference; the facing preference is `ideal`, never `exact`, so a laptop with one webcam
   * still opens instead of throwing OverconstrainedError.
   * @param {string} portraitMode `professional` or `character`.
   * @param {string} [deviceId] A specific camera to open.
   * @returns {object} The `video` half of a getUserMedia constraint object.
   */
  function videoConstraints(portraitMode, deviceId) {
    if (deviceId) return { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 1280 } };
    return { facingMode: { ideal: facingModeFor(portraitMode) }, width: { ideal: 1280 }, height: { ideal: 1280 } };
  }

  /**
   * @description Name the cameras for the picker. Device labels are empty until permission has
   * been granted, so a positional fallback is required or the picker reads as a list of blanks.
   * @param {Array<{kind?:string,deviceId?:string,label?:string}>} devices enumerateDevices() output.
   * @returns {Array<{deviceId:string,label:string}>} Video inputs only, always labelled.
   */
  function describeCameras(devices) {
    var cams = (devices || []).filter(function (d) { return d && d.kind === 'videoinput'; });
    return cams.map(function (d, i) {
      return { deviceId: d.deviceId || '', label: d.label || ('Camera ' + (i + 1)) };
    });
  }

  /**
   * @description Whether the camera picker is worth showing. One camera is not a choice.
   * @param {Array} cameras Result of {@link describeCameras}.
   * @returns {boolean}
   */
  function shouldShowPicker(cameras) {
    return (cameras || []).length > 1;
  }

  /**
   * @description Pixel box of the largest centred square-ish frame to keep from a video element.
   * The crop stage does the real framing; this only avoids handing it a letterboxed frame with
   * dead bands, and it never upscales past what the camera actually delivered.
   * @param {number} w Intrinsic video width.
   * @param {number} h Intrinsic video height.
   * @returns {{sx:number,sy:number,sw:number,sh:number}} Source rectangle for drawImage.
   */
  function frameBox(w, h) {
    var vw = w > 0 ? w : 640;
    var vh = h > 0 ? h : 480;
    var side = Math.min(vw, vh);
    var sw = side;
    var sh = Math.min(vh, Math.round(side * 1.25)); // a little taller than square: heads need headroom
    return { sx: Math.round((vw - sw) / 2), sy: Math.round((vh - sh) / 2), sw: sw, sh: sh };
  }

  // ── Connected-asset picker ────────────────────────────────────────────────
  // The framework already browses every storage source the caller has connected
  // (GET /api/files/roots|browse|download): OSHAL Storage, Career, Dropbox, Google
  // Drive, GitHub. The studio does not integrate with any of them individually — it
  // reads that one rail and filters it down to pickable images.

  /** Extensions the browser can actually decode into an <img>, mapped to their MIME. */
  var IMAGE_MIME_BY_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    bmp: 'image/bmp', avif: 'image/avif',
  };
  /** Camera-roll formats most desktop browsers still cannot decode. Pickable, but flagged. */
  var RISKY_IMAGE_EXT = { heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff' };

  /**
   * @description File extension, lowercased, with no dot. Drive paths carry a `~<id>` suffix on
   * each segment, so the id is stripped before the extension is read.
   * @param {string} name File name or path segment.
   * @returns {string}
   */
  function extensionOf(name) {
    var base = String(name || '').split('/').pop().split('~')[0];
    var dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  }

  /**
   * @description The image MIME a stored file will produce, or null when it is not a picture.
   * This is the filter AND the type applied to the downloaded bytes: `/api/files/download`
   * streams everything as `application/octet-stream`, so a blob taken straight from it would be
   * refused by {@link photoRejectReason} for not being an image. Deriving the type from the name
   * is what makes a stored file behave exactly like a dropped one.
   * @param {string} name File name.
   * @returns {string|null}
   */
  function imageMimeFromName(name) {
    var ext = extensionOf(name);
    return IMAGE_MIME_BY_EXT[ext] || RISKY_IMAGE_EXT[ext] || null;
  }

  /**
   * @description Whether this browser is likely to fail to decode the format even though it is
   * an image — HEIC off an iPhone being the common one. Pickable, but worth warning about
   * rather than letting it fail as a mystery.
   * @param {string} name File name.
   * @returns {boolean}
   */
  function isRiskyImage(name) {
    return Object.prototype.hasOwnProperty.call(RISKY_IMAGE_EXT, extensionOf(name));
  }

  /**
   * @description Split one browse listing into what the picker shows. Folders always stay (they
   * are how you reach the pictures); files are kept only when they are images small enough to
   * use, and everything dropped is COUNTED so the surface can say "14 other files hidden"
   * instead of pretending the folder was empty.
   * @param {Array<{name:string,type:string,path:string,size?:number}>} entries Browse output.
   * @returns {{folders:Array,images:Array,hiddenOther:number,hiddenTooBig:number}}
   */
  function partitionEntries(entries) {
    var out = { folders: [], images: [], hiddenOther: 0, hiddenTooBig: 0 };
    (entries || []).forEach(function (e) {
      if (!e) return;
      if (e.type === 'folder') { out.folders.push(e); return; }
      var mime = imageMimeFromName(e.name);
      if (!mime) { out.hiddenOther++; return; }
      if (typeof e.size === 'number' && e.size > MAX_PHOTO_BYTES) { out.hiddenTooBig++; return; }
      out.images.push({ name: e.name, path: e.path, size: e.size, mime: mime, risky: isRiskyImage(e.name) });
    });
    return out;
  }

  /**
   * @description One line describing what the filter removed, or '' when it removed nothing.
   * @param {{hiddenOther:number,hiddenTooBig:number}} part Result of {@link partitionEntries}.
   * @returns {string}
   */
  function hiddenSummary(part) {
    var bits = [];
    if (part && part.hiddenOther) bits.push(part.hiddenOther + ' non-image file' + (part.hiddenOther === 1 ? '' : 's'));
    if (part && part.hiddenTooBig) bits.push(part.hiddenTooBig + ' over 20 MB');
    return bits.length ? bits.join(' and ') + ' hidden' : '';
  }

  /**
   * @description Human path trail for the header, newest last. Google Drive segments are
   * `<url-encoded name>~<file id>`; every other provider is a plain '/'-joined path. Both
   * collapse to the same crumb list so the picker needs no per-provider branch.
   * @param {string} p Provider-relative path ('' = that provider's root).
   * @returns {Array<{label:string,path:string}>}
   */
  function breadcrumbs(p) {
    var trail = [];
    var segs = String(p || '').split('/').filter(Boolean);
    var acc = '';
    segs.forEach(function (seg) {
      acc = acc ? acc + '/' + seg : seg;
      var label = seg.split('~')[0];
      try { label = decodeURIComponent(label); } catch (e) { /* leave it raw */ }
      trail.push({ label: label, path: acc });
    });
    return trail;
  }

  /**
   * @description The folder one level up.
   * @param {string} p Current provider-relative path.
   * @returns {string} Parent path ('' at the provider root).
   */
  function parentPath(p) {
    var segs = String(p || '').split('/').filter(Boolean);
    segs.pop();
    return segs.join('/');
  }

  /**
   * @description What to tell the caller when a provider lists nothing. Google Drive is the one
   * source that can be connected and still legitimately look empty: the connector holds the
   * per-file `drive.file` scope, which only ever sees files this app created — NOT the photos
   * the user took. Saying "no images here" there would be a lie about the cause.
   * @param {string} provider Provider id from /api/files/roots.
   * @returns {string}
   */
  function emptyMessage(provider) {
    if (provider === 'google-drive') {
      return 'Nothing here yet. Drive is connected with per-file access, so oshal only sees files it ' +
        'created — your own photos will not be listed until Drive access is widened.';
    }
    return 'No images in this folder.';
  }

  return {
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES,
    imageMimeFromName: imageMimeFromName,
    isRiskyImage: isRiskyImage,
    partitionEntries: partitionEntries,
    hiddenSummary: hiddenSummary,
    breadcrumbs: breadcrumbs,
    parentPath: parentPath,
    emptyMessage: emptyMessage,
    photoRejectReason: photoRejectReason,
    readEnv: readEnv,
    chooseCaptureMode: chooseCaptureMode,
    unavailableReason: unavailableReason,
    permissionMessage: permissionMessage,
    facingModeFor: facingModeFor,
    videoConstraints: videoConstraints,
    describeCameras: describeCameras,
    shouldShowPicker: shouldShowPicker,
    frameBox: frameBox,
  };
}));
