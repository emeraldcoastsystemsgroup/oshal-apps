/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard final-statement authorization and transactional class deletion against TOCTOU regressions.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Require locked, fail-closed cleanup of class material files and exact RAG collections before relational deletion.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Pin locked material sharing, grounding, and deletion to their live tenant, enrollment, uploader, and class-owner authority.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free source contract for the authorization facts that must remain
 * in the same PostgreSQL statement as each protected read or write. Runtime
 * behavior is covered by the compiled package suite after the official build;
 * this guard stays runnable while multiple source modules are being assembled.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.resolve(__dirname, '..', 'src-routes');

function routeSource(name) {
  return fs.readFileSync(path.join(ROUTES, name), 'utf8').replace(/\s+/g, ' ');
}

test('roster reads and removals carry current actor authorization in final SQL', () => {
  const source = routeSource('education-roster-routes.ts');
  assert.match(source, /JOIN lm_students a ON a\.student_id = \$2 AND a\.tenant_id = c\.tenant_id/);
  assert.match(source, /WITH authorized AS MATERIALIZED[\s\S]*DELETE FROM lm_enrollments/);
  assert.match(source, /a\.role = 'admin'[\s\S]*c\.teacher_student_id = a\.student_id/);
  assert.match(source, /s\.tenant_id = a\.tenant_id/);
});

test('catalog enrollment and leave derive their mutations from current class state', () => {
  const source = routeSource('education-catalog-routes.ts');
  assert.match(source, /WITH eligible AS MATERIALIZED[\s\S]*c\.status = 'active'/);
  assert.match(source, /c\.published = true OR c\.teacher_student_id = a\.student_id/);
  assert.match(source, /INSERT INTO lm_enrollments[\s\S]*SELECT student_id, class_id FROM eligible/);
  assert.match(source, /WITH leavable AS MATERIALIZED[\s\S]*c\.tenant_id = a\.tenant_id/);
  assert.match(source, /c\.teacher_student_id IS DISTINCT FROM a\.student_id[\s\S]*DELETE FROM lm_enrollments/);
});

test('assignment reads and writes re-evaluate current tenant, role, and membership', () => {
  const source = routeSource('education-assignment-routes.ts');
  assert.match(source, /JOIN lm_students viewer[\s\S]*viewer\.tenant_id = c\.tenant_id/);
  assert.match(source, /viewer\.role = 'teacher' AND c\.teacher_student_id = viewer\.student_id/);
  assert.match(source, /membership\.student_id = viewer\.student_id/);
  assert.match(source, /INSERT INTO lm_assignments[\s\S]*SELECT c\.class_id/);
  assert.match(source, /JOIN lm_students a ON a\.student_id = \$7 AND a\.tenant_id = c\.tenant_id/);
  assert.match(source, /a\.role = 'admin' OR \(a\.role = 'teacher'/);
});

test('dashboard PII query contains the complete current viewer relationship', () => {
  const source = routeSource('education-dashboard-routes.ts');
  assert.match(source, /FROM lm_students target JOIN lm_students viewer/);
  assert.match(source, /viewer\.tenant_id = target\.tenant_id/);
  assert.match(source, /viewer\.student_id = target\.student_id OR viewer\.role = 'admin'/);
  assert.match(source, /viewer\.role = 'teacher' AND EXISTS/);
  assert.match(source, /c\.teacher_student_id = viewer\.student_id[\s\S]*c\.status = 'active'/);
});

test('class deletion locks authorization, cleans material artifacts, and commits relational deletes together', () => {
  const source = routeSource('education-class-routes.ts');
  assert.match(source, /FOR UPDATE OF c, a/);
  assert.match(source, /FROM lm_materials WHERE class_id = \$1 FOR UPDATE/);
  assert.match(source, /deleteMaterialCollection\(material\.rag_collection\)[\s\S]*deleteStoredMaterial\(material\)/);
  assert.match(source, /DELETE FROM lm_materials WHERE class_id = \$1/);
  assert.match(source, /DELETE FROM lm_classes c USING lm_students a/);
  assert.match(source, /a\.student_id = \$2 AND a\.tenant_id = c\.tenant_id/);
  assert.match(
    source,
    /client\.query\('BEGIN'\)[\s\S]*lockClassDeletion[\s\S]*lockClassMaterials[\s\S]*deleteClassMaterialArtifacts[\s\S]*deleteClassDependents[\s\S]*deleteAuthorizedClass[\s\S]*client\.query\('COMMIT'\)/,
  );
  assert.match(source, /ROLLBACK/);
});

test('material lifecycle side effects remain inside locked authorization transactions', () => {
  const source = routeSource('education-materials-routes.ts');
  assert.match(source, /FOR UPDATE OF c, a[\s\S]*FOR UPDATE OF m, uploader/);
  assert.match(source, /runLockedMaterialTransaction[\s\S]*createdCollection/);
  assert.match(source, /const \{ client, row \} = transaction[\s\S]*UPDATE lm_materials SET rag_collection/);
  assert.match(source, /UPDATE lm_materials m SET share_status[\s\S]*EXISTS \(SELECT 1 FROM lm_enrollments/);
  assert.match(source, /UPDATE lm_materials m SET share_status[\s\S]*c\.teacher_student_id = a\.student_id/);
  assert.match(
    source,
    /deleteMaterialCollection\(transaction\.row\.rag_collection\)[\s\S]*deleteStoredMaterial\(transaction\.row\)[\s\S]*deleteAuthorizedMaterialRow/,
  );
  assert.match(source, /DELETE FROM lm_materials m USING lm_classes c, lm_students a, lm_students uploader/);
});
