/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Register named learner and teaching permission boundaries without changing roster identities or enrollment.
 */
import type { AppContext } from '@/app/composition/app-context';
import type { AuthorizationResourceAdapter } from '@/shared/application-authorization';

type AuthorizationInput = Parameters<AuthorizationResourceAdapter['authorize']>[0];

/** Require the verified personal principal; school tenancy remains the roster's responsibility. */
function personalScope({ actor, operation, grant, fields }: AuthorizationInput): boolean {
  return actor.isActive && Boolean(actor.issuer?.trim()) && Boolean(actor.sub?.trim())
    && grant.scope === 'own' && !operation.tenantId && fields.length === 0;
}

/**
 * Register structural permissions before activation. The learner gate permits first sign-in;
 * existing handlers still resolve the exact identity and enforce every record relationship.
 * Teaching additionally requires an already-bound, current school role. Never adopt placeholders,
 * promote roles, create students or enroll anyone while evaluating a structural permission.
 */
export function registerEducationAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) throw new Error('Little Monsters requires application-authorization');
  ctx.authorization.registerResource('learner', {
    authorize: async input => personalScope(input),
  });
  ctx.authorization.registerResource('teaching', {
    authorize: async input => {
      if (!personalScope(input)) return false;
      const result = await ctx.pool.query<{ role: string; tenant_id: string | null }>(
        `SELECT role, tenant_id FROM lm_students
          WHERE external_issuer = $1 AND external_id = $2 LIMIT 2`,
        [input.actor.issuer, input.actor.sub],
      );
      return result.rows.length === 1 && Boolean(result.rows[0].tenant_id)
        && ['teacher', 'admin'].includes(result.rows[0].role);
    },
  });
}
