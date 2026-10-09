/**
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Delete native class relations under authoritative optimistic transactions without pretending external artifacts were removed.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Remove native file bytes and search chunks in the same authorized transaction before deleting class relationships.
 */
import type { Pool, PoolClient } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { EducationAccessError } from './education-access';
import { schoolTransaction } from './education-transactions';

const logger = createChildLogger({ module: 'education-native-class-deletion' });

/** The actor and class are part of the commit's authoritative read set. */
async function admitDeletion(client: PoolClient, actorId: string, classId: string): Promise<void> {
  const result = await client.query(
    `SELECT c.class_id FROM lm_classes c
       JOIN lm_students a ON a.student_id=$2 AND a.tenant_id=c.tenant_id
      WHERE c.class_id=$1 AND
        (a.role='admin' OR (a.role='teacher' AND c.teacher_student_id=a.student_id))`,
    [classId, actorId],
  );
  if (result.rows.length !== 1) throw new EducationAccessError('You do not teach this class', 403);
}

/** Refuse unmigrated external pointers; native bytes and chunks share the SQL commit. */
async function requireRelationalMaterials(client: PoolClient, classId: string): Promise<void> {
  const result = await client.query(
    'SELECT material_id, stored_path, rag_collection FROM lm_materials WHERE class_id=$1', [classId],
  );
  if (result.rows.some(row => row.stored_path && !String(row.stored_path).startsWith('native-file:'))) {
    logger.warn({ classId, materialCount: result.rows.length }, 'Native class deletion requires external material cleanup');
    throw new EducationAccessError('Class materials require an available file and search cleanup service', 503);
  }
  await client.query('DELETE FROM lm_rag_collections WHERE class_id=$1', [classId]);
  await client.query('DELETE FROM lm_native_files WHERE class_id=$1', [classId]);
}

/** Child rows disappear before their relationship policy's parent rows. */
async function removeDependents(client: PoolClient, classId: string): Promise<void> {
  const sets = await client.query('SELECT set_id FROM lm_flashcard_sets WHERE class_id=$1', [classId]);
  for (const set of sets.rows) {
    await client.query('DELETE FROM lm_flashcards WHERE set_id=$1', [set.set_id]);
  }
  for (const table of ['lm_materials', 'lm_flashcard_sets', 'lm_assignments', 'lm_lectures', 'lm_enrollments']) {
    // Identifiers come exclusively from this fixed dependency list, never from the caller.
    await client.query(`DELETE FROM ${table} WHERE class_id=$1`, [classId]);
  }
}

/** Commit the class and its relational dependents together or leave them all intact. */
export async function deleteNativeClassRows(pool: Pool, actorId: string, classId: string): Promise<number> {
  return schoolTransaction(pool, async client => {
    await admitDeletion(client, actorId, classId);
    await requireRelationalMaterials(client, classId);
    await removeDependents(client, classId);
    const result = await client.query('DELETE FROM lm_classes WHERE class_id=$1', [classId]);
    if (result.rowCount !== 1) throw new EducationAccessError('Class authorization changed; no data was deleted', 409);
    return result.rowCount;
  });
}
