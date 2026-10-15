"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read the deck-builder's slide outline out of its reply. Sweep 10: a reply cut off at the model's output budget failed the AI draft with the raw parser text "Unterminated string in JSON at position 4444". A cut-off array keeps its complete slides when at least half the requested slides survived; otherwise, and for a reply with no outline, the refusal says what happened in plain words.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutlineError = exports.OUTLINE_MISSING = exports.OUTLINE_CUT_OFF = void 0;
exports.parseOutline = parseOutline;
/** The plain words a cut-off outline is refused with. */
exports.OUTLINE_CUT_OFF = "The deck builder's outline came back cut off, so no deck was made. Try again, or ask for fewer slides.";
/** The plain words a reply with no outline is refused with. */
exports.OUTLINE_MISSING = 'The deck builder did not return a slide outline, so no deck was made. Try again.';
/** A refusal the route answers with its own words and code instead of a parser message. */
class OutlineError extends Error {
    code;
    constructor(code, message) { super(message); this.code = code; }
}
exports.OutlineError = OutlineError;
/**
 * @description The end offset of every complete top-level object inside the array that starts at `start`, scanning
 * strings and escapes so a bracket inside a slide's text never counts.
 * @param text - The reply.
 * @param start - The offset of the array's opening bracket.
 * @returns The offsets just past each complete top-level object, in order, and the offset just past the array's
 * closing bracket (0 when the array never closes).
 */
function objectEnds(text, start) {
    const ends = [];
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (c === '\\')
                escaped = true;
            else if (c === '"')
                inString = false;
        }
        else if (c === '"')
            inString = true;
        else if (c === '[' || c === '{')
            depth++;
        else if (c === ']' || c === '}') {
            depth--;
            if (c === '}' && depth === 1)
                ends.push(i + 1);
            if (depth === 0)
                return { ends, close: i + 1 };
        }
    }
    return { ends, close: 0 };
}
/**
 * @description Only slide objects with a title count as an outline.
 * @param value - A parsed JSON value.
 * @returns The slides, or null when the value is not an outline.
 */
function slidesOf(value) {
    if (!Array.isArray(value) || !value.length)
        return null;
    const slides = value.filter((s) => !!s && typeof s === 'object' && typeof s.title === 'string');
    return slides.length ? slides : null;
}
/**
 * @description Parse JSON text, answering null instead of throwing.
 * @param text - The candidate JSON.
 * @returns The parsed value, or null.
 */
function tryParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
/**
 * @description The slide outline in a deck-builder reply. A whole array is used as is. An array cut off before its
 * closing bracket keeps its complete slides when at least half of the requested slides (rounded up) survived;
 * otherwise it is refused as cut off. A reply with no array of titled slides is refused as missing.
 * @param reply - The bot's reply text.
 * @param requested - How many slides were asked for.
 * @returns The slides and whether the end was cut off.
 * @throws OutlineError with code outline_cut_off or outline_missing and plain words.
 */
function parseOutline(reply, requested) {
    const text = String(reply || '');
    const start = text.indexOf('[');
    if (start < 0)
        throw new OutlineError('outline_missing', exports.OUTLINE_MISSING);
    const { ends, close } = objectEnds(text, start);
    if (close) {
        const whole = slidesOf(tryParse(text.slice(start, close)));
        if (whole)
            return { slides: whole, cutOff: false };
    }
    const kept = ends.length ? slidesOf(tryParse(text.slice(start, ends[ends.length - 1]) + ']')) : null;
    if (!kept)
        throw new OutlineError(ends.length ? 'outline_missing' : 'outline_cut_off', ends.length ? exports.OUTLINE_MISSING : exports.OUTLINE_CUT_OFF);
    if (kept.length < Math.ceil(Math.max(requested, 1) / 2))
        throw new OutlineError('outline_cut_off', exports.OUTLINE_CUT_OFF);
    return { slides: kept, cutOff: true };
}
//# sourceMappingURL=outline-json.js.map