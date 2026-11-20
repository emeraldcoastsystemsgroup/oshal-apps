/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Map the selected saved packet into the existing Word model and restyle saved Office content without changing facts, dates, manual text or role ordering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Fall back to getRandomValues UUIDv4 generation on plain-HTTP LAN origins where crypto.randomUUID is unavailable.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Match downloaded Word (.docx) and cover letter formatting to the clean PDF templates: 0.5in margins, centered navy header with bottom rule, uppercase bordered section headings in exact PDF order, single-line right-tabbed role titles/dates, inline comma-separated competencies and skills, and compact Education & Certifications.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.68.20: keep candidate name single-line without appending contact.credential onto the header title.
 */
'use strict';
{
  const root = typeof window !== 'undefined' ? window : globalThis;
  const H = root.CareerRoleHierarchy || (typeof require === 'function' ? require('./career-role-hierarchy.js') : null);
  const copy = value => JSON.parse(JSON.stringify(value));
  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  const line = value => typeof value === 'string' ? value.trim() : '';
  const uid = () => root.crypto?.randomUUID ? root.crypto.randomUUID()
    : Array.from(root.crypto.getRandomValues(new Uint8Array(16)), (b, i) =>
      ([4, 6, 8, 10].includes(i) ? '-' : '') + (i === 6 ? (b & 15) | 64 : i === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, '0')).join('');

  const NAVY = '#1f3a5f', INK = '#1a1a1a', SUB = '#33414f', MUTED = '#5a6675', CONTACT = '#444444', RULE = '#d6dee8';
  const PAGE_W = 612, PAGE_H = 792, RESUME_TAB = 540;

  function run(text, overrides = {}) {
    return {
      text: String(text == null ? '' : text),
      style: {fontFamily: 'Calibri', fontSize: 10.5, bold: false, italic: false, underline: false, color: INK, align: 'left', ...overrides},
    };
  }

  function para(runs, opts = {}) {
    const block = {
      id: opts.id || uid(),
      type: 'paragraph',
      runs: Array.isArray(runs) ? runs : [run(runs, opts.look)],
      style: opts.style || 'normal',
      spacingBefore: opts.before ?? 0,
      spacingAfter: opts.after ?? 4,
      lineHeight: opts.lineHeight ?? 1.3,
      list: opts.list || 'none',
    };
    if (opts.indentLeft !== undefined) block.indentLeft = opts.indentLeft;
    if (opts.keepWithNext !== undefined) block.keepWithNext = opts.keepWithNext;
    if (opts.borderBottom !== undefined) block.borderBottom = opts.borderBottom;
    if (opts.tabRight !== undefined) block.tabRight = opts.tabRight;
    return block;
  }

  function sectionHeading(title) {
    return para([run(title.toUpperCase(), {fontSize: 11, bold: true, color: NAVY})], {
      style: 'heading1', before: 10, after: 4, lineHeight: 1.2, keepWithNext: true, borderBottom: NAVY,
    });
  }

  function contactLine(meta, includeCitizenship = true) {
    const source = meta.contact || {};
    const keys = includeCitizenship
      ? ['location', 'phone', 'email', 'linkedin', 'clearance', 'citizenship']
      : ['location', 'phone', 'email', 'linkedin', 'clearance'];
    return keys.map(key => line(source[key])).filter(Boolean).join('  |  ');
  }

  function savedResume(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw Error('This saved packet has no résumé content to download.');
    }
    for (const key of ['headline', 'summary', 'clearance']) {
      if (value[key] != null && typeof value[key] !== 'string') throw Error('This saved résumé has unreadable text.');
    }
    for (const key of ['competencies', 'skills', 'education', 'certifications']) {
      if (value[key] != null && (!Array.isArray(value[key]) || value[key].some(item => typeof item !== 'string'))) {
        throw Error('This saved résumé has an unreadable section.');
      }
    }
    for (const key of ['experience', 'open_source', 'additional_experience']) {
      if (value[key] == null) continue;
      if (!Array.isArray(value[key])) throw Error('This saved résumé has unreadable roles.');
      for (const role of value[key]) {
        if (!role || typeof role !== 'object' || ['title', 'org', 'span'].some(field => role[field] != null && typeof role[field] !== 'string')
          || (role.bullets != null && (!Array.isArray(role.bullets) || role.bullets.some(item => typeof item !== 'string')))) {
          throw Error('This saved résumé has an unreadable role.');
        }
      }
    }
    return copy(value);
  }

  function orderedRoles(list) {
    const items = Array.isArray(list) ? list : [];
    return H && typeof H.ordered === 'function' ? H.ordered(items) : items.map((role, index) => ({role, index, child: false, heading: ''}));
  }

  function roleBlocks(row, prefix = '') {
    const {role, index, child, heading: label} = row, out = [], bullets = strings(role.bullets);
    if (label) {
      out.push(para([run(label, {fontSize: 10.2, bold: true, color: NAVY})], {
        id: prefix + 'career-label-' + index, before: 4, after: 2, lineHeight: 1.2, indentLeft: 18, keepWithNext: true,
      }));
    }
    const headerRuns = [];
    if (role.title) headerRuns.push(run(role.title, {fontSize: 10.8, bold: true, color: INK}));
    if (role.org) headerRuns.push(run((role.title ? ', ' : '') + role.org, {fontSize: 10.2, bold: true, color: SUB}));
    if (!headerRuns.length) headerRuns.push(run('', {fontSize: 10.8, bold: true, color: INK}));
    if (role.span) headerRuns.push(run('\t' + role.span, {fontSize: 9.4, bold: false, color: MUTED}));
    out.push(para(headerRuns, {
      id: prefix ? prefix + uid() : (role.id || 'career-index:' + index),
      style: 'heading2', before: 6, after: 2, lineHeight: 1.25,
      indentLeft: child ? 18 : undefined, keepWithNext: bullets.length > 0, tabRight: RESUME_TAB,
    }));
    for (const item of bullets) {
      out.push(para([run(item, {fontSize: 10.5, color: INK})], {
        list: 'bullet', before: 0, after: 2, lineHeight: 1.3, indentLeft: child ? 30.6 : undefined,
      }));
    }
    return out;
  }

  function headerBlocks(meta, content) {
    const blocks = [], fullName = line(meta.name) || line(meta.contact?.name);
    const address = contactLine(meta, true);
    if (fullName) {
      blocks.push(para([run(fullName, {fontSize: 20, bold: true, color: NAVY, align: 'center'})], {
        style: 'title', before: 0, after: 1, lineHeight: 1.15, keepWithNext: true,
      }));
    }
    if (line(content.headline)) {
      blocks.push(para([run(content.headline, {fontSize: 11.5, bold: true, color: SUB, align: 'center'})], {
        before: 0, after: 3, lineHeight: 1.2, keepWithNext: true,
      }));
    }
    if (address) {
      blocks.push(para([run(address, {fontSize: 9.3, color: CONTACT, align: 'center'})], {
        before: 0, after: 8, lineHeight: 1.25, borderBottom: RULE,
      }));
    } else if (blocks.length) {
      blocks[blocks.length - 1].borderBottom = RULE;
      blocks[blocks.length - 1].spacingAfter = 8;
    }
    return blocks;
  }

  function qualificationsBlocks(content, meta) {
    const education = strings(content.education), certs = strings(content.certifications);
    const clearance = line(content.clearance) || line(meta.contact?.clearance);
    if (!education.length && !certs.length && !clearance) return [];
    const blocks = [sectionHeading('Education & Certifications')];
    const labeled = (label, value) => para([
      run(label + ': ', {fontSize: 10, bold: true, color: NAVY}),
      run(value, {fontSize: 10, color: INK}),
    ], {before: 0, after: 2, lineHeight: 1.3});
    if (education.length) blocks.push(labeled('Education', education.join(', ')));
    if (certs.length) blocks.push(labeled('Certifications', certs.join(', ')));
    if (clearance) blocks.push(labeled('Clearance', clearance));
    return blocks;
  }

  function resume(packet) {
    const meta = packet.meta || {}, content = savedResume(packet.resume);
    const blocks = [...headerBlocks(meta, content)];
    const summaryParts = String(content.summary || '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
    if (summaryParts.length) {
      blocks.push(sectionHeading('Professional Summary'));
      for (const part of summaryParts) blocks.push(para([run(part, {fontSize: 10.5, color: INK})], {before: 0, after: 4, lineHeight: 1.3}));
    }
    const competencies = strings(content.competencies);
    if (competencies.length) {
      blocks.push(sectionHeading('Core Competencies'));
      blocks.push(para([run(competencies.join(', '), {fontSize: 10.5, color: INK})], {before: 0, after: 4, lineHeight: 1.3}));
    }
    if (Array.isArray(content.experience) && content.experience.length) {
      blocks.push(sectionHeading('Professional Experience'));
      for (const row of orderedRoles(content.experience)) blocks.push(...roleBlocks(row));
    }
    for (const [key, title, prefix] of [['open_source', 'Open Source & Independent R&D', 'oss-'], ['additional_experience', 'Additional Experience', 'add-']]) {
      if (!Array.isArray(content[key]) || !content[key].length) continue;
      blocks.push(sectionHeading(title));
      for (const row of orderedRoles(content[key])) blocks.push(...roleBlocks(row, prefix));
    }
    const skills = strings(content.skills);
    if (skills.length) {
      blocks.push(sectionHeading('Technical Skills'));
      blocks.push(para([run(skills.join(', '), {fontSize: 10.5, color: INK})], {before: 0, after: 4, lineHeight: 1.3}));
    }
    blocks.push(...qualificationsBlocks(content, meta));
    const displayName = line(meta.name) || line(meta.contact?.name) || 'Saved';
    return {
      version: 1, kind: 'docx', title: (displayName + ' résumé').slice(0, 120),
      pageWidth: PAGE_W, pageHeight: PAGE_H, margins: {top: 36, right: 36, bottom: 36, left: 36}, header: '', footer: '',
      pages: [{id: uid(), name: 'Page 1', background: '#ffffff', blocks: blocks.length ? blocks : [para('')]}],
    };
  }

  function cover(packet) {
    const source = packet.cover, meta = packet.meta || {};
    if (!source || !Array.isArray(source.paragraphs) || source.paragraphs.some(value => typeof value !== 'string')
      || !source.paragraphs.some(value => value.trim())) {
      throw Error('This saved packet has no generated cover letter.');
    }
    if (['greeting', 'closing'].some(key => source[key] != null && typeof source[key] !== 'string')) {
      throw Error('This saved cover letter has unreadable text.');
    }
    const rawName = line(meta.name) || line(meta.contact?.name);
    const fullName = rawName, address = contactLine(meta, false);
    const blocks = [];
    if (fullName) {
      blocks.push(para([run(fullName, {fontSize: 16, bold: true, color: NAVY, align: 'center'})], {
        style: 'title', before: 0, after: address ? 2 : 10, lineHeight: 1.15, borderBottom: address ? undefined : RULE,
      }));
    }
    if (address) {
      blocks.push(para([run(address, {fontSize: 9.5, color: CONTACT, align: 'center'})], {
        before: 0, after: 10, lineHeight: 1.25, borderBottom: RULE,
      }));
    }
    if (line(meta.company)) blocks.push(para([run(meta.company, {fontSize: 10.5, bold: true, color: NAVY})], {before: 4, after: 2, lineHeight: 1.3}));
    if (line(meta.title)) blocks.push(para([run('Re: ' + meta.title, {fontSize: 10.5, color: SUB})], {before: 0, after: 10, lineHeight: 1.3}));
    if (line(source.greeting)) blocks.push(para([run(source.greeting, {fontSize: 10.5, color: INK})], {before: 0, after: 8, lineHeight: 1.35}));
    for (const text of strings(source.paragraphs)) {
      if (text.trim()) blocks.push(para([run(text, {fontSize: 10.5, color: INK})], {before: 0, after: 8, lineHeight: 1.35}));
    }
    if (line(source.closing)) blocks.push(para([run(source.closing, {fontSize: 10.5, color: INK})], {before: 6, after: 2, lineHeight: 1.35}));
    if (rawName) blocks.push(para([run(rawName, {fontSize: 10.5, bold: true, color: NAVY})], {before: 0, after: 0, lineHeight: 1.35}));
    return {
      version: 1, kind: 'docx', title: ((rawName || 'Saved') + ' cover letter').slice(0, 120),
      pageWidth: PAGE_W, pageHeight: PAGE_H, margins: {top: 54, right: 54, bottom: 54, left: 54}, header: '', footer: '',
      pages: [{id: uid(), name: 'Page 1', background: '#ffffff', blocks: blocks.length ? blocks : [para('')]}],
    };
  }

  /** Restyle a copy of the actual selected saved model; every text run and object identity stays unchanged. */
  function styled(source, style) {
    if (!['ats', 'professional'].includes(style)) throw Error('Choose ATS or Professional style.');
    const model = copy(source);
    if (model.kind !== 'docx') throw Error('Choose a saved Word résumé.');
    if (style === 'ats') return model;
    model.margins = {top: 36, right: 36, bottom: 36, left: 36};
    for (const page of model.pages) {
      for (const block of page.blocks) {
        if (block.type !== 'paragraph') continue;
        const heading = ['title', 'heading1'].includes(block.style);
        for (const r of block.runs) {
          r.style = {
            ...r.style,
            fontFamily: heading ? 'Georgia' : 'Calibri',
            fontSize: block.style === 'title' ? 22 : block.style === 'heading1' ? 11 : Math.min(r.style.fontSize || 10.5, 10.5),
            color: heading ? '#16304f' : (r.style.color === MUTED || r.style.color === CONTACT ? r.style.color : '#23303c'),
          };
        }
        if (block.borderBottom === NAVY) block.borderBottom = '#16304f';
        block.lineHeight = 1.3;
      }
    }
    return model;
  }

  function fromPacket(packet, kind, style = 'ats') {
    if (!packet || typeof packet !== 'object' || !['resume', 'cover'].includes(kind)) throw Error('Choose a saved résumé or cover letter.');
    if (packet.meta && (typeof packet.meta !== 'object' || Array.isArray(packet.meta)
      || ['name', 'company', 'title'].some(key => packet.meta[key] != null && typeof packet.meta[key] !== 'string'))) {
      throw Error('This saved packet has unreadable identity details.');
    }
    if (kind === 'cover' && style !== 'ats') throw Error('Professional style is available for the résumé.');
    return styled(kind === 'resume' ? resume(packet) : cover(packet), style);
  }

  const api = {fromPacket, styled};
  root.CareerExportModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}
