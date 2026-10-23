/**
 * Little Monsters book chapters: find a numbered chapter in a class book's text.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Locate chapter N of a book's extracted text so a student can ask for "flashcards and a lesson summary from chapter 2 of my math book". Headings are "Chapter 2 ..." lines or a number followed by an upper-case title ("2   THE LANGUAGE OF ALGEBRA"); table-of-contents lines (a title ending in a page number) are not headings; with no chapter headings, numbered sections (2.1 ...) mark the chapter. A book whose text has neither answers not-found with the headings it does have, never a guessed passage. A "Chapter 2" line alone takes the next line as its title; running page headers ("4   TABLE OF CONTENTS") are not chapters.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A chapter longer than the answer's budget is given as an even share of each of its numbered sections (2.1, 2.2, ...) with every section heading, not just its opening: a lesson summary of Prealgebra 2e chapter 2 covered only part of 2.1. The answer names the chapter's sections.
 * -----------------------------------------------------------------------------
 *
 * @module education-book-chapters
 */

/** One chapter heading found in a book's text. */
export interface ChapterHeading {
    number: number;
    title: string;
    line: number;
}

/** The answer for one requested chapter. */
export interface ChapterSlice {
    found: boolean;
    number: number;
    heading?: string;
    text?: string;
    truncated?: boolean;
    sections?: string[];
    chapters: string[];
}

/** The most chapter text one answer carries (a model reads it whole). */
export const CHAPTER_TEXT_CHARS = 12000;
/** The most headings a not-found answer lists. */
const LISTED_HEADINGS = 40;

const CHAPTER_WORD = /^\s*chapter\s+(\d{1,2})\b[\s:.\-–—]*(.*)$/i;
const NUMBERED_TITLE = /^\s*(\d{1,2})\s{2,}([A-Z][A-Z0-9 ,'&:()\-–—]{3,})\s*$/;
const PAGE_NUMBER_END = /\S\s+\d{1,4}\s*$/;
/** Running page headers that look like numbered titles ("4   TABLE OF CONTENTS"). */
const NOT_A_TITLE = /^(TABLE OF )?CONTENTS$|^INDEX$/i;

/** A chapter heading on one line, or null; a contents line ending in a page number is not one. */
function headingOf(line: string): { number: number; title: string } | null {
    const word = CHAPTER_WORD.exec(line);
    if (word) {
        if (word[2] && PAGE_NUMBER_END.test(line)) return null;
        return { number: Number(word[1]), title: word[2].trim() };
    }
    const numbered = NUMBERED_TITLE.exec(line);
    if (!numbered || NOT_A_TITLE.test(numbered[2].trim())) return null;
    return { number: Number(numbered[1]), title: numbered[2].trim() };
}

/**
 * @description Every chapter heading in the text, in order.
 * @param {string} text A book's extracted text.
 * @returns {ChapterHeading[]} The headings with their line numbers.
 */
export function chapterHeadings(text: string): ChapterHeading[] {
    const found: ChapterHeading[] = [];
    const lines = String(text || '').split(/\r?\n/);
    lines.forEach((line, index) => {
        const heading = headingOf(line);
        if (!heading || heading.number <= 0) return;
        // "Chapter 2" alone on its line takes the next non-empty line as its title.
        const next = heading.title ? '' : lines.slice(index + 1, index + 4).find((l) => l.trim()) || '';
        const title = heading.title || (next.trim().length <= 80 && !/^\d/.test(next.trim()) ? next.trim() : '');
        found.push({ number: heading.number, title, line: index });
    });
    return found;
}

/** Title-case an upper-case heading for reading ("THE LANGUAGE OF ALGEBRA" -> "The Language Of Algebra"). */
function readable(title: string): string {
    return title === title.toUpperCase() ? title.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : title;
}

/** The longest span starting at one of `starts` and ending at the first later line in `ends` (or the end). */
function longestSpan(starts: number[], ends: number[], lineCount: number): [number, number] | null {
    let best: [number, number] | null = null;
    for (const start of starts) {
        const end = ends.find((line) => line > start) ?? lineCount;
        if (!best || end - start > best[1] - best[0]) best = [start, end];
    }
    return best;
}

/** Chapter N's line span: by chapter headings first, else by its numbered sections (N.1 to N+1.1). */
function chapterSpan(lines: string[], headings: ChapterHeading[], n: number): { span: [number, number]; title: string } | null {
    const own = headings.filter((h) => h.number === n);
    if (own.length) {
        const later = headings.filter((h) => h.number > n).map((h) => h.line);
        const span = longestSpan(own.map((h) => h.line), later, lines.length);
        const title = own.find((h) => h.line === span?.[0])?.title || '';
        return span ? { span, title } : null;
    }
    const section = new RegExp(`^\\s*${n}\\.1\\s+[A-Z]`);
    const next = new RegExp(`^\\s*${n + 1}\\.1\\s+[A-Z]`);
    const starts = lines.flatMap((line, i) => (section.test(line) && !PAGE_NUMBER_END.test(line) ? [i] : []));
    const ends = lines.flatMap((line, i) => (next.test(line) && !PAGE_NUMBER_END.test(line) ? [i] : []));
    const span = longestSpan(starts, ends, lines.length);
    return span ? { span, title: '' } : null;
}

/**
 * The chapter's numbered sections (n.1, n.2, ...) as [title, start line] in order, contents lines excluded. A section
 * named twice (a chapter outline, then the section itself) is the occurrence with the most text before the next one.
 */
function sectionsOf(lines: string[], n: number): Array<[string, number]> {
    const section = new RegExp(`^\\s*(${n}\\.\\d{1,2})\\s+([A-Z].{2,})$`);
    const all: Array<{ key: string; title: string; line: number }> = [];
    lines.forEach((line, i) => {
        const match = section.exec(line);
        if (match && !PAGE_NUMBER_END.test(line)) all.push({ key: match[1], title: `${match[1]} ${match[2].trim()}`, line: i });
    });
    const best = new Map<string, { title: string; line: number; length: number }>();
    all.forEach((hit, i) => {
        const length = lines.slice(hit.line, all[i + 1]?.line ?? lines.length).join('\n').length;
        const kept = best.get(hit.key);
        if (!kept || length > kept.length) best.set(hit.key, { title: hit.title, line: hit.line, length });
    });
    return [...best.values()].sort((a, b) => a.line - b.line).map((hit): [string, number] => [hit.title, hit.line]);
}

/** Collapse runs of spaces and blank lines. */
function tidy(text: string): string {
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** A chapter body within `maxChars`: whole when it fits, else an even share of each section after the opening. */
function fitted(lines: string[], sections: Array<[string, number]>, maxChars: number): string {
    const whole = tidy(lines.join('\n'));
    if (whole.length <= maxChars || sections.length < 2) return whole.slice(0, maxChars);
    const starts = [0, ...sections.map(([, line]) => line)];
    const parts = starts.map((start, i) => tidy(lines.slice(start, starts[i + 1] ?? lines.length).join('\n')));
    // Equal shares, with what a short part leaves over handed to the longer ones.
    const budget = maxChars - 8 * parts.length;
    const shares = parts.map(() => 0);
    let open = parts.map((_, i) => i);
    let left = budget;
    while (open.length && left > open.length) {
        const share = Math.floor(left / open.length);
        open.forEach((i) => { const take = Math.min(share, parts[i].length - shares[i]); shares[i] += take; left -= take; });
        open = open.filter((i) => shares[i] < parts[i].length);
    }
    return parts.map((part, i) => part.slice(0, shares[i])).join('\n[...]\n').slice(0, maxChars);
}

/**
 * @description Find chapter `n` of a book's text: its heading and up to CHAPTER_TEXT_CHARS of its text, or
 * not found with the chapter headings the text does carry.
 * @param {string} text A book's extracted text.
 * @param {number} n The chapter number asked for.
 * @param {number} maxChars The most text to return.
 * @returns {ChapterSlice} The chapter, or not found.
 */
export function findChapter(text: string, n: number, maxChars: number = CHAPTER_TEXT_CHARS): ChapterSlice {
    const lines = String(text || '').split(/\r?\n/);
    const headings = chapterHeadings(text);
    const listed = [...new Map(headings.map((h) => [h.number, `${h.number} ${readable(h.title)}`.trim()])).values()]
        .slice(0, LISTED_HEADINGS);
    const located = Number.isInteger(n) && n > 0 ? chapterSpan(lines, headings, n) : null;
    if (!located) return { found: false, number: n, chapters: listed };
    const chapterLines = lines.slice(located.span[0], located.span[1]);
    const sections = sectionsOf(chapterLines, n);
    const whole = tidy(chapterLines.join('\n'));
    return {
        found: true,
        number: n,
        heading: `Chapter ${n}${located.title ? `: ${readable(located.title)}` : ''}`,
        text: fitted(chapterLines, sections, maxChars),
        truncated: whole.length > maxChars,
        sections: sections.map(([title]) => title),
        chapters: listed,
    };
}
