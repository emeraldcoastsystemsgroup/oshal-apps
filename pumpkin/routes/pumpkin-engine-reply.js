"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:36:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: tolerant parser for the pumpkin-bot reply envelope {say, expression, intensity}. Strips fences, pulls the first JSON object, allowlists the expression, clamps intensity, and always yields a speakable line (in-character fallback) so the prop never goes silent on a malformed reply.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePumpkinReply = parsePumpkinReply;
const EXPRESSIONS = ['neutral', 'happy', 'mischief', 'spooky', 'angry', 'laugh', 'surprised'];
/** An in-character line for when the bot reply can't be reached or parsed — the prop stays alive. */
const FALLBACK_LINE = 'Heh heh... the candle flickers, and my thoughts wander. Ask me again, little one.';
/** Longest spoken line; a wordy model gets trimmed to a boundary, never chopped mid-word. */
const MAX_SPOKEN = 280;
/**
 * Clean + length-cap a spoken line WITHOUT cutting mid-word. Strips markdown, then, if over the cap,
 * trims to the last sentence end (preferred) or the last space so the pumpkin never bites off a
 * half-word like "...Happy Halloween, tiny".
 */
function capSpoken(raw) {
    const s = raw.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
    if (s.length <= MAX_SPOKEN)
        return s;
    const head = s.slice(0, MAX_SPOKEN);
    const sentEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    if (sentEnd >= MAX_SPOKEN * 0.5)
        return head.slice(0, sentEnd + 1).trim();
    const sp = head.lastIndexOf(' ');
    return (sp > 0 ? head.slice(0, sp) : head).trim();
}
/** Extract the first balanced {...} JSON object from a noisy string, or null. */
function firstJsonObject(text) {
    const start = text.indexOf('{');
    if (start < 0)
        return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc)
                esc = false;
            else if (ch === '\\')
                esc = true;
            else if (ch === '"')
                inStr = false;
        }
        else if (ch === '"')
            inStr = true;
        else if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return text.slice(start, i + 1);
        }
    }
    return null;
}
/**
 * @description Parse pumpkin-bot's raw reply into a safe, always-speakable PumpkinReply. Tolerates
 * markdown fences and surrounding prose, allowlists the expression, clamps intensity to [0,1], caps
 * the spoken line, and returns an in-character fallback rather than an empty line on any failure.
 * @param raw - The bot's raw response text.
 * @returns A validated reply the projector can speak + animate.
 */
function parsePumpkinReply(raw) {
    const text = String(raw || '').trim();
    const block = firstJsonObject(text);
    let say = '';
    let expression = 'neutral';
    let intensity = 0.5;
    if (block) {
        try {
            const obj = JSON.parse(block);
            if (typeof obj.say === 'string')
                say = obj.say.trim();
            if (typeof obj.expression === 'string' && EXPRESSIONS.includes(obj.expression)) {
                expression = obj.expression;
            }
            if (typeof obj.intensity === 'number' && Number.isFinite(obj.intensity)) {
                intensity = Math.min(1, Math.max(0, obj.intensity));
            }
        }
        catch {
            /* fall through to fallback below */
        }
    }
    // If the bot ignored the contract entirely, speak whatever prose it produced (capped), else fallback.
    if (!say)
        say = block ? FALLBACK_LINE : text || FALLBACK_LINE;
    say = capSpoken(say) || FALLBACK_LINE;
    return { say, expression, intensity };
}
//# sourceMappingURL=pumpkin-engine-reply.js.map