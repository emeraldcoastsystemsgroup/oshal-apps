/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Download one selected saved résumé or cover in a fixed format, with source epochs, bounded transport and no save or generation side effects.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add FIPS-180-4 SHA-256 fallback so transient exports work on plain-HTTP LAN origins where crypto.subtle is unavailable.
 */
'use strict';
{
  const root = typeof window !== 'undefined' ? window : globalThis;
  const OFFICE = '/api/presentations/editor', CAREER = '/api/career-hunter';
  const MIME = {docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', rtf: 'text/rtf'};
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const MAX_BODY = 524288, MAX_FILE = 8388608;
  const K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let modelModule;
  const schema = () => modelModule ||= import('/api/presentations/editor/assets/model.mjs');
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));

  async function sha256Hex(input) {
    const raw = new TextEncoder().encode(input);
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest('SHA-256', raw);
      return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    const len = raw.length, padLen = ((len + 9 + 63) & ~63), buf = new Uint8Array(padLen), view = new DataView(buf.buffer);
    buf.set(raw); buf[len] = 0x80;
    view.setUint32(padLen - 8, Math.floor((len * 8) / 0x100000000), false);
    view.setUint32(padLen - 4, (len * 8) >>> 0, false);
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], W = new Uint32Array(64);
    for (let o = 0; o < padLen; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(o + i * 4, false);
      for (let i = 16; i < 64; i++) W[i] = (((rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10)) + W[i - 7] + (rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3)) + W[i - 16])) >>> 0;
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
        const t2 = ((rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(v => v.toString(16).padStart(8, '0')).join('');
  }

  function abortable(work, signal) {
    let reject;
    const stopped = new Promise((_resolve, no) => { reject = no; });
    const abort = () => reject(Error('The download request ended.'));
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
    return Promise.race([work, stopped]).finally(() => signal.removeEventListener('abort', abort));
  }

  async function bytes(response, limit) {
    if (!response.body) throw Error('This download has no response body.');
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > limit) throw Error('This download exceeds the supported size.');
        parts.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }

  async function json(url, signal) {
    const response = await root.fetch(url, {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal});
    const value = JSON.parse(new TextDecoder().decode(await bytes(response, MAX_FILE)));
    if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : 'This saved source is unavailable.');
    return value;
  }

  async function supplied(source, style, signal) {
    if (source.type === 'office') {
      if (!UUID.test(source.documentId || '')) throw Error('Open the saved main résumé document before downloading it.');
      const value = await json(OFFICE + '/documents/' + source.documentId, signal), doc = value.document;
      if (!doc || doc.id !== source.documentId || !Number.isInteger(doc.revision) || doc.revision < 1 || doc.revision > 100 || doc.model?.kind !== 'docx') throw Error('The saved résumé revision could not be verified.');
      return {model: root.CareerExportModel.styled(doc.model, style), title: doc.title || doc.model.title,
        savedUrl: style === 'ats' ? OFFICE + '/documents/' + source.documentId + '/revisions/' + doc.revision + '/content' : null,
        notice: 'Saved document revision ' + doc.revision};
    }
    if (source.type !== 'packet' || !Number.isSafeInteger(source.id) || source.id < 1 || !['resume', 'cover'].includes(source.part)) throw Error('Choose a saved generated résumé or cover letter.');
    if (source.submitted) throw Error('Only the retained submitted PDF is available here. Use Download PDF above.');
    const packet = await json(CAREER + '/resume/doc?id=' + source.id, signal);
    if (Number(packet.meta?.postingId) !== source.id) throw Error('The generated packet identity could not be verified.');
    const model = root.CareerExportModel.fromPacket(packet, source.part, style);
    const dates = packet.meta?.dates;
    const uncertain = dates && (dates.ambiguous?.length || dates.unavailable?.length);
    return {model, title: model.title, notice: uncertain ? 'Saved packet; some dates have no uniquely recorded month.' : 'Selected saved packet'};
  }

  async function artifact(saved, format, signal) {
    let response;
    if (saved.savedUrl) response = await root.fetch(saved.savedUrl + '?format=' + format,
      {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal});
    else {
      const {validate, stableJSON} = await schema(), model = validate(saved.model);
      const modelSha256 = await sha256Hex(stableJSON(model));
      const body = JSON.stringify({model, format, modelSha256});
      if (new TextEncoder().encode(body).length > MAX_BODY) throw Error('This selected document exceeds the 512 KiB export request limit.');
      response = await root.fetch(OFFICE + '/exports', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: {'Content-Type': 'application/json'}, body});
    }
    if (!response.ok) {
      const error = JSON.parse(new TextDecoder().decode(await bytes(response, MAX_BODY)));
      throw Error(error.message || error.error || 'This format is not available for this saved source.');
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (mime !== MIME[format]) { await response.body?.cancel(); throw Error('The server returned a different file format.'); }
    const data = await bytes(response, MAX_FILE), prefix = new TextDecoder().decode(data.subarray(0, 8));
    if (!data.length || (format === 'docx' ? data[0] !== 80 || data[1] !== 75 : !prefix.startsWith(format === 'pdf' ? '%PDF-' : '{\\rtf1'))) throw Error('The returned file could not be verified.');
    return new Blob([data], {type: mime});
  }

  function controls(host) {
    host.innerHTML = '<details><summary>Download</summary><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;padding:8px 0">'
      + '<label data-export-part-label>Document <select data-export-part><option value="resume">Résumé</option><option value="cover">Cover letter</option></select></label>'
      + '<label>Style <select data-export-style><option value="ats">ATS / import-friendly</option><option value="professional">Professional / email</option></select></label>'
      + '<label>Format <select data-export-format><option value="docx">Word (.docx)</option><option value="pdf">PDF</option><option value="rtf">RTF (ATS/import)</option></select></label>'
      + '<button type="button" class="ck-btn btn" data-export-start>Download selected file</button></div><p role="status" data-export-status></p>'
      + '<small>Downloads use the selected saved version. Save document edits first.</small></details>';
    return {part: host.querySelector('[data-export-part]'), style: host.querySelector('[data-export-style]'), format: host.querySelector('[data-export-format]'),
      button: host.querySelector('[data-export-start]'), status: host.querySelector('[data-export-status]')};
  }

  function choices(ui, options, part) {
    ui.part.closest('label').hidden = !options.parts;
    if (options.parts) {
      const available = options.parts(), coverOption = ui.part.querySelector('[value=cover]');
      coverOption.disabled = !available.includes('cover');
      coverOption.textContent = coverOption.disabled ? 'Cover letter (not generated)' : 'Cover letter';
      if (!available.includes(ui.part.value)) ui.part.value = 'resume';
    }
    const cover = part() === 'cover';
    ui.style.querySelector('[value=professional]').disabled = cover;
    if (cover) ui.style.value = 'ats';
    const rtf = ui.format.querySelector('[value=rtf]');
    if (rtf) rtf.disabled = ui.style.value === 'professional';
    if (ui.style.value === 'professional' && ui.format.value === 'rtf') ui.format.value = 'docx';
  }

  function mount(host, options) {
    const ui = controls(host), urls = new Set();
    if (options.fixedStyle) { ui.style.value = options.fixedStyle; ui.style.closest('label').hidden = true; ui.format.querySelector('[value=rtf]')?.remove(); }
    if (options.expanded) { host.querySelector('details').open = true; host.querySelector('summary').hidden = true; }
    let epoch = 0, active, disposed = false;
    const key = () => String(options.key());
    const part = () => options.parts ? ui.part.value : options.part?.() || 'resume';
    const cancel = () => { epoch++; active?.abort(); active = null; ui.button.disabled = false; ui.status.textContent = ''; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
    function choose() {
      cancel(); ui.status.textContent = '';
      choices(ui, options, part);
    }
    async function download() {
      if (active || disposed) return;
      const own = ++epoch, selected = key(), format = ui.format.value, style = ui.style.value;
      const controller = new AbortController(), deadline = root.performance.now() + 15000;
      const timer = setTimeout(() => controller.abort(), 15000);
      active = controller; ui.button.disabled = true; ui.status.textContent = 'Preparing the selected saved file…';
      try {
        const saved = await abortable(supplied(options.source(part()), style, controller.signal), controller.signal);
        if (root.performance.now() >= deadline) controller.abort();
        const blob = await abortable(artifact(saved, format, controller.signal), controller.signal);
        if (disposed || own !== epoch || selected !== key()) return;
        if (root.performance.now() >= deadline) controller.abort();
        if (controller.signal.aborted) throw Error('The download request ended.');
        const url = URL.createObjectURL(blob), link = root.document.createElement('a'); urls.add(url);
        link.href = url; link.download = (String(saved.title).replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 100) || 'Saved document') + '.' + format;
        link.hidden = true; root.document.body.append(link); link.click(); link.remove();
        setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
        ui.status.textContent = saved.notice + ' · download started.';
      } catch (error) { if (!disposed && own === epoch) ui.status.textContent = controller.signal.aborted ? 'Download canceled or timed out. Your saved source is unchanged; retry when ready.' : error.message; }
      finally { clearTimeout(timer); if (own === epoch) { active = null; ui.button.disabled = false; } }
    }
    function dispose() { disposed = true; cancel(); root.removeEventListener('pagehide', cancel); }
    ui.part.addEventListener('change', choose); ui.style.addEventListener('change', choose); ui.format.addEventListener('change', choose);
    ui.button.addEventListener('click', download); root.addEventListener('pagehide', cancel); choose();
    return {cancel, refresh: choose, dispose};
  }
  root.CareerResumeDownloads = {mount};
}
