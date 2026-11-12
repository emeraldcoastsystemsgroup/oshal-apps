"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcpRefusal = void 0;
exports.googleJson = googleJson;
exports.listProjects = listProjects;
exports.listBillingAccounts = listBillingAccounts;
exports.billingStatus = billingStatus;
exports.readGcp = readGcp;
exports.refusalOf = refusalOf;
exports.createGcpProjectsRoutes = createGcpProjectsRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0 (T73; Roger, 2026-11-12: "i just connected to gcp can you tell me what projects are there and which projects have a real billing account"): GET /api/cloud/gcp/projects reads the person's Google Cloud projects (Resource Manager), each project's billing (Cloud Billing: enabled, linked account) and the billing accounts they can see (open or closed), with their own GCP connection. The kernel places that connection on these two Google hosts only (connectors/gcp.yaml apiHosts, kernel 07cb278c); this route never sees it. Read-only. A project whose billing Google will not show (a connection made before cloud-billing.readonly was asked for) is marked so, with the step that fixes it, instead of failing the whole answer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.1 (T73): a read the kernel could not make for the person is said in words: no Google Cloud connection ("is not connected") answers 409 connect with the button that fixes it, and a connection that expired and could not be renewed answers 409 reconnect; anything else stays 502. Measured on the test slot: the test person, with no connection, read "Google Cloud could not be read right now."
 */
const express_1 = require("express");
const PROJECTS = 'https://cloudresourcemanager.googleapis.com/v1/projects';
const BILLING = 'https://cloudbilling.googleapis.com/v1';
/** The most projects one answer reads, and how many billing reads run at once. */
const MAX_PROJECTS = 200;
const PARALLEL = 4;
/** A refusal with the HTTP status the route answers and the words the person reads. */
class GcpRefusal extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.GcpRefusal = GcpRefusal;
/** One Google answer as JSON; 401 and 403 are said in words, anything else not 2xx is a provider error. */
async function googleJson(url, fetchImpl = fetch) {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
        throw new GcpRefusal(409, 'Google Cloud refused the saved connection. Reconnect Google Cloud on the Cloud Accounts screen.', 'reconnect');
    }
    if (response.status === 403) {
        const why = String(body?.error?.message || '').slice(0, 200);
        throw new GcpRefusal(403, why || 'Google Cloud did not allow this read with the saved connection.', 'forbidden');
    }
    if (!response.ok)
        throw new GcpRefusal(502, `Google Cloud answered HTTP ${response.status}.`, 'provider_error');
    return body;
}
/** Every project the person can see, up to MAX_PROJECTS, following Google's pages. */
async function listProjects(fetchImpl = fetch) {
    const projects = [];
    let token = '';
    do {
        const page = await googleJson(`${PROJECTS}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, fetchImpl);
        projects.push(...(Array.isArray(page.projects) ? page.projects : []));
        token = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (token && projects.length < MAX_PROJECTS);
    return projects.slice(0, MAX_PROJECTS);
}
/** The billing accounts the person can see, or null when Google will not show them to this connection. */
async function listBillingAccounts(fetchImpl = fetch) {
    try {
        const page = await googleJson(`${BILLING}/billingAccounts?pageSize=100`, fetchImpl);
        return Array.isArray(page.billingAccounts) ? page.billingAccounts : [];
    }
    catch (error) {
        if (error instanceof GcpRefusal && error.code === 'forbidden')
            return null;
        throw error;
    }
}
/** One project's billing, or a mark that Google would not show it. */
async function billingOf(projectId, fetchImpl) {
    try {
        const info = await googleJson(`${BILLING}/projects/${encodeURIComponent(projectId)}/billingInfo`, fetchImpl);
        const account = typeof info.billingAccountName === 'string' && info.billingAccountName ? info.billingAccountName.replace(/^billingAccounts\//, '') : null;
        return { enabled: info.billingEnabled === true, account };
    }
    catch (error) {
        if (error instanceof GcpRefusal && error.code === 'forbidden')
            return { enabled: null, account: null };
        throw error;
    }
}
/** Run `work` over `items`, at most PARALLEL at a time, keeping their order. */
async function inParallel(items, work) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
        while (next < items.length) {
            const at = next++;
            out[at] = await work(items[at]);
        }
    }));
    return out;
}
/** The status a person reads for one project's billing. */
function billingStatus(enabled, account, linked) {
    if (enabled === null)
        return 'billing not visible: reconnect Google Cloud to let this app read billing';
    if (enabled && account?.open !== false)
        return 'real billing';
    if (linked && account && account.open === false)
        return 'linked to a closed billing account';
    return 'no billing';
}
/**
 * @description The person's projects with their billing and the billing accounts, read with their own GCP connection.
 * @param fetchImpl The fetch to use (the kernel's egress places the connection; tests pass a stand-in).
 * @returns {projects, accounts, summary, billingVisible}.
 */
async function readGcp(fetchImpl = fetch) {
    const [projects, accounts] = await Promise.all([listProjects(fetchImpl), listBillingAccounts(fetchImpl)]);
    const byId = new Map((accounts || []).map((a) => [String(a.name || '').replace(/^billingAccounts\//, ''), a]));
    const active = projects.filter((p) => !p.lifecycleState || p.lifecycleState === 'ACTIVE');
    const billing = await inParallel(active, (p) => billingOf(String(p.projectId), fetchImpl));
    const rows = active.map((p, i) => {
        const { enabled, account } = billing[i];
        const known = account ? byId.get(account) : null;
        const open = known ? known.open === true : null;
        return {
            name: String(p.name || p.projectId), projectId: String(p.projectId), billingEnabled: enabled,
            billingAccount: account, billingAccountName: known ? String(known.displayName || account) : null, billingAccountOpen: open,
            status: billingStatus(enabled, known ? { open: known.open === true } : null, Boolean(account)),
        };
    });
    const linked = (id) => rows.filter((r) => r.billingAccount === id).length;
    const accountRows = (accounts || []).map((a) => {
        const id = String(a.name || '').replace(/^billingAccounts\//, '');
        return { id, name: String(a.displayName || id), open: a.open === true, projects: linked(id) };
    });
    const count = (status) => rows.filter((r) => r.status === status).length;
    return {
        projects: rows, accounts: accountRows, billingVisible: accounts !== null,
        summary: { projects: rows.length, realBilling: count('real billing'), closedAccount: count('linked to a closed billing account'), noBilling: count('no billing') },
        asOf: new Date().toISOString(),
    };
}
/**
 * @description The refusal a person reads for a failed read: Google's own answer as given, or the kernel's word that it had
 * no usable connection for them (its egress throws with that text), else a provider error.
 * @param error What the read threw. @returns {GcpRefusal} The status, the words and the code.
 */
function refusalOf(error) {
    if (error instanceof GcpRefusal)
        return error;
    const text = String(error?.message || error || '');
    if (/is not connected/i.test(text)) {
        return new GcpRefusal(409, 'Google Cloud is not connected for you yet. Press Connect Google Cloud on the Cloud Accounts screen.', 'connect');
    }
    if (/could not be renewed/i.test(text)) {
        return new GcpRefusal(409, 'Your Google Cloud connection expired and could not be renewed. Press Reconnect Google Cloud on the Cloud Accounts screen.', 'reconnect');
    }
    return new GcpRefusal(502, 'Google Cloud could not be read right now.', 'provider_error');
}
/** GET / (mounted at /api/cloud/gcp/projects): the signed-in person's projects and billing. */
function createGcpProjectsRoutes(_ctx, fetchImpl = fetch) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        if (process.env.OSHAL_EGRESS !== 'kernel') {
            res.status(503).json({ error: 'not_on_kernel', message: 'Google Cloud reads run on the native kernel, which places your connection.' });
            return;
        }
        try {
            res.json(await readGcp(fetchImpl));
        }
        catch (error) {
            const refusal = refusalOf(error);
            res.status(refusal.status).json({ error: refusal.code, message: refusal.message });
        }
    });
    return router;
}
