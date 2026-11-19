"use strict";
/**
 * Safe mail body, HTML link, and attachment metadata extraction for Intelligent Communication.
 *
 * Dependency-free helper shared by Gmail (email-app-routes) and Outlook / Graph (outlook-mailbox)
 * message detail reads so multipart and HTML emails expose safe http(s) links and attachment
 * metadata alongside the plain-text body.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | Extract safe http(s) HTML anchor links (entity-decoded, deduplicated, bounded, tracking-pixel filtered), plain-text bodies, and MIME attachment metadata for Gmail and Outlook message reads.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeHtmlEntities = decodeHtmlEntities;
exports.decodeBase64Url = decodeBase64Url;
exports.stripHtml = stripHtml;
exports.extractHtmlLinks = extractHtmlLinks;
exports.extractGmailContent = extractGmailContent;
exports.normalizeGraphAttachments = normalizeGraphAttachments;
const MAX_HTML_SCAN = 512 * 1024;
const MAX_LINKS = 30;
const MAX_ATTACHMENTS = 30;
const MAX_URL_LEN = 2048;
const MAX_LABEL_LEN = 200;
const MAX_FILENAME_LEN = 256;
const MAX_MIME_DEPTH = 20;
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};
const ACTIONABLE_URL_RE = /(?:^|[/?&._-])(pay|payment|invoice|billing|checkout|receipt|verify|confirm|reset|download|sign|approve|portal|statement)(?:$|[/?&._-])/i;
const TRACKING_URL_RE = /(?:^|[/?&._-])(pixel|1x1|open\.gif|track\/open|beacon)(?:$|[/?&._-])/i;
/** Decode common named and numeric HTML entities in a single non-recursive pass. */
function decodeHtmlEntities(text) {
    return String(text || '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, named) => {
        if (named)
            return NAMED_ENTITIES[String(named).toLowerCase()] ?? match;
        const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
        const valid = code === 0x09 || code === 0x0a || code === 0x0d
            || (code >= 0x20 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff));
        return valid ? String.fromCodePoint(code) : match;
    });
}
/** Decode base64url payload data to UTF-8 text. */
function decodeBase64Url(data) {
    return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
/** Strip style/script/comments and tags from HTML into normalized readable plain text. */
function stripHtml(html) {
    const cleaned = String(html || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ');
    return decodeHtmlEntities(cleaned).replace(/\s+/g, ' ').trim();
}
/** Extract an HTML attribute value (quoted or unquoted) from an opening tag's attribute string. */
function extractAttr(attrs, name) {
    const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, 'i');
    const m = re.exec(attrs);
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}
/** Validate and normalize an anchor href, allowing only bounded http:// or https:// URLs. */
function normalizeSafeUrl(rawHref) {
    const decoded = decodeHtmlEntities(rawHref).trim();
    if (!decoded || decoded.length > MAX_URL_LEN || /[\u0000-\u001f\u007f]/.test(decoded))
        return null;
    if (!/^https?:\/\//i.test(decoded))
        return null;
    try {
        const parsed = new URL(decoded);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname)
            return null;
        const href = parsed.toString();
        return href.length <= MAX_URL_LEN ? href : null;
    }
    catch {
        return null;
    }
}
/** Detect 1x1 or zero-size tracking pixel anchors so noise links are skipped. */
function isTrackingPixel(innerHtml, url) {
    if (TRACKING_URL_RE.test(url))
        return true;
    if (!/<img\b/i.test(innerHtml))
        return false;
    const tinyWidth = /\bwidth\s*=\s*["']?(?:0|1)(?:px)?["']?/i.test(innerHtml) || /\bwidth\s*:\s*(?:0|1)px\b/i.test(innerHtml);
    const tinyHeight = /\bheight\s*=\s*["']?(?:0|1)(?:px)?["']?/i.test(innerHtml) || /\bheight\s*:\s*(?:0|1)px\b/i.test(innerHtml);
    return tinyWidth && tinyHeight;
}
/** Clean a candidate label string, removing zero-width characters and clamping length. */
function cleanLabel(raw) {
    return decodeHtmlEntities(raw)
        .replace(/[\u200B-\u200D\uFEFF\u00AD\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LABEL_LEN);
}
/** Resolve the best human-readable label for an HTML anchor from inner text, img alt, or attributes. */
function extractAnchorLabel(attrs, innerHtml) {
    const visible = stripHtml(innerHtml).replace(/[\u200B-\u200D\uFEFF\u00AD]+/g, '').trim().slice(0, MAX_LABEL_LEN);
    if (visible)
        return { label: visible, explicit: true };
    const imgMatch = /<img\b([^>]{0,2048})>/i.exec(innerHtml);
    if (imgMatch) {
        const alt = cleanLabel(extractAttr(imgMatch[1], 'alt'));
        if (alt)
            return { label: alt, explicit: true };
    }
    const attrLabel = cleanLabel(extractAttr(attrs, 'aria-label') || extractAttr(attrs, 'title'));
    if (attrLabel)
        return { label: attrLabel, explicit: true };
    return { label: '', explicit: false };
}
/** Build a compact readable fallback label for an actionable image-only link. */
function fallbackLabelForUrl(url) {
    const parsed = new URL(url);
    const tail = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${parsed.hostname}${tail}`.slice(0, MAX_LABEL_LEN);
}
/**
 * Extract safe, deduplicated, bounded http(s) links from HTML email content.
 * Rejects non-http(s) schemes and relative URLs, decodes HTML entities, caps link count and lengths,
 * and skips 1x1 tracking pixels or empty-label noise unless the URL itself is actionable.
 */
function extractHtmlLinks(html) {
    const source = String(html || '').slice(0, MAX_HTML_SCAN)
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
    const out = [];
    const byUrl = new Map();
    const anchorRe = /<a\b([^>]{0,4096})>([\s\S]{0,4096}?)<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(source)) !== null) {
        const url = normalizeSafeUrl(extractAttr(match[1], 'href'));
        if (!url)
            continue;
        const extracted = extractAnchorLabel(match[1], match[2]);
        let label = extracted.label;
        if (!label) {
            if (isTrackingPixel(match[2], url) || !ACTIONABLE_URL_RE.test(url))
                continue;
            label = fallbackLabelForUrl(url);
        }
        const existing = byUrl.get(url);
        if (existing) {
            if (!existing.explicit && extracted.explicit) {
                existing.item.label = label;
                existing.explicit = true;
            }
            continue;
        }
        if (out.length >= MAX_LINKS)
            break;
        const item = { label, url };
        out.push(item);
        byUrl.set(url, { item, explicit: extracted.explicit });
    }
    return out;
}
/** Clean a MIME filename/contentType string and clamp length. */
function cleanMeta(value, max) {
    return String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}
/** Walk a Gmail MIME payload tree to collect plain text, HTML parts, and named attachments. */
function walkGmailParts(payload, state, depth) {
    if (!payload || typeof payload !== 'object' || depth > MAX_MIME_DEPTH)
        return;
    const p = payload;
    const filename = cleanMeta(p.filename, MAX_FILENAME_LEN);
    const mimeType = cleanMeta(p.mimeType, 128).toLowerCase();
    if (filename) {
        if (state.attachments.length < MAX_ATTACHMENTS) {
            const rawSize = Number(p.body?.size);
            const size = Number.isFinite(rawSize) && rawSize >= 0 ? Math.trunc(rawSize) : 0;
            state.attachments.push({ filename, mimeType: mimeType || 'application/octet-stream', size });
        }
        return;
    }
    if (mimeType === 'text/plain' && p.body?.data)
        state.plain.push(decodeBase64Url(p.body.data));
    else if (mimeType === 'text/html' && p.body?.data)
        state.html.push(decodeBase64Url(p.body.data));
    if (Array.isArray(p.parts)) {
        for (const part of p.parts)
            walkGmailParts(part, state, depth + 1);
    }
}
/** Extract plain-text body, safe HTML links, and attachment metadata from a Gmail message payload. */
function extractGmailContent(payload) {
    const state = { plain: [], html: [], attachments: [] };
    walkGmailParts(payload, state, 0);
    const plainBody = state.plain.filter((t) => t.length > 0).join('\n\n');
    const htmlCombined = state.html.join('\n');
    const body = plainBody || (htmlCombined ? stripHtml(htmlCombined) : '');
    const links = htmlCombined ? extractHtmlLinks(htmlCombined) : [];
    return { body, links, attachments: state.attachments };
}
/** Normalize optional Microsoft Graph attachment entries into MailAttachment[]. */
function normalizeGraphAttachments(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        if (out.length >= MAX_ATTACHMENTS)
            break;
        const item = (entry || {});
        const filename = cleanMeta(item.name, MAX_FILENAME_LEN);
        if (!filename)
            continue;
        const mimeType = cleanMeta(item.contentType, 128).toLowerCase() || 'application/octet-stream';
        const rawSize = Number(item.size);
        out.push({ filename, mimeType, size: Number.isFinite(rawSize) && rawSize >= 0 ? Math.trunc(rawSize) : 0 });
    }
    return out;
}
