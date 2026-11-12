/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0 (concierge audit T15): the one read Intelligent Processing's front-desk concierge answers from. GET / lists the caller's own tickets on this queue through the kernel's ticket port (ctx.ticketService.listTickets, which the kernel scopes to the admitted caller and to this package's own ticket type) and answers the queue's counts (total, open, waiting on a person, failed, done, cancelled), the newest tickets' status, phase and times, and one summary sentence. The port carries no title, so no alert is named here; the queue screen shows the titles. No SQL, no model call, no write.
 */

import { Router } from 'express';

/** The ticket type this package registers; the kernel's port lists no other. */
const QUEUE = 'intelligent-processing';
/** The most tickets the kernel's ticket port returns in one listing. */
const LIMIT = 200;
/** How many of the newest tickets the answer lists one by one. */
const SHOWN = 25;
/** Statuses the kernel is finished with; every other ticket is open. */
const CLOSED = new Set(['done', 'failed', 'cancelled']);
/** Statuses that wait on someone outside the workflow: the queue screen's "Waiting on a person". */
const WAITING = new Set(['awaiting_approval', 'blocked']);

/** One ticket as the kernel's ticket port projects it. */
interface PortTicket {
  ticketId?: unknown;
  id?: unknown;
  ticketType?: unknown;
  status?: unknown;
  position?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface QueueContext {
  ticketService?: {
    listTickets(filter: { ticketType: string; limit: number }): Promise<PortTicket[]>;
  };
}

interface Caller {
  oidc?: { user?: { sub?: unknown } };
}

/** Milliseconds since the epoch, or null when the port gave no usable time. */
function millis(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** How long ago a time was, in words, or null when it is not recorded. */
function ago(at: number | null, now: number): string | null {
  if (at === null) return null;
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The workflow phase a ticket has reached, or null before its first dispatch and after its last. */
function phaseOf(position: unknown): string | null {
  const name = position && typeof position === 'object' ? (position as { name?: unknown }).name : null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** What a ticket's status and phase mean, in words a person reads. */
function stateOf(status: string, phase: string | null): string {
  const at = phase ? ` the ${phase} phase` : '';
  switch (status) {
    case 'draft': return 'a draft, not yet submitted';
    case 'queued': return phase ? `queued for${at}` : 'queued, waiting for its first phase';
    case 'running': return phase ? `in${at}` : 'running';
    case 'awaiting_approval': return phase ? `waiting on a person to approve${at}` : 'waiting on a person to approve its next phase';
    case 'blocked': return `blocked${phase ? ` at${at}` : ''}: something it needs is not loaded or not reachable`;
    case 'done': return 'done';
    case 'failed': return phase ? `failed in${at}` : 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'in a state this queue does not recognise';
  }
}

/** A count with its noun, singular or plural. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * @description The concierge's answer about the caller's tickets on this queue: counts, the newest tickets and one
 *   summary sentence. Pure, so the route and its tests share it.
 * @param tickets - The tickets the kernel's ticket port returned, newest first.
 * @param now - Milliseconds since the epoch.
 * @returns The answer the route serves.
 */
export function queueSummary(tickets: PortTicket[], now: number) {
  const mine = (Array.isArray(tickets) ? tickets : []).filter((ticket) => ticket && ticket.ticketType === QUEUE);
  const status = (ticket: PortTicket) => (typeof ticket.status === 'string' ? ticket.status : 'unknown');
  const byStatus: Record<string, number> = {};
  for (const ticket of mine) byStatus[status(ticket)] = (byStatus[status(ticket)] || 0) + 1;
  const counts = {
    total: mine.length,
    open: mine.filter((ticket) => !CLOSED.has(status(ticket))).length,
    waitingOnPerson: mine.filter((ticket) => WAITING.has(status(ticket))).length,
    failed: byStatus.failed || 0,
    done: byStatus.done || 0,
    cancelled: byStatus.cancelled || 0,
  };
  const rows = mine.map((ticket) => {
    const phase = phaseOf(ticket.position);
    const filed = millis(ticket.createdAt);
    const moved = millis(ticket.updatedAt);
    return {
      ticketId: String(ticket.ticketId || ticket.id || ''),
      status: status(ticket),
      phase,
      state: stateOf(status(ticket), phase),
      filedAt: filed === null ? null : new Date(filed).toISOString(),
      filed: ago(filed, now),
      lastMovedAt: moved === null ? null : new Date(moved).toISOString(),
      lastMoved: ago(moved, now),
      sortKey: moved ?? filed ?? 0,
      filedKey: filed ?? 0,
    };
  }).sort((a, b) => b.sortKey - a.sortKey);
  const truncated = mine.length >= LIMIT;
  let summary = 'No tickets on this queue yet. An alert filed on the Intelligent Processing screen opens one.';
  if (mine.length) {
    const newest = rows.reduce((best, row) => (row.filedKey > best.filedKey ? row : best), rows[0]);
    summary = `${counted(counts.total, 'ticket')} on this queue: ${counts.open} open (${counts.waitingOnPerson} waiting on a person), `
      + `${counts.failed} failed, ${counts.done} done${counts.cancelled ? `, ${counts.cancelled} cancelled` : ''}. `
      + `The most recently filed was filed ${newest.filed ?? 'at a time not recorded'} and is ${newest.state}.`
      + (truncated ? ` These counts cover the newest ${LIMIT} tickets.` : '');
  }
  return {
    asOf: new Date(now).toISOString(),
    queue: QUEUE,
    summary,
    counts,
    byStatus,
    tickets: rows.slice(0, SHOWN).map(({ sortKey: _sort, filedKey: _filed, ...row }) => row),
    truncated,
    titles: 'not carried: the kernel ticket port gives each ticket\'s status, phase and times only; the Intelligent Processing screen shows each alert\'s title',
    open: 'Intelligent Processing',
    source: 'your own tickets on this queue, read from the kernel; nothing was run, filed or approved',
    executionAuthorized: false,
  };
}

/**
 * @description The queue read the concierge's processing-queue tool calls. It reads the caller's own tickets of this
 *   package's ticket type through the kernel's ticket port and nothing else.
 * @param ctx - The package context the kernel hands a route factory.
 * @returns The router mounted at /api/intelligent-processing/queue.
 */
export function createProcessingQueueRoutes(ctx: QueueContext): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const sub = (req as unknown as Caller).oidc?.user?.sub;
    if (typeof sub !== 'string' || !sub.trim()) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    if (!ctx.ticketService || typeof ctx.ticketService.listTickets !== 'function') {
      res.status(503).json({ error: 'queue_unavailable', summary: 'The queue cannot be read here: the kernel ticket port is not available.' });
      return;
    }
    try {
      const tickets = await ctx.ticketService.listTickets({ ticketType: QUEUE, limit: LIMIT });
      res.json(queueSummary(tickets, Date.now()));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      res.status(502).json({ error: 'queue_unavailable', summary: 'The queue could not be read just now.', detail: detail.slice(0, 200) });
    }
  });

  return router;
}
