"use strict";
/**
 * Switchboard variant reply — what one per-platform rewrite request to the comms bot came back as.
 *
 * The composer asks the bot for the post text, or one line `DECLINED: <why>` when there is nothing to rewrite.
 * A rewrite becomes the variant's editable text. The bot declining (the DECLINED line, a JSON `{"ok": false}`
 * answer, or a reply that opens by refusing the drafting task — "I can't draft…", "I cannot publish to
 * Facebook…" — and carries no sign of being a post) comes back as a notice the surface shows as a warning,
 * never as post text. A post that merely opens like a refusal keeps its text: dropping a real draft and
 * telling the person the bot wrote nothing is the worse failure, because nothing is published unreviewed.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: read the comms bot's variant reply as a rewrite or a decline. Live, the bot's refusals ("I can't draft the post without the underlying content…", "I cannot publish to Facebook from this environment.") were stored verbatim as post variants in Compose and Streams.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The answer shape is plain text with a `DECLINED: <why>` line, not JSON: live, asked for {ok, text} the comms bot sometimes refused the JSON format itself ("The task requires a plain prose answer…"), and its escape hatch declined ordinary texts. A JSON answer is still read.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A refusal opening is a decline only when it refuses the drafting task itself (draft/write/rewrite… a post or text, publish to a network, a bare "help with that", "complete this request"). Any "can't/won't/unable to" + help/make/share/post declined real posts ("I can't help but smile…", "Unable to make it to DevCon?", "I won't share every detail yet…") and Compose said the bot had not written them.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A real post that opens like a refusal of the drafting task is a rewrite. Posts such as "I cannot publish this without thanking the team: the new board is live.", "I can't write a better post than this one: the new board is live." and "Unable to publish on LinkedIn from your phone? The new board fixes that." were still dropped as failed:'bot_declined' and Compose said the bot had not written them. A refusal opening is now a decline only when the reply carries none of the post signs: the source text's own topic words (two, or the one it has), a hashtag, a link, or a bare "Unable to …?" hook. The DECLINED line must be upper case, as the prompt writes it, so a post that opens "Declined: …" is kept; a JSON answer with text and no ok:false is a rewrite.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | A refusal that names the author's topic is a decline again. Seq 4 counted the source's topic words anywhere in the reply, so refusals that repeat the subject ("I can't write a post about the ticket board without knowing what changed.", "I can't write a hiring post from a single word.", "…: \"sweep5 test draft\" is a placeholder.", one quoting the source's link) were kept as editable variants with Publish. Post signs are now read only outside the refused clause and quoted spans; a reply that states what it lacks ("without knowing…", "need more details", "from a single word", "placeholder", "the text says…") is a decline unless it adds a hashtag or link the source did not have; topic words need two shared (a one-word source gives no topic sign); a link or hashtag the source already had is a post sign only without such a reason.
 *
 * @module switchboard-variant-reply
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VARIANT_ANSWER_SHAPE = exports.DECLINE_SENTINEL = void 0;
exports.opensAsDecline = opensAsDecline;
exports.isDecline = isDecline;
exports.readVariantReply = readVariantReply;
/** Longest notice carried back to the surface. */
const NOTICE_MAX = 500;
/** How a refusal opens: "I can't", "I cannot", "I won't", "I'm unable to", a bare "Unable to", after an optional
 * "Sorry," / "Unfortunately,". */
const REFUSAL_SUBJECT = "(?:sorry[,.!]?\\s*|unfortunately,?\\s*)?(?:i(?:\\s+(?:can(?:no|['’])t|cannot|won['’]t|will\\s+not"
    + "|am\\s+(?:unable|not\\s+able)\\s+to)|['’]m\\s+(?:unable|not\\s+able)\\s+to)|unable\\s+to)\\s+";
/** What a bot refuses when it declines the rewrite: the drafting task itself, never any act. A post that opens
 * "I can't help but smile…", "Unable to make it to DevCon?" or "I won't share every detail yet…" refuses something
 * else and is a rewrite, so the act alone ("help", "make", "share", "post") never makes a decline. */
const REFUSED_TASK = [
    // "I can't draft the post…", "I'm unable to rewrite this text", "I won't create content for this request"
    "(?:draft|write|rewrite|compose|create|generate|produce|provide|adapt)\\s+(?:(?:this|that|the|a|an|your|any)\\s+)?"
        + '(?:[\\w-]+\\s+){0,2}?(?:post|text|content|variant|draft|version|rewrite|tweet|caption|copy)\\b',
    // "I cannot publish to Facebook from this environment."
    '(?:publish|post)\\s+(?:(?:this|that|it|anything)\\b|(?:to|on)\\s+(?:x|twitter|linkedin|facebook|instagram|threads|social)\\b)',
    // "Sorry, I can't help with that." / "I can't assist." — the whole reply, not "help but…" or "help with the move"
    '(?:help|assist)(?:\\s+(?:you\\s+)?with\\s+(?:this|that)(?:\\s+(?:request|task))?)?\\s*(?:[.!]|$)',
    // "I am not able to complete this request."
    '(?:do|complete|fulfil|fulfill|comply\\s+with)\\s+(?:this|that|the|your)\\s+(?:request|task)\\b',
].join('|');
/** A reply that opens as the bot declining the drafting task rather than writing a post. */
const DECLINE_OPENING = new RegExp(`^${REFUSAL_SUBJECT}(?:${REFUSED_TASK})`, 'i');
/** The line a bot answers with instead of a post when there is nothing to rewrite. */
exports.DECLINE_SENTINEL = 'DECLINED:';
/** The instruction appended to every variant prompt: the answer shape the reader expects. Plain text, because the
 * comms bot's persona answers in prose (asked for JSON it sometimes refused the format itself). */
exports.VARIANT_ANSWER_SHAPE = [
    'Answer with ONLY the post text: no preamble, no quotes, no notes.',
    'Write the post whenever the text below says anything at all; a short text makes a short post. Only when the text',
    `has nothing to rewrite (empty, or a bare placeholder), answer one line: ${exports.DECLINE_SENTINEL} <one sentence why>.`,
    'You are only drafting text for the author to review; nothing is published, so never say you cannot publish.',
].join('\n');
/** @description Whether the text opens as a refusal. @param text - Reply text. @returns True for a decline. */
function opensAsDecline(text) {
    return DECLINE_OPENING.test(text.trim());
}
/** Words that say nothing about what a text is about: the drafting vocabulary a refusal uses, the network
 * names, and common words, so "I can't draft the post…" never matches a source text about posting. */
const NEUTRAL_WORDS = new Set([
    'draft', 'drafting', 'write', 'writing', 'written', 'rewrite', 'rewriting', 'post', 'posting', 'text', 'content',
    'publish', 'published', 'publishing', 'variant', 'version', 'copy', 'caption', 'tweet', 'platform', 'network',
    'social', 'request', 'task', 'placeholder', 'empty', 'twitter', 'linkedin', 'facebook', 'instagram', 'thread',
    'this', 'that', 'with', 'from', 'without', 'your', 'have', 'will', 'about', 'there', 'their', 'they', 'them',
    'then', 'than', 'what', 'when', 'which', 'here', 'into', 'just', 'only', 'more', 'some', 'also', 'been', 'were',
    'would', 'could', 'should', 'cannot', 'these', 'those', 'over', 'after', 'before', 'because', 'while', 'where',
    'please', 'sorry', 'unable', 'able', 'help', 'share', 'need', 'want', 'like', 'make',
]);
/** @description A text's topic words: four letters or more, plural folded, neutral words dropped.
 * @param text - Any text. @returns The words. */
function topicWords(text) {
    const words = String(text).toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/);
    const out = new Set();
    for (const word of words) {
        const w = word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
        if (w.length >= 4 && !NEUTRAL_WORDS.has(w))
            out.add(w);
    }
    return out;
}
/** A bare "Unable to …?" opening is a hook ("Unable to make it to DevCon?"); a refusal states, it does not ask. */
const QUESTION_HOOK = /^unable\s+to\b[^.!?\n]*\?/i;
/** A hashtag (every platform prompt asks for some) or a link: what a post carries and a refusal rarely does. */
const POST_MARK = /(?:^|\s)(#[A-Za-z][\w-]*)|(https?:\/\/[^\s"'”’)<>]+)/g;
/** A refusal saying what it lacks or asks for: "without knowing what changed", "I need more details", "from a single
 * word", "from just a link", "is a placeholder", "the text says…", "share the details". A post that opens like a
 * refusal ("I cannot publish this without thanking the team…") says none of these. */
const REFUSAL_REASON = new RegExp([
    '\\bwithout\\s+(?:knowing|(?:more|any|enough|further|additional|some)\\s+(?:details?|context|information|info|specifics|content|input)'
        + '|the\\s+(?:underlying|actual|original|full|real)\\s+\\w+)',
    '\\b(?:need|needs|require|requires)\\s+(?:more|some|additional|further|actual|real|specific)\\b',
    '\\b(?:more|additional|further)\\s+(?:details?|context|information|info|specifics)\\b',
    '\\bfrom\\s+(?:just\\s+|only\\s+)?(?:a|one|the|this)\\s+(?:single\\s+)?(?:word|link|url|phrase|title|line)\\b',
    '\\bplaceholder\\b',
    '\\b(?:the|your|this)\\s+(?:text|draft|source|input|message|note)\\s+(?:says|is\\s+only|only|contains|has\\s+no|reads|looks)\\b',
    '\\b(?:share|send|provide|give|paste)\\s+(?:me\\s+)?(?:the|more|some|your)\\s+(?:details?|context|information|key\\s+points|draft|text|content)\\b',
].join('|'), 'i');
/** Quoted spans: a refusal quoting the author's text names its topic without writing about it. Typographic single
 * quotes only, because a plain apostrophe is part of "can't". */
const QUOTED = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g;
/** @description The hashtags and links a text carries, lower-cased. @param text - Any text. @returns The marks. */
function postMarks(text) {
    const out = new Set();
    for (const m of String(text).matchAll(POST_MARK))
        out.add((m[1] || m[2]).toLowerCase().replace(/[.,;:!?]+$/, ''));
    return out;
}
/** @description Whether a reply's own words carry the source: two of its topic words (a one-word source gives no
 * topic sign, since a refusal naming that word is the usual reply to it).
 * @param body - The reply outside its refused clause and quotes. @param source - The author's text. @returns True when they do. */
function carriesSource(body, source) {
    const have = topicWords(body);
    let shared = 0;
    for (const word of topicWords(source))
        if (have.has(word))
            shared += 1;
    return shared >= 2;
}
/**
 * @description Whether a reply is the bot declining rather than a post that opens like a refusal. A reply opening by
 * refusing the drafting task is a post only by what it says outside the refused clause and its quotes: a hashtag or
 * link the source did not have; else, when it gives no reason (what it lacks or asks for), the source's own marks or
 * two of its topic words. A bare "Unable to …?" opening is a question hook.
 * @param text - The trimmed reply. @param source - The author's text the bot was asked to rewrite.
 * @returns True for a decline.
 */
function isDecline(text, source = '') {
    const opening = DECLINE_OPENING.exec(text.trim());
    if (!opening || QUESTION_HOOK.test(text))
        return false;
    const body = text.trim().slice(opening[0].length).replace(QUOTED, ' ');
    const sourceMarks = postMarks(source);
    const marks = [...postMarks(body)];
    if (marks.some((mark) => !sourceMarks.has(mark)))
        return false;
    if (REFUSAL_REASON.test(body))
        return true;
    return !marks.length && !carriesSource(body, source);
}
/** @description A bounded notice from the bot's words. @param text - Words. @returns Notice. */
function notice(text) {
    const t = text.trim() || 'The bot did not write this variant.';
    return t.length > NOTICE_MAX ? `${t.slice(0, NOTICE_MAX - 1)}…` : t;
}
/**
 * @description The JSON object a reply carries, alone or in one code fence; null when it carries none.
 * @param reply - The bot's reply.
 * @returns The parsed object, or null.
 */
function jsonAnswer(reply) {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(reply.trim());
    const body = (fenced ? fenced[1] : reply).trim();
    if (!body.startsWith('{'))
        return null;
    try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * @description Read one variant reply as a rewrite or a decline.
 * @param reply - The comms bot's reply to a variant prompt.
 * @param source - The author's text the bot was asked to rewrite (its topic words mark a reply as a post).
 * @returns `{text}` for a rewrite, `{declined}` (the bot's words) when it did not rewrite.
 */
function readVariantReply(reply, source = '') {
    const raw = String(reply ?? '');
    const answer = jsonAnswer(raw);
    if (answer) {
        const text = typeof answer.text === 'string' ? answer.text.trim() : '';
        if (answer.ok !== false && text && !isDecline(text, source))
            return { text, declined: null };
        const reason = typeof answer.reason === 'string' ? answer.reason : text;
        return { text: null, declined: notice(reason) };
    }
    const text = raw.trim();
    if (text.startsWith(exports.DECLINE_SENTINEL))
        return { text: null, declined: notice(text.slice(exports.DECLINE_SENTINEL.length)) };
    if (!text || isDecline(text, source))
        return { text: null, declined: notice(text) };
    return { text, declined: null };
}
