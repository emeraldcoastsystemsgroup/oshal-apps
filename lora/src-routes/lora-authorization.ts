/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | LoRA's ADR-149 package side. The worker callbacks moved onto the kernel's signed-package-callbacks rail, which requires an authorization catalog, so the package now registers the resource adapter its catalog names and reads the verified caller's issuer from the kernel's actor. A callback grant must name its owner's exact (subject, issuer) pair: the kernel refreshes that principal from the directory before any callback runs.
 */

/**
 * LoRA authorization helpers.
 *
 * `authorization.yaml` declares one resource, `lora`, with `own` scope only. The kernel decides the
 * named permission for every request (route bindings, role grants, current tier) and then asks this
 * adapter; row ownership itself stays where it always was, in each route's owner predicate and the
 * tables' forced row-level security. The adapter therefore admits any active verified actor and
 * never widens what a query can read.
 */

import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'lora-authorization' });

/** The one resource `authorization.yaml` declares. */
export const LORA_RESOURCE = 'lora';

/** Longest issuer the kernel's callback principal contract accepts. */
const MAX_ISSUER_LENGTH = 2048;

/**
 * @description Whether a value can be stored as a principal issuer.
 * @param value - Candidate issuer.
 * @returns True for a non-empty issuer within the kernel's callback principal bound.
 */
export function isValidIssuer(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ISSUER_LENGTH && !value.includes('\0');
}

/**
 * @description Register the catalog's resource adapter. The kernel accepts adapters only while the
 * package is activating, so this runs from the studio route factory; a package context without the
 * kernel's authorization port (an isolated route test) has nothing to register.
 * @param ctx - Package context from the route mounter.
 * @returns Nothing; a refusal from the kernel propagates so a strict activation fails loudly.
 */
export function registerLoraAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) return;
  ctx.authorization.registerResource(LORA_RESOURCE, { authorize: async ({ actor }) => actor.isActive === true });
  logger.info({ resource: LORA_RESOURCE }, 'lora authorization resource registered');
}

/**
 * @description The verified issuer of the request's current actor, when that actor is the owner a
 * grant is being minted for. It is read from the kernel's authorization context, never from a
 * request field, so a caller cannot choose the issuer its worker callbacks will run under.
 * @param ctx - Package context.
 * @param ownerSub - The owner the caller resolved to.
 * @returns The issuer, or null when no active verified actor with that subject is present.
 */
export function verifiedIssuer(ctx: AppContext, ownerSub: string): string | null {
  const actor = ctx.authorization?.currentActor();
  if (!actor || actor.isActive !== true || actor.sub !== ownerSub) return null;
  return isValidIssuer(actor.issuer) ? actor.issuer : null;
}
