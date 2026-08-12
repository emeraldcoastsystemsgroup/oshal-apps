"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted administrator-only shared-company inspection and career-board refresh routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Content-negotiate the admin denial. The Companies ribbon entry points an iframe at the /companies-admin SURFACE route, but the gate answered every caller with res.status(403).json(...) — so with CAREER_HUNTER_ADMIN_SUBS unset in the deployment the operator saw a raw JSON body wrapped in the browser's built-in JSON viewer ("Pretty print" checkbox) instead of a page. Browser navigations now get a themed 403 HTML page naming the env var an operator sets; fetch/XHR callers keep the JSON 403, and the status is unchanged because this is a real authorization boundary. Also logs the EMPTY-allowlist case distinctly from "caller is not an admin" — an unset env var was previously indistinguishable from a normal denial and took a live container inspection to diagnose.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Denial log records req.path, not req.originalUrl — the query string on a DENIED request is unbounded caller-controlled input (seturl carries a whole URL) and was being written into the WARN line.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCareerAdmin = isCareerAdmin;
exports.registerCareerCompanyRoutes = registerCareerCompanyRoutes;
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_surface_routes_1 = require("./career-surface-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'career-company-routes' });
const CAREER_ADMIN_SUBS = new Set((process.env.CAREER_HUNTER_ADMIN_SUBS || '')
    .split(',')
    .map((sub) => sub.trim())
    .filter(Boolean));
/**
 * @description Checks the fail-closed Career Hunter administrator allow-list.
 * @param sub - Authenticated OIDC subject or trusted service subject.
 * @returns True only when the subject is explicitly configured as an administrator.
 */
function isCareerAdmin(sub) {
    return !!sub && CAREER_ADMIN_SUBS.has(sub);
}
/**
 * Denial page for a BROWSER navigation to the admin-only Companies surface. The cockpit loads that
 * route in an iframe, so a JSON body renders as the browser's raw JSON viewer rather than a page.
 * Self-contained and inline on purpose: this is an error page, not a surface. It joins the
 * canonical theme rail (`surface-themes.css` + `surface-theme.js`) and derives every colour from
 * framework tokens, so it follows the cockpit theme instead of flashing dark inside a light one —
 * CSS custom properties do not cross the iframe document boundary, hence the surface must set its
 * own `data-theme` (defaulted here to `midnight` for the no-JS case). It names only the env var an
 * operator sets; it never echoes a configured subject or any other deployment value.
 */
const ADMIN_DENIED_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Companies &mdash; administrator only</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
<style>
  :root { --bg: var(--bg-primary); --panel: var(--bg-card); --text: var(--text-primary);
          --muted: var(--text-muted); --line: var(--border-color); --accent: var(--accent-primary); }
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
         background: var(--bg); color: var(--text); }
  .card { max-width: 32rem; padding: 22px 26px; border: 1px solid var(--line);
          border-radius: 10px; background: var(--panel); }
  h1 { margin: 0 0 10px; font-size: 1.1rem; font-weight: 600; color: var(--text); }
  p { margin: 0 0 10px; line-height: 1.55; color: var(--muted); }
  p.last { margin-bottom: 0; }
  code { padding: 2px 6px; border-radius: 4px; border: 1px solid var(--line);
         background: var(--bg-tertiary); color: var(--accent); font-size: 0.92em; }
</style>
</head>
<body>
<main class="card">
  <h1>Companies is administrator only</h1>
  <p>The shared company corpus is restricted to Career Hunter administrators, and this account is
     not one of them on this deployment.</p>
  <p class="last">An operator grants access by adding the account&rsquo;s subject to
     <code>CAREER_HUNTER_ADMIN_SUBS</code> in the deployment environment and recreating the API
     container.</p>
</main>
</body>
</html>
`;
/**
 * @description Records an administrator denial so an unset allow-list is observable in the logs.
 * "No administrators are configured on this deployment" and "this caller is not an administrator"
 * are the same 403 to the caller but completely different operator actions, and an empty allow-list
 * previously required inspecting the running container to detect. Logs the configured administrator
 * COUNT only — never a subject, configured or otherwise.
 * @param req - Denied request, used for the requested path.
 * @param authenticated - Whether the request carried an authenticated subject at all.
 * @returns Nothing.
 */
function logAdminDenial(req, authenticated) {
    // req.path, not originalUrl: on a denial the query string is unbounded caller-controlled
    // input (seturl carries a full URL) and does not belong in an authorization-failure log line.
    const detail = { path: req.path, authenticated, adminsConfigured: CAREER_ADMIN_SUBS.size };
    if (CAREER_ADMIN_SUBS.size === 0) {
        logger.warn(detail, 'career admin route denied: NO administrators are configured on this deployment '
            + '— set CAREER_HUNTER_ADMIN_SUBS and recreate the api');
        return;
    }
    logger.warn(detail, 'career admin route denied: caller is not a configured administrator');
}
const requireCareerAdmin = (req, res, next) => {
    const sub = (0, career_user_store_1.callerSub)(req);
    if (isCareerAdmin(sub)) {
        next();
        return;
    }
    logAdminDenial(req, !!sub);
    // 403 either way — this is a real authorization boundary, only the representation is negotiated.
    // Never cached: once an operator configures the allow-list, a reload must re-evaluate the gate.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(403);
    // Accept order matters: fetch()'s default `*/*` resolves to the FIRST entry ('json'), so the data
    // routes keep their JSON body and only a genuine document navigation (the cockpit's Companies
    // iframe, or an address-bar hit) gets the page. One negotiated gate covers every route this file
    // guards, including any surface route added behind it later.
    if (req.accepts(['json', 'html']) === 'html') {
        res.type('html').send(ADMIN_DENIED_HTML);
        return;
    }
    res.json({ error: 'admin only' });
};
function listCompanies(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    const db = userSub && (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ companies: [] });
        return;
    }
    try {
        const companies = db.prepare(`SELECT c.id, c.name, c.ats_type, c.ats_token, c.careers_url, c.discover_status,
              (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id=c.id AND p.active=1) AS active_jobs
         FROM corpus.companies c
        ORDER BY active_jobs DESC, c.name`).all();
        res.json({ companies });
    }
    catch (err) {
        logger.error({ err, userSub }, 'company list failed');
        res.status(500).json({ error: 'read failed' });
    }
    finally {
        db.close();
    }
}
async function setCompanyUrl(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const companyId = parseInt(String(req.query.companyId ?? ''), 10);
    const url = String(req.query.url ?? '').trim();
    if (!companyId || !url) {
        res.status(400).json({ error: 'companyId and url required' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['seturl', '--company-id', String(companyId), '--url', url]);
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'company refresh');
        return;
    }
    let parsed = null;
    try {
        parsed = JSON.parse((result.out || '').trim().split('\n').pop() || '{}');
    }
    catch (err) {
        logger.warn({ err, companyId }, 'company refresh returned non-JSON output');
    }
    res.json({
        ok: result.ok,
        result: parsed,
        error: result.ok ? undefined : (result.err || '').slice(-300),
    });
}
/**
 * @description Registers the administrator-only shared-company routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to run the brokered company refresh command.
 * @returns Nothing.
 */
function registerCareerCompanyRoutes(router, ctx) {
    router.get('/companies-admin', requireCareerAdmin, (0, career_surface_routes_1.createCareerToolFileHandler)('career-companies.html'));
    router.get('/companies-admin/list', requireCareerAdmin, listCompanies);
    router.post('/companies-admin/seturl', requireCareerAdmin, (req, res) => {
        void setCompanyUrl(ctx, req, res);
    });
}
//# sourceMappingURL=career-company-routes.js.map