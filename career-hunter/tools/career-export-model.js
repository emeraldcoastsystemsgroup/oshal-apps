/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Map the selected saved packet into the existing Word model and restyle saved Office content without changing facts, dates, manual text or role ordering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Fall back to getRandomValues UUIDv4 generation on plain-HTTP LAN origins where crypto.randomUUID is unavailable.
 */
'use strict';
{
  const root = typeof window !== 'undefined' ? window : globalThis;
  const Office = root.CareerResumeOffice || (typeof require === 'function' ? require('./career-resume-office.js') : null);
  const copy = value => JSON.parse(JSON.stringify(value));
  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  const line = value => typeof value === 'string' ? value : '';
  const uid = () => root.crypto?.randomUUID ? root.crypto.randomUUID()
    : Array.from(root.crypto.getRandomValues(new Uint8Array(16)), (b, i) =>
      ([4, 6, 8, 10].includes(i) ? '-' : '') + (i === 6 ? (b & 15) | 64 : i === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, '0')).join('');

  function paragraph(value, bold = false) {
    return {id: uid(), type: 'paragraph', runs: [{text: value, style: {fontFamily: 'Arial', fontSize: 11,
      bold, italic: false, underline: false, color: '#172033', align: 'left'}}],
    style: 'normal', spacingBefore: 0, spacingAfter: 8, lineHeight: 1.3, list: 'none'};
  }

  function contact(meta) {
    const source = meta.contact || {};
    return ['location', 'phone', 'email', 'linkedin', 'citizenship'].map(key => line(source[key])).filter(Boolean).join(' · ');
  }

  function savedResume(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw Error('This saved packet has no résumé content to download.');
    for (const key of ['headline', 'summary', 'clearance']) if (value[key] != null && typeof value[key] !== 'string') throw Error('This saved résumé has unreadable text.');
    for (const key of ['competencies', 'skills', 'education', 'certifications']) {
      if (value[key] != null && (!Array.isArray(value[key]) || value[key].some(item => typeof item !== 'string'))) throw Error('This saved résumé has an unreadable section.');
    }
    for (const key of ['experience', 'open_source', 'additional_experience']) {
      if (value[key] == null) continue;
      if (!Array.isArray(value[key])) throw Error('This saved résumé has unreadable roles.');
      for (const role of value[key]) {
        if (!role || typeof role !== 'object' || ['title', 'org', 'span'].some(field => role[field] != null && typeof role[field] !== 'string')
          || (role.bullets != null && (!Array.isArray(role.bullets) || role.bullets.some(item => typeof item !== 'string')))) throw Error('This saved résumé has an unreadable role.');
      }
    }
    return copy(value);
  }

  function extraRoles(model, resume) {
    for (const [key, title] of [['open_source', 'Open Source & Independent R&D'], ['additional_experience', 'Additional Experience']]) {
      if (!Array.isArray(resume[key]) || !resume[key].length) continue;
      const mapped = Office.resumeToModel({experience: resume[key]}, {}).pages[0].blocks;
      const begin = mapped.findIndex(block => block.style === 'heading1' && block.runs[0].text === 'Experience');
      const end = mapped.findIndex((block, index) => index > begin && block.style === 'heading1');
      const heading = paragraph(title, true); heading.style = 'heading1'; heading.keepWithNext = true;
      const blocks = mapped.slice(begin + 1, end < 0 ? undefined : end).map(block => ({...block, id: 'extra-' + uid()}));
      model.pages[0].blocks.push(heading, ...blocks);
    }
  }

  function resume(packet) {
    const meta = packet.meta || {}, address = contact(meta);
    const content = savedResume(packet.resume);
    if (!content.clearance && line(meta.contact?.clearance)) content.clearance = meta.contact.clearance;
    const model = Office.resumeToModel(content, meta);
    model.title = ((line(meta.name) || 'Saved') + ' résumé').slice(0, 120);
    if (meta.name && line(meta.contact?.credential)) model.pages[0].blocks[0].runs[0].text += ', ' + meta.contact.credential;
    if (address) model.pages[0].blocks.splice(meta.name ? 2 : 1, 0, paragraph(address));
    extraRoles(model, packet.resume);
    return model;
  }

  function cover(packet) {
    const source = packet.cover, meta = packet.meta || {};
    if (!source || !Array.isArray(source.paragraphs) || source.paragraphs.some(value => typeof value !== 'string')
      || !source.paragraphs.some(value => value.trim())) throw Error('This saved packet has no generated cover letter.');
    if (['greeting', 'closing'].some(key => source[key] != null && typeof source[key] !== 'string')) throw Error('This saved cover letter has unreadable text.');
    const model = Office.resumeToModel({}, {});
    const title = line(meta.name) || line(meta.contact?.name), address = contact(meta);
    const lines = [title, address, line(meta.company), line(meta.title), line(source.greeting),
      ...strings(source.paragraphs), line(source.closing), title].filter(Boolean);
    model.title = ((title || 'Saved') + ' cover letter').slice(0, 120);
    model.pages[0].blocks = lines.map((value, index) => paragraph(value, index === 0));
    return model;
  }

  /** Restyle a copy of the actual selected saved model; every text run and object identity stays unchanged. */
  function styled(source, style) {
    if (!['ats', 'professional'].includes(style)) throw Error('Choose ATS or Professional style.');
    const model = copy(source);
    if (model.kind !== 'docx') throw Error('Choose a saved Word résumé.');
    if (style === 'ats') return model;
    model.margins = {top: 36, right: 36, bottom: 36, left: 36};
    for (const page of model.pages) for (const block of page.blocks) {
      if (block.type !== 'paragraph') continue;
      const heading = ['title', 'heading1'].includes(block.style);
      for (const run of block.runs) run.style = {...run.style, fontFamily: heading ? 'Georgia' : 'Calibri',
        fontSize: block.style === 'title' ? 23 : block.style === 'heading1' ? 10.5 : 10,
        color: heading ? '#16304f' : '#23303c'};
      block.lineHeight = 1.3;
    }
    return model;
  }

  function fromPacket(packet, kind, style = 'ats') {
    if (!packet || typeof packet !== 'object' || !['resume', 'cover'].includes(kind)) throw Error('Choose a saved résumé or cover letter.');
    if (packet.meta && (typeof packet.meta !== 'object' || Array.isArray(packet.meta)
      || ['name', 'company', 'title'].some(key => packet.meta[key] != null && typeof packet.meta[key] !== 'string'))) throw Error('This saved packet has unreadable identity details.');
    if (kind === 'cover' && style !== 'ats') throw Error('Professional style is available for the résumé.');
    return styled(kind === 'resume' ? resume(packet) : cover(packet), style);
  }
  const api = {fromPacket, styled};
  root.CareerExportModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}
