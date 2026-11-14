/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-06: Resume Studio opens the master resume as an editable Word document in AI Office's own editor, with AI Office's standard Concierge beside it. Career keeps only the mapping between its master resume and that document (headings, paragraphs, bullets) and saves the document back through the existing whitelisted master save. No AI Office code is copied: the editor is AI Office's page, reached through its documented document routes and the shared document handoff.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reading the document back splits the Skills line only on the " · " this file writes, and an untouched Skills line keeps the master's list exactly. Live 2026-11-09 02:35 the save before a Chat rail message split a skill holding two semicolons into three skills (a new "Additional Skills" group) in a master nobody had edited. Guard: tests/career-resume-office.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: résumé carries its accents in the lines a person reads here (the status under the document, the notes about what stays in the document, the frame's title). The AI Office document's own title is a stored name this file looks the document up by, so it is unchanged.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 12, 13 and 14: one name for each page. The lines a person reads say main résumé (was master résumé). The stored document title this file looks the document up by is unchanged. Guard: tests/career-page-names.test.mjs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: "it said ... i needed to go to career profile.. but there is no career profile page"). The lines this file wrote sent people to "Profile" for jobs, titles, employers and dates; no such page existed. They now name Work history, the page that edits them, and Education and Certifications say plainly that this document does not change them. Opening the document reads each job's dates line back too (documentState): a document whose text still matches the main résumé but whose jobs changed on Work history is brought up to date as a new revision before it opens (nothing typed is replaced; the earlier one stays in Revision history), one with a different number of jobs says so and offers Use my work history, and syncDocument does the same update from the Work history page right after a save. open() also opens AI Office's editor with assistant=host, so Career's concierge is the one assistant on My résumé.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13: the concierge found wording an earlier approved card had added no longer there). Two ways a Word document that is behind the main résumé could undo an approved change, both shown on a made-up profile in tests/career-work-history-keeps.test.mjs: (1) syncDocument left a document that was behind only on job headings or dates lines as it was ('kept'), so the next change's bullets never reached it and the save before the next concierge turn on My résumé wrote the older bullets back; it now brings such a document up to date, as open() already did, since nothing typed is lost. (2) modelToResume put each document job's bullets into the job at the same place, so a document made before a card removed two jobs and added two wrote the removed jobs' bullets into the new ones; a document job must now be the main résumé's job at that place (its heading, its dates line or its bullets agree), or the save is refused in words with Use my work history.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "the resume concierge the resume tab and the database ... i dont think they are working together well. i cant use the tools to update my resume and see it in the resume tab after adding experience"). The main résumé is the one source of truth and this document is a view of it. The document kept no record of which main résumé it was made from, so one that was only behind read as "typed": it was never updated again, and the save before a concierge turn wrote its older bullets back over an approved change (tests/career-resume-one-source.test.mjs shows both on the earlier file). Now the document names the main résumé revision it was made from (the id of its first page, which typing never changes), and settle() is the one way every page brings the two together: a document that is only behind is rewritten from the main résumé; text typed in it is saved into the main résumé, merged field by field and bullet by bullet with what changed there meanwhile (mergeLists), and never lost; a document Career cannot place (made before this version and unlike any kept version) is left alone until the person presses Save to main résumé or Use my work history; and a document near AI Office's 100-revision limit is replaced by a fresh one. open(), saveToMaster() and follow() all go through it.
 */
(function (root) {
  'use strict';
  const TITLE = 'Master resume (Career)';
  const OFFICE = '/api/presentations/editor';
  const CAREER = '/api/career-hunter';
  // The first page's id names the main résumé revision the document was made from; AI Office keeps a page's id while
  // a person types, takes any text of at most 80 characters, and shows it nowhere.
  const MARK = 'career-', DIGEST = /^[a-f0-9]{64}$/;
  // AI Office refuses a revision past 100; a document is replaced by a fresh one before a person's own save could meet that.
  const ROLL_AT = 95;
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
   * @param {string} [revision] the main résumé's exact revision; the document then names it (revisionOf)
   * @returns {object} an AI Office Word model (kind docx)
   */
  function resumeToModel(resume, meta, revision) {
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
      pages: [{ id: DIGEST.test(String(revision)) ? MARK + revision : uid(), name: 'Page 1', background: '#ffffff', blocks }] };
  }

  /**
   * @description The main résumé revision a document says it was made from.
   * @param {object} model a saved AI Office Word model @returns {string} the revision, or '' when it names none
   */
  function revisionOf(model) {
    const id = model && Array.isArray(model.pages) && model.pages[0] ? String(model.pages[0].id || '') : '';
    return id.startsWith(MARK) && DIGEST.test(id.slice(MARK.length)) ? id.slice(MARK.length) : '';
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
        else if (role && text && role.span == null) role.span = text;
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

  /** A document job is the main résumé's job at its place when its heading, its dates line or its bullets agree. */
  function sameJob(found, role) {
    return squash(found.heading) === squash(roleLine(role)) || squash(found.span || '') === squash(role.span || '')
      || JSON.stringify(found.bullets.map(squash)) === JSON.stringify(strings(role.bullets).map(squash));
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
    const notes = found.extra.map((name) => `"${name}" stays in this document only: the main résumé has no ${name} section.`);
    if (found.roles.length !== roles.length) {
      return { notes, error: `This document has ${found.roles.length} job${found.roles.length === 1 ? '' : 's'} and your Work history has ${roles.length}. `
        + 'Press Use my work history to bring the document up to date; add or remove jobs on the Work history page.' };
    }
    const other = found.roles.findIndex((role, index) => !sameJob(role, roles[index]));
    if (other >= 0) {
      return { notes, error: `Job ${other + 1} in this document is "${found.roles[other].heading}" and job ${other + 1} in your Work history is "${roleLine(roles[other])}". `
        + 'Press Use my work history to bring the document up to date; add, remove or move jobs on the Work history page.' };
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
        notes.push(`The job heading "${role.heading}" stays in this document only: change a job's title, employer and dates on the Work history page.`);
      }
    });
    for (const key of ['education', 'certifications']) {
      if (JSON.stringify(found[key].map(squash)) !== JSON.stringify(strings(prior[key]).map(squash))) {
        notes.push(`${SECTIONS[key]} stays as Career recorded it from your résumé; this document's changes to it are not saved to your main résumé.`);
      }
    }
    return { resume, notes };
  }

  /**
   * @description How a saved document stands against the main résumé: 'same'; 'headings' when only its job headings or
   * dates lines are behind (nothing typed would be lost by bringing it up to date); 'jobs' when it has a different number
   * of jobs; 'typed' when it holds text not yet saved to the main résumé.
   * @param {object} model the saved AI Office Word model @param {object} master the main résumé
   * @returns {'same'|'headings'|'jobs'|'typed'} the state
   */
  function documentState(model, master) {
    const mapped = modelToResume(model, master);
    if (mapped.error) return 'jobs';
    if (!sameResume(mapped.resume, master)) return 'typed';
    const roles = Array.isArray(master && master.experience) ? master.experience : [];
    const found = readSections(model).roles;
    return found.every((role, index) => squash(role.heading) === squash(roleLine(roles[index]))
      && squash(role.span || '') === squash(roles[index].span || '')) ? 'same' : 'headings';
  }

  /** @description Whether two master resumes agree on every field the document can change. */
  function sameResume(a, b) {
    const pick = (r) => JSON.stringify([squash(r && r.headline), squash(r && r.summary), squash(r && r.clearance),
      strings(r && r.competencies).map(squash), strings(r && r.skills).map(squash),
      (r && Array.isArray(r.experience) ? r.experience : []).map((role) => strings(role.bullets).map(squash))]);
    return pick(a) === pick(b);
  }

  /** Whether two lists read the same, spacing aside. */
  const sameList = (a, b) => JSON.stringify(strings(a).map(squash)) === JSON.stringify(strings(b).map(squash));

  /**
   * @description One list changed in two places since `base`: what was typed in the document (`mine`) and what the
   * main résumé holds now (`theirs`). The result is the main résumé's list with the typed changes made to it: what the
   * person removed is removed, what they added follows the item it followed, and nothing either side added is lost.
   * @param {string[]} base the list both started from @param {string[]} mine as typed @param {string[]} theirs as saved
   * @returns {string[]} the merged list
   */
  function mergeLists(base, mine, theirs) {
    const has = (list, item) => list.some((other) => squash(other) === squash(item));
    if (sameList(mine, base)) return theirs.slice();
    if (sameList(theirs, base)) return mine.slice();
    const result = theirs.filter((item) => !has(base, item) || has(mine, item));
    let cursor = 0;
    for (const item of mine) {
      const found = result.findIndex((other) => squash(other) === squash(item));
      if (found >= 0) { cursor = found + 1; continue; }
      if (has(base, item)) continue;
      result.splice(cursor, 0, item); cursor += 1;
    }
    return result;
  }

  /** The place in `roles` of the job that is `role`: the same title and employer (and months, when two share both). */
  function twinIndex(role, roles) {
    let hits = roles.map((other, index) => index).filter((index) => roles[index].title === role.title && roles[index].org === role.org);
    if (hits.length > 1) hits = hits.filter((index) => roles[index].start === role.start && roles[index].end === role.end);
    return hits.length === 1 ? hits[0] : -1;
  }

  /** The main résumé with what was typed in the document since `base` made into it; a part both changed keeps the saved one. */
  function merge(base, typed, master) {
    const out = JSON.parse(JSON.stringify(master)), notes = [];
    for (const [key, label] of [['headline', 'headline'], ['summary', 'summary'], ['clearance', 'clearance']]) {
      if (squash(typed[key]) === squash(base[key])) continue;
      if (squash(master[key]) === squash(base[key])) out[key] = typed[key];
      else if (squash(master[key]) !== squash(typed[key])) {
        notes.push(`Your ${label} also changed in your main résumé after you typed it here. The document now shows the saved one; what you typed is in Revision history.`);
      }
    }
    for (const key of ['competencies', 'skills']) {
      if (!sameList(typed[key], base[key])) out[key] = mergeLists(strings(base[key]), strings(typed[key]), strings(master[key]));
    }
    const roles = Array.isArray(out.experience) ? out.experience : [];
    (Array.isArray(base.experience) ? base.experience : []).forEach((role, index) => {
      const mine = strings(typed.experience[index].bullets), was = strings(role.bullets);
      if (sameList(mine, was)) return;
      const at = twinIndex(role, roles);
      if (at < 0) {
        notes.push(`"${roleLine(role)}" is no longer in your work history as it was, so what you typed under it is kept in Revision history only.`);
        return;
      }
      roles[at].bullets = mergeLists(was, mine, strings(roles[at].bullets));
    });
    return { resume: out, notes };
  }

  /** Whether every job heading and dates line of the document is the main résumé's. */
  function headingsMatch(model, master) {
    const roles = Array.isArray(master && master.experience) ? master.experience : [], found = readSections(model).roles;
    return found.length === roles.length && found.every((role, index) => squash(role.heading) === squash(roleLine(roles[index]))
      && squash(role.span || '') === squash(roles[index].span || ''));
  }

  /**
   * @description How a saved document stands against the main résumé, given the version it was made from when Career
   * knows it. 'same'; 'behind' (nothing typed in it: rewrite it from the main résumé); 'typed' (it holds text the main
   * résumé never had: `resume` is the main résumé with that text made into it); 'unsure' (it differs and Career does
   * not know the version it was made from); 'jobs' (its jobs do not line up, `error` says how).
   * @param {object} model the saved AI Office Word model @param {object} master the main résumé (`resume`)
   * @param {object|null} base the main résumé as it read when the document was made, or null when not known
   * @returns {{state:string,resume?:object,notes:string[],error?:string}} the state and what goes with it
   */
  function reconcile(model, master, base) {
    const direct = modelToResume(model, master);
    if (!direct.error && sameResume(direct.resume, master)) return { state: headingsMatch(model, master) ? 'same' : 'behind', notes: [] };
    const lost = direct.error ? { state: 'jobs', notes: direct.notes, error: direct.error } : { state: 'unsure', notes: direct.notes };
    if (!base) return lost;
    const typed = modelToResume(model, base);
    if (typed.error) return lost;
    if (sameResume(typed.resume, base)) return { state: 'behind', notes: [] };
    const merged = merge(base, typed.resume, master);
    return sameResume(merged.resume, master) ? { state: 'behind', notes: merged.notes } : { state: 'typed', resume: merged.resume, notes: merged.notes };
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

  /** Career's own routes, for a page that passes none: the main résumé with its revision, and the whitelisted save. */
  const careerMaster = () => json(`${CAREER}/resume/doc?id=master`);
  async function careerSave(resume) {
    const saved = await json(`${CAREER}/resume/save`, { method: 'POST', body: JSON.stringify({ postingId: 'master', resume }) });
    if (!saved.ok) throw new Error('Save failed' + (saved.error ? ': ' + saved.error : '.'));
    return saved;
  }
  /** The main résumé as it read at an earlier revision, or the few most recent earlier ones; none when not kept. */
  async function earlier(which) {
    try { const answer = await json(`${CAREER}/resume/doc?id=master&earlier=${encodeURIComponent(which)}`); return Array.isArray(answer.versions) ? answer.versions : []; }
    catch (_) { return []; }
  }

  /** The caller's own linked document (AI Office lists only the caller's, newest first), or null. */
  async function find() {
    const { documents = [] } = await json(`${OFFICE}/documents`);
    return documents.find((item) => item.kind === 'docx' && item.title === TITLE) || null;
  }

  /**
   * The version of the main résumé the document was made from: the one it names; else, when nothing was typed in it,
   * the version the page held before its own change, or the most recent kept version it reads exactly as.
   */
  async function baseOf(model, master, before) {
    const mark = revisionOf(model);
    if (mark && mark === master.revision) return master;
    if (mark) { const [version] = await earlier(mark); if (version) return version; }
    const untyped = (candidate) => { const mapped = modelToResume(model, candidate.resume); return !mapped.error && sameResume(mapped.resume, candidate.resume); };
    if (before && before.resume && untyped(before)) return before;
    return (await earlier('recent')).find(untyped) || null;
  }

  /** Write the main résumé into the document as a new revision (the earlier text stays in Revision history), or into a fresh document once this one nears AI Office's limit. */
  async function write(doc, master) {
    const model = resumeToModel(master.resume, master.meta, master.revision);
    if (doc.revision < ROLL_AT) {
      return (await json(`${OFFICE}/documents/${encodeURIComponent(doc.id)}/revisions`, { method: 'POST',
        body: JSON.stringify({ baseRevision: doc.revision, requestKey: uid(), model }) })).document;
    }
    const made = (await json(`${OFFICE}/documents`, { method: 'POST', body: JSON.stringify({ model, requestKey: uid() }) })).document;
    try { await json(`${OFFICE}/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE', body: JSON.stringify({ baseRevision: doc.revision }) }); }
    catch (_) { /* the full document stays; the newest one is the one Career opens */ }
    return made;
  }

  async function settleNow({ save, explicit, before, saved, master, create, readMaster, saveMaster }) {
    const done = (state, more) => ({ state, notes: [], changed: false, revised: false, master, ...more });
    // The person's documents are looked at first: with none (and none to make) there is nothing to read or compare.
    let doc = saved || null;
    const found = doc ? null : await find();
    if (!doc && !found && !create) return done('none');
    master = master || await readMaster();
    if (!master || !master.resume) return done('none');
    if (!doc) {
      if (!found) {
        const made = (await json(`${OFFICE}/documents`, { method: 'POST',
          body: JSON.stringify({ model: resumeToModel(master.resume, master.meta, master.revision), requestKey: uid() }) })).document;
        return done('made', { documentId: made.id });
      }
      doc = (await json(`${OFFICE}/documents/${encodeURIComponent(found.id)}`)).document;
    }
    let result = reconcile(doc.model, master.resume, null);
    if (result.state !== 'same' && result.state !== 'behind') {
      const base = await baseOf(doc.model, master, before);
      if (base) result = reconcile(doc.model, master.resume, base.resume);
    }
    const out = (state, more) => done(state, { documentId: doc.id, notes: result.notes, error: result.error, ...more });
    // A document that says what the main résumé says, but is close to AI Office's limit, moves to a fresh one now,
    // while nothing is typed in it, so the person's own next save is never the one that meets the limit.
    if (result.state === 'same' && doc.revision >= ROLL_AT) { doc = await write(doc, master); return out('same', { revised: true }); }
    if (result.state === 'behind') { doc = await write(doc, master); return out('updated', { revised: true }); }
    if (result.state === 'typed' && !save) return out('typed');
    if (result.state === 'typed' || (explicit && (result.state === 'unsure' || result.state === 'jobs'))) {
      // 'unsure' or 'jobs' reaches here only when the person pressed Save to main résumé: the document wins, as they asked.
      const mapped = result.state === 'typed' ? result : modelToResume(doc.model, master.resume);
      if (mapped.error) throw new Error(mapped.error);
      const upToDate = revisionOf(doc.model) === master.revision;
      const answer = await saveMaster(mapped.resume);
      // The main résumé took nothing of it (the difference is only how the document words something the main résumé
      // keeps its own way): the two are together, and the document is not rewritten on every look.
      if (answer && answer.changed === false && upToDate) return out('same');
      master = await readMaster();
      const again = reconcile(doc.model, master.resume, null);
      if (again.state === 'same' && revisionOf(doc.model)) return out('saved', { changed: true, changelog: answer && answer.changelog });
      doc = await write(doc, master);
      return out(again.state === 'same' ? 'saved' : 'merged', { changed: true, revised: true, changelog: answer && answer.changelog });
    }
    return out(result.state);
  }

  /**
   * @description Bring the person's Word document and their main résumé together; the one way every Career page does
   * it. A document that is only behind is rewritten from the main résumé. With `save`, text typed in the document is
   * saved into the main résumé (merged with what changed there meanwhile) and the document then shows the result. A
   * document Career cannot place is left as it is unless `explicit` (the person pressed Save to main résumé).
   * @param {{save?:boolean,explicit?:boolean,before?:object,saved?:object,master?:object,create?:boolean,strict?:boolean,readMaster?:Function,saveMaster?:Function}} [options]
   * `before` the main résumé the page held before its own change; `saved` the open document as just saved; `master`
   * the main résumé when the page already holds it; `create` make the document when there is none; `strict` throw
   * instead of answering 'none' when AI Office or Career cannot be reached.
   * @returns {Promise<{state:'none'|'made'|'same'|'updated'|'saved'|'merged'|'typed'|'unsure'|'jobs',notes:string[],changed:boolean,revised:boolean,documentId?:string,master?:object,error?:string}>}
   * `changed` the main résumé was saved to; `revised` the document was rewritten
   */
  async function settle(options) {
    const given = { save: false, explicit: false, before: null, saved: null, master: null, create: false,
      readMaster: careerMaster, saveMaster: careerSave, ...(options || {}) };
    try { return await settleNow(given); }
    catch (error) {
      if (given.strict) throw error;
      return { state: 'none', notes: [], changed: false, revised: false, error: error.message };
    }
  }

  const STATUS = { same: 'Matches your main résumé', made: 'Matches your main résumé', updated: 'Updated with your work history',
    saved: 'Saved what you typed to your main résumé', merged: 'Saved what you typed, and updated with your work history',
    typed: 'Not yet saved to your main résumé',
    unsure: 'This document and your main résumé differ, and Career cannot tell which is newer. Use my work history puts your main résumé in the document; Save to main résumé keeps what is typed here.' };
  /** The line under the document for one outcome of settle. */
  function words(outcome) {
    const line = outcome.state === 'jobs' ? outcome.error : STATUS[outcome.state] || '';
    return [line, ...(outcome.state === 'jobs' ? [] : outcome.notes)].filter(Boolean).join(' ');
  }

  /**
   * @description The host side of My résumé's document view: find or make the person's own main résumé document in AI
   * Office, show AI Office's editor on it, and keep it and the main résumé together (settle).
   * @param {{host:HTMLElement, readMaster:Function, saveMaster:Function, status:Function}} options
   * @returns {object} open, close, active, saveToMaster, follow, replaceFromMaster, inSync, documentId, state, master
   */
  function createHost({ host, readMaster, saveMaster, status }) {
    let documentId = null, frame = null, state = null, latest = null;
    async function handoff() { return import('/shared/ui/js/document-handoff.js'); }
    /** Save the editor's unsaved text first (AI Office's own save), then read that saved revision. */
    async function savedDocument() {
      const { beginDocumentHandoff } = await handoff();
      const { context } = await beginDocumentHandoff({ app: 'presentations' }, { win: root });
      if (!context || context.recordId !== documentId) throw new Error('The résumé document is still opening. Try again in a moment.');
      return (await json(`${OFFICE}/documents/${encodeURIComponent(documentId)}`)).document;
    }
    function show() {
      if (!frame) { frame = root.document.createElement('iframe'); frame.id = 'officeFrame'; frame.title = 'Main résumé document'; host.append(frame); }
      const src = `${OFFICE}/app?document=${encodeURIComponent(documentId)}&assistant=host`;
      if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
    }
    /** Take one outcome of settle: remember it, show the document it left, and say it under the document. */
    async function took(outcome, opened) {
      state = outcome.state === 'made' ? 'same' : outcome.state; latest = outcome.master || latest;
      if (outcome.documentId && outcome.documentId !== documentId) { documentId = outcome.documentId; show(); }
      else if (outcome.revised && !opened) { const { refreshOpenDocument } = await handoff(); await refreshOpenDocument({ app: 'presentations', win: root }); }
      status(words(outcome));
      return outcome;
    }
    async function open(master) {
      const look = (save) => settle({ strict: true, save, create: true, master, readMaster, saveMaster });
      // A save that cannot go through just now (the engine is busy) never keeps the document from opening:
      // what was typed stays in it, and the line under it says it is not yet saved.
      const outcome = await look(true).catch(() => look(false));
      documentId = outcome.documentId; show(); host.hidden = false;
      await took(outcome, true);
      return documentId;
    }
    function close() { host.hidden = true; documentId = null; if (frame) { frame.remove(); frame = null; } }
    /**
     * Bring the open document and the main résumé together. `explicit` is the person pressing Save to main résumé (a
     * document Career cannot place then wins); the save before a concierge turn passes false and leaves such a document.
     */
    async function saveToMaster(explicit = true) {
      const outcome = await took(await settle({ strict: true, save: true, explicit, saved: await savedDocument(), readMaster, saveMaster }));
      return { changed: outcome.changed, changelog: outcome.changelog || [], notes: outcome.notes, state: outcome.state };
    }
    /** After the main résumé changed (an approved card, Undo): the document follows, and nothing typed meanwhile is lost. */
    const follow = () => saveToMaster(false);
    /** Replace the document's text with the saved main résumé as a NEW revision; the earlier one stays in Revision history. */
    async function replaceFromMaster() {
      const saved = await savedDocument(), master = await readMaster();
      const doc = await write(saved, master);
      await took({ state: 'updated', notes: [], changed: false, revised: true, documentId: doc.id, master });
    }
    /** Whether the document already says what the saved main résumé says (no unsaved résumé text in it). */
    async function inSync() {
      const saved = await savedDocument(), master = await readMaster();
      const mapped = modelToResume(saved.model, master.resume);
      return !mapped.error && sameResume(mapped.resume, master.resume);
    }
    return { open, close, saveToMaster, follow, replaceFromMaster, inSync, active: () => Boolean(documentId), documentId: () => documentId,
      state: () => state, master: () => latest };
  }

  /**
   * @description After a change made on Work history, bring the person's linked Word document up to the new main
   * résumé (settle, with the résumé the page held before the change as the version an unmarked document may be from).
   * @param {{resume:object}} before the main résumé document before the change @param {{resume:object,meta:object}} after it after
   * @returns {Promise<'none'|'kept'|'updated'>} no document, left as it was, or updated
   */
  async function syncDocument(before, after) {
    if (!before || !after || !before.resume || !after.resume) return 'none';
    const outcome = await settle({ strict: true, master: after, before });
    return outcome.state === 'none' ? 'none' : outcome.revised ? 'updated' : 'kept';
  }

  const api = { TITLE, SECTIONS, resumeToModel, revisionOf, modelToResume, sameResume, documentState, reconcile, mergeLists, settle, syncDocument, createHost };
  root.CareerResumeOffice = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
