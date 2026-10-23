/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract workflow-generated response files byte-exact from an accepted answer's named fenced sections (```lang file=NAME), with digests and byte ranges, so the same deterministic rule serves the browser preview and the server-side plan without parsing prose into pretend files.
 */
(function (root) {
  'use strict';
  const REQUIRED = ['remediate.sh', 'verify.sh', 'rollback.md', 'verify.md'];
  const OPTIONAL = ['diagnose.sh'];
  const LIMITS = { 'remediate.sh': 4096, 'verify.sh': 4096, 'diagnose.sh': 4096, 'rollback.md': 16384, 'verify.md': 16384 };
  const NAME = /^[a-z][a-z0-9-]{0,39}\.(sh|md)$/;
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
  function utf8Length(text) { let n = 0; for (let i = 0; i < text.length; i++) { const c = text.codePointAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : (i++, 4); } return n; }
  const api = { REQUIRED, OPTIONAL, LIMITS, sections, extract, utf8Length };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.OperationsResponseArtifacts = api;
})(typeof window === 'object' ? window : globalThis);
