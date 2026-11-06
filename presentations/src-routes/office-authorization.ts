/** Fresh original-person access for the retained Office generation surface. */
type LegacyActor = { isActive?: boolean; issuer?: string; sub?: string; principalId?: string; tenantIds?: string[] };
type LegacyPort = { currentActor(): LegacyActor; authorize(input: { permission: string }): Promise<{ allowed?: boolean }> };

/** Refuse unavailable authority, identity changes, and roles without legacy access. */
export async function legacyAccess(context: unknown): Promise<boolean> {
  try {
    const port = (context as { authorization?: LegacyPort }).authorization;
    const original = port?.currentActor();
    if (original?.isActive !== true || [original.issuer, original.sub, original.principalId].some(value => typeof value !== 'string' || !value.trim() || value.length > 4096)
      || !Array.isArray(original.tenantIds) || original.tenantIds.length !== 1 || typeof original.tenantIds[0] !== 'string' || !original.tenantIds[0].trim()) return false;
    const identity = JSON.stringify(original);
    const decision = await port!.authorize({ permission: 'legacy.access' });
    return decision.allowed === true && JSON.stringify(port!.currentActor()) === identity;
  } catch {
    return false;
  }
}
