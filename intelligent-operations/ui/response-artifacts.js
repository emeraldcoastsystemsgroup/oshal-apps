/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Extract workflow-generated response files byte-exact from an accepted answer's named fenced sections (```lang file=NAME), with digests and byte ranges, so the same deterministic rule serves the browser preview and the server-side plan without parsing prose into pretend files.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | 1.9.7 (R21): add deterministic response-plan manifest builder (buildManifest, bundleDigest), bounded line-by-line unified diff (unifiedDiff), and plan-to-plan comparison (comparePlans) with explicit non-authorization notice inside the bound response-artifacts asset.
 */
(function (root) {
  'use strict';
  const REQUIRED = ['remediate.sh', 'verify.sh', 'rollback.md', 'verify.md'];
  const OPTIONAL = ['diagnose.sh'];
  const LIMITS = { 'remediate.sh': 4096, 'verify.sh': 4096, 'diagnose.sh': 4096, 'rollback.md': 16384, 'verify.md': 16384 };
  const NAME = /^[a-z][a-z0-9-]{0,39}\.(sh|md)$/;
  const AUTHORIZATION_NOTICE = 'Viewing generated files or diffs does not authorize execution. Explicit approval bound to these exact SHA-256 digests and target pod is required.';
  const MAX_DIFF_LINES = 2000;
  const MAX_MYERS_D = 1000;

  /** @description Find every fenced block whose info string names a file; the body is kept exactly, without the fence lines. */
  function sections(answer) {
    if (typeof answer !== 'string' || !answer.length || answer.length > 262144) return [];
    const lines = answer.split('\n'), out = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const open = /^(`{3,}|~{3,})\s*([a-zA-Z0-9_-]*)\s+file=([^\s`]+)\s*$/.exec(lines[i]);
      const lineStart = offset;
      offset += lines[i].length + 1;
      if (!open) continue;
      const fence = open[1], name = open[3], bodyStart = offset, body = [];
      let closed = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith(fence) && !lines[j].slice(fence.length).trim()) { closed = true; i = j; break; }
        body.push(lines[j]);
      }
      if (!closed) break;
      const content = body.join('\n') + (body.length ? '\n' : '');
      for (let j = 0; j < body.length; j++) offset += body[j].length + 1;
      offset += lines[i].length + 1;
      out.push({ name, language: open[2] || null, content, start: lineStart, bodyStart, end: offset });
    }
    return out;
  }

  /** @description Admit only the closed response-file set: valid names, one block per name, byte limits, and the approval statement before the state-changing script. */
  function extract(answer, digest) {
    const found = sections(answer), artifacts = [], problems = [], seen = new Set();
    for (const s of found) {
      if (!NAME.test(s.name)) { problems.push('Ignored a file name outside the response contract: ' + s.name.slice(0, 48)); continue; }
      if (!REQUIRED.includes(s.name) && !OPTIONAL.includes(s.name)) { problems.push('Ignored an unexpected response file: ' + s.name); continue; }
      if (seen.has(s.name)) { problems.push('Duplicate response file: ' + s.name); continue; }
      seen.add(s.name);
      const bytes = utf8Length(s.content);
      if (bytes === 0) { problems.push('Empty response file: ' + s.name); continue; }
      if (bytes > LIMITS[s.name]) { problems.push(s.name + ' exceeds ' + LIMITS[s.name] + ' bytes'); continue; }
      if (s.content.includes('\u0000')) { problems.push(s.name + ' contains a NUL byte'); continue; }
      artifacts.push({ name: s.name, language: s.language, content: s.content, bytes, sha256: digest ? digest(s.content) : null, range: { start: s.bodyStart, end: s.end } });
    }
    const names = new Set(artifacts.map(a => a.name)), missing = REQUIRED.filter(n => !names.has(n));
    const remediate = artifacts.find(a => a.name === 'remediate.sh');
    if (remediate && !/approval required/i.test(answer.slice(0, remediate.range.start))) problems.push('remediate.sh is not preceded by an "approval required" statement.');
    const executable = missing.length === 0 && !problems.some(p => p.startsWith('remediate.sh is not preceded'));
    return { artifacts, missing, problems, executable, required: REQUIRED.slice(), optional: OPTIONAL.slice() };
  }

  function utf8Length(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.codePointAt(i);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : (i++, 4);
    }
    return n;
  }

  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.codePointAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); i++; }
    }
    return out;
  }

  const SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  /** @description Pure synchronous FIPS 180-4 SHA-256 hex digest for browser and Node parity. */
  function sha256Hex(str) {
    const bytes = utf8Bytes(String(str ?? ''));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Int32Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /** @description Deterministic bundle SHA-256 computed over sorted file digests. */
  function bundleDigest(files) {
    const rows = Array.isArray(files) ? files.slice() : [];
    rows.sort((a, b) => {
      const an = String(a?.name || ''), bn = String(b?.name || '');
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    const canonical = rows.map(f => String(f?.name || '') + ':' + String(f?.sha256 || '') + ':' + String(Number.isFinite(f?.bytes) ? f.bytes : '')).join('\n');
    return sha256Hex('response-manifest-v1\n' + canonical);
  }

  function lookupContent(mapOrObj, key) {
    if (!mapOrObj || typeof key !== 'string') return null;
    if (typeof mapOrObj.get === 'function') { const v = mapOrObj.get(key); return typeof v === 'string' ? v : null; }
    return Object.prototype.hasOwnProperty.call(mapOrObj, key) && typeof mapOrObj[key] === 'string' ? mapOrObj[key] : null;
  }

  function countLines(content) {
    if (typeof content !== 'string') return null;
    if (!content.length) return 0;
    const norm = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return norm.endsWith('\n') ? norm.slice(0, -1).split('\n').length : norm.split('\n').length;
  }

  function manifestFileEntry(raw, dl, plan, contentByName) {
    const name = String(raw?.name || dl?.name || '');
    const text = lookupContent(contentByName, name);
    const range = raw?.range && Number.isFinite(raw.range.start) && Number.isFinite(raw.range.end)
      ? { start: raw.range.start, end: raw.range.end } : null;
    const path = typeof dl?.path === 'string' && dl.path.startsWith('/executions/plans/')
      ? dl.path : (plan.id && name ? '/executions/plans/' + encodeURIComponent(plan.id) + '/artifacts/' + encodeURIComponent(name) : null);
    return {
      name,
      sha256: typeof raw?.sha256 === 'string' ? raw.sha256 : (typeof dl?.sha256 === 'string' ? dl.sha256 : null),
      bytes: Number.isFinite(raw?.bytes) ? raw.bytes : (Number.isFinite(dl?.bytes) ? dl.bytes : (text !== null ? utf8Length(text) : null)),
      range,
      lines: text !== null ? countLines(text) : null,
      provenance: { ticketId: plan.ticketId || null, workId: plan.workId || null, phase: plan.phase || null, origin: raw?.origin || 'workflow-answer-section' },
      downloadPath: path,
      downloadUrl: path ? '/api/intelligent-operations' + path : null,
    };
  }

  /** @description Produce a deterministic structured manifest for a response plan without granting execution authority. */
  function buildManifest(plan, contentByName) {
    const p = plan && typeof plan === 'object' ? plan : {};
    const downloads = Array.isArray(p.downloads) ? p.downloads : [];
    const dlByName = new Map(downloads.map(d => [d.name, d]));
    const sourceList = Array.isArray(p.artifacts) && p.artifacts.length ? p.artifacts : downloads;
    const files = sourceList.map(item => manifestFileEntry(item, dlByName.get(item.name) || null, p, contentByName));
    const t = p.target && typeof p.target === 'object' ? p.target : {};
    const totalBytes = files.reduce((sum, f) => sum + (Number.isFinite(f.bytes) ? f.bytes : 0), 0);
    return {
      planId: typeof p.id === 'string' ? p.id : (typeof p.planId === 'string' ? p.planId : null),
      ticketId: typeof p.ticketId === 'string' ? p.ticketId : null,
      ticketRevision: Number.isSafeInteger(p.ticketRevision) ? p.ticketRevision : null,
      workId: typeof p.workId === 'string' ? p.workId : null,
      phase: typeof p.phase === 'string' ? p.phase : null,
      answerVerifiedByServer: p.answerVerifiedByServer === true,
      answerSha256: typeof p.answerSha256 === 'string' ? p.answerSha256 : null,
      answerReceipt: typeof p.answerReceipt === 'string' ? p.answerReceipt : null,
      bundleDigest: typeof p.bundleDigest === 'string' && p.bundleDigest ? p.bundleDigest : bundleDigest(files),
      target: { pod: t.pod || null, namespace: t.namespace || null, container: t.container || null, uid: t.uid || null },
      authorizationNotice: AUTHORIZATION_NOTICE,
      executionAuthorized: false,
      totalBytes,
      files,
    };
  }

  function splitNormalized(input, maxLines) {
    const raw = typeof input === 'string' ? input : '';
    const norm = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const trailingNewline = norm.length > 0 && norm.endsWith('\n');
    const all = norm.length === 0 ? [] : (trailingNewline ? norm.slice(0, -1).split('\n') : norm.split('\n'));
    const truncated = all.length > maxLines;
    return { lines: truncated ? all.slice(0, maxLines) : all, trailingNewline, truncated, originalLines: all.length, norm };
  }

  /** @description Myers O((N+M)D) shortest edit script with bounded edit distance to guarantee responsiveness. */
  function myersEdits(a, b) {
    const n = a.length, m = b.length, maxD = Math.min(n + m, MAX_MYERS_D), offset = maxD;
    const v = new Int32Array(2 * maxD + 1);
    const trace = [];
    for (let d = 0; d <= maxD; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) ? v[offset + k + 1] : v[offset + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[offset + k] = x;
        if (x >= n && y >= m) return backtrackMyers(trace, a, b, offset);
      }
    }
    return [...a.map(text => ({ type: 'remove', text })), ...b.map(text => ({ type: 'add', text }))];
  }

  function backtrackMyers(trace, a, b, offset) {
    let x = a.length, y = b.length;
    const rev = [];
    for (let d = trace.length - 1; d >= 0; d--) {
      const v = trace[d], k = x - y;
      const prevK = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) ? k + 1 : k - 1;
      const prevX = v[offset + prevK], prevY = prevX - prevK;
      while (x > prevX && y > prevY) { rev.push({ type: 'context', text: a[x - 1] }); x--; y--; }
      if (d > 0) {
        if (x === prevX) { rev.push({ type: 'add', text: b[y - 1] }); y--; }
        else { rev.push({ type: 'remove', text: a[x - 1] }); x--; }
      }
    }
    return rev.reverse();
  }

  function computeOps(aLines, bLines) {
    let start = 0;
    while (start < aLines.length && start < bLines.length && aLines[start] === bLines[start]) start++;
    let endA = aLines.length, endB = bLines.length;
    while (endA > start && endB > start && aLines[endA - 1] === bLines[endB - 1]) { endA--; endB--; }
    const ops = [];
    for (let i = 0; i < start; i++) ops.push({ type: 'context', text: aLines[i] });
    for (const op of myersEdits(aLines.slice(start, endA), bLines.slice(start, endB))) ops.push(op);
    for (let i = endA; i < aLines.length; i++) ops.push({ type: 'context', text: aLines[i] });
    return ops;
  }

  function annotateOps(ops, oldInfo, newInfo) {
    let oldLine = 1, newLine = 1;
    const raw = ops.map(op => {
      const row = { ...op, oldLine: op.type === 'add' ? null : oldLine, newLine: op.type === 'remove' ? null : newLine };
      if (op.type !== 'add') oldLine++;
      if (op.type !== 'remove') newLine++;
      return row;
    });
    const lastOld = raw.reduce((acc, row, i) => (row.type !== 'add' ? i : acc), -1);
    const lastNew = raw.reduce((acc, row, i) => (row.type !== 'remove' ? i : acc), -1);
    if (lastOld >= 0 && !oldInfo.trailingNewline && !oldInfo.truncated) raw[lastOld].noNewlineOld = true;
    if (lastNew >= 0 && !newInfo.trailingNewline && !newInfo.truncated) raw[lastNew].noNewlineNew = true;
    const indexed = [];
    for (const row of raw) {
      if (row.type === 'context' && Boolean(row.noNewlineOld) !== Boolean(row.noNewlineNew)) {
        indexed.push({ type: 'remove', text: row.text, oldLine: row.oldLine, newLine: null, noNewlineOld: row.noNewlineOld });
        indexed.push({ type: 'add', text: row.text, oldLine: null, newLine: row.newLine, noNewlineNew: row.noNewlineNew });
      } else indexed.push(row);
    }
    return indexed;
  }

  function buildHunks(indexed, contextLines) {
    const ranges = [];
    for (let i = 0; i < indexed.length; i++) {
      const row = indexed[i];
      const isChange = row.type !== 'context' || Boolean(row.noNewlineOld) !== Boolean(row.noNewlineNew);
      if (!isChange) continue;
      const from = Math.max(0, i - contextLines), to = Math.min(indexed.length - 1, i + contextLines);
      if (ranges.length && from <= ranges[ranges.length - 1].to + 1) ranges[ranges.length - 1].to = Math.max(ranges[ranges.length - 1].to, to);
      else ranges.push({ from, to });
    }
    return ranges.map(r => formatHunk(indexed.slice(r.from, r.to + 1)));
  }

  function formatHunk(slice) {
    let oldStart = null, newStart = null, oldCount = 0, newCount = 0;
    const lines = [];
    for (const row of slice) {
      if (row.type !== 'add') { if (oldStart === null) oldStart = row.oldLine; oldCount++; }
      if (row.type !== 'remove') { if (newStart === null) newStart = row.newLine; newCount++; }
      const prefix = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' ';
      lines.push({ type: row.type, prefix, text: row.text });
      if ((row.type !== 'add' && row.noNewlineOld) || (row.type !== 'remove' && row.noNewlineNew)) {
        lines.push({ type: 'note', prefix: '\\', text: ' No newline at end of file' });
      }
    }
    const os = oldStart === null ? 0 : oldStart, ns = newStart === null ? 0 : newStart;
    return { header: '@@ -' + os + ',' + oldCount + ' +' + ns + ',' + newCount + ' @@', oldStart: os, oldCount, newStart: ns, newCount, lines };
  }

  /** @description Pure deterministic line-by-line unified diff with safe line-limit truncation guard. */
  function unifiedDiff(oldText, newText, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const oldLabel = typeof opts.oldLabel === 'string' ? opts.oldLabel : 'a';
    const newLabel = typeof opts.newLabel === 'string' ? opts.newLabel : 'b';
    const contextLines = Number.isInteger(opts.contextLines) ? Math.max(0, Math.min(20, opts.contextLines)) : 3;
    const maxLines = Number.isInteger(opts.maxLines) && opts.maxLines > 0 ? opts.maxLines : MAX_DIFF_LINES;
    const oldInfo = splitNormalized(oldText, maxLines), newInfo = splitNormalized(newText, maxLines);
    const truncated = oldInfo.truncated || newInfo.truncated;
    const truncationNotice = truncated ? 'Diff truncated at ' + maxLines + ' lines per file (old: ' + oldInfo.originalLines + ', new: ' + newInfo.originalLines + ').' : null;
    const indexed = annotateOps(computeOps(oldInfo.lines, newInfo.lines), oldInfo, newInfo);
    let added = 0, removed = 0, unchanged = 0;
    for (const op of indexed) { if (op.type === 'add') added++; else if (op.type === 'remove') removed++; else unchanged++; }
    const hunks = buildHunks(indexed, contextLines);
    const changed = added > 0 || removed > 0 || oldInfo.norm !== newInfo.norm;
    const out = [];
    if (hunks.length || truncated) {
      out.push('--- ' + oldLabel, '+++ ' + newLabel);
      for (const h of hunks) { out.push(h.header); for (const l of h.lines) out.push(l.prefix + l.text); }
      if (truncationNotice) out.push('... ' + truncationNotice);
    }
    return { oldLabel, newLabel, changed, added, removed, unchanged, truncated, truncationNotice, hunks, text: out.join('\n') };
  }

  function planContentLookup(contentByPlan, planId) {
    if (!contentByPlan || typeof planId !== 'string') return null;
    if (typeof contentByPlan.get === 'function') return contentByPlan.get(planId) || null;
    return Object.prototype.hasOwnProperty.call(contentByPlan, planId) ? contentByPlan[planId] : null;
  }

  function compareEntry(name, baseFile, targetFile, baseContent, targetContent, baseId, targetId) {
    const oldText = lookupContent(baseContent, name), newText = lookupContent(targetContent, name);
    const shortBase = String(baseId || 'base').slice(0, 12), shortTarget = String(targetId || 'target').slice(0, 12);
    if (!baseFile && targetFile) {
      const diff = newText !== null ? unifiedDiff('', newText, { oldLabel: '/dev/null', newLabel: 'plan-' + shortTarget + '/' + name }) : null;
      return { name, status: 'added', base: null, target: targetFile, contentLoaded: newText !== null, diff };
    }
    if (baseFile && !targetFile) {
      const diff = oldText !== null ? unifiedDiff(oldText, '', { oldLabel: 'plan-' + shortBase + '/' + name, newLabel: '/dev/null' }) : null;
      return { name, status: 'removed', base: baseFile, target: null, contentLoaded: oldText !== null, diff };
    }
    const sameDigest = Boolean(baseFile.sha256 && targetFile.sha256 && baseFile.sha256 === targetFile.sha256);
    const sameText = !baseFile.sha256 && !targetFile.sha256 && oldText !== null && newText !== null && oldText === newText;
    if (sameDigest || sameText) {
      return { name, status: 'unchanged', base: baseFile, target: targetFile, contentLoaded: oldText !== null && newText !== null, diff: null };
    }
    const loaded = oldText !== null && newText !== null;
    const diff = loaded ? unifiedDiff(oldText, newText, { oldLabel: 'plan-' + shortBase + '/' + name, newLabel: 'plan-' + shortTarget + '/' + name }) : null;
    return { name, status: 'modified', base: baseFile, target: targetFile, contentLoaded: loaded, diff };
  }

  /** @description Compare two response plans' file manifests by filename, computing unified diffs when file bytes are loaded. */
  function comparePlans(basePlan, targetPlan, contentByPlan) {
    const baseId = basePlan?.id || basePlan?.planId || null;
    const targetId = targetPlan?.id || targetPlan?.planId || null;
    const baseContent = planContentLookup(contentByPlan, baseId);
    const targetContent = planContentLookup(contentByPlan, targetId);
    const baseManifest = buildManifest(basePlan, baseContent);
    const targetManifest = buildManifest(targetPlan, targetContent);
    const baseByName = new Map(baseManifest.files.map(f => [f.name, f]));
    const targetByName = new Map(targetManifest.files.map(f => [f.name, f]));
    const names = [];
    for (const f of targetManifest.files) names.push(f.name);
    for (const f of baseManifest.files) if (!targetByName.has(f.name)) names.push(f.name);
    const files = names.map(n => compareEntry(n, baseByName.get(n) || null, targetByName.get(n) || null, baseContent, targetContent, baseId, targetId));
    const summary = { unchanged: 0, modified: 0, added: 0, removed: 0, total: files.length };
    for (const f of files) summary[f.status]++;
    return { basePlanId: baseManifest.planId, targetPlanId: targetManifest.planId, baseManifest, targetManifest, authorizationNotice: AUTHORIZATION_NOTICE, executionAuthorized: false, summary, files };
  }

  const manifestApi = { AUTHORIZATION_NOTICE, MAX_DIFF_LINES, sha256Hex, bundleDigest, buildManifest, unifiedDiff, comparePlans };
  const api = { REQUIRED, OPTIONAL, LIMITS, sections, extract, utf8Length, ...manifestApi };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OperationsResponseArtifacts = api; root.OperationsResponseManifest = manifestApi; }
})(typeof window === 'object' ? window : globalThis);
