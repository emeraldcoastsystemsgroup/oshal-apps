/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-03-17 16:07:00 | roger.murphy@agenticfederal.us   | Initial section-based presentation generation routes for presentation-bot
 * 2026-06-16 10:50:00 | roger.murphy@agenticfederal.us   | POST /pptx — render a REAL .pptx (pptxgenjs) and save it to the caller's Dropbox file space (the Presenton replacement). Accepts structured `sections` OR a `topic` (the comms bot drafts the outline). Falls back to a direct download when Dropbox isn't connected. Needs ctx for the connector token + bot.
 * 2026-06-17 09:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-043 — decks save to the deck-builder bot's own subfolder (oshal/{bot-id}/); persist the outline so the surface can show a real preview; /list scans the store (authoritative) and merges the table as a metadata cache so added/removed decks are reflected.
 * 2026-07-16 16:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Real template selection: GET /themes serves the theme + layout catalog; POST /pptx takes theme/byline/subtitle/autoLayout and persists the theme so "My decks" can show it. The AI-draft prompt now teaches the comms bot the layout micro-syntax, so an AI deck comes back with charts/KPIs/quotes instead of twelve identical bullet slides.
 * 2026-07-17 19:50:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-103 AI Office: POST /docx and /xlsx render the SAME outline through the same themes as Word and Excel — one shared handler; artifacts save to the same bot store; oshal_presentations gains a `format` column so "My decks" can badge the kind.
 * 2026-07-18 20:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | AI Office residue: DELETE /file (owner-scoped — store copy via deleteStoredFile's recycle semantics + the caller's table rows) and POST /email (render the current outline and send it as an attachment over the user's OWN mailbox — sendGmail, else the Graph sibling; behind the standard confirm:true 428 gate because generation is not consent to broadcast).
 * 2026-07-18 21:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | DELETE /file follows the ROW's provider when it says oshal-local (deterministic path, no folder prefs) — live QA orphaned local copies behind a target switch; other cross-provider rows keep current-target semantics because their folder config may have drifted since the save.
 * 2026-07-19 18:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the presentations app package (ADR-085 Wave 2, "skill with a surface" — the deck-generation ENGINE stays a kernel skill; this app is the AI Office surface + studio routes over it). Standard (ctx) factory; the surface serves from ctx.appPackageDir/tools (load-time env fallback, D10); shared core helpers (storage-target skill, inline-bot-execution, connectors, email senders) import via @/app/routes aliases; ensurePresentationsSchema appends buildOwnerRlsPolicyStatements (A1.2 fresh-DB chokepoint parity with migration 060).
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | ADR-043 item A — make the resolved save destination visible before a paid render. GET /destination resolves only the authenticated caller's Files target; a validated `?provider=` previews a one-off override through the same cleanOverride contract as Generate. Anonymous calls stop before preference lookup and lookup failures return 502 rather than guessing a provider.
 */

import { Router, raw, type Request, type Response } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import {
  PresentationEngine, renderPptx, renderDocx, renderXlsx, themeCatalog, layoutCatalog,
  isThemeId, DEFAULT_THEME_ID, importOffice,
  type RenderableSlide,
} from '@/features/presentation-generation';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import type { AppContext } from '@/app/composition/app-context';
import type { DeckThemeId, PresentationRequest } from '@/shared/types';
import { saveContent, listFolder, deleteStoredFile, resolveStorageTarget, type StorageTarget } from '@/app/routes/storage-target';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { sendGmail, sendOutlookMail } from '@/app/routes/email-routes';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'bot-presentation-routes' });
const engine = new PresentationEngine();

/** The comms bot (codex) drafts slide outlines — same bot the social/email swarms use. */
const COMMS_BOT_AGENT_ID = 'b0000000-0000-0000-0000-000000000001';
/** The Presentations app's own bot (deck-builder) — owns the deck store under oshal/{bot-id}/. */
const DECK_BUILDER_AGENT_ID = 'a0000000-0000-0000-0000-000000000042';
/** Bot-scoped store path for generated decks (ADR-043). */
const DECK_SUBFOLDER = `oshal/${DECK_BUILDER_AGENT_ID}`;
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Signed-in caller's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/**
 * The authoring micro-syntax, as taught to the bots. Kept in one place because both the
 * AI-draft prompt and the guide prompt must describe it identically — if they drift, the
 * guide teaches a syntax the drafter doesn't emit. Mirrors `slide-content-parser`.
 */
const SYNTAX_BRIEF = [
  'A slide "content" body may use this syntax — the renderer picks a real layout from its shape:',
  '  plain lines            -> bullets',
  '  ## Heading             -> a column/panel heading; lines under it are its bullets (2 groups = comparison, 4 = quadrant)',
  '  | A | B |              -> a markdown table row (first row = header)',
  '  > quoted sentence      -> a pull quote, followed by "— Attribution"',
  '  94% :: uptime          -> a "value :: caption" pair (1 = big number, 2-4 = KPI tiles)',
  '  Q1 2026 :: Beta        -> date-like labels make a timeline',
  '  Q3: 240                -> "label: number" points make a chart (3+ time labels = line, a share/mix = pie, else bar)',
  '  #layout: kpi-grid      -> force a layout by id',
  'Use REAL structure where the content has it — a deck of only bullet slides is a failure.',
  'Never invent facts or metrics: if a number is a placeholder, write it as one (e.g. "TBD :: replace me").',
].join('\n');

/** Ask the comms bot for a slide outline on a topic; parse its JSON into sections. */
async function outlineFromTopic(ctx: AppContext, sub: string, topic: string, slideCount: number): Promise<RenderableSlide[]> {
  const prompt = [
    `Create a ${slideCount}-slide presentation outline on: ${topic}.`,
    'Output ONLY a valid JSON array (no prose, no markdown fences) of objects:',
    '[{"title":"Slide title","content":"point one\\npoint two","layout":"bullets","notes":"optional speaker note"}]',
    '"layout" is OPTIONAL — omit it and the renderer infers one from the content. Include it only when you mean it.',
    SYNTAX_BRIEF,
    'Vary the deck: open with the story, use a statement or quote to land the key idea, a chart or KPI tiles where',
    'there are numbers, and close with next steps. Each slide: a short title + 3-5 concise points.',
  ].join('\n');
  const result = await executeBotOrInline(ctx, botClient, COMMS_BOT_AGENT_ID, {
    text: prompt, taskId: `pptx-${sub}`, workspaceFolderId: `pptx-${sub}`,
    agentId: COMMS_BOT_AGENT_ID, agenticMode: true, direct: true, userSub: sub,
  });
  const m = String(result.response || '').match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(m ? m[0] : String(result.response)) as RenderableSlide[];
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('bot did not return a slide array');
  return parsed;
}

/** Validate an optional per-save target override (the "Save to…" choice). */
function cleanOverride(t: unknown): StorageTarget | undefined {
  const o = (t || {}) as Record<string, unknown>;
  const provider = String(o.provider || '');
  if (!['dropbox', 'oshal-local', 'github', 'google-drive', 'onedrive'].includes(provider)) return undefined;
  return { provider: provider as StorageTarget['provider'], folder: o.folder ? String(o.folder) : undefined, repo: o.repo ? String(o.repo) : undefined };
}

/** A lightweight per-user record of each generated deck, so the studio's "My decks" list
 *  works across every storage backend (Dropbox/GitHub/local) without re-listing each one. */
export async function ensurePresentationsSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'presentations routes',
    statements: [
      `CREATE TABLE IF NOT EXISTS oshal_presentations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_sub TEXT NOT NULL,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        provider TEXT,
        download_url TEXT,
        url TEXT,
        slides INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'ALTER TABLE oshal_presentations ADD COLUMN IF NOT EXISTS outline JSONB',
      'ALTER TABLE oshal_presentations ADD COLUMN IF NOT EXISTS theme TEXT',
      "ALTER TABLE oshal_presentations ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'pptx'",
      'CREATE INDEX IF NOT EXISTS idx_presentations_user ON oshal_presentations(user_sub, created_at DESC)',
      // A1.2 chokepoint: a fresh DB must never leave this owner-keyed table policy-less between
      // lazy creation and a migration-060 re-run (same fix as the movies→purchasing carves).
      ...buildOwnerRlsPolicyStatements('oshal_presentations', 'user_sub'),
    ],
    requirements: [
      {
        table: 'oshal_presentations',
        columns: ['id', 'user_sub', 'title', 'file_name', 'provider', 'download_url', 'url', 'slides', 'created_at', 'outline', 'theme', 'format'],
      },
    ],
  });
}

/** A compact outline for preview cards: slide title + the first couple of bullets. */
function previewOutline(sections: RenderableSlide[]): Array<{ title: string; bullets: string[] }> {
  return sections.slice(0, 12).map((s) => ({
    title: String(s.title || '').slice(0, 120),
    bullets: String(s.content ?? '').split(/\n+/).map((b) => b.trim()).filter(Boolean).slice(0, 2),
  }));
}

/** A slide the bot proposes (title + bullets) — used by set_outline / update_slide / add_slide. */
interface GuideSlide { title: string; bullets: string[] }
/** A surface edit the bot wants applied to the Studio editor (ADR-043 phase C). */
type GuideAction =
  | { op: 'set_title'; title: string }
  | { op: 'set_outline'; slides: GuideSlide[] }
  | { op: 'update_slide'; index: number; title?: string; bullets?: string[] }
  | { op: 'add_slide'; title: string; bullets: string[] }
  | { op: 'set_theme'; theme: DeckThemeId };

/** Sanitize slides the bot returned (cap counts + lengths so the editor stays sane). */
function cleanSlides(raw: unknown): GuideSlide[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).map((s) => {
    const o = (s || {}) as Record<string, unknown>;
    const bullets = Array.isArray(o.bullets) ? o.bullets.slice(0, 12).map((b) => String(b).slice(0, 300)) : [];
    return { title: String(o.title || '').slice(0, 200), bullets };
  }).filter((s) => s.title || s.bullets.length);
}

/** Whitelist + normalize the bot's proposed surface actions (never trust raw model output). */
function cleanActions(raw: unknown): GuideAction[] {
  if (!Array.isArray(raw)) return [];
  const out: GuideAction[] = [];
  for (const a of raw.slice(0, 30)) {
    const o = (a || {}) as Record<string, unknown>;
    const op = String(o.op || '');
    if (op === 'set_title' && o.title) out.push({ op, title: String(o.title).slice(0, 200) });
    else if (op === 'set_theme' && isThemeId(o.theme)) out.push({ op, theme: o.theme });
    else if (op === 'set_outline') out.push({ op, slides: cleanSlides(o.slides) });
    else if (op === 'add_slide' && o.title) out.push({ op, title: String(o.title).slice(0, 200), bullets: cleanSlides([{ title: 'x', bullets: o.bullets }])[0]?.bullets ?? [] });
    else if (op === 'update_slide' && Number(o.index) >= 1) {
      const upd: GuideAction = { op, index: Math.floor(Number(o.index)) };
      if (o.title != null) upd.title = String(o.title).slice(0, 200);
      if (Array.isArray(o.bullets)) upd.bullets = o.bullets.slice(0, 12).map((b) => String(b).slice(0, 300));
      out.push(upd);
    }
  }
  return out;
}

/** Build the deck-builder turn: live editor state as context + the structured-output contract. */
function guidePrompt(message: string, title: string, slides: GuideSlide[], history: string, theme: string): string {
  const state = slides.length
    ? slides.map((s, i) => `${i + 1}. ${s.title}${s.bullets.length ? '\n   - ' + s.bullets.join('\n   - ') : ''}`).join('\n')
    : '(empty)';
  const themes = themeCatalog().map((t) => `${t.id} (${t.mood})`).join(', ');
  return [
    'You are guiding the user to build a slide outline in the OSHAL Presentation Studio.',
    'You can BOTH reply conversationally AND directly edit the outline editor via actions.',
    'Respond with ONLY a JSON object (no prose, no code fences):',
    '{"reply":"<short conversational reply>","actions":[ ...zero or more... ]}',
    'Action types — include ONLY what the user asked for this turn (use [] when none):',
    '- {"op":"set_title","title":"Deck title"}',
    '- {"op":"set_outline","slides":[{"title":"Slide title","bullets":["one idea","one idea"]}]}  // replaces the whole outline',
    '- {"op":"update_slide","index":2,"title":"New title","bullets":["..."]}  // 1-based; include title and/or bullets',
    '- {"op":"add_slide","title":"...","bullets":["..."]}',
    '- {"op":"set_theme","theme":"executive"}  // only when the user describes a LOOK or an audience',
    `Themes: ${themes}`,
    'A "bullet" may be any line of the slide syntax below — that is how a slide becomes a chart, KPI tiles, a quote, or a table.',
    SYNTAX_BRIEF,
    'Rules: one idea per bullet; never invent facts/metrics (mark placeholders); keep "reply" brief.',
    `Current deck title: ${title || '(none)'}`,
    `Current theme: ${theme || DEFAULT_THEME_ID}`,
    `Current outline:\n${state}`,
    history ? `Recent conversation:\n${history}` : '',
    `User: ${message}`,
  ].filter(Boolean).join('\n');
}

/**
 * @description Creates routes for the AI Office studio (mount at /api/presentations/sections,
 * auth: oidc). Packaged shape (ADR-085): standard (ctx) factory — the surface serves from the
 * installed package's tools/ dir (ctx.appPackageDir, captured at factory time per D10). The
 * deck-generation engine itself is a kernel skill resolved from the framework dist.
 *
 * @returns Express Router with presentation bot endpoints
 */
export function createBotPresentationRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir
    ? path.join(ctx.appPackageDir, 'tools')
    : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
  void ensurePresentationsSchema(ctx.pool).catch((err) => logger.warn({ err: err?.message }, 'presentations schema ensure failed'));

  /** GET /ui — the Presentations Studio surface. */
  router.get('/ui', (_req: Request, res: Response) => {
    res.sendFile(path.join(assetRoot, 'presentations.html'), (err) => {
      if (err) { logger.error({ err }, 'serve presentations UI failed'); res.status(404).send('Page not found'); }
    });
  });

  /**
   * @description GET /themes — the template catalog: ten themes (look and feel) and the
   * twenty slide layouts, with the content shape each expects. Drives the Studio's picker and
   * its layout reference. Static catalog data with no per-user content, but it inherits the
   * `requiresAuth` on this router's mount in server.ts and stays that way — the only caller is
   * the signed-in Studio, so there is nothing to gain from widening it.
   */
  router.get('/themes', (_req: Request, res: Response) => {
    res.json({ themes: themeCatalog(), layouts: layoutCatalog(), defaultTheme: DEFAULT_THEME_ID });
  });

  /**
   * @description Report where the next Generate will save, before the caller spends a render.
   * With no override this resolves the authenticated caller's configured Files target. A valid
   * `?provider=` previews the same one-off override accepted by Generate without reading or
   * mutating the stored preference. Unknown providers deliberately fall back to the real default
   * so the surface never promises a destination the save path would reject.
   */
  router.get('/destination', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const override = cleanOverride({ provider: String(req.query.provider ?? '') });
    try {
      const target = override ?? await resolveStorageTarget(ctx, sub, 'files');
      res.json({
        provider: target.provider,
        folder: target.folder ?? null,
        repo: target.repo ?? null,
        subfolder: DECK_SUBFOLDER,
        // Distinguish the durable account default from a previewed one-off selection in the UI.
        isDefault: !override,
      });
    } catch (err) {
      logger.error({ err, sub }, 'resolve save destination failed');
      res.status(502).json({ error: 'could not resolve your save destination' });
    }
  });

  /** GET /list — the caller's generated decks (the studio's "My decks" panel). The bot's store
   *  (oshal/{bot-id}/ on the current Files target) is authoritative for what exists; the
   *  oshal_presentations table supplies metadata (title/slides/outline preview) + history on other
   *  backends. ADR-043. */
  router.get('/list', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const rows = (await ctx.pool.query(
        `SELECT title, file_name, provider, download_url, url, slides, created_at, outline, theme, format
         FROM oshal_presentations WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 100`, [sub],
      )).rows;
      // Keyed case-insensitively: Dropbox returns original-case names while we may have stored a
      // lowercased path basename — match regardless of case.
      const byName = new Map(rows.map((r) => [String(r.file_name).toLowerCase(), r]));
      const toDeck = (r: Record<string, unknown>, over?: { downloadUrl?: string; url?: string }) => ({
        title: r.title, fileName: r.file_name, provider: r.provider,
        downloadUrl: over?.downloadUrl ?? r.download_url, url: over?.url ?? r.url, slides: r.slides,
        outline: r.outline ?? null, theme: r.theme ?? null, format: r.format ?? 'pptx',
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      });

      // Scan the store (authoritative). If the backend can't be read, fall back to the table.
      let scan: { provider: string; files: Array<{ name: string; downloadUrl?: string; url?: string }> } | null = null;
      try { scan = await listFolder(ctx, sub, 'files', DECK_SUBFOLDER); }
      catch (err) { logger.warn({ err: (err as Error).message }, 'deck store scan failed — listing from table only'); }

      if (!scan) { res.json({ decks: rows.slice(0, 50).map((r) => toDeck(r)) }); return; }

      // Files present in the store (current target) — enriched with table metadata where we have it.
      const present = scan.files.map((f) => {
        const meta = byName.get(f.name.toLowerCase());
        return meta
          ? toDeck(meta, { downloadUrl: f.downloadUrl, url: f.url })
          : { title: f.name.replace(/\.(pptx|docx|xlsx)$/i, ''), fileName: f.name, provider: scan!.provider, downloadUrl: f.downloadUrl, url: f.url, slides: null, outline: null, theme: null, format: (/\.(docx|xlsx)$/i.exec(f.name)?.[1] ?? 'pptx').toLowerCase(), createdAt: null };
      });
      // History saved to a different backend than the current target — can't scan, trust the table.
      const elsewhere = rows.filter((r) => r.provider && r.provider !== scan!.provider).map((r) => toDeck(r));
      res.json({ decks: [...present, ...elsewhere].slice(0, 50) });
    } catch (err) {
      logger.error({ err }, 'list presentations failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /**
   * @description POST /guide — the deck-builder bot guides the outline AND drives the editor.
   * Body: { message, title?, slides?[{title,bullets}], history?[{role,text}] }. The bot sees the
   * live editor state, returns { reply, actions[] } — actions the surface applies to the editor
   * (set_title / set_outline / update_slide / add_slide). Cost lands under deck-builder (…042).
   * ADR-043 phase C.
   */
  router.post('/guide', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = req.body as { message?: string; title?: string; slides?: GuideSlide[]; theme?: string; history?: Array<{ role?: string; text?: string }> };
    const message = String(body.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    try {
      const slides = cleanSlides(body.slides);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
        .map((h) => `${h.role === 'guide' ? 'Guide' : 'You'}: ${String(h.text || '').slice(0, 500)}`).join('\n');
      const result = await executeBotOrInline(ctx, botClient, DECK_BUILDER_AGENT_ID, {
        text: guidePrompt(message, String(body.title || ''), slides, history, String(body.theme || '')),
        taskId: `deckguide-${sub}`, workspaceFolderId: `deckguide-${sub}`,
        agentId: DECK_BUILDER_AGENT_ID, agenticMode: true, direct: true, userSub: sub,
      });
      const m = String(result.response || '').match(/\{[\s\S]*\}/);
      let reply = String(result.response || '').slice(0, 1200);
      let actions: GuideAction[] = [];
      if (m) {
        try { const parsed = JSON.parse(m[0]) as { reply?: string; actions?: unknown }; reply = String(parsed.reply || reply).slice(0, 1200); actions = cleanActions(parsed.actions); }
        catch (err) { logger.warn({ err: (err as Error).message }, 'guide: could not parse bot JSON — returning raw reply'); }
      }
      logger.info({ sub, actions: actions.length }, 'deck guide turn');
      res.json({ reply, actions });
    } catch (err) {
      logger.error({ err }, 'deck guide failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** One Office format the studio can emit — the render fn plus its file plumbing (ADR-103). */
  interface OfficeFormat {
    render: typeof renderPptx;
    ext: string;
    mime: string;
  }
  const OFFICE_FORMATS: Record<'pptx' | 'docx' | 'xlsx', OfficeFormat> = {
    pptx: { render: renderPptx, ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    docx: { render: renderDocx, ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    xlsx: { render: renderXlsx, ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  };

  /**
   * @description The shared generate handler behind POST /pptx, /docx and /xlsx (ADR-103:
   * one outline, three projections). Body: { title, sections?[], topic?, slideCount?, theme?,
   * subtitle?, byline?, autoLayout?, slideNumbers?, saveTo? }. With `topic` and no `sections`,
   * the comms bot drafts the outline first — the SAME draft syntax feeds every format. Saves
   * to the deck-builder bot's store (ADR-043) and records the artifact with its format; falls
   * back to a direct download when no storage target is connected.
   */
  function officeHandler(kind: keyof typeof OFFICE_FORMATS) {
    const fmt = OFFICE_FORMATS[kind];
    return async (req: Request, res: Response) => {
      const sub = callerSub(req);
      if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
      const body = req.body as {
        title?: string; sections?: RenderableSlide[]; topic?: string; slideCount?: number; saveTo?: unknown;
        theme?: string; subtitle?: string; byline?: string; autoLayout?: boolean; slideNumbers?: boolean;
      };
      const title = (body.title || body.topic || 'Presentation').trim();
      // An unknown theme falls back to the default rather than 400-ing: a bad theme string is
      // not worth failing an artifact the user is waiting on.
      const theme: DeckThemeId = isThemeId(body.theme) ? body.theme : DEFAULT_THEME_ID;
      try {
        let sections = Array.isArray(body.sections) ? body.sections : null;
        if ((!sections || !sections.length) && body.topic) {
          sections = await outlineFromTopic(ctx, sub, body.topic, Math.min(Math.max(body.slideCount || 6, 1), 30));
        }
        if (!sections || !sections.length) { res.status(400).json({ error: 'provide sections[] or topic' }); return; }

        const buf = await fmt.render(title, sections, {
          theme,
          subtitle: body.subtitle ? String(body.subtitle).slice(0, 200) : undefined,
          byline: body.byline ? String(body.byline).slice(0, 120) : undefined,
          autoLayout: body.autoLayout !== false,
          slideNumbers: body.slideNumbers !== false,
        });
        const fileName = title.replace(/[^\w.\- ]/g, '_').slice(0, 80) + fmt.ext;
        // An Office artifact is a 'files' artifact — save to the deck-builder bot's own store
        // (oshal/{bot-id}/) under the user's Files target (or a per-save override). ADR-043.
        const saved = await saveContent(ctx, sub, 'files', fileName, buf, cleanOverride(body.saveTo), DECK_SUBFOLDER).catch((err) => {
          logger.warn({ err: err?.message, kind }, 'office: save-to-target failed — falling back to direct download');
          return null;
        });
        if (saved) {
          logger.info({ sub, kind, provider: saved.provider, location: saved.location, slides: sections.length, theme }, 'office artifact generated + saved');
          // Record it for the studio's "My decks" list (best-effort — never block the response).
          // Store the ACTUAL saved basename (Dropbox lowercases + may autorename on conflict) so
          // the store scan in /list can match this row by name; the outline feeds the preview.
          const savedName = (saved.location || '').split('/').pop() || fileName;
          ctx.pool.query(
            `INSERT INTO oshal_presentations (user_sub, title, file_name, provider, download_url, url, slides, outline, theme, format)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [sub, title, savedName, saved.provider, saved.downloadUrl ?? null, saved.url ?? null, sections.length, JSON.stringify(previewOutline(sections)), theme, kind],
          ).catch((err) => logger.warn({ err: err?.message }, 'record office artifact failed'));
          res.json({ ok: true, format: kind, provider: saved.provider, savedTo: saved.location, slides: sections.length, theme, downloadUrl: saved.downloadUrl, url: saved.url });
          return;
        }
        res.setHeader('Content-Type', fmt.mime);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buf);
      } catch (err) {
        logger.error({ err, kind }, 'office generation failed');
        res.status(502).json({ error: (err as Error).message });
      }
    };
  }

  /**
   * @description POST /import — open an existing Office file (ADR-103's return lane). Raw
   * body upload (?name= carries the filename, following files-routes' pattern); the parser
   * sniffs docx/xlsx/pptx from the bytes and returns { title, sections, format } in the
   * outline model, ready for the editor + guide-chat CRUD + regeneration. Content-level
   * fidelity by design: text, headings, lists, tables and numbers survive; exotic formatting
   * re-themes on regenerate.
   */
  router.post('/import', raw({ type: () => true, limit: '25mb' }), async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) { res.status(400).json({ error: 'send the file as the raw request body' }); return; }
    try {
      const outline = await importOffice(buf, String(req.query.name || ''));
      if (!outline.sections.length) { res.status(422).json({ error: 'could not read that file — is it a .docx, .pptx or .xlsx?' }); return; }
      logger.info({ sub, format: outline.format, sections: outline.sections.length, bytes: buf.length }, 'office file imported');
      res.json(outline);
    } catch (err) {
      logger.error({ err }, 'office import failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /**
   * @description DELETE /file?name= — remove a generated artifact from "My files": the store
   * copy (recycle/trash semantics per adapter; a GitHub target keeps history and says so) and
   * the caller's oshal_presentations rows for that name. Owner-scoped twice over: the store
   * path is the CALLER's resolved target and the table delete is keyed by user_sub. A store
   * copy that can't be removed (target disconnected) still clears the record — the /list store
   * scan will honestly re-surface the file until the user deletes it at the provider.
   */
  router.delete('/file', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const name = String(req.query.name || '').trim();
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      // If the record says the file lives on the LOCAL store, delete there even when the
      // caller's current Files target is elsewhere — local is deterministic (no folder prefs),
      // so this never orphans a disk copy behind a provider switch. Other cross-provider rows
      // keep current-target semantics: their folder config may have changed since the save.
      const rec = (await ctx.pool.query(
        'SELECT provider FROM oshal_presentations WHERE user_sub = $1 AND LOWER(file_name) = LOWER($2) LIMIT 1', [sub, name],
      )).rows[0] as { provider?: string } | undefined;
      const override: StorageTarget | undefined = rec?.provider === 'oshal-local' ? { provider: 'oshal-local' } : undefined;
      let store: { provider: string; removed: boolean; reason?: string } | null = null;
      try { store = await deleteStoredFile(ctx, sub, 'files', name, DECK_SUBFOLDER, override); }
      catch (err) { logger.warn({ err: (err as Error).message, name }, 'store delete failed — removing the record only'); }
      const del = await ctx.pool.query('DELETE FROM oshal_presentations WHERE user_sub = $1 AND LOWER(file_name) = LOWER($2)', [sub, name]);
      logger.info({ sub, name, provider: store?.provider, storeRemoved: store?.removed ?? false, rows: del.rowCount }, 'office artifact deleted');
      res.json({ ok: true, provider: store?.provider ?? null, storeRemoved: store?.removed ?? false, reason: store?.reason, rows: del.rowCount ?? 0 });
    } catch (err) {
      logger.error({ err }, 'delete office artifact failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /**
   * @description POST /email — deliver the CURRENT outline as a rendered Office attachment to
   * one recipient over the user's OWN connected mailbox (Gmail when Google is connected, else
   * Microsoft Graph). The comms leg of ADR-108's delivery adapters, approval-gated: generation
   * is not consent to broadcast, so the server requires `confirm: true` (428 otherwise) and
   * there is no batch or scheduled path — one explicit user action per send. Body: { confirm,
   * to, subject?, note?, title, sections[], format?, theme?, subtitle?, byline?, autoLayout?,
   * slideNumbers? }.
   */
  router.post('/email', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!hasExplicitWriteConfirmation(req.body)) { res.status(428).json(confirmationRequiredPayload('office-email', 'Emailing a generated file')); return; }
    const body = req.body as {
      to?: string; subject?: string; note?: string; title?: string; sections?: RenderableSlide[]; format?: string;
      theme?: string; subtitle?: string; byline?: string; autoLayout?: boolean; slideNumbers?: boolean;
    };
    const to = String(body.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { res.status(400).json({ error: 'a valid "to" address is required' }); return; }
    const kind = (['pptx', 'docx', 'xlsx'] as const).find((k) => k === body.format) ?? 'pptx';
    const sections = Array.isArray(body.sections) ? body.sections.filter((s) => s && (s.title || s.content)) : [];
    if (!sections.length) { res.status(400).json({ error: 'sections[] required — there is nothing to send' }); return; }
    const title = String(body.title || 'Document').trim() || 'Document';
    const theme: DeckThemeId = isThemeId(body.theme) ? body.theme : DEFAULT_THEME_ID;
    try {
      const fmt = OFFICE_FORMATS[kind];
      const buf = await fmt.render(title, sections, {
        theme,
        subtitle: body.subtitle ? String(body.subtitle).slice(0, 200) : undefined,
        byline: body.byline ? String(body.byline).slice(0, 120) : undefined,
        autoLayout: body.autoLayout !== false,
        slideNumbers: body.slideNumbers !== false,
      });
      const fileName = title.replace(/[^\w.\- ]/g, '_').slice(0, 80) + fmt.ext;
      const mail = {
        to,
        subject: String(body.subject || '').trim().slice(0, 300) || title,
        body: String(body.note || '').slice(0, 4000) || `${title} is attached.\n\nGenerated with OSHAL AI Office.`,
        attachment: { filename: fileName, contentBase64: buf.toString('base64'), mimeType: fmt.mime },
      };
      const gtok = await getValidAccessToken(ctx.pool, sub, 'google');
      if (gtok) {
        const sent = await sendGmail(gtok, mail);
        logger.info({ sub, kind, via: 'gmail', id: sent.id, bytes: buf.length }, 'office artifact emailed');
        res.json({ ok: true, via: 'gmail', id: sent.id, to, format: kind, fileName });
        return;
      }
      const mtok = (await getValidAccessToken(ctx.pool, sub, 'microsoft')) || (await getValidAccessToken(ctx.pool, sub, 'outlook'));
      if (mtok) {
        await sendOutlookMail(mtok, mail);
        logger.info({ sub, kind, via: 'outlook', bytes: buf.length }, 'office artifact emailed');
        res.json({ ok: true, via: 'outlook', to, format: kind, fileName });
        return;
      }
      res.status(409).json({ error: 'no_mail_connection', message: 'Connect Google (Gmail) or Microsoft 365 in /utilities to send email.' });
    } catch (err) {
      logger.error({ err, kind }, 'office email failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /pptx — the deck projection (the original endpoint; contract unchanged). */
  router.post('/pptx', officeHandler('pptx'));
  /** POST /docx — the Word projection of the same outline (ADR-103). */
  router.post('/docx', officeHandler('docx'));
  /** POST /xlsx — the Excel projection of the same outline (ADR-103). */
  router.post('/xlsx', officeHandler('xlsx'));

  /**
   * @openapi
   * /api/presentations/sections/generate:
   *   post:
   *     summary: Generate slides from structured sections
   *     tags: [Presentations]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [title, sections]
   *             properties:
   *               title:
   *                 type: string
   *               templateId:
   *                 type: string
   *               format:
   *                 type: string
   *                 enum: [pptx, pdf, html]
   *               sections:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [title, content]
   *                   properties:
   *                     title:
   *                       type: string
   *                     content:
   *                       type: string
   *                     type:
   *                       type: string
   *                       enum: [intro, content, summary, divider]
   *                     notes:
   *                       type: string
   *     responses:
   *       200:
   *         description: Generated presentation with slides
   *       400:
   *         description: Invalid request
   */
  router.post('/generate', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const body = req.body as Partial<PresentationRequest>;

      if (!body.title || !body.sections || !Array.isArray(body.sections)) {
        logger.warn({ body }, 'Invalid presentation request — missing required fields');
        res.status(400).json({
          error: 'Missing required fields: title, sections (array)',
        });
        return;
      }

      if (body.sections.length === 0) {
        logger.warn({}, 'Presentation request with empty sections');
        res.status(400).json({
          error: 'Sections array must not be empty',
        });
        return;
      }

      const request: PresentationRequest = {
        title: body.title,
        templateId: body.templateId,
        format: body.format,
        sections: body.sections,
        metadata: body.metadata,
      };

      const result = await engine.generate(request);
      const durationMs = Date.now() - startTime;

      logger.info({ id: result.id, durationMs }, 'Presentation generation request completed');
      res.json(result);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error({ err: error, durationMs }, 'Presentation generation request failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
