"use strict";
/**
 * Little Monsters lecture notes as a PDF.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render a lecture's markdown notes as a PDF (headings, bullets, wrapped paragraphs, page numbers) with the standard Helvetica fonts, so a student can ask for "a summary of the lecture as a PDF". No subprocess and no embedded font: the package runs in a small sandbox.
 * -----------------------------------------------------------------------------
 *
 * @module education-notes-pdf
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderNotesPdf = renderNotesPdf;
exports.notesLines = notesLines;
/** Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM. */
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
    722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278,
    556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const PAGE = { width: 612, height: 792, margin: 54 };
const STYLE = {
    title: { font: 'F2', size: 18, gap: 10 },
    h2: { font: 'F2', size: 14, gap: 8 },
    h3: { font: 'F2', size: 12, gap: 6 },
    body: { font: 'F1', size: 11, gap: 3 },
    bullet: { font: 'F1', size: 11, gap: 2 },
};
const REPLACE = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...',
    '→': '->', '←': '<-', ' ': ' ', '•': '-', '−': '-', '×': 'x', '₂': '2', '₃': '3' };
/** Plain WinAnsi-safe text: markdown emphasis, code ticks and simple LaTeX removed, other characters mapped or dropped. */
function plain(text) {
    return String(text)
        .replace(/\$([^$]*)\$/g, (_, tex) => tex.replace(/[_^]\{?([^}\s]*)\}?/g, '$1').replace(/\\[a-z]+/gi, ''))
        .replace(/\*\*|__|`/g, '')
        .replace(/(^|\s)\*(\S[^*]*)\*/g, '$1$2')
        .replace(/[^\x20-\x7e]/g, (ch) => REPLACE[ch] ?? (ch.charCodeAt(0) >= 0xa0 && ch.charCodeAt(0) <= 0xff ? ch : ''))
        .replace(/\s+/g, ' ')
        .trim();
}
/** Width of a string in points for the given size (bold is a little wider). */
function width(text, size, bold) {
    let units = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        units += code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
    }
    return (units * size * (bold ? 1.06 : 1)) / 1000;
}
/** Break one paragraph into lines that fit `room` points. */
function wrap(text, size, bold, room) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (width(next, size, bold) <= room || !line) line = next;
        else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
}
/**
 * @description Lay the notes out as styled lines (style, x indent and text), wrapping each block.
 * @param {string} title Document title.
 * @param {string} markdown Lecture notes.
 * @returns {{style: string, indent: number, text: string}[]} Laid-out lines.
 */
function notesLines(title, markdown) {
    const out = [];
    const room = PAGE.width - PAGE.margin * 2;
    const push = (style, text, indent = 0, lead = '') => {
        const s = STYLE[style];
        const body = plain(text);
        if (!body) return;
        wrap(body, s.size, s.font === 'F2', room - indent - (lead ? 12 : 0)).forEach((line, i) => {
            out.push({ style, indent: indent + (lead && i > 0 ? 12 : 0), text: (lead && i === 0 ? `${lead} ` : '') + line });
        });
    };
    push('title', title);
    for (const raw of String(markdown || '').split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, '');
        const bullet = line.match(/^(\s*)[*\-+]\s+(.*)$/);
        const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
        if (/^#\s/.test(line)) { if (plain(line.slice(2)) !== plain(title)) push('h2', line.slice(2)); }
        else if (/^##\s/.test(line)) push('h2', line.slice(3));
        else if (/^#{3,6}\s/.test(line)) push('h3', line.replace(/^#+\s/, ''));
        else if (bullet) push('bullet', bullet[2], Math.min(36, 12 + Math.floor(bullet[1].length / 2) * 12), '-');
        else if (numbered) push('bullet', numbered[3], Math.min(36, 12 + Math.floor(numbered[1].length / 2) * 12), `${numbered[2]}.`);
        else if (line.trim()) push('body', line);
    }
    return out;
}
/** Escape a PDF literal string. */
function literal(text) {
    return `(${text.replace(/[\\()]/g, (ch) => `\\${ch}`)})`;
}
/** Split laid-out lines into pages of drawing operations. */
function pages(title, lines) {
    const result = [];
    let ops = [];
    let y = PAGE.height - PAGE.margin;
    for (const line of lines) {
        const s = STYLE[line.style];
        const step = s.size * 1.35 + (line.style === 'body' || line.style === 'bullet' ? 0 : s.gap);
        if (y - step < PAGE.margin + 24) { result.push(ops); ops = []; y = PAGE.height - PAGE.margin; }
        y -= step;
        ops.push(`BT /${s.font} ${s.size} Tf ${PAGE.margin + line.indent} ${y.toFixed(2)} Td ${literal(line.text)} Tj ET`);
    }
    result.push(ops);
    return result.map((page, i) => page.concat(
        `BT /F1 9 Tf ${PAGE.margin} ${PAGE.margin - 18} Td ${literal(`${plain(title)} - page ${i + 1} of ${result.length}`)} Tj ET`));
}
/**
 * @description Render lecture notes (markdown) as a PDF document.
 * @param {string} title Document title shown at the top and in the footer.
 * @param {string} markdown The notes.
 * @returns {Buffer} The PDF bytes.
 */
function renderNotesPdf(title, markdown) {
    const drawn = pages(title, notesLines(title, markdown));
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const catalog = add('');
    const tree = add('');
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of drawn) {
        const stream = Buffer.from(ops.join('\n'), 'latin1');
        const content = add(`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] `
            + `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
    objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
        + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
        + `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
}
