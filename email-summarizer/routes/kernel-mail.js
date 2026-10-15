"use strict";
/**
 * Native-kernel mail egress for Intelligent Communication.
 *
 * Inside the native kernel's package sandbox there is no network and no connector broker: the
 * framework's getValidAccessToken answers null, and the framework email module
 * (@/app/routes/email-routes) is not present, so its senders and Gmail summarizer are inert stand-ins.
 * The kernel instead offers a fenced egress keyed by the manifest: this package declares
 * gmail.googleapis.com, www.googleapis.com, graph.microsoft.com and graph.facebook.com, each with the
 * caller's own connection applied by the kernel as a Bearer token. The package sends requests through
 * the global fetch with no Authorization header and never sees a credential.
 *
 * This module holds what that path needs and nothing else: which providers the caller has connected
 * (from the kernel's connectors.metadata intent, metadata only), the fetch wrapper that keeps a request
 * inside what the egress accepts and turns the kernel's "not connected" refusal into the package's own
 * 409, and the Gmail summary and the two senders the framework would otherwise provide. The senders keep
 * the framework's header-injection fence byte for byte: every header-bound value is CRLF-flattened here.
 * Outside the kernel (OSHAL_EGRESS unset) nothing in this module is used.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: connection state from connectors.metadata, the kernel fetch wrapper (allow-listed headers, "not connected" and 401 mapped to MailboxRefusal), the Gmail metadata summary and the Gmail / Graph senders for the native kernel.
 *
 * @module kernel-mail
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KERNEL_TOKEN = void 0;
exports.kernelEgress = kernelEgress;
exports.readConnections = readConnections;
exports.connectionState = connectionState;
exports.kernelTokenFor = kernelTokenFor;
exports.kernelFetch = kernelFetch;
exports.summarizeGmail = summarizeGmail;
exports.gmailRaw = gmailRaw;
exports.kernelSendGmail = kernelSendGmail;
exports.kernelSendOutlook = kernelSendOutlook;
const crypto_1 = require("crypto");
const mail_provider_1 = require("./mail-provider");
/** The sentinel token the mailbox carries under the kernel: the kernel, not the package, holds the credential. */
exports.KERNEL_TOKEN = 'kernel';
/** Request headers the kernel egress lets a package set itself; anything else (Authorization, Prefer) is dropped. */
const PACKAGE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match',
    'if-modified-since', 'x-requested-with', 'cache-control', 'range']);
/** Connector ids naming one provider's grant. The kernel resolves the Google aliases to the same authorization. */
const CONNECTORS = {
    google: ['google', 'gmail', 'google-calendar', 'google-drive'],
    outlook: ['outlook', 'microsoft'],
    facebook: ['facebook'],
};
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
/**
 * @description True inside the native kernel's package sandbox, where manifest egress declarations carry the credentials.
 * @returns Whether mail requests go through the kernel egress.
 */
function kernelEgress() {
    return process.env.OSHAL_EGRESS === 'kernel';
}
/**
 * @description Read the caller's saved connections from the kernel (metadata only). A context without the intent, or a
 * refused intent, answers null: the state is then unknown and the provider request itself decides.
 * @param ctx - The application context; the native bridge carries `intent`.
 * @param onError - Told about a refused intent so the route can log it.
 * @returns The connectors.metadata answer, or null.
 */
async function readConnections(ctx, onError = () => undefined) {
    const intent = ctx?.intent;
    if (typeof intent !== 'function')
        return null;
    try {
        const answer = await intent.call(ctx, 'connectors.metadata', {});
        return answer && typeof answer === 'object' ? answer : null;
    }
    catch (err) {
        onError(err);
        return null;
    }
}
/**
 * @description Classify one provider's connection. Usable unless revoked, or past its expiry with nothing to renew it.
 * @param meta - The connectors.metadata answer (or null when unknown).
 * @param provider - The provider family.
 * @param now - Clock seam in milliseconds.
 * @returns The state, or null when the metadata cannot say.
 */
function connectionState(meta, provider, now = Date.now()) {
    if (!meta || !Array.isArray(meta.connections))
        return null;
    const ids = CONNECTORS[provider];
    const rows = meta.connections.filter((c) => ids.includes(String(c?.provider || '').toLowerCase()));
    if (!rows.length)
        return 'none';
    const usable = rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
    return usable ? 'connected' : 'reconnect';
}
/**
 * @description The selectMailConnection lookup under the kernel: the sentinel for a usable (or unknown) connection,
 * null for none, and a throw for a lapsed one so the selection reports reconnect.
 * @param meta - The connectors.metadata answer (or null).
 * @returns The per-provider lookup.
 */
function kernelTokenFor(meta) {
    return async (provider) => {
        const state = connectionState(meta, provider);
        if (state === 'none')
            return null;
        if (state === 'reconnect')
            throw new Error(`${provider} connection has lapsed`);
        return exports.KERNEL_TOKEN;
    };
}
/** Keep only the headers the kernel egress accepts from a package. */
function packageHeaders(headers) {
    const entries = headers && typeof headers === 'object' ? Object.entries(headers) : [];
    return Object.fromEntries(entries.filter(([name]) => PACKAGE_HEADERS.has(name.toLowerCase())).map(([name, value]) => [name, String(value)]));
}
/**
 * @description A fetch for one provider through the kernel egress: drops the headers the kernel would refuse (the
 * kernel applies Authorization itself), answers a kernel "not connected" refusal as the 409 a missing connection gets,
 * and a 401 as reconnect.
 * @param provider - The mailbox provider whose refusal body to use.
 * @returns A fetch-compatible function.
 */
function kernelFetch(provider) {
    return async (url, init = {}) => {
        let response;
        try {
            response = await fetch(url, { ...init, headers: packageHeaders(init.headers) });
        }
        catch (err) {
            if (/not connected/i.test(String(err?.message || '')))
                throw new mail_provider_1.MailboxRefusal(409, provider, (0, mail_provider_1.missingConnectionBody)(provider));
            throw err;
        }
        if (response.status === 401)
            throw new mail_provider_1.MailboxRefusal(409, provider, (0, mail_provider_1.missingConnectionBody)(provider, true));
        return response;
    };
}
/** Read a header value (case-insensitive) from a Gmail message payload. */
function header(msg, name) {
    const payload = msg.payload;
    const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h?.value || '';
}
/** Gmail's millisecond internalDate as a stable ISO time, or '' when unusable. */
function receivedAt(internalDate) {
    const millis = Number(internalDate);
    if (!Number.isFinite(millis) || millis <= 0)
        return '';
    const received = new Date(millis);
    return Number.isNaN(received.getTime()) ? '' : received.toISOString();
}
/**
 * @description The privacy-bounded Gmail metadata summary, identical in shape and rules to the framework's
 * summarizeGmailMetadata (labels reduced to UNREAD/IMPORTANT/STARRED; no body), for the kernel where that module is absent.
 * @param id - Fallback message id when the payload lacks one.
 * @param msg - The Gmail message payload.
 * @returns The bounded summary.
 */
function summarizeGmail(id, msg) {
    const labelIds = msg.labelIds || [];
    const unread = labelIds.includes('UNREAD');
    const important = labelIds.includes('IMPORTANT');
    const starred = labelIds.includes('STARRED');
    const internalDate = msg.internalDate == null ? '' : String(msg.internalDate);
    return {
        id: String(msg.id || id), from: header(msg, 'From'), subject: header(msg, 'Subject') || '(no subject)', date: header(msg, 'Date'),
        internalDate, receivedAt: receivedAt(internalDate), snippet: msg.snippet || '',
        unread, important, starred, providerFlags: { unread, important, starred },
    };
}
/**
 * @description Build the RFC-2822 message exactly as the framework's sendGmail does, header-injection fence included:
 * to/subject/filename are CRLF-flattened, the filename loses double quotes and the MIME type anything non-token.
 * @param m - The outbound message.
 * @returns The raw message text.
 */
function gmailRaw(m) {
    const join = (lines) => lines.join('\r\n');
    const headerSafe = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
    const to = headerSafe(m.to);
    const subject = headerSafe(m.subject);
    if (!m.attachment || !m.attachment.contentBase64) {
        return join([`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', m.body]);
    }
    const boundary = `oshal_${(0, crypto_1.randomBytes)(8).toString('hex')}`;
    const att = m.attachment;
    const filename = headerSafe(att.filename).replace(/"/g, '');
    const mimeType = (att.mimeType || 'application/octet-stream').replace(/[^\w./+-]/g, '');
    return join([
        `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', '', m.body, '',
        `--${boundary}`, `Content-Type: ${mimeType}; name="${filename}"`, `Content-Disposition: attachment; filename="${filename}"`,
        'Content-Transfer-Encoding: base64', '', att.contentBase64.replace(/\s+/g, ''), '', `--${boundary}--`,
    ]);
}
/**
 * @description Send through Gmail users.messages.send via the kernel egress (gmail.send scope on the caller's grant).
 * @param m - The outbound message.
 * @returns The provider message id.
 */
async function kernelSendGmail(m) {
    const r = await kernelFetch('google')(`${GMAIL}/messages/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(gmailRaw(m), 'utf8').toString('base64url') }),
    });
    if (!r.ok)
        throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { id: String((await r.json()).id || '') };
}
/**
 * @description Send through Microsoft Graph users/me/sendMail via the kernel egress, the same JSON as the framework's
 * sendOutlookMail. Graph answers 202 with no message id.
 * @param m - The outbound message.
 * @returns An empty provider id.
 */
async function kernelSendOutlook(m) {
    const message = {
        subject: m.subject, body: { contentType: 'Text', content: m.body }, toRecipients: [{ emailAddress: { address: m.to } }],
    };
    if (m.attachment?.contentBase64) {
        message.attachments = [{
                '@odata.type': '#microsoft.graph.fileAttachment', name: m.attachment.filename,
                contentType: m.attachment.mimeType || 'application/octet-stream', contentBytes: m.attachment.contentBase64.replace(/\s+/g, ''),
            }];
    }
    const r = await kernelFetch('outlook')('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!r.ok)
        throw new Error(`graph sendMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { id: '' };
}
//# sourceMappingURL=kernel-mail.js.map