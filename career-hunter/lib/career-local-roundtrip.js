/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | S-6 (1.52.0): Local editing export and version-preserving import for the master resume. Builds a valid OpenDocument Text (.odt) archive and structured text from the master resume via career-resume-office.js, and parses edited .odt or text back into whitelisted master resume fields for base-save (preserving the previous snapshot in backups/ and enrichment_log.jsonl).
 */
'use strict';

const zlib = require('node:zlib');
const office = require('../tools/career-resume-office.js');

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const SECTION_NAMES = new Map(
  Object.entries(office.SECTIONS).map(([key, label]) => [label.toLowerCase(), { key, label }]),
);

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value) {
  return String(value == null ? '' : value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function roleLine(role) {
  return [role && role.title, role && role.org].filter(Boolean).join(' — ');
}

function resumeToText(resume, meta) {
  const model = office.resumeToModel(resume || {}, meta || {});
  const blocks = (model.pages && model.pages[0] && model.pages[0].blocks) || [];
  const lines = [];
  for (const block of blocks) {
    const text = (block.runs || []).map((r) => r.text).join('').trim();
    if (block.style === 'title') {
      if (text) lines.push(`# ${text}`, '');
    } else if (block.style === 'heading1') {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(`# ${text}`);
    } else if (block.style === 'heading2') {
      lines.push(`## ${text}`);
    } else if (block.list === 'bullet') {
      if (text) lines.push(`- ${text}`);
    } else if (text) {
      lines.push(text);
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

function matchSectionHeading(rawLine) {
  const cleaned = rawLine.replace(/^#+\s*/, '').replace(/:$/, '').trim();
  const hit = SECTION_NAMES.get(cleaned.toLowerCase());
  return hit ? hit.label : null;
}

function isRoleHeadingLine(rawLine, knownRoleLines, hasHeadingPrefix) {
  const cleaned = rawLine.replace(/^#+\s*/, '').trim();
  if (!cleaned || /^[-*•]\s+/.test(rawLine)) return false;
  if (hasHeadingPrefix) return true;
  if (knownRoleLines.has(cleaned.toLowerCase())) return true;
  return cleaned.includes(' — ');
}

function textToModel(text, masterResume, meta) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const roles = Array.isArray(masterResume && masterResume.experience) ? masterResume.experience : [];
  const knownRoles = new Set(roles.map((r) => roleLine(r).toLowerCase()).filter(Boolean));
  const knownSpans = new Set(roles.map((r) => String((r && r.span) || '').trim().toLowerCase()).filter(Boolean));
  const ownerName = String((meta && meta.name) || '').trim().toLowerCase();
  const blocks = [];
  let section = null;
  let justSawRole = false;
  const pushPara = (val, style = 'normal', list = 'none') => {
    blocks.push({ id: `b-${blocks.length}`, type: 'paragraph', style, list, runs: [{ text: val, style: {} }] });
  };
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const secLabel = matchSectionHeading(trimmed);
    if (secLabel) {
      section = secLabel.toLowerCase();
      justSawRole = false;
      pushPara(secLabel, 'heading1');
      continue;
    }
    if (!section) {
      const bare = trimmed.replace(/^#+\s*/, '').replace(/^Headline:\s*/i, '').trim();
      if ((/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) || (ownerName && bare.toLowerCase() === ownerName)) {
        pushPara(bare, 'title');
      } else if (bare) {
        pushPara(bare, 'heading2');
      }
      continue;
    }
    if (section === office.SECTIONS.experience.toLowerCase()) {
      const hasH2 = /^#{2,}\s+/.test(trimmed);
      if (isRoleHeadingLine(trimmed, knownRoles, hasH2)) {
        pushPara(trimmed.replace(/^#+\s*/, '').trim(), 'heading2');
        justSawRole = true;
        continue;
      }
      const cleanSpan = trimmed.replace(/^Span:\s*/i, '').trim();
      if (justSawRole && !/^[-*•]\s+/.test(trimmed) && (knownSpans.has(cleanSpan.toLowerCase()) || /^\d{4}\b/.test(cleanSpan))) {
        pushPara(cleanSpan, 'normal', 'none');
        justSawRole = false;
        continue;
      }
      justSawRole = false;
      pushPara(trimmed.replace(/^[-*•]\s*/, '').trim(), 'normal', 'bullet');
      continue;
    }
    if (section === office.SECTIONS.competencies.toLowerCase()) {
      pushPara(trimmed.replace(/^[-*•]\s*/, '').trim(), 'normal', 'bullet');
      continue;
    }
    pushPara(trimmed.replace(/^[-*•]\s*/, '').trim(), 'normal', 'none');
  }
  return { version: 1, kind: 'docx', title: office.TITLE, pages: [{ id: 'p-1', name: 'Page 1', blocks }] };
}

function buildOdtContentXml(resume, meta) {
  const model = office.resumeToModel(resume || {}, meta || {});
  const blocks = (model.pages && model.pages[0] && model.pages[0].blocks) || [];
  const body = [];
  for (const block of blocks) {
    const text = xmlEscape((block.runs || []).map((r) => r.text).join('').trim());
    if (block.style === 'title') {
      if (text) body.push(`<text:p text:style-name="Title">${text}</text:p>`);
    } else if (block.style === 'heading1') {
      body.push(`<text:h text:style-name="Heading_20_1" text:outline-level="1">${text}</text:h>`);
    } else if (block.style === 'heading2') {
      body.push(`<text:h text:style-name="Heading_20_2" text:outline-level="2">${text}</text:h>`);
    } else if (block.list === 'bullet') {
      if (text) body.push(`<text:list><text:list-item><text:p text:style-name="List_20_Bullet">${text}</text:p></text:list-item></text:list>`);
    } else {
      body.push(`<text:p text:style-name="Standard">${text}</text:p>`);
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">',
    '<office:body><office:text>',
    ...body,
    '</office:text></office:body></office:document-content>',
  ].join('');
}

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = zlib.crc32(dataBuf) >>> 0;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    localParts.push(local, dataBuf);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);
    offset += local.length + dataBuf.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function resumeToOdtBuffer(resume, meta) {
  const manifestXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">',
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIME}"/>`,
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>',
    '</manifest:manifest>',
  ].join('');
  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"/>',
  ].join('');
  return buildStoredZip([
    { name: 'mimetype', data: ODT_MIME },
    { name: 'META-INF/manifest.xml', data: manifestXml },
    { name: 'styles.xml', data: stylesXml },
    { name: 'content.xml', data: buildOdtContentXml(resume, meta) },
  ]);
}

function extractZipEntryText(zipBuf, targetName) {
  let pos = 0;
  while (pos + 30 <= zipBuf.length && zipBuf.readUInt32LE(pos) === 0x04034b50) {
    const method = zipBuf.readUInt16LE(pos + 8);
    const compSize = zipBuf.readUInt32LE(pos + 18);
    const nameLen = zipBuf.readUInt16LE(pos + 26);
    const extraLen = zipBuf.readUInt16LE(pos + 28);
    const name = zipBuf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8');
    const dataStart = pos + 30 + nameLen + extraLen;
    const raw = zipBuf.subarray(dataStart, dataStart + compSize);
    if (name === targetName) {
      return (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    }
    pos = dataStart + compSize;
  }
  return null;
}

function odtXmlToText(xml) {
  const lines = [];
  const tokenRe = /<(text:h|text:p)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = tokenRe.exec(xml)) !== null) {
    const tag = match[1];
    const attrs = match[2] || '';
    const inner = xmlUnescape(match[3].replace(/<[^>]+>/g, '')).trim();
    if (!inner) continue;
    if (tag === 'text:h') {
      const level = /outline-level="2"/.test(attrs) ? '##' : '#';
      lines.push(`${level} ${inner}`);
    } else if (/List_20_Bullet|List/i.test(attrs)) {
      lines.push(`- ${inner}`);
    } else if (/Title/i.test(attrs)) {
      lines.push(`# ${inner}`);
    } else {
      lines.push(inner);
    }
  }
  return lines.join('\n');
}

function exportMasterResume(masterDoc) {
  const resume = (masterDoc && masterDoc.resume) || {};
  const meta = (masterDoc && masterDoc.meta) || {};
  const odtBuf = resumeToOdtBuffer(resume, meta);
  const text = resumeToText(resume, meta);
  return {
    ok: true,
    app: 'career-hunter',
    itemId: 'master',
    format: 'odt',
    fileName: 'master-resume.odt',
    mimeType: ODT_MIME,
    odtBase64: odtBuf.toString('base64'),
    text,
    resume,
    meta,
  };
}

function prepareMasterImport(input, masterDoc) {
  const priorResume = (masterDoc && masterDoc.resume) || {};
  const meta = (masterDoc && masterDoc.meta) || {};
  const previousText = resumeToText(priorResume, meta);
  if (input && input.resume && typeof input.resume === 'object' && !Array.isArray(input.resume)) {
    const model = office.resumeToModel(input.resume, meta);
    const mapped = office.modelToResume(model, priorResume);
    if (mapped.error) return { ok: false, error: mapped.error, notes: mapped.notes };
    return {
      ok: true,
      resume: mapped.resume,
      notes: mapped.notes,
      changed: !office.sameResume(mapped.resume, priorResume),
      previousText,
      importedText: resumeToText(mapped.resume, meta),
    };
  }
  let sourceText = '';
  if (input && typeof input.odtBase64 === 'string' && input.odtBase64.trim()) {
    const buf = Buffer.from(input.odtBase64.trim(), 'base64');
    const xml = extractZipEntryText(buf, 'content.xml');
    if (!xml) return { ok: false, error: 'The provided .odt archive does not contain a readable content.xml.' };
    sourceText = odtXmlToText(xml);
  } else if (input && typeof input.text === 'string' && input.text.trim()) {
    sourceText = input.text;
  } else if (input && typeof input.markdown === 'string' && input.markdown.trim()) {
    sourceText = input.markdown;
  } else {
    return { ok: false, error: 'Provide edited text, markdown, odtBase64, or resume object to import.' };
  }
  const model = textToModel(sourceText, priorResume, meta);
  const mapped = office.modelToResume(model, priorResume);
  if (mapped.error) return { ok: false, error: mapped.error, notes: mapped.notes };
  return {
    ok: true,
    resume: mapped.resume,
    notes: mapped.notes,
    changed: !office.sameResume(mapped.resume, priorResume),
    previousText,
    importedText: resumeToText(mapped.resume, meta),
  };
}

module.exports = {
  ODT_MIME,
  resumeToText,
  textToModel,
  resumeToOdtBuffer,
  extractZipEntryText,
  odtXmlToText,
  exportMasterResume,
  prepareMasterImport,
};
