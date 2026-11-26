"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure HTML email template engine, compliance
 *     settings normalizer, and email compliance linter for marketing-engine 0.6.2 (zero DB,
 *     zero network, zero clock mutation): built-in announcement, newsletter, and launch
 *     templates with strict HTML escaping, http(s)-only CTA and unsubscribe URLs, unremovable
 *     sender identity, physical postal address, and unsubscribe link in both HTML and
 *     plain-text parts, plus fail-closed compliance linting.
 *
 * @module marketing-templates
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKETING_TEMPLATES = exports.DEFAULT_COMPLIANCE_SETTINGS = exports.MARKETING_TEMPLATE_IDS = void 0;
exports.escapeHtml = escapeHtml;
exports.isValidEmail = isValidEmail;
exports.safeHttpUrl = safeHttpUrl;
exports.normalizeComplianceSettings = normalizeComplianceSettings;
exports.complianceReadiness = complianceReadiness;
exports.lintMarketingEmail = lintMarketingEmail;
exports.renderMarketingTemplate = renderMarketingTemplate;
exports.parseEmailDraftCopy = parseEmailDraftCopy;
/** @description Built-in marketing email template identifiers. */
exports.MARKETING_TEMPLATE_IDS = ['announcement', 'newsletter', 'launch'];
/** @description Default empty compliance settings (email sending refused until identity, address, and unsubscribe URL are set). */
exports.DEFAULT_COMPLIANCE_SETTINGS = {
    senderName: '',
    senderEmail: '',
    replyToEmail: '',
    postalAddress: '',
    unsubscribeBaseUrl: '',
    smsQuietStartHour: 21,
    smsQuietEndHour: 8,
    smsDefaultTimezone: 'America/New_York',
};
/** @description Built-in HTML + plain-text email templates. */
exports.MARKETING_TEMPLATES = [
    {
        id: 'announcement',
        name: 'Announcement',
        description: 'Product or milestone announcement with headline, intro, body paragraphs, primary CTA, and mandatory compliance footer.',
        fields: ['subject', 'headline', 'intro', 'body', 'ctaLabel', 'ctaUrl'],
    },
    {
        id: 'newsletter',
        name: 'Newsletter',
        description: 'Periodic digest with headline, intro, structured sections/highlights, CTA link, and mandatory compliance footer.',
        fields: ['subject', 'headline', 'intro', 'sections', 'body', 'ctaLabel', 'ctaUrl'],
    },
    {
        id: 'launch',
        name: 'Launch',
        description: 'Product launch email with headline, launch summary, key highlights, primary CTA button, and mandatory compliance footer.',
        fields: ['subject', 'headline', 'intro', 'highlights', 'body', 'ctaLabel', 'ctaUrl'],
    },
];
const EMAIL_ADDR_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEZONE_RE = /^[A-Za-z0-9_+\-/]{2,64}$/;
/** Create a coded validation error without leaking internal details. */
function codedError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}
/**
 * @description Escape untrusted text cleanly for HTML element content and attributes.
 * @param value - Untrusted input value.
 * @returns Escaped HTML string.
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/**
 * @description Validate an email address shape (bounded to 254 chars, no whitespace).
 * @param raw - Candidate email value.
 * @returns True when valid.
 */
function isValidEmail(raw) {
    if (typeof raw !== 'string')
        return false;
    const s = raw.trim();
    return s.length > 0 && s.length <= 254 && EMAIL_ADDR_RE.test(s);
}
/**
 * @description Restrict URLs strictly to http:// or https:// (refuses javascript:, data:, etc.).
 * @param raw - Candidate URL string.
 * @returns Normalized URL string, or null when invalid or disallowed.
 */
function safeHttpUrl(raw) {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 2000 || /[\u0000-\u001f\u007f]/.test(trimmed))
        return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        return parsed.toString();
    }
    catch {
        return null;
    }
}
/** Trim a string input and bound its maximum length. */
function cleanText(raw, max) {
    if (typeof raw !== 'string')
        return '';
    return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max);
}
/** Parse an integer hour in 0..23 with default fallback. */
function parseQuietHour(raw, fallback) {
    if (raw === undefined || raw === null || raw === '')
        return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 23)
        return null;
    return n;
}
/**
 * @description Validate and normalize owner compliance settings.
 * @param raw - Untrusted settings payload.
 * @returns Normalized settings or a coded validation error.
 */
function normalizeComplianceSettings(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    const senderName = cleanText(src.senderName ?? src.sender_name, 160);
    const senderEmail = cleanText(src.senderEmail ?? src.sender_email, 254).toLowerCase();
    if (senderEmail && !isValidEmail(senderEmail)) {
        return { ok: false, error: 'invalid_sender_email', message: 'Sender email must be a valid email address.' };
    }
    const replyToEmail = cleanText(src.replyToEmail ?? src.reply_to_email, 254).toLowerCase();
    if (replyToEmail && !isValidEmail(replyToEmail)) {
        return { ok: false, error: 'invalid_reply_to_email', message: 'Reply-to email must be a valid email address.' };
    }
    const postalAddress = cleanText(src.postalAddress ?? src.postal_address, 500).replace(/\n+/g, ', ').replace(/\s{2,}/g, ' ');
    const rawUnsub = cleanText(src.unsubscribeBaseUrl ?? src.unsubscribe_base_url, 500);
    const unsubscribeBaseUrl = rawUnsub ? safeHttpUrl(rawUnsub) : '';
    if (rawUnsub && !unsubscribeBaseUrl) {
        return { ok: false, error: 'invalid_unsubscribe_url', message: 'Unsubscribe URL must start with https:// or http://.' };
    }
    const smsQuietStartHour = parseQuietHour(src.smsQuietStartHour ?? src.sms_quiet_start_hour, 21);
    const smsQuietEndHour = parseQuietHour(src.smsQuietEndHour ?? src.sms_quiet_end_hour, 8);
    if (smsQuietStartHour === null || smsQuietEndHour === null) {
        return { ok: false, error: 'invalid_sms_quiet_hours', message: 'SMS quiet hours must be whole hours between 0 and 23.' };
    }
    const tzRaw = cleanText(src.smsDefaultTimezone ?? src.sms_default_timezone, 64) || 'America/New_York';
    if (!TIMEZONE_RE.test(tzRaw)) {
        return { ok: false, error: 'invalid_timezone', message: 'Default timezone must be a valid IANA timezone identifier.' };
    }
    return {
        ok: true,
        settings: {
            senderName,
            senderEmail,
            replyToEmail,
            postalAddress,
            unsubscribeBaseUrl: unsubscribeBaseUrl || '',
            smsQuietStartHour,
            smsQuietEndHour,
            smsDefaultTimezone: tzRaw,
        },
    };
}
/**
 * @description Compute compliance readiness flags from normalized settings.
 * @param settings - Owner compliance settings.
 * @returns Readiness flags for identity, postal address, unsubscribe link, and email sending.
 */
function complianceReadiness(settings) {
    const s = settings ?? {};
    const identityReady = cleanText(s.senderName, 160).length > 0 && isValidEmail(s.senderEmail);
    const postalAddressReady = cleanText(s.postalAddress, 500).length >= 8;
    const unsubscribeReady = safeHttpUrl(s.unsubscribeBaseUrl) !== null;
    return {
        identityReady,
        postalAddressReady,
        unsubscribeReady,
        readyForEmailSend: identityReady && postalAddressReady && unsubscribeReady,
    };
}
/**
 * @description Lint an email's HTML part, plain-text part, sender identity, postal address footer,
 * and unsubscribe link. Every requirement is fail-closed.
 * @param input - HTML body, plain-text body, compliance settings, and optional unsubscribe URL override.
 * @returns Lint verdict with structured error codes and messages.
 */
function lintMarketingEmail(input) {
    const errors = [];
    const c = input?.compliance ?? {};
    const senderName = cleanText(c.senderName, 160);
    const senderEmail = cleanText(c.senderEmail, 254).toLowerCase();
    const postalAddress = cleanText(c.postalAddress, 500).replace(/\n+/g, ', ').replace(/\s{2,}/g, ' ');
    const html = typeof input?.html === 'string' ? input.html.trim() : '';
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    const unsub = safeHttpUrl(input?.unsubscribeUrl) || safeHttpUrl(c.unsubscribeBaseUrl);
    if (!senderName || !isValidEmail(senderEmail)) {
        errors.push({ code: 'compliance_identity_required', message: 'Set a sender name and valid sender email address in Compliance settings.' });
    }
    if (postalAddress.length < 8) {
        errors.push({ code: 'compliance_postal_address_required', message: 'Set a physical postal address (at least 8 characters) in Compliance settings.' });
    }
    if (!html) {
        errors.push({ code: 'template_missing_html_part', message: 'Email must include an HTML part.' });
    }
    else {
        if (postalAddress.length >= 8 && !html.includes(escapeHtml(postalAddress))) {
            errors.push({ code: 'template_missing_html_footer', message: 'HTML email footer must include the physical postal address.' });
        }
        if (!unsub || !html.includes(escapeHtml(unsub))) {
            errors.push({ code: 'template_missing_html_unsubscribe', message: 'HTML email footer must include a valid http(s) unsubscribe link.' });
        }
    }
    if (!text) {
        errors.push({ code: 'template_missing_text_part', message: 'Email must include a plain-text alternative.' });
    }
    else {
        if (postalAddress.length >= 8 && !text.includes(postalAddress)) {
            errors.push({ code: 'template_missing_text_footer', message: 'Plain-text email footer must include the physical postal address.' });
        }
        if (!unsub || !text.includes(unsub)) {
            errors.push({ code: 'template_missing_text_unsubscribe', message: 'Plain-text email footer must include a valid http(s) unsubscribe link.' });
        }
    }
    return { ok: errors.length === 0, errors };
}
/** Split free-form body text into non-empty paragraphs. */
function splitParagraphs(body) {
    return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 20);
}
/** Normalize newsletter sections or launch highlights from structured input or line-separated body text. */
function normalizeItems(raw, fallbackBody) {
    if (Array.isArray(raw)) {
        const out = [];
        for (const entry of raw.slice(0, 12)) {
            if (typeof entry === 'string' && entry.trim()) {
                out.push({ text: entry.trim().slice(0, 600) });
            }
            else if (entry && typeof entry === 'object') {
                const rec = entry;
                const heading = cleanText(rec.heading ?? rec.title, 160);
                const text = cleanText(rec.text ?? rec.body ?? rec.summary, 1000);
                if (heading || text)
                    out.push({ ...(heading ? { heading } : {}), text: text || heading });
            }
        }
        if (out.length)
            return out;
    }
    const lines = fallbackBody.split('\n').map((l) => l.replace(/^[-*•]\s+/, '').trim()).filter(Boolean);
    return lines.slice(0, 10).map((text) => ({ text }));
}
/** Build the HTML body content specific to the chosen template. */
function renderTemplateBodyHtml(templateId, data) {
    const eyebrow = templateId === 'launch' ? 'PRODUCT LAUNCH' : templateId === 'newsletter' ? 'NEWSLETTER DIGEST' : 'ANNOUNCEMENT';
    const parts = [
        `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;color:#2563eb;text-transform:uppercase;">${eyebrow}</p>`,
        `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">${escapeHtml(data.headline)}</h1>`,
    ];
    if (data.intro)
        parts.push(`<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#374151;">${escapeHtml(data.intro)}</p>`);
    if (templateId === 'newsletter' && data.items.length) {
        for (const sec of data.items) {
            parts.push('<div style="margin:0 0 14px;padding:12px 14px;border-left:3px solid #2563eb;background:#f8fafc;">'
                + (sec.heading ? `<h2 style="margin:0 0 6px;font-size:16px;color:#111827;">${escapeHtml(sec.heading)}</h2>` : '')
                + `<p style="margin:0;font-size:14px;line-height:1.55;color:#374151;">${escapeHtml(sec.text)}</p></div>`);
        }
    }
    else if (templateId === 'launch' && data.items.length) {
        parts.push('<ul style="margin:0 0 18px;padding-left:20px;color:#374151;font-size:15px;line-height:1.6;">'
            + data.items.map((h) => `<li style="margin:0 0 6px;">${h.heading ? `<strong>${escapeHtml(h.heading)}:</strong> ` : ''}${escapeHtml(h.text)}</li>`).join('')
            + '</ul>');
    }
    else {
        for (const p of data.paragraphs) {
            parts.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(p)}</p>`);
        }
    }
    if (data.ctaUrl) {
        const label = data.ctaLabel || (templateId === 'launch' ? 'Explore the launch' : 'Learn more');
        parts.push(`<p style="margin:22px 0 8px;"><a href="${escapeHtml(data.ctaUrl)}" style="display:inline-block;padding:11px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a></p>`);
    }
    return parts.join('\n');
}
/** Build the mandatory HTML footer containing sender identity, postal address, and unsubscribe link. */
function renderFooterHtml(footer) {
    const senderLine = footer.senderName && footer.senderEmail
        ? `Sent by ${escapeHtml(footer.senderName)} (${escapeHtml(footer.senderEmail)})`
        : footer.senderName ? `Sent by ${escapeHtml(footer.senderName)}` : 'Sender identity not configured';
    const addressLine = footer.postalAddress ? escapeHtml(footer.postalAddress) : 'Physical postal address not configured';
    const unsubLine = footer.unsubscribeUrl
        ? `<a href="${escapeHtml(footer.unsubscribeUrl)}" style="color:#2563eb;text-decoration:underline;">Unsubscribe</a>`
        : 'Unsubscribe link not configured';
    return [
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;" />',
        '<footer style="font-size:12px;line-height:1.55;color:#6b7280;">',
        `<p style="margin:0 0 4px;">${senderLine}</p>`,
        `<p style="margin:0 0 6px;">${addressLine}</p>`,
        `<p style="margin:0;">${unsubLine}</p>`,
        '</footer>',
    ].join('\n');
}
/** Build the plain-text alternative with matching content and mandatory compliance footer. */
function renderPlainText(templateId, data, footer) {
    const lines = [data.headline.toUpperCase(), ''];
    if (data.intro)
        lines.push(data.intro, '');
    if ((templateId === 'newsletter' || templateId === 'launch') && data.items.length) {
        for (const item of data.items) {
            lines.push(item.heading ? `- ${item.heading}: ${item.text}` : `- ${item.text}`);
        }
        lines.push('');
    }
    else if (data.paragraphs.length) {
        for (const p of data.paragraphs)
            lines.push(p, '');
    }
    if (data.ctaUrl) {
        const label = data.ctaLabel || (templateId === 'launch' ? 'Explore the launch' : 'Learn more');
        lines.push(`${label}: ${data.ctaUrl}`, '');
    }
    lines.push('---');
    if (footer.senderName || footer.senderEmail) {
        lines.push(`Sent by: ${footer.senderName}${footer.senderEmail ? ` <${footer.senderEmail}>` : ''}`.trim());
    }
    if (footer.postalAddress)
        lines.push(footer.postalAddress);
    if (footer.unsubscribeUrl)
        lines.push(`Unsubscribe: ${footer.unsubscribeUrl}`);
    return lines.join('\n').trim();
}
/** Wrap escaped template body + footer into a standalone email-safe HTML document. */
function wrapEmailHtmlDocument(subject, bodyHtml, footerHtml) {
    return [
        '<!doctype html>',
        `<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>`,
        '<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">',
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px;">',
        bodyHtml,
        footerHtml,
        '</div></body></html>',
    ].join('\n');
}
/** Validate template id and http(s)-only CTA/unsubscribe URLs before rendering. */
function validateRenderInputs(src, settings) {
    const templateId = String(src.templateId ?? '').trim();
    if (!exports.MARKETING_TEMPLATE_IDS.includes(templateId)) {
        throw codedError('invalid_template_id', 'Template must be one of: announcement, newsletter, launch.');
    }
    const rawCtaUrl = cleanText(src.ctaUrl, 2000);
    const ctaUrl = rawCtaUrl ? safeHttpUrl(rawCtaUrl) : '';
    if (rawCtaUrl && !ctaUrl)
        throw codedError('invalid_cta_url', 'CTA URL must start with https:// or http://.');
    const rawInputUnsub = cleanText(src.unsubscribeUrl, 2000);
    if (rawInputUnsub && !safeHttpUrl(rawInputUnsub)) {
        throw codedError('invalid_unsubscribe_url', 'Unsubscribe URL must start with https:// or http://.');
    }
    const unsubscribeUrl = (rawInputUnsub ? safeHttpUrl(rawInputUnsub) : safeHttpUrl(settings.unsubscribeBaseUrl)) || '';
    return { templateId, ctaUrl: ctaUrl || '', unsubscribeUrl };
}
/**
 * @description Render one of the three built-in marketing email templates (announcement, newsletter,
 * launch) to escaped HTML plus a plain-text alternative, deterministically injecting the mandatory
 * sender identity, physical postal address, and unsubscribe link into both parts.
 * @param input - Template id and content fields.
 * @param compliance - Caller's saved compliance settings.
 * @returns Rendered HTML, plain-text alternative, footer metadata, compliance lint result, and canApprove flag.
 */
function renderMarketingTemplate(input, compliance) {
    const src = (input && typeof input === 'object' ? input : {});
    const norm = normalizeComplianceSettings(compliance ?? exports.DEFAULT_COMPLIANCE_SETTINGS);
    const settings = norm.ok ? norm.settings : exports.DEFAULT_COMPLIANCE_SETTINGS;
    const { templateId, ctaUrl, unsubscribeUrl } = validateRenderInputs(src, settings);
    const subject = cleanText(src.subject, 240) || cleanText(src.headline, 240) || 'Open Swarm update';
    const headline = cleanText(src.headline, 240) || subject;
    const intro = cleanText(src.intro, 1200);
    const body = cleanText(src.body, 8000);
    const ctaLabel = cleanText(src.ctaLabel, 120);
    const paragraphs = splitParagraphs(body);
    const items = templateId === 'newsletter'
        ? normalizeItems(src.sections ?? src.highlights, body)
        : templateId === 'launch' ? normalizeItems(src.highlights ?? src.sections, body) : [];
    const footer = {
        senderName: settings.senderName,
        senderEmail: settings.senderEmail,
        postalAddress: settings.postalAddress,
        unsubscribeUrl,
    };
    const bodyData = { headline, intro, paragraphs, items, ctaLabel, ctaUrl };
    const html = wrapEmailHtmlDocument(subject, renderTemplateBodyHtml(templateId, bodyData), renderFooterHtml(footer));
    const text = renderPlainText(templateId, bodyData, footer);
    const complianceResult = lintMarketingEmail({ html, text, compliance: settings, unsubscribeUrl });
    return { templateId, subject, html, text, footer, compliance: complianceResult, canApprove: complianceResult.ok };
}
/**
 * @description Parse bot-written or manual email copy (optional first-line "Subject: ...") into
 * template input fields without mutating content.
 * @param rawText - Raw email text.
 * @param fallbackSubject - Fallback subject when no Subject line is present.
 * @returns Structured subject, headline, intro, and body text.
 */
function parseEmailDraftCopy(rawText, fallbackSubject) {
    const cleaned = cleanText(rawText, 8000);
    const lines = cleaned.split('\n');
    let subject = cleanText(fallbackSubject, 240) || 'Open Swarm update';
    let bodyLines = lines;
    if (lines.length && /^subject:\s*/i.test(lines[0])) {
        const parsedSubject = lines[0].replace(/^subject:\s*/i, '').trim().slice(0, 240);
        if (parsedSubject)
            subject = parsedSubject;
        bodyLines = lines.slice(1);
        while (bodyLines.length && !bodyLines[0].trim())
            bodyLines = bodyLines.slice(1);
    }
    const paragraphs = splitParagraphs(bodyLines.join('\n'));
    const intro = paragraphs[0] ?? '';
    const body = paragraphs.length > 1 ? paragraphs.slice(1).join('\n\n') : paragraphs.join('\n\n');
    return { subject, headline: subject, intro, body };
}
