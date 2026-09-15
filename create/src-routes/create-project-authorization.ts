/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Repeat named project permissions with verified issuer-qualified personal ownership and no administrative row bypass.
 */
import { ProjectError, type ProjectContext, type ProjectOwner } from './create-project-types';

export const PROJECT_ACTIONS = ['view', 'read', 'create', 'change', 'delete', 'export'] as const;
export type ProjectAction = typeof PROJECT_ACTIONS[number] | 'upload';

/** Only the framework's active execution actor establishes ownership. */
export function projectOwner(ctx: ProjectContext): ProjectOwner {
  const actor = ctx.authorization?.currentActor();
  if (!actor?.isActive || typeof actor.issuer !== 'string' || typeof actor.sub !== 'string'
    || !actor.issuer.trim() || !actor.sub.trim() || actor.issuer.length > 2048 || actor.sub.length > 2048) {
    throw new ProjectError(401, 'project_verified_identity_required');
  }
  return Object.freeze({ issuer: actor.issuer, sub: actor.sub });
}

/** Collection grants remain own-only; every actual project/asset SQL statement checks both owner fields. */
export function registerCreateProjectAuthorization(ctx: ProjectContext): void {
  if (!ctx.authorization) throw new Error('Create projects require application-authorization');
  ctx.authorization.registerResource('projects', { authorize: async ({ actor, operation, grant }) =>
    actor.isActive && !!actor.issuer && !!actor.sub && grant.scope === 'own' && !operation.tenantId });
}

/** Re-read current policy immediately before work and transaction commit. */
export async function requireProjectAccess(ctx: ProjectContext, action: ProjectAction, expected?: ProjectOwner): Promise<ProjectOwner> {
  const owner = projectOwner(ctx);
  if (expected && (owner.issuer !== expected.issuer || owner.sub !== expected.sub)) throw new ProjectError(401, 'project_identity_changed');
  const required = new Set(['view', ...(action === 'export' ? ['read', 'export'] : action === 'upload' ? [] : [action])]);
  for (const permission of required) {
    if (!(await ctx.authorization!.authorize({ permission: `project.${permission}` })).allowed) throw new ProjectError(403, 'project_permission_denied');
  }
  if (action === 'upload') {
    const create = await ctx.authorization!.authorize({ permission: 'project.create' });
    if (!create.allowed && !(await ctx.authorization!.authorize({ permission: 'project.change' })).allowed) throw new ProjectError(403, 'project_permission_denied');
  }
  return owner;
}

/** Report effective actions without converting unavailable authorization into successful access. */
export async function projectPermissions(ctx: ProjectContext): Promise<Record<string, boolean>> {
  projectOwner(ctx);
  return Object.fromEntries(await Promise.all(PROJECT_ACTIONS.map(async action => {
    try { await requireProjectAccess(ctx, action); return [action, true]; }
    catch { return [action, false]; }
  })));
}
