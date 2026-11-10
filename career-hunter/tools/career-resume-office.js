/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-06: Resume Studio opens the master resume as an editable Word document in AI Office's own editor, with AI Office's standard Concierge beside it. Career keeps only the mapping between its master resume and that document (headings, paragraphs, bullets) and saves the document back through the existing whitelisted master save. No AI Office code is copied: the editor is AI Office's page, reached through its documented document routes and the shared document handoff.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reading the document back splits the Skills line only on the " · " this file writes, and an untouched Skills line keeps the master's list exactly. Live 2026-11-09 02:35 the save before a Chat rail message split a skill holding two semicolons into three skills (a new "Additional Skills" group) in a master nobody had edited. Guard: tests/career-resume-office.test.mjs.
 */
(function (root) {
  'use strict';
  const TITLE = 'Master resume (Career)';
  const OFFICE = '/api/presentations/editor';
  const SECTIONS = Object.freeze({ summary: 'Summary', competencies: 'Core competencies', skills: 'Skills',
    experience: 'Experience', education: 'Education', certifications: 'Certifications', clearance: 'Clearance' });
  const uid = () => root.crypto.randomUUID();
  const squash = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const strings = (value) => (Array.isArray(value) ? value : []).filter((item) => typeof item === 'string');

  function run(text, style) {
    return { text: String(text == null ? '' : text), style: { fontFamily: 'Arial', fontSize: 11, bold: false, italic: false,
      underline: false, color: '#172033', align: 'left', ...style } };
  }
  function para(text, { style = 'normal', list = 'none', look = {}, before = 0, after = 6 } = {}) {
    return { id: uid(), type: 'paragraph', runs: [run(text, look)], style, spacingBefore: before, spacingAfter: after,
      lineHeight: 1.25, list };
  }
  const heading = (text) => para(text, { style: 'heading1', look: { fontSize: 13, bold: true, color: '#1f3a5f' }, before: 12, after: 4 });
  const roleLine = (role) => [role && role.title, role && role.org].filter(Boolean).join(' — ');

  /**
   * @description Lay the master resume out as one Word document: the name as its title, the headline
   * under it, then one Heading 1 per section, each role as a Heading 2 with its dates and its bullets.
   * The section headings are the anchors the save reads back, so the mapping is exact both ways.
   * @param {object} resume the master resume document (`resume base`)
   * @param {object} meta its meta block (name)
   * @returns {object} an AI Office Word model (kind docx)
   */
  function resumeToModel(resume, meta) {
    const r = resume || {}, blocks = [];
    if (meta && meta.name) blocks.push(para(meta.name, { style: 'title', look: { fontSize: 20, bold: true }, after: 2 }));
    blocks.push(para(r.headline || '', { style: 'heading2', look: { fontSize: 12, bold: true, color: '#334155' }, after: 8 }));
    blocks.push(heading(SECTIONS.summary));
    const summary = String(r.summary || '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    (summary.length ? summary : ['']).forEach((part) => blocks.push(para(part)));
    blocks.push(heading(SECTIONS.competencies));
    strings(r.competencies).forEach((item) => blocks.push(para(item, { list: 'bullet', after: 2 })));
    blocks.push(heading(SECTIONS.skills));
    blocks.push(para(strings(r.skills).join(' · ')));
    blocks.push(heading(SECTIONS.experience));
    for (const role of Array.isArray(r.experience) ? r.experience : []) {
      blocks.push(para(roleLine(role), { style: 'heading2', look: { fontSize: 11.5, bold: true }, before: 6, after: 1 }));
      if (role.span) blocks.push(para(role.span, { look: { italic: true, color: '#475569' }, after: 3 }));
      strings(role.bullets).forEach((item) => blocks.push(para(item, { list: 'bullet', after: 2 })));
    }
    for (const key of ['education', 'certifications']) {
      const items = strings(r[key]);
      if (items.length) { blocks.push(heading(SECTIONS[key])); items.forEach((item) => blocks.push(para(item))); }
    }
    blocks.push(heading(SECTIONS.clearance));
    blocks.push(para(r.clearance || ''));
    return { version: 1, kind: 'docx', title: TITLE, pageWidth: 612, pageHeight: 792,
      margins: { top: 54, right: 54, bottom: 54, left: 54 }, header: '', footer: '',
      pages: [{ id: uid(), name: 'Page 1', background: '#ffffff', blocks }] };
  }

  /** Read the document's paragraphs into the sections the master resume has. */
  function readSections(model) {
    const blocks = (model && Array.isArray(model.pages) ? model.pages : []).flatMap((page) => page.blocks || [])
      .filter((block) => block.type === 'paragraph');
    const found = { lead: [], summary: [], competencies: [], skills: [], clearance: [], education: [], certifications: [], roles: [], extra: [] };
    let section = null;
    for (const block of blocks) {
      const text = (block.runs || []).map((item) => item.text).join('').trim();
      if (block.style === 'heading1') {
        section = Object.keys(SECTIONS).find((key) => SECTIONS[key].toLowerCase() === text.toLowerCase()) || 'extra';
        if (section === 'extra' && text) found.extra.push(text);
        continue;
      }
      if (!section) { if (block.style !== 'title' && text) found.lead.push(text); continue; }
      if (section === 'experience') {
        if (block.style === 'heading2') { found.roles.push({ heading: text, bullets: [] }); continue; }
        const role = found.roles[found.roles.length - 1];
        if (role && block.list !== 'none' && text) role.bullets.push(text);
        continue;
      }
      if (section !== 'extra' && text) found[section].push(text);
    }
    return found;
  }

  /** Keep the master's own wording when only whitespace differs, so an untouched field is never "changed". */
  const keep = (next, prior) => (squash(next) === squash(prior) ? prior : next);
  const keepList = (next, prior) => (JSON.stringify(next.map(squash)) === JSON.stringify(strings(prior).map(squash)) ? prior : next);
  /**
   * The Skills section's skills. resumeToModel writes them as one line joined by " · ", so that is the
   * only separator read back: a semicolon or comma is part of a skill's own text. A line that still
   * says exactly what the master's list says keeps that list, even a skill holding the separator.
   */
  function readSkills(lines, prior) {
    if (squash(lines.join(' · ')) === squash(strings(prior).join(' · '))) return prior;
    return keepList(lines.flatMap((line) => line.split(/\s*·\s*/)).map((item) => item.trim()).filter(Boolean), prior);
  }

  /**
   * @description Read an edited Word document back into the master resume. Only the fields the master
   * save accepts are taken (headline, summary, competencies, skills, clearance and each role's bullets);
   * role titles, employers and dates stay the profile's, because the save matches roles by index and title.
   * @param {object} model the saved AI Office Word model
   * @param {object} master the current master resume
   * @returns {{resume?:object,notes:string[],error?:string}} the resume to save, what stays in the document only, or why it cannot be saved
   */
  function modelToResume(model, master) {
    const prior = master || {}, found = readSections(model), roles = Array.isArray(prior.experience) ? prior.experience : [];
    const notes = found.extra.map((name) => `"${name}" stays in this document only: the master resume has no ${name} section.`);
    if (found.roles.length !== roles.length) {
      return { notes, error: `The Experience section has ${found.roles.length} role${found.roles.length === 1 ? '' : 's'} and your profile has ${roles.length}. `
        + 'Keep one Heading 2 per role here; add or remove roles in Profile.' };
    }
    const resume = JSON.parse(JSON.stringify(prior));
    resume.headline = keep(found.lead.join(' '), prior.headline || '');
    resume.summary = keep(found.summary.join('\n\n'), prior.summary || '');
    resume.competencies = keepList(found.competencies, prior.competencies);
    resume.skills = readSkills(found.skills, prior.skills);
    resume.clearance = keep(found.clearance.join(' '), prior.clearance || '');
    found.roles.forEach((role, index) => {
      resume.experience[index].bullets = keepList(role.bullets, roles[index].bullets);
      if (squash(role.heading) !== squash(roleLine(roles[index]))) {
        notes.push(`The role heading "${role.heading}" stays in this document only: titles, employers and dates come from your profile.`);
      }
    });
    for (const key of ['education', 'certifications']) {
      if (JSON.stringify(found[key].map(squash)) !== JSON.stringify(strings(prior[key]).map(squash))) {
        notes.push(`${SECTIONS[key]} stays as your profile records it; this document's changes to it are not saved there.`);
      }
    }
    return { resume, notes };
  }

  /** @description Whether two master resumes agree on every field the document can change. */
  function sameResume(a, b) {
    const pick = (r) => JSON.stringify([squash(r && r.headline), squash(r && r.summary), squash(r && r.clearance),
      strings(r && r.competencies).map(squash), strings(r && r.skills).map(squash),
      (r && Array.isArray(r.experience) ? r.experience : []).map((role) => strings(role.bullets).map(squash))]);
    return pick(a) === pick(b);
  }

  async function json(path, init) {
    const response = await root.fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init,
      headers: init && init.body ? { 'Content-Type': 'application/json' } : {} });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || (typeof body.error === 'string' ? body.error : '') || `HTTP ${response.status}`);
      error.status = response.status; throw error;
    }
    return body;
  }

  /**
   * @description The host side of Resume Studio's document view: find or make the person's own master
   * resume document in AI Office, show AI Office's editor on it, and move text between it and Career.
   * @param {{host:HTMLElement, readMaster:Function, saveMaster:Function, status:Function}} options
   * @returns {object} open, close, active, saveToMaster, replaceFromMaster, documentId
   */
  function createHost({ host, readMaster, saveMaster, status }) {
    let documentId = null, frame = null;
    async function handoff() { return import('/shared/ui/js/document-handoff.js'); }
    /** Find the caller's own linked document (AI Office lists only the caller's), or make it from the master. */
    async function link(master) {
      const { documents = [] } = await json(`${OFFICE}/documents`);
      const found = documents.find((item) => item.kind === 'docx' && item.title === TITLE);
      if (found) return found.id;
      const made = await json(`${OFFICE}/documents`, { method: 'POST',
        body: JSON.stringify({ model: resumeToModel(master.resume, master.meta), requestKey: uid() }) });
      return made.document.id;
    }
    /** Save the editor's unsaved text first (AI Office's own save), then read that saved revision. */
    async function savedDocument() {
      const { beginDocumentHandoff } = await handoff();
      const { context } = await beginDocumentHandoff({ app: 'presentations' }, { win: root });
      if (!context || context.recordId !== documentId) throw new Error('The resume document is still opening. Try again in a moment.');
      return (await json(`${OFFICE}/documents/${encodeURIComponent(documentId)}`)).document;
    }
    async function open(master) {
      documentId = await link(master);
      if (!frame) { frame = root.document.createElement('iframe'); frame.id = 'officeFrame'; frame.title = 'Master resume document'; host.append(frame); }
      const src = `${OFFICE}/app?document=${encodeURIComponent(documentId)}`;
      if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
      host.hidden = false;
      const saved = (await json(`${OFFICE}/documents/${encodeURIComponent(documentId)}`)).document;
      const mapped = modelToResume(saved.model, master.resume);
      status(mapped.error || (sameResume(mapped.resume, master.resume) ? 'Matches your master resume' : 'Not yet saved to your master resume'));
      return documentId;
    }
    function close() { host.hidden = true; documentId = null; if (frame) { frame.remove(); frame = null; } }
    /** Write the document's text into the master resume through Career's existing whitelisted save. */
    async function saveToMaster() {
      const saved = await savedDocument(), master = await readMaster();
      const mapped = modelToResume(saved.model, master.resume);
      if (mapped.error) throw new Error(mapped.error);
      if (sameResume(mapped.resume, master.resume)) return { changed: false, changelog: [], notes: mapped.notes };
      const result = await saveMaster(mapped.resume);
      return { ...result, notes: mapped.notes };
    }
    /** Replace the document's text with the saved master as a NEW revision; the earlier one stays in Revision history. */
    async function replaceFromMaster() {
      const saved = await savedDocument(), master = await readMaster();
      await json(`${OFFICE}/documents/${encodeURIComponent(documentId)}/revisions`, { method: 'POST',
        body: JSON.stringify({ baseRevision: saved.revision, requestKey: uid(), model: resumeToModel(master.resume, master.meta) }) });
      const { refreshOpenDocument } = await handoff();
      await refreshOpenDocument({ app: 'presentations', win: root });
    }
    /** Whether the document already says what the saved master says (no unsaved resume text in it). */
    async function inSync() {
      const saved = await savedDocument(), master = await readMaster();
      const mapped = modelToResume(saved.model, master.resume);
      return !mapped.error && sameResume(mapped.resume, master.resume);
    }
    return { open, close, saveToMaster, replaceFromMaster, inSync, active: () => Boolean(documentId), documentId: () => documentId };
  }

  const api = { TITLE, SECTIONS, resumeToModel, modelToResume, sameResume, createHost };
  root.CareerResumeOffice = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
