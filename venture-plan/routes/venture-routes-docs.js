"use strict";
/**
 * Venture Plan — the document and export routes.
 *
 * SPLIT OUT of `venture-routes.ts` to keep both files well inside the line cap and
 * to keep one idea per file: this one is "turn a stored snapshot into something a
 * human reads".
 *
 * A DOCUMENT IS RENDERED FROM A SNAPSHOT, ALWAYS. `GET /documents/:key` renders
 * live from the latest computed model when no version has been stored yet — free,
 * deterministic, no bot — so a plan is readable the moment it computes rather than
 * only after somebody has paid for narration. A stored version is served in
 * preference, because that one carries the prose and the flags.
 *
 * EXPORT REFUSES WITHOUT A MODEL. All export routes answer 409 `no_model` when no
 * snapshot exists. An export rendered from unresolved inputs is the single most
 * dangerous artefact this package could produce: a `.docx` looks finished in a way
 * a web page does not, and it travels.
 *
 * THERE IS NO PDF RENDERER in either repository — no headless browser, no PDF
 * library — so `/print` serves a print-styled HTML page and the browser makes the
 * PDF. Saying so is better than adding a dependency to a store package or
 * pretending the button does something it does not.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the document list/read/history/regenerate endpoints with live rendering from the latest snapshot, the print view, and the .docx/.xlsx/.pptx/.zip exports through the deck-generation kernel skill with a lazy jszip require so a missing dependency costs one button rather than the route module.
 *
 * @module venture-routes-docs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.markdownToHtml = markdownToHtml;
exports.registerDocumentRoutes = registerDocumentRoutes;
const logger_1 = require("@/shared/logger");
const venture_documents_1 = require("./venture-documents");
const venture_doc_catalog_1 = require("./venture-doc-catalog");
const venture_run_1 = require("./venture-run");
const venture_store_1 = require("./venture-store");
const venture_store_outputs_1 = require("./venture-store-outputs");
const venture_http_1 = require("./venture-http");
const log = (0, logger_1.createChildLogger)({ module: 'venture-routes-docs' });
/** Resolve venture + latest snapshot, or reply 404/409 and return null. */
async function docContext(pool, sub, ventureId, res) {
    const venture = await (0, venture_store_1.getVenture)(pool, sub, ventureId);
    if (!venture) {
        res.status(404).json({ error: 'not found' });
        return null;
    }
    const snapshot = await (0, venture_store_outputs_1.latestModel)(pool, sub, ventureId, null);
    if (!snapshot) {
        res.status(409).json({ error: 'no_model', hint: 'POST /ventures/:id/model first' });
        return null;
    }
    return { venture, snapshot };
}
/** Render one document live from a snapshot, with whatever prose is stored. */
async function renderLive(pool, sub, ctx, docKey) {
    const spec = (0, venture_doc_catalog_1.getDocSpec)(docKey);
    if (!spec)
        throw new venture_documents_1.MissingFiguresError(docKey, ['unknown document key']);
    const assumptions = await (0, venture_store_1.liveAssumptions)(pool, sub, ctx.venture.id);
    return (0, venture_documents_1.renderDocument)(spec, {
        figures: ctx.snapshot.figures, tables: ctx.snapshot.tables,
        coverage: ctx.snapshot.coverage, posture: ctx.snapshot.posture,
        canPublish: ctx.snapshot.canPublish, warnings: ctx.snapshot.warnings,
        assumptions, prose: {}, ventureName: ctx.venture.name, computedAt: ctx.snapshot.computedAt,
    });
}
/** Escape text for HTML. Applied before any markdown structure is added back. */
function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Inline markdown: bold and code. Runs AFTER escaping, so no tag can be injected. */
function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
}
/** Convert one markdown table block into an HTML table. */
function tableHtml(rows) {
    const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map((r) => cells(r));
    return `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
        + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
/**
 * @description Convert the document's markdown subset to HTML for the print view.
 *
 * Deliberately small: this renders only what `venture-documents` emits — headings,
 * tables, blockquotes, list items, emphasis and paragraphs. Everything is escaped
 * first and structure is added back afterwards, so nothing in a document body can
 * become markup.
 *
 * @param markdown - The document body.
 * @returns HTML fragment.
 */
function markdownToHtml(markdown) {
    const out = [];
    const lines = String(markdown ?? '').split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (/^\s*$/.test(line)) {
            i += 1;
            continue;
        }
        if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s\-|]+\|$/.test(lines[i + 1])) {
            const block = [];
            while (i < lines.length && /^\|/.test(lines[i])) {
                block.push(lines[i]);
                i += 1;
            }
            out.push(tableHtml(block));
            continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
            out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
            i += 1;
            continue;
        }
        if (/^>\s?/.test(line)) {
            const block = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                block.push(lines[i].replace(/^>\s?/, ''));
                i += 1;
            }
            out.push(`<blockquote>${block.map(inline).join('<br>')}</blockquote>`);
            continue;
        }
        if (/^[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^[-*]\s+/, ''));
                i += 1;
            }
            out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
            continue;
        }
        out.push(`<p>${inline(line)}</p>`);
        i += 1;
    }
    return out.join('\n');
}
/** The print-styled page wrapper. Own CSS; nothing external is fetched. */
function printPage(title, bodyHtml) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light}
body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;margin:0;padding:32px;max-width:900px}
h1{font-size:26px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
blockquote{margin:12px 0;padding:10px 14px;background:#f6f7f9;border-left:3px solid #999;font-size:13px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px;display:block;overflow-x:auto}
th,td{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#f2f3f5}code{background:#f2f3f5;padding:1px 4px;border-radius:3px}
@media print{body{padding:0;max-width:none}h2{page-break-after:avoid}table{page-break-inside:avoid}}
</style></head><body>${bodyHtml}</body></html>`;
}
/** Map documents onto the deck-generation slide shape the kernel skill renders. */
function slidesFor(docs) {
    return docs.map((d) => ({ title: d.title, content: d.bodyMd.replace(/^#\s+.*$/m, '').trim().slice(0, 20000) }));
}
/** Every stored document, falling back to a live render of the whole catalogue. */
async function documentsForExport(pool, sub, ctx) {
    const stored = await (0, venture_store_outputs_1.listDocuments)(pool, sub, ctx.venture.id, true);
    if (stored.length)
        return stored;
    const out = [];
    for (const spec of venture_doc_catalog_1.DOC_CATALOG) {
        try {
            const r = await renderLive(pool, sub, ctx, spec.key);
            out.push({
                id: '', ventureId: ctx.venture.id, docKey: r.docKey, version: 0, modelId: ctx.snapshot.id,
                title: r.title, bodyMd: r.bodyMd, sections: r.sections, proseRunId: null,
                proseStatus: 'none', unverifiedNumbers: r.unverifiedNumbers,
                assumptionsCited: r.assumptionsCited, estimatePct: r.estimatePct, createdAt: ctx.snapshot.computedAt,
            });
        }
        catch (err) {
            log.error({ err, stack: err?.stack, docKey: spec.key }, 'document skipped from export');
        }
    }
    return out;
}
/** Register the document list and read endpoints. Both are free of any bot call. */
function registerReadRoutes(router, pool) {
    router.get('/ventures/:id/documents', (0, venture_http_1.guarded)('GET documents', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.json({
            catalog: venture_doc_catalog_1.DOC_CATALOG.map((d) => ({ key: d.key, title: d.title, audience: d.audience, decision: d.decision })),
            documents: await (0, venture_store_outputs_1.listDocuments)(pool, sub, id, false),
        });
    }));
    router.get('/ventures/:id/documents/:docKey', (0, venture_http_1.guarded)('GET document', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const docKey = String(req.params.docKey);
        if (!(0, venture_doc_catalog_1.getDocSpec)(docKey)) {
            res.status(404).json({ error: 'unknown document' });
            return;
        }
        const c = await docContext(pool, sub, String(req.params.id), res);
        if (!c)
            return;
        const stored = await (0, venture_store_outputs_1.getDocument)(pool, sub, c.venture.id, docKey, null);
        if (stored) {
            res.json({ document: stored, live: false });
            return;
        }
        try {
            const rendered = await renderLive(pool, sub, c, docKey);
            res.json({ document: { ...rendered, version: 0, modelId: c.snapshot.id, proseStatus: 'none' }, live: true });
        }
        catch (err) {
            replyMissingFigures(res, err);
        }
    }));
}
/** Version history, regeneration and the print view. */
function registerDocActionRoutes(router, ctx, pool) {
    router.get('/ventures/:id/documents/:docKey/history', (0, venture_http_1.guarded)('GET document history', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.json({ versions: await (0, venture_store_outputs_1.documentHistory)(pool, sub, id, String(req.params.docKey)) });
    }));
    router.post('/ventures/:id/documents/:docKey/regenerate', (0, venture_http_1.guarded)('regenerate document', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        const docKey = String(req.params.docKey);
        if (!(0, venture_doc_catalog_1.getDocSpec)(docKey)) {
            res.status(404).json({ error: 'unknown document' });
            return;
        }
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        // Narration spends, so it goes out of band like every other paid path.
        const started = await (0, venture_run_1.startRun)(ctx, sub, id, 'narrate', [docKey], new Date().toISOString().slice(0, 10));
        res.status(202).json(started);
    }));
    router.get('/ventures/:id/documents/:docKey/print', (0, venture_http_1.guarded)('print document', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const docKey = String(req.params.docKey);
        if (!(0, venture_doc_catalog_1.getDocSpec)(docKey)) {
            res.status(404).send('unknown document');
            return;
        }
        const c = await docContext(pool, sub, String(req.params.id), res);
        if (!c)
            return;
        const stored = await (0, venture_store_outputs_1.getDocument)(pool, sub, c.venture.id, docKey, null);
        try {
            const body = stored ? stored.bodyMd : (await renderLive(pool, sub, c, docKey)).bodyMd;
            res.type('html').send(printPage(`${c.venture.name} — ${docKey}`, markdownToHtml(body)));
        }
        catch (err) {
            replyMissingFigures(res, err);
        }
    }));
}
/** Answer a refused render as a 409 naming the figures, or rethrow. */
function replyMissingFigures(res, err) {
    if (err instanceof venture_documents_1.MissingFiguresError) {
        res.status(409).json({
            error: 'missing_figures', docKey: err.docKey, figureIds: err.figureIds,
            hint: 'the engine produced no value for these; resolve the assumptions they rest on and recompute',
        });
        return;
    }
    throw err;
}
/**
 * One Office export handler. Hoisted out of the registration function so each
 * stays readable and so the three formats provably share one code path — three
 * near-identical handlers would drift, and the one that drifted would be the one
 * somebody emailed to a lender.
 */
function officeExport(pool, format, mime) {
    return (0, venture_http_1.guarded)(`export ${format}`, async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const c = await docContext(pool, sub, String(req.params.id), res);
        if (!c)
            return;
        const docs = await documentsForExport(pool, sub, c);
        try {
            // The deck-generation kernel skill. Required lazily so a framework without
            // it costs one export button rather than the whole route module.
            // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
            const gen = require('@/features/presentation-generation');
            const render = format === 'docx' ? gen.renderDocx : format === 'xlsx' ? gen.renderXlsx : gen.renderPptx;
            const buffer = await render(`${c.venture.name} — venture plan`, slidesFor(docs), {
                subtitle: `posture: ${c.snapshot.posture} · ${c.snapshot.coverage.estimatePct}% of assumptions are model estimates`,
            });
            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Disposition', `attachment; filename="${safeName(c.venture.name)}-${c.snapshot.posture}.${format}"`);
            res.send(buffer);
        }
        catch (err) {
            log.error({ err, stack: err?.stack, format }, 'office export unavailable');
            res.status(503).json({
                error: 'export_unavailable',
                detail: err?.message || String(err),
                hint: 'the document is readable and printable in the browser regardless',
            });
        }
    });
}
/** Register the four export endpoints. Each refuses without a computed model. */
function registerExportRoutes(router, pool) {
    router.get('/ventures/:id/export/plan.docx', officeExport(pool, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    router.get('/ventures/:id/export/model.xlsx', officeExport(pool, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    router.get('/ventures/:id/export/deck.pptx', officeExport(pool, 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
    router.get('/ventures/:id/export/bundle.zip', (0, venture_http_1.guarded)('export bundle', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const c = await docContext(pool, sub, String(req.params.id), res);
        if (!c)
            return;
        const docs = await documentsForExport(pool, sub, c);
        const assumptions = await (0, venture_store_1.liveAssumptions)(pool, sub, c.venture.id);
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
            const JSZip = require('jszip');
            const zip = new JSZip();
            for (const d of docs)
                zip.file(`${d.docKey}.md`, d.bodyMd);
            zip.file('assumption-register.csv', (0, venture_documents_1.renderRegisterCsv)(assumptions));
            zip.file('model.json', JSON.stringify({
                engineVersion: c.snapshot.engineVersion, inputsHash: c.snapshot.inputsHash,
                computedAt: c.snapshot.computedAt, posture: c.snapshot.posture,
                canPublish: c.snapshot.canPublish, coverage: c.snapshot.coverage,
                figures: c.snapshot.figures, tables: c.snapshot.tables, warnings: c.snapshot.warnings,
            }, null, 2));
            const buffer = await zip.generateAsync({ type: 'nodebuffer' });
            res.setHeader('Content-Type', 'application/zip');
            // The posture is in the FILENAME on purpose: a plan whose numbers are the
            // model's own guesses should say so before anybody opens it.
            res.setHeader('Content-Disposition', `attachment; filename="${safeName(c.venture.name)}-${c.snapshot.posture}.zip"`);
            res.send(buffer);
        }
        catch (err) {
            log.error({ err, stack: err?.stack }, 'bundle export unavailable');
            res.status(503).json({ error: 'export_unavailable', detail: err?.message || String(err) });
        }
    }));
}
/** A filesystem-safe slug for a download name. */
function safeName(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'venture';
}
/**
 * @description Register the document and export routes on this package's router.
 * @param router - The router built by `createVentureRoutes`.
 * @param ctx - The framework app context (needed for the narration run).
 * @param pool - Shared pool.
 * @returns Nothing; routes are registered in place.
 */
function registerDocumentRoutes(router, ctx, pool) {
    registerReadRoutes(router, pool);
    registerDocActionRoutes(router, ctx, pool);
    registerExportRoutes(router, pool);
}
//# sourceMappingURL=venture-routes-docs.js.map