/**
 * Parent and guardian progress summary service (RP-LM-01).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Implement learner-invited guardian links, cadence preferences, link removal, and single-learner read-only progress summaries
 * ---------------------------------------------------------------------------
 *
 * @module education-guardian-service
 */

import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { EducationAccessError, resolveAuthedStudent, type AuthedStudent } from './education-access';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LearnerSummarySnapshot {
  learnerName: string;
  xp: number;
  level: number;
  due: Array<{ title: string; className: string; dueAt: string | null }>;
  missing: Array<{ title: string; className: string; dueAt: string | null }>;
  recentStudy: Array<{ kind: string; detail: string; occurredAt: string | null }>;
  updatedAt: string;
}

function parseJsonObject<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return typeof raw === 'object' ? (raw as T) : fallback;
}

function normalizeEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new EducationAccessError('Enter a valid parent or guardian email address.', 400);
  }
  return email;
}

function normalizeCadence(raw: unknown): 'daily' | 'weekly' {
  if (raw === 'daily' || raw === 'weekly') return raw;
  throw new EducationAccessError('Cadence must be daily or weekly.', 400);
}

async function queryRewards(pool: any, studentId: string): Promise<{ xp: number; level: number }> {
  const rewards = await pool.query(
    'SELECT xp, level FROM lm_rewards WHERE student_id = $1',
    [studentId],
  );
  if (rewards.rows.length > 0) {
    return {
      xp: Number(rewards.rows[0].xp ?? 0),
      level: Math.max(1, Number(rewards.rows[0].level ?? 1)),
    };
  }
  const student = await pool.query(
    'SELECT xp, level FROM lm_students WHERE student_id = $1',
    [studentId],
  );
  if (student.rows.length === 0) return { xp: 0, level: 1 };
  return {
    xp: Number(student.rows[0].xp ?? 0),
    level: Math.max(1, Number(student.rows[0].level ?? 1)),
  };
}

async function queryAssignments(
  pool: any,
  tenantId: string,
  studentId: string,
): Promise<{
  due: LearnerSummarySnapshot['due'];
  missing: LearnerSummarySnapshot['missing'];
}> {
  const result = await pool.query(
    `SELECT a.title, a.due_date, a.status, c.name AS class_name
     FROM lm_assignments a
     JOIN lm_classes c ON c.class_id = a.class_id AND c.tenant_id = $1
     JOIN lm_enrollments e ON e.class_id = c.class_id AND e.student_id = $2
     WHERE a.status = 'active'
     ORDER BY a.due_date ASC NULLS LAST
     LIMIT 20`,
    [tenantId, studentId],
  );
  const now = Date.now();
  const due: LearnerSummarySnapshot['due'] = [];
  const missing: LearnerSummarySnapshot['missing'] = [];
  for (const row of result.rows) {
    const dueIso = row.due_date ? new Date(row.due_date).toISOString() : null;
    const item = {
      title: String(row.title || 'Assignment'),
      className: String(row.class_name || 'Class'),
      dueAt: dueIso,
    };
    if (dueIso && Date.parse(dueIso) < now) missing.push(item);
    else due.push(item);
  }
  return { due: due.slice(0, 6), missing: missing.slice(0, 6) };
}

async function queryRecentStudy(
  pool: any,
  studentId: string,
): Promise<LearnerSummarySnapshot['recentStudy']> {
  const quizzes = await pool.query(
    `SELECT score_percent, completed_at
     FROM lm_quiz_results
     WHERE student_id = $1
     ORDER BY completed_at DESC
     LIMIT 4`,
    [studentId],
  );
  const cards = await pool.query(
    `SELECT COUNT(*)::int AS reviewed_count, MAX(last_reviewed) AS latest_at
     FROM lm_flashcard_progress
     WHERE student_id = $1 AND last_reviewed IS NOT NULL`,
    [studentId],
  );
  const items: LearnerSummarySnapshot['recentStudy'] = quizzes.rows.map((r: any) => ({
    kind: 'Quiz',
    detail: `Scored ${Math.round(Number(r.score_percent ?? 0))}%`,
    occurredAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  }));
  const reviewedCount = Number(cards.rows[0]?.reviewed_count ?? 0);
  if (reviewedCount > 0) {
    items.unshift({
      kind: 'Flashcards',
      detail: `${reviewedCount} card${reviewedCount === 1 ? '' : 's'} studied`,
      occurredAt: cards.rows[0]?.latest_at ? new Date(cards.rows[0].latest_at).toISOString() : null,
    });
  }
  return items.slice(0, 5);
}

/** Build a single learner's current summary snapshot from their own records. */
export async function buildLearnerSummarySnapshot(
  pool: any,
  studentId: string,
  tenantId: string,
  learnerName: string,
): Promise<LearnerSummarySnapshot> {
  const [{ xp, level }, { due, missing }, recentStudy] = await Promise.all([
    queryRewards(pool, studentId),
    queryAssignments(pool, tenantId, studentId),
    queryRecentStudy(pool, studentId),
  ]);
  return {
    learnerName: learnerName || 'Student',
    xp,
    level,
    due,
    missing,
    recentStudy,
    updatedAt: new Date().toISOString(),
  };
}

/** Refresh stored summary snapshots on every active guardian link for this learner. */
export async function refreshGuardianSnapshotsForLearner(
  pool: any,
  actor: AuthedStudent,
): Promise<LearnerSummarySnapshot> {
  const snapshot = await buildLearnerSummarySnapshot(
    pool,
    actor.studentId,
    actor.tenantId,
    actor.name,
  );
  await pool.query(
    `UPDATE lm_guardian_links
     SET learner_name = $1, summary_snapshot = $2::jsonb, updated_at = NOW()
     WHERE student_id = $3 AND tenant_id = $4`,
    [actor.name, JSON.stringify(snapshot), actor.studentId, actor.tenantId],
  );
  return snapshot;
}

async function resolveLinkedSummary(
  pool: any,
  tenantId: string,
  row: Record<string, any>,
): Promise<LearnerSummarySnapshot> {
  const fallback = parseJsonObject<LearnerSummarySnapshot>(row.summary_snapshot, {
    learnerName: String(row.learner_name || 'Student'),
    xp: 0,
    level: 1,
    due: [],
    missing: [],
    recentStudy: [],
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  });
  try {
    const studentCheck = await pool.query(
      'SELECT name FROM lm_students WHERE student_id = $1 AND tenant_id = $2',
      [row.student_id, tenantId],
    );
    if (studentCheck.rows.length === 0) return fallback;
    return await buildLearnerSummarySnapshot(
      pool,
      String(row.student_id),
      tenantId,
      String(studentCheck.rows[0].name || fallback.learnerName),
    );
  } catch {
    return fallback;
  }
}

/** Serve GET /student/guardian-summary/dashboard for both learners and invited guardians. */
export async function getGuardianSummaryPayload(pool: any, req: Request, res: Response): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, pool);
    const ownSnapshot = await refreshGuardianSnapshotsForLearner(pool, actor);
    const ownLinks = await pool.query(
      `SELECT link_id, guardian_email, cadence, created_at, updated_at
       FROM lm_guardian_links
       WHERE student_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [actor.studentId, actor.tenantId],
    );
    let linkedLearners: Array<Record<string, unknown>> = [];
    if (actor.email) {
      const incoming = await pool.query(
        `SELECT link_id, student_id, learner_name, guardian_email, cadence, summary_snapshot, updated_at
         FROM lm_guardian_links
         WHERE tenant_id = $1 AND guardian_email = $2 AND student_id != $3
         ORDER BY updated_at DESC`,
        [actor.tenantId, actor.email.toLowerCase(), actor.studentId],
      );
      linkedLearners = await Promise.all(
        incoming.rows.map(async (row: any) => ({
          linkId: row.link_id,
          cadence: row.cadence,
          guardianEmail: row.guardian_email,
          summary: await resolveLinkedSummary(pool, actor.tenantId, row),
        })),
      );
    }
    res.json({
      viewer: { name: actor.name, email: actor.email, role: actor.role },
      ownSummary: ownSnapshot,
      guardians: ownLinks.rows.map((r: any) => ({
        linkId: r.link_id,
        guardianEmail: r.guardian_email,
        cadence: r.cadence,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      linkedLearners,
    });
  } catch (err) {
    if (err instanceof EducationAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Guardian summary failed' });
  }
}

async function inviteGuardian(pool: any, actor: AuthedStudent, body: Record<string, unknown>) {
  const guardianEmail = normalizeEmail(body.guardianEmail);
  if (actor.email && guardianEmail === actor.email.toLowerCase()) {
    throw new EducationAccessError('Choose a parent or guardian email different from your own.', 400);
  }
  const cadence = body.cadence ? normalizeCadence(body.cadence) : 'weekly';
  const snapshot = await buildLearnerSummarySnapshot(pool, actor.studentId, actor.tenantId, actor.name);
  const existing = await pool.query(
    `SELECT link_id FROM lm_guardian_links
     WHERE student_id = $1 AND tenant_id = $2 AND guardian_email = $3`,
    [actor.studentId, actor.tenantId, guardianEmail],
  );
  if (existing.rows.length > 0) {
    const linkId = String(existing.rows[0].link_id);
    await pool.query(
      `UPDATE lm_guardian_links
       SET cadence = $1, learner_name = $2, summary_snapshot = $3::jsonb, updated_at = NOW()
       WHERE link_id = $4 AND student_id = $5 AND tenant_id = $6`,
      [cadence, actor.name, JSON.stringify(snapshot), linkId, actor.studentId, actor.tenantId],
    );
    return { linkId, guardianEmail, cadence };
  }
  const linkId = randomUUID();
  await pool.query(
    `INSERT INTO lm_guardian_links
       (link_id, student_id, tenant_id, learner_name, guardian_email, cadence, summary_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [linkId, actor.studentId, actor.tenantId, actor.name, guardianEmail, cadence, JSON.stringify(snapshot)],
  );
  return { linkId, guardianEmail, cadence };
}

async function updateGuardianCadence(pool: any, actor: AuthedStudent, body: Record<string, unknown>) {
  const linkId = typeof body.linkId === 'string' ? body.linkId.trim() : '';
  if (!UUID_PATTERN.test(linkId)) throw new EducationAccessError('Valid linkId is required.', 400);
  const cadence = normalizeCadence(body.cadence);
  const actorEmail = actor.email ? actor.email.toLowerCase() : null;
  const updated = await pool.query(
    `UPDATE lm_guardian_links
     SET cadence = $1, updated_at = NOW()
     WHERE link_id = $2 AND tenant_id = $3
       AND (student_id = $4 OR ($5::text IS NOT NULL AND guardian_email = $5))
     RETURNING link_id, guardian_email, cadence`,
    [cadence, linkId, actor.tenantId, actor.studentId, actorEmail],
  );
  if (updated.rows.length === 0) throw new EducationAccessError('Guardian link not found.', 404);
  return {
    linkId: updated.rows[0].link_id,
    guardianEmail: updated.rows[0].guardian_email,
    cadence: updated.rows[0].cadence,
  };
}

async function removeGuardianLink(pool: any, actor: AuthedStudent, body: Record<string, unknown>) {
  const linkId = typeof body.linkId === 'string' ? body.linkId.trim() : '';
  if (!UUID_PATTERN.test(linkId)) throw new EducationAccessError('Valid linkId is required.', 400);
  const deleted = await pool.query(
    `DELETE FROM lm_guardian_links
     WHERE link_id = $1 AND student_id = $2 AND tenant_id = $3
     RETURNING link_id`,
    [linkId, actor.studentId, actor.tenantId],
  );
  if (deleted.rows.length === 0) throw new EducationAccessError('Guardian link not found.', 404);
  return { removed: true, linkId };
}

/** Handle guardian link mutations posted through POST /notify with guardianAction. */
export async function handleGuardianMutation(pool: any, req: Request, res: Response): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, pool);
    const body = (req.body || {}) as Record<string, unknown>;
    const action = String(body.guardianAction || '');
    if (action === 'invite') {
      res.status(201).json({ success: true, ...(await inviteGuardian(pool, actor, body)) });
      return;
    }
    if (action === 'cadence') {
      res.json({ success: true, ...(await updateGuardianCadence(pool, actor, body)) });
      return;
    }
    if (action === 'remove') {
      res.json({ success: true, ...(await removeGuardianLink(pool, actor, body)) });
      return;
    }
    res.status(400).json({ error: 'Unsupported guardianAction' });
  } catch (err) {
    if (err instanceof EducationAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Guardian update failed' });
  }
}
