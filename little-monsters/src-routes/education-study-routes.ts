/**
 * Education Study Routes — Little Monsters Platform API
 *
 * Flashcard CRUD + SM-2 review tracking, and the RAG-grounded auto-generators
 * (flashcards + multiple-choice quizzes from the class's own materials).
 * Extracted from education-routes.ts when it crossed the 1000-line cap.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-06-12 19:45:00 | roger.murphy@agenticfederal.us   | Extracted flashcard/quiz routes from education-routes.ts (1522 lines > 1000 cap); endpoints moved verbatim
 * ---------------------------------------------------------------------------
 *
 * @module education-study-routes
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  resolveAuthedStudent,
  listAccessibleClassIds,
  assertClassAccess,
  EducationAccessError,
} from './education-access';

const logger = createChildLogger({ module: 'education-study-routes' });

/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res: Response, err: unknown): boolean {
  if (err instanceof EducationAccessError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/** Robustly extract a JSON array from an LLM reply: strips ```json fences, grabs the
 *  outermost [...], and tolerates trailing commas. Returns [] if nothing parses. */
function parseJsonArray(raw: string): any[] {
  let t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const m = t.match(/\[[\s\S]*\]/);
  const candidate = m ? m[0] : t;
  try { const v = JSON.parse(candidate); return Array.isArray(v) ? v : []; } catch { /* try repair */ }
  try { const v = JSON.parse(candidate.replace(/,(\s*[\]}])/g, '$1')); return Array.isArray(v) ? v : []; } catch { /* give up */ }
  return [];
}

/**
 * @description Creates the study sub-router mounted inside createEducationRoutes:
 * flashcard set CRUD, the RAG-grounded flashcard/quiz generators, and SM-2
 * spaced-repetition review recording.
 * @param ctx - shared app context (db pool)
 * @returns an Express router with all /flashcards* and /quiz/generate endpoints
 */
export function createEducationStudyRoutes(ctx: AppContext): Router {
  const router = Router();

  /** GET /api/education/flashcards/sets?classId=X — list flashcard sets (shared
   *  class materials). A specific classId requires enrollment; without a classId
   *  the list is scoped to the student's accessible classes. */
  router.get('/flashcards/sets', async (req: Request, res: Response) => {
    try {
      const { classId } = req.query;
      const student = await resolveAuthedStudent(req, ctx.pool);
      let sql = `SELECT fs.*, c.name as class_name FROM lm_flashcard_sets fs
                 LEFT JOIN lm_classes c ON fs.class_id = c.class_id`;
      const params: any[] = [];

      if (classId) {
        await assertClassAccess(ctx.pool, student, String(classId)); // 403 unless enrolled/teacher
        sql += ' WHERE fs.class_id = $1';
        params.push(classId);
      } else {
        const accessible = await listAccessibleClassIds(ctx.pool, student);
        if (accessible.length === 0) { res.json({ sets: [] }); return; }
        sql += ' WHERE fs.class_id = ANY($1)';
        params.push(accessible);
      }
      sql += ' ORDER BY fs.created_at DESC';

      const result = await ctx.pool.query(sql, params);
      res.json({ sets: result.rows });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to list flashcard sets');
      res.status(500).json({ error: err.message });
    }
  });

  /** GET /api/education/flashcards/sets/:setId/cards — get cards for study (enrollment-gated) */
  router.get('/flashcards/sets/:setId/cards', async (req: Request, res: Response) => {
    try {
      // Was unauthenticated — any caller could read any set's cards by id. Require a session
      // and (for class-owned sets) enrollment, matching the sibling list route.
      const me = await resolveAuthedStudent(req, ctx.pool);
      const own = await ctx.pool.query('SELECT class_id FROM lm_flashcard_sets WHERE set_id = $1', [req.params.setId]);
      if (own.rows.length === 0) { res.status(404).json({ error: 'Set not found' }); return; }
      if (own.rows[0].class_id) await assertClassAccess(ctx.pool, me, own.rows[0].class_id);
      const result = await ctx.pool.query(
        `SELECT * FROM lm_flashcards WHERE set_id = $1 ORDER BY difficulty, card_id`,
        [req.params.setId]
      );
      res.json({ cards: result.rows });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to get flashcards');
      res.status(500).json({ error: 'Could not load the cards' });
    }
  });

  // ── Access helpers for the by-id card/set endpoints ──────────────────────────
  // Without these, "has a session" was being treated as authorization, letting any
  // student edit/delete cards in another class by guessing an id (IDOR). We resolve
  // the owning class and run the same enrollment check the rest of the module uses.
  // class_id === null is a student's PRIVATE self-study set (no class to gate against,
  // so allowed); `undefined` means the set/card doesn't exist.
  const classIdForSet = async (setId: string): Promise<string | null | undefined> => {
    const r = await ctx.pool.query('SELECT class_id FROM lm_flashcard_sets WHERE set_id = $1', [setId]);
    return r.rows.length ? (r.rows[0].class_id ?? null) : undefined;
  };
  const classIdForCard = async (cardId: string): Promise<string | null | undefined> => {
    const r = await ctx.pool.query(
      'SELECT s.class_id FROM lm_flashcards c JOIN lm_flashcard_sets s ON c.set_id = s.set_id WHERE c.card_id = $1',
      [cardId],
    );
    return r.rows.length ? (r.rows[0].class_id ?? null) : undefined;
  };
  // Coerce + cap a card field so a client can't store multi-MB or non-string content
  // (matches the auto-generator's String(..).slice(..) treatment).
  const cardField = (v: unknown): string => String(v ?? '').slice(0, 1000);

  /** PATCH /api/education/flashcards/cards/:cardId — edit a card's front/back (enrollment-gated) */
  router.patch('/flashcards/cards/:cardId', async (req: Request, res: Response) => {
    try {
      const me = await resolveAuthedStudent(req, ctx.pool);
      const cls = await classIdForCard(String(req.params.cardId));
      if (cls === undefined) { res.status(404).json({ error: 'Card not found' }); return; }
      if (cls) await assertClassAccess(ctx.pool, me, cls);
      const front = cardField(req.body?.front), back = cardField(req.body?.back);
      if (!front || !back) { res.status(400).json({ error: 'front and back are required' }); return; }
      await ctx.pool.query('UPDATE lm_flashcards SET front = $1, back = $2 WHERE card_id = $3', [front, back, req.params.cardId]);
      res.json({ ok: true });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to edit card');
      res.status(500).json({ error: 'Could not edit the card' });
    }
  });

  /** DELETE /api/education/flashcards/cards/:cardId — remove a card (enrollment-gated) */
  router.delete('/flashcards/cards/:cardId', async (req: Request, res: Response) => {
    try {
      const me = await resolveAuthedStudent(req, ctx.pool);
      const cls = await classIdForCard(String(req.params.cardId));
      if (cls === undefined) { res.status(404).json({ error: 'Card not found' }); return; }
      if (cls) await assertClassAccess(ctx.pool, me, cls);
      const r = await ctx.pool.query('DELETE FROM lm_flashcards WHERE card_id = $1 RETURNING set_id', [req.params.cardId]);
      if (r.rows[0]?.set_id) {
        await ctx.pool.query('UPDATE lm_flashcard_sets SET card_count = GREATEST(0, card_count - 1) WHERE set_id = $1', [r.rows[0].set_id]).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to delete card');
      res.status(500).json({ error: 'Could not delete the card' });
    }
  });

  /** POST /api/education/flashcards/sets/:setId/cards — add a card to a set (enrollment-gated) */
  router.post('/flashcards/sets/:setId/cards', async (req: Request, res: Response) => {
    try {
      const me = await resolveAuthedStudent(req, ctx.pool);
      const cls = await classIdForSet(String(req.params.setId));
      if (cls === undefined) { res.status(404).json({ error: 'Set not found' }); return; }
      if (cls) await assertClassAccess(ctx.pool, me, cls);
      const front = cardField(req.body?.front), back = cardField(req.body?.back);
      if (!front || !back) { res.status(400).json({ error: 'front and back are required' }); return; }
      await ctx.pool.query(
        `INSERT INTO lm_flashcards (set_id, front, back, card_type, difficulty) VALUES ($1, $2, $3, 'concept', 2)`,
        [req.params.setId, front, back],
      );
      await ctx.pool.query('UPDATE lm_flashcard_sets SET card_count = card_count + 1 WHERE set_id = $1', [req.params.setId]).catch(() => {});
      res.json({ ok: true });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to add card');
      res.status(500).json({ error: 'Could not add the card' });
    }
  });

  /** DELETE /api/education/flashcards/sets/:setId — delete a set + its cards (enrollment-gated) */
  router.delete('/flashcards/sets/:setId', async (req: Request, res: Response) => {
    try {
      const me = await resolveAuthedStudent(req, ctx.pool);
      const cls = await classIdForSet(String(req.params.setId));
      if (cls === undefined) { res.status(404).json({ error: 'Set not found' }); return; }
      if (cls) await assertClassAccess(ctx.pool, me, cls);
      await ctx.pool.query('DELETE FROM lm_flashcards WHERE set_id = $1', [req.params.setId]);
      await ctx.pool.query('DELETE FROM lm_flashcard_sets WHERE set_id = $1', [req.params.setId]);
      res.json({ ok: true });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to delete set');
      res.status(500).json({ error: 'Could not delete the set' });
    }
  });

  /** POST /api/education/flashcards/sets — create a flashcard set with cards */
  router.post('/flashcards/sets', async (req: Request, res: Response) => {
    try {
      const { classId, title, topic, sourceType, sourceReference, cards } = req.body;
      if (!title || !cards || !Array.isArray(cards) || cards.length === 0) {
        res.status(400).json({ error: 'title and cards[] are required' });
        return;
      }

      const setId = randomUUID();
      const client = await ctx.pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `INSERT INTO lm_flashcard_sets (set_id, class_id, title, topic, source_type, source_reference, card_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [setId, classId || null, title, topic || null, sourceType || 'manual', sourceReference || null, cards.length]
        );

        for (const card of cards) {
          await client.query(
            `INSERT INTO lm_flashcards (set_id, front, back, card_type, difficulty, topic, hints)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [setId, card.front, card.back, card.type || 'concept', card.difficulty || 2, card.topic || topic || '', JSON.stringify(card.hints || [])]
          );
        }

        await client.query('COMMIT');
        logger.info({ setId, title, cardCount: cards.length }, 'Flashcard set created');
        res.status(201).json({ setId, title, cardCount: cards.length });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      logger.error({ err }, 'Failed to create flashcard set');
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/education/flashcards/generate — auto-create a flashcard set from the class's
   *  OWN ingested textbook/lecture materials (RAG retrieval + LLM card generation). This is the
   *  "turn your textbook into study materials" feature the manual-entry clones lack. */
  router.post('/flashcards/generate', async (req: Request, res: Response) => {
    try {
      const { classId, count } = req.body;
      if (!classId) { res.status(400).json({ error: 'classId is required' }); return; }

      const fsMod = require('fs') as typeof import('fs');
      const claudeOauthExists = (() => {
        try { return fsMod.existsSync('/root/.claude/.credentials.json') || fsMod.existsSync(`${process.env.HOME || ''}/.claude/.credentials.json`); }
        catch { return false; }
      })();
      const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
      if (!hasAnthropicKey && !claudeOauthExists) {
        res.status(503).json({ error: 'Flashcard generation unavailable', reason: 'no claude-code OAuth or ANTHROPIC_API_KEY' });
        return;
      }

      let className = 'this class', subject = '';
      try {
        const r = await ctx.pool.query('SELECT name, subject FROM lm_classes WHERE class_id = $1', [classId]);
        if (r.rows[0]) { className = r.rows[0].name; subject = r.rows[0].subject || ''; }
      } catch { /* class lookup best-effort */ }

      // Retrieve the class's own materials (grounding).
      const { RagService } = require('@/features/rag');
      const rag = new RagService();
      const collections = [`lm-class-${classId}-textbook`, `lm-class-${classId}-lecture`];
      const broadQuery = `${subject} ${className} key concepts definitions formulas important terms`;
      const groups = await Promise.all(collections.map((c: string) => rag.search(broadQuery, c, 8).catch(() => [] as any[])));
      const chunks = (groups.flat() as Array<{ text?: string }>).map((h) => String(h.text || '')).filter(Boolean);
      if (chunks.length === 0) {
        res.status(409).json({ error: 'No class materials found', reason: `Upload a textbook for ${className} first — nothing in lm-class-${classId}-* yet.` });
        return;
      }
      const material = chunks.join('\n\n').slice(0, 6000);
      const n = Math.min(Math.max(parseInt(String(count)) || 6, 3), 12);

      const sysPrompt = `You create study flashcards for ${className}${subject ? ` (${subject})` : ''}. From the class materials below, write ${n} flashcards covering the most important concepts. Each card has a short "front" (a question or term) and a "back" (a clear, correct answer/definition GROUNDED in the materials). Vary difficulty 1-3. Respond with ONLY a JSON array, no prose: [{"front":"...","back":"...","topic":"...","difficulty":1}]`;

      let raw = '';
      if (hasAnthropicKey) {
        const { AnthropicProvider } = require('@/features/llm-provider');
        const provider = new AnthropicProvider({ model: 'claude-haiku-4-5-20251001', maxTokens: 1500 });
        const result = await provider.sendRequest({ systemPrompt: sysPrompt, messages: [{ role: 'user', content: `CLASS MATERIALS:\n${material}` }] });
        const tb = (result.content as Array<{ type: string; text?: string }>).find((b) => b.type === 'text');
        raw = tb?.text ?? '';
      } else {
        const { spawn } = require('child_process') as typeof import('child_process');
        raw = await new Promise<string>((resolve, reject) => {
          const child = spawn('claude', ['-p', `CLASS MATERIALS:\n${material}`, '--output-format', 'json', '--system-prompt', sysPrompt, '--model', 'claude-haiku-4-5-20251001', '--allowedTools', ''], { env: { ...process.env, ANTHROPIC_API_KEY: '' } });
          let o = '', e = '';
          child.stdout?.on('data', (d) => o += d.toString());
          child.stderr?.on('data', (d) => e += d.toString());
          child.on('error', reject);
          child.on('close', (c) => { if (c !== 0) { reject(new Error(`claude CLI exit ${c}: ${e.slice(0, 300)}`)); return; } try { const p = JSON.parse(o); resolve(p.result || p.content || ''); } catch { resolve(o.trim()); } });
          setTimeout(() => { try { child.kill(); } catch { /* noop */ } reject(new Error('claude CLI timed out after 90s')); }, 90_000);
        });
      }

      let cards: Array<{ front?: string; back?: string; topic?: string; difficulty?: number }> = parseJsonArray(raw);
      cards = (Array.isArray(cards) ? cards : []).filter((c) => c && c.front && c.back).slice(0, n);
      if (cards.length === 0) {
        res.status(502).json({ error: 'Generation produced no valid cards', rawPreview: raw.slice(0, 200) });
        return;
      }

      const setId = randomUUID();
      const client = await ctx.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO lm_flashcard_sets (set_id, class_id, title, topic, source_type, source_reference, card_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [setId, classId, `Auto: ${className} key concepts`, subject || null, 'textbook', 'auto-generated from class materials', cards.length],
        );
        for (const card of cards) {
          await client.query(
            `INSERT INTO lm_flashcards (set_id, front, back, card_type, difficulty, topic, hints)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [setId, String(card.front).slice(0, 500), String(card.back).slice(0, 1000), 'concept', Math.min(Math.max(parseInt(String(card.difficulty)) || 2, 1), 3), String(card.topic || subject || '').slice(0, 120), JSON.stringify([])],
          );
        }
        await client.query('COMMIT');
      } catch (txErr) { await client.query('ROLLBACK'); throw txErr; } finally { client.release(); }

      logger.info({ classId, setId, cardCount: cards.length }, 'Auto-generated flashcards from class materials (RAG)');
      res.status(201).json({ setId, cardCount: cards.length, grounded: true, cards });
    } catch (err: any) {
      logger.error({ err }, 'Flashcard generation failed');
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/education/quiz/generate — auto-create a grounded multiple-choice quiz from the
   *  class's own ingested materials (RAG retrieval + LLM). Returns questions to take in the UI;
   *  results are recorded via POST /quiz-results. */
  router.post('/quiz/generate', async (req: Request, res: Response) => {
    try {
      const { classId, count } = req.body;
      if (!classId) { res.status(400).json({ error: 'classId is required' }); return; }

      const fsMod = require('fs') as typeof import('fs');
      const claudeOauthExists = (() => {
        try { return fsMod.existsSync('/root/.claude/.credentials.json') || fsMod.existsSync(`${process.env.HOME || ''}/.claude/.credentials.json`); }
        catch { return false; }
      })();
      const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
      if (!hasAnthropicKey && !claudeOauthExists) {
        res.status(503).json({ error: 'Quiz generation unavailable', reason: 'no claude-code OAuth or ANTHROPIC_API_KEY' });
        return;
      }

      let className = 'this class', subject = '';
      try {
        const r = await ctx.pool.query('SELECT name, subject FROM lm_classes WHERE class_id = $1', [classId]);
        if (r.rows[0]) { className = r.rows[0].name; subject = r.rows[0].subject || ''; }
      } catch { /* best-effort */ }

      const { RagService } = require('@/features/rag');
      const rag = new RagService();
      const collections = [`lm-class-${classId}-textbook`, `lm-class-${classId}-lecture`];
      const broadQuery = `${subject} ${className} key concepts definitions important terms`;
      const groups = await Promise.all(collections.map((c: string) => rag.search(broadQuery, c, 8).catch(() => [] as any[])));
      const chunks = (groups.flat() as Array<{ text?: string }>).map((h) => String(h.text || '')).filter(Boolean);
      if (chunks.length === 0) {
        res.status(409).json({ error: 'No class materials found', reason: `Upload a textbook for ${className} first.` });
        return;
      }
      const material = chunks.join('\n\n').slice(0, 6000);
      const n = Math.min(Math.max(parseInt(String(count)) || 5, 3), 10);

      const sysPrompt = `You write a multiple-choice quiz for ${className}${subject ? ` (${subject})` : ''}. From the class materials below, write ${n} questions testing the most important concepts. Each question has exactly 4 options, one correct. GROUND every question in the materials. Respond with ONLY a JSON array, no prose: [{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"why","topic":"..."}]`;

      let raw = '';
      if (hasAnthropicKey) {
        const { AnthropicProvider } = require('@/features/llm-provider');
        const provider = new AnthropicProvider({ model: 'claude-haiku-4-5-20251001', maxTokens: 4000 });
        const result = await provider.sendRequest({ systemPrompt: sysPrompt, messages: [{ role: 'user', content: `CLASS MATERIALS:\n${material}` }] });
        const tb = (result.content as Array<{ type: string; text?: string }>).find((b) => b.type === 'text');
        raw = tb?.text ?? '';
      } else {
        const { spawn } = require('child_process') as typeof import('child_process');
        raw = await new Promise<string>((resolve, reject) => {
          const child = spawn('claude', ['-p', `CLASS MATERIALS:\n${material}`, '--output-format', 'json', '--system-prompt', sysPrompt, '--model', 'claude-haiku-4-5-20251001', '--allowedTools', ''], { env: { ...process.env, ANTHROPIC_API_KEY: '' } });
          let o = '', e = '';
          child.stdout?.on('data', (d) => o += d.toString());
          child.stderr?.on('data', (d) => e += d.toString());
          child.on('error', reject);
          child.on('close', (c) => { if (c !== 0) { reject(new Error(`claude CLI exit ${c}: ${e.slice(0, 300)}`)); return; } try { const p = JSON.parse(o); resolve(p.result || p.content || ''); } catch { resolve(o.trim()); } });
          setTimeout(() => { try { child.kill(); } catch { /* noop */ } reject(new Error('claude CLI timed out after 90s')); }, 90_000);
        });
      }

      let questions: Array<{ question?: string; options?: string[]; correctIndex?: number; explanation?: string; topic?: string }> = parseJsonArray(raw);
      questions = (Array.isArray(questions) ? questions : [])
        .filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2 && typeof q.correctIndex === 'number')
        .slice(0, n);
      if (questions.length === 0) {
        res.status(502).json({ error: 'Generation produced no valid questions', rawPreview: raw.slice(0, 200) });
        return;
      }

      logger.info({ classId, questionCount: questions.length }, 'Auto-generated grounded quiz from class materials (RAG)');
      res.json({ classId, className, questionCount: questions.length, grounded: true, questions });
    } catch (err: any) {
      logger.error({ err }, 'Quiz generation failed');
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/education/flashcards/review — record a card review result (SM-2) */
  router.post('/flashcards/review', async (req: Request, res: Response) => {
    try {
      const { cardId, score } = req.body;
      // PRIVATE write: SM-2 progress always records against the AUTHENTICATED
      // student — a student cannot alter another student's review schedule.
      const authed = await resolveAuthedStudent(req, ctx.pool);
      const studentId = authed.studentId;
      if (!cardId || score === undefined) {
        res.status(400).json({ error: 'cardId and score (0-2) are required' });
        return;
      }

      // SM-2 algorithm
      const existing = await ctx.pool.query(
        'SELECT * FROM lm_flashcard_progress WHERE student_id = $1 AND card_id = $2',
        [studentId, cardId]
      );

      let ef = 2.5, interval = 1, reps = 0;
      if (existing.rows.length > 0) {
        ef = existing.rows[0].ease_factor;
        interval = existing.rows[0].interval_days;
        reps = existing.rows[0].repetitions;
      }

      // SM-2 update
      if (score >= 1) {
        reps += 1;
        if (reps === 1) interval = 1;
        else if (reps === 2) interval = 6;
        else interval = Math.round(interval * ef);
        ef = Math.max(1.3, ef + (0.1 - (2 - score) * (0.08 + (2 - score) * 0.02)));
      } else {
        reps = 0;
        interval = 1;
      }

      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + interval);

      await ctx.pool.query(
        `INSERT INTO lm_flashcard_progress (student_id, card_id, repetitions, ease_factor, interval_days, next_review, last_reviewed)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (student_id, card_id) DO UPDATE SET
           repetitions = $3, ease_factor = $4, interval_days = $5, next_review = $6, last_reviewed = NOW()`,
        [studentId, cardId, reps, ef, interval, nextReview.toISOString().split('T')[0]]
      );

      res.json({ success: true, nextReview: nextReview.toISOString().split('T')[0], interval, easeFactor: ef });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to record review');
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
