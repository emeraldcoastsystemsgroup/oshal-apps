"use strict";
/**
 * Native-kernel delivery egress for AI Office (email and Slack).
 *
 * Inside the native kernel's package sandbox there is no network and no connector broker: the
 * framework's getValidAccessToken answers null, the framework email senders are inert stand-ins that
 * answer {} (so a send would falsely succeed) and the framework Slack client is refused. The kernel
 * instead offers a fenced egress keyed by the manifest: this package declares gmail.googleapis.com
 * (connector gmail), graph.microsoft.com (connector outlook) and slack.com (connector slack), each with
 * the caller's own connection applied by the kernel as a Bearer token, and files.slack.com with no
 * credential (the pre-signed upload URL Slack hands back). The package sends requests through the
 * global fetch with no Authorization header and never sees a credential.
 *
 * This module holds what that path needs: which providers the caller has connected (from the kernel's
 * connectors.metadata intent, metadata only), the fetch wrapper that turns the kernel's "not connected"
 * refusal into a recognisable error, the Gmail and Graph senders the framework would otherwise provide
 * (the Gmail MIME keeps the framework's header-injection fence), and the Slack external-upload sequence.
 * Outside the kernel (OSHAL_EGRESS unset) nothing in this module is used.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: connection state from connectors.metadata, the kernel fetch wrapper ("not connected" recognised), the fenced Gmail MIME builder and the Gmail / Graph senders with Gmail-then-Microsoft selection, and the Slack files.getUploadURLExternal / upload / files.completeUploadExternal sequence for the native kernel.
 *
 * @module kernel-delivery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotConnectedError = void 0;
exports.kernelEgress = kernelEgress;
exports.connectionState = connectionState;
exports.isNotConnected = isNotConnected;
exports.gmailRaw = gmailRaw;
exports.kernelSendGmail = kernelSendGmail;
exports.kernelSendOutlook = kernelSendOutlook;
exports.kernelSendMail = kernelSendMail;
exports.kernelSlackUsable = kernelSlackUsable;
exports.kernelUploadSlackFile = kernelUploadSlackFile;
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'presentations-kernel-delivery' });
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SLACK_API = 'https://slack.com/api';
/** The only host a Slack pre-signed upload URL may name; the kernel refuses any other undeclared host anyway. */
const SLACK_UPLOAD_HOST = 'files.slack.com';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Connector ids naming one provider's grant in the kernel's connection metadata. */
const CONNECTORS = {
    google: ['google', 'gmail', 'google-calendar', 'google-drive'],
    outlook: ['outlook', 'microsoft'],
    slack: ['slack'],
};
/** The kernel refused a request because the caller has no connection for its connector. */
class NotConnectedError extends Error {
    provider;
    /** @param provider - The provider family that is not connected. */
    constructor(provider) {
        super(`${provider} is not connected`);
        this.provider = provider;
    }
}
exports.NotConnectedError = NotConnectedError;
/**
 * @description True inside the native kernel's package sandbox, where manifest egress declarations carry the credentials.
 * @returns Whether delivery requests go through the kernel egress.
 */
function kernelEgress() {
    return process.env.OSHAL_EGRESS === 'kernel';
}
/**
 * @description Read the caller's saved connections from the kernel (metadata only). A context without the intent, or a
 * refused intent, answers null: the state is then unknown and the provider request itself decides.
 * @param ctx - The application context; the native bridge carries `intent`.
 * @returns The connectors.metadata answer, or null.
 */
async function readConnections(ctx) {
    const intent = ctx?.intent;
    if (typeof intent !== 'function')
        return null;
    try {
        const answer = await intent.call(ctx, 'connectors.metadata', {});
        return answer && typeof answer === 'object' ? answer : null;
    }
    catch (err) {
        logger.error({ err, stack: err instanceof Error ? err.stack : undefined }, 'connectors.metadata refused');
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
/** Whether a provider may be tried: a known-missing or lapsed connection is skipped, an unknown one is tried. */
function usable(meta, provider) {
    const state = connectionState(meta, provider);
    return state !== 'none' && state !== 'reconnect';
}
/**
 * @description Is this the kernel's (or this module's) "not connected" refusal?
 * @param err - What a delivery call threw.
 * @returns True when the caller has no connection for the provider asked.
 */
function isNotConnected(err) {
    return err instanceof NotConnectedError || (kernelEgress() && /not connected/i.test(String(err?.message || '')));
}
/** A fetch through the kernel egress that turns its "not connected" refusal into a NotConnectedError. */
async function egressFetch(provider, url, init) {
    try {
        return await fetch(url, init);
    }
    catch (err) {
        if (/not connected/i.test(String(err?.message || '')))
            throw new NotConnectedError(provider);
        throw err;
    }
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
    const r = await egressFetch('google', `${GMAIL}/messages/send`, {
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
 * @returns Nothing; a refusal throws.
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
    const r = await egressFetch('outlook', 'https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!r.ok)
        throw new Error(`graph sendMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
/**
 * @description Send over the caller's own mailbox under the kernel, in the legacy order: Gmail when Google is
 * connected, else Microsoft Graph. A provider the metadata knows is missing or lapsed is skipped; one the kernel
 * refuses as not connected falls through to the next, as the broker's null did.
 * @param ctx - The application context (carries the connectors.metadata intent).
 * @param mail - The outbound message.
 * @returns Which mailbox sent it (and Gmail's id), or null when neither is connected.
 */
async function kernelSendMail(ctx, mail) {
    const meta = await readConnections(ctx);
    if (usable(meta, 'google')) {
        try {
            return { via: 'gmail', id: (await kernelSendGmail(mail)).id };
        }
        catch (err) {
            if (!(err instanceof NotConnectedError))
                throw err;
        }
    }
    if (usable(meta, 'outlook')) {
        try {
            await kernelSendOutlook(mail);
            return { via: 'outlook' };
        }
        catch (err) {
            if (!(err instanceof NotConnectedError))
                throw err;
        }
    }
    return null;
}
/**
 * @description Whether the caller's Slack connection may be tried under the kernel (the broker-token check's place).
 * @param ctx - The application context.
 * @returns False only when the metadata says Slack is missing or lapsed.
 */
async function kernelSlackUsable(ctx) {
    return usable(await readConnections(ctx), 'slack');
}
/** Coerce a Slack answer to an object (the framework slack-client's slackObject). */
function slackObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
/** The framework uploadSlackFile's input checks, unchanged. */
function checkedUpload(input) {
    const channelId = String(input.channelId || '').trim();
    const filename = String(input.filename || '').trim();
    const mimeType = String(input.mimeType || '').trim();
    const content = input.content instanceof Uint8Array ? input.content : new Uint8Array(input.content || []);
    if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/i.test(channelId))
        throw new Error('valid Slack channel id required');
    if (!filename || filename.length > 160 || /[\\/\r\n]/.test(filename))
        throw new Error('valid filename required');
    if (!mimeType || mimeType.length > 160)
        throw new Error('valid mime type required');
    if (!content.length || content.length > MAX_UPLOAD_BYTES)
        throw new Error('Slack file size is outside the allowed range');
    return { channelId, filename, mimeType, content };
}
/** Ask Slack for a pre-signed upload URL; the kernel applies the caller's Slack token. */
async function slackUploadUrl(filename, length) {
    const request = await egressFetch('slack', `${SLACK_API}/files.getUploadURLExternal`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ filename, length: String(length) }),
    });
    const prepared = slackObject(await request.json().catch(() => ({ ok: false, error: 'bad_json' })));
    if (!request.ok || prepared.ok !== true || typeof prepared.upload_url !== 'string' || !prepared.upload_url
        || typeof prepared.file_id !== 'string' || !prepared.file_id) {
        throw new Error(`slack files.getUploadURLExternal failed: ${String(prepared.error || request.status)}`);
    }
    const uploadUrl = new URL(prepared.upload_url);
    if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== SLACK_UPLOAD_HOST) {
        throw new Error(`slack upload URL is not on ${SLACK_UPLOAD_HOST}`);
    }
    return { uploadUrl, fileId: prepared.file_id };
}
/**
 * @description Upload one rendered Office artifact to a Slack conversation through the kernel egress: the framework
 * uploadSlackFile's three steps and checks. The pre-signed upload URL takes the raw bytes with their Content-Type
 * only (the egress refuses a package-set Content-Disposition; the filename is already registered in step one) and
 * carries no credential, exactly as the framework sent it.
 * @param input - The upload.
 * @returns The Slack file id, the channel and the permalink when Slack answers one.
 */
async function kernelUploadSlackFile(input) {
    const { channelId, filename, mimeType, content } = checkedUpload(input);
    const { uploadUrl, fileId } = await slackUploadUrl(filename, content.length);
    const uploaded = await fetch(uploadUrl.href, { method: 'POST', headers: { 'Content-Type': mimeType }, body: Buffer.from(content) });
    if (!uploaded.ok)
        throw new Error(`slack file upload failed: ${uploaded.status}`);
    const completed = await egressFetch('slack', `${SLACK_API}/files.completeUploadExternal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            files: [{ id: fileId, title: String(input.title || filename).slice(0, 200) }],
            channel_id: channelId,
            initial_comment: String(input.initialComment || '').slice(0, 4000) || undefined,
        }),
    });
    const result = slackObject(await completed.json().catch(() => ({ ok: false, error: 'bad_json' })));
    if (!completed.ok || result.ok !== true) {
        throw new Error(`slack files.completeUploadExternal failed: ${String(result.error || completed.status)}`);
    }
    const file = slackObject(Array.isArray(result.files) ? result.files[0] : result.file);
    return { fileId, channelId, permalink: typeof file.permalink === 'string' && file.permalink ? file.permalink : undefined };
}
//# sourceMappingURL=kernel-delivery.js.map