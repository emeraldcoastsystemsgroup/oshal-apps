/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reconcile unrenewable expiring connections through registered Jarvis briefing source.
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import * as taskStore from '@/app/routes/jarvis-task-store';
import { getJarvisBriefingDelivery } from '@/app/routes/jarvis-briefing-delivery';
import { runWithSystemIdentity } from '@/shared/services/database/request-identity';
import { isConnectionExpiring, type ConnectionRow } from '@/app/routes/connector-tenancy';

export const SESSION = 'identity-expiring-connections';
export const SOURCE_ID = 'identity:expiring-connections';

export interface ExpiringConnectionCounts {
  inspected: number;
  queued: number;
  deferred: number;
}

export async function expiringConnectionRows(ctx: AppContext): Promise<ConnectionRow[]> {
  const query = {
    text: `SELECT connection_id, user_sub, connected_by_sub, tenant_id, provider, label,
                  account_key, is_default, account_email, account_id, scopes, access_token,
                  refresh_token, expiry, created_at
           FROM oshal_connections
           WHERE expiry IS NOT NULL AND refresh_token IS NULL
             AND expiry > NOW() AND expiry <= NOW() + INTERVAL '14 days'
           ORDER BY expiry ASC`,
    query_timeout: 2_000,
  };
  const result = await runWithSystemIdentity(() => ctx.pool.query<ConnectionRow>(query));
  return result.rows;
}

export async function collectExpiringConnectionBriefings(
  ctx: AppContext,
  now: number = Date.now(),
): Promise<{ summary: string; state: string; counts?: ExpiringConnectionCounts }> {
  const runtime = getJarvisBriefingDelivery();
  if (typeof taskStore.saveCompletedBriefing !== 'function' || !runtime) {
    return { state: 'unavailable', summary: 'Expiring-connection briefings require the registered completed-briefing runtime.' };
  }
  try {
    if (!await runtime.service.isProducerSession(SESSION)) {
      return { state: 'unavailable', summary: 'Expiring-connection briefing source is not registered.' };
    }
    const rows = await expiringConnectionRows(ctx);
    const counts: ExpiringConnectionCounts = { inspected: 0, queued: 0, deferred: 0 };
    const dayKey = new Date(now).toISOString().slice(0, 10);

    for (const row of rows) {
      counts.inspected += 1;
      if (!isConnectionExpiring(row, now)) {
        continue;
      }
      const at = new Date(row.expiry as unknown as string).getTime();
      const daysLeft = Math.max(1, Math.ceil((at - now) / (24 * 3600_000)));
      const id = `identity:expiring:${row.connection_id}:${dayKey}`;
      const name = row.label || row.account_email || row.provider;
      const title = `Expiring connection: ${name}`;
      const payload = `Your ${name} (${row.provider}) connection will lapse in ${daysLeft} day${daysLeft === 1 ? '' : 's'} and cannot renew itself. Reconnect in Identity Hub before it breaks.`;

      const accepted = await taskStore.saveCompletedBriefing(id, row.user_sub, SESSION, title, payload);
      if (accepted) {
        counts.queued += 1;
      } else {
        counts.deferred += 1;
      }
    }

    return {
      state: counts.deferred ? 'deferred' : 'available',
      counts,
      summary: `Expiring connections: ${counts.inspected} inspected, ${counts.queued} queued, ${counts.deferred} deferred or already queued.`,
    };
  } catch (err) {
    return { state: 'unavailable', summary: 'Expiring-connection briefing collection is unavailable; a later scheduled run can retry.' };
  }
}

export function createExpiringConnectionBriefingRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post('/collect', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await collectExpiringConnectionBriefings(ctx);
    res.status(result.state === 'unavailable' ? 503 : result.state === 'deferred' ? 202 : 200).json(result);
  });
  return router;
}
