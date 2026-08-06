/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard durable enqueue rejection, sanitized failures, and non-overlapping asynchronous result polls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard exact owner propagation/scoped listing, missing service attribution refusal, deferred DB identity, and terminal payload redaction.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guard bounded dispatch options and HTML escaping for every job-table value.
 */

import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  enqueueTask: vi.fn(),
  getCompletedResult: vi.fn(),
  listClients: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/app/routes/remote-client-routes', () => ({
  remoteClientRegistry: {
    enqueueTask: harness.enqueueTask,
    getCompletedResult: harness.getCompletedResult,
    listClients: harness.listClients,
  },
}));
vi.mock('@/shared/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: harness.logWarn }),
}));

import { createVidsRoutes, watchTask } from '../src-routes/vids-routes';

function recordingContext() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    ctx: {
      pool: {
        query: vi.fn(async (text: string, params: unknown[] = []) => {
          calls.push({ text, params });
          return /INSERT INTO vids_jobs/.test(text) ? { rows: [{ job_id: 'job-1' }] } : { rows: [] };
        }),
      },
    } as any,
  };
}

async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('missing listener address'));
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function authenticatedApp(ownerSub = 'owner-a'): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).oidc = { isAuthenticated: () => true, user: { sub: ownerSub } };
    next();
  });
  app.use(express.json());
  return app;
}

describe('Vids durable remote dispatch', () => {
  let server: Server | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    harness.listClients.mockReturnValue([{
      clientId: 'vids-1', agentId: 'vids-agent', status: 'online', healthy: true,
      capabilities: ['vids.generate', 'content.produce'], tags: ['vids'],
    }]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it.each([
    ['/jobs', { prompt: 'make a safe clip' }],
    ['/story', { title: 'safe story', script: 'one scene' }],
  ])('marks %s failed and sanitizes an asynchronous enqueue rejection', async (route, body) => {
    const sensitive = 'remote-provider-secret-must-not-escape';
    harness.enqueueTask.mockRejectedValue(new Error(sensitive));
    const { ctx, calls } = recordingContext();
    const app = authenticatedApp().use(createVidsRoutes(ctx));
    const listening = await listen(app);
    server = listening.server;
    const response = await fetch(`${listening.origin}${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(sensitive);
    const failed = calls.find((call) => /SET status = 'failed'/.test(call.text));
    expect(failed).toBeTruthy();
    expect(JSON.stringify(failed?.params)).not.toContain(sensitive);
    expect(JSON.stringify(harness.logWarn.mock.calls)).not.toContain(sensitive);
    expect(harness.enqueueTask).toHaveBeenCalledWith(
      'vids-1',
      expect.objectContaining({ userSub: 'owner-a' }),
    );
  });

  it('binds job listing to the authenticated owner and never selects raw outcome JSON', async () => {
    const { ctx, calls } = recordingContext();
    const app = authenticatedApp('owner-list').use(createVidsRoutes(ctx));
    const listening = await listen(app);
    server = listening.server;
    const response = await fetch(`${listening.origin}/jobs?status=done`);
    expect(response.status).toBe(200);
    const listed = calls.find((call) => /FROM vids_jobs/.test(call.text));
    expect(listed?.text).toMatch(/WHERE user_sub = \$1/);
    expect(listed?.text).not.toMatch(/client_id,\s*outcome[,\s]/);
    expect(listed?.params).toEqual(['owner-list', 50, 'done']);
  });

  it('rejects a service-secret request that omits the separate user identity', async () => {
    const previous = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = 'vids-test-service-secret';
    try {
      const { ctx, calls } = recordingContext();
      const app = express().use(express.json()).use(createVidsRoutes(ctx));
      const listening = await listen(app);
      server = listening.server;
      const response = await fetch(`${listening.origin}/jobs`, {
        headers: { 'x-service-secret': 'vids-test-service-secret' },
      });
      expect(response.status).toBe(403);
      expect(calls).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.SWARM_SERVICE_SECRET;
      else process.env.SWARM_SERVICE_SECRET = previous;
    }
  });

  it('rejects crafted display options before persistence or worker dispatch', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(authenticatedApp().use(createVidsRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'safe prompt', orientation: '<img src=x onerror=alert(1)>' }),
    });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(harness.enqueueTask).not.toHaveBeenCalled();
  });

  it('escapes every database-derived cell in the embedded surface renderer', async () => {
    const { ctx } = recordingContext();
    const listening = await listen(authenticatedApp().use(createVidsRoutes(ctx)));
    server = listening.server;
    const html = await (await fetch(`${listening.origin}/app`)).text();
    const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(inlineScript).toBeTruthy();
    expect(() => new Function(inlineScript!)).not.toThrow();
    expect(html).toContain('function esc(v)');
    expect(html).toContain("'<td>'+esc(j.orientation)+'</td>'");
    expect(html).toContain("'<td>'+esc(j.client_id)+'</td>'");
    expect(html).toContain("'<td class=\"idea\">'+esc(j.idea)+'</td>'");
    expect(html).not.toContain("(j.idea||'').replace(/[<>&]/g,'')");
  });

  it('never overlaps asynchronous completion polls for the same task', async () => {
    vi.useFakeTimers();
    let release!: (value: null) => void;
    harness.getCompletedResult.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { ctx } = recordingContext();
    watchTask(ctx, 'vids-1', 'task-1', 'job-1', 'owner-a');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(harness.getCompletedResult).toHaveBeenCalledTimes(1);
    release(null);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.getCompletedResult).toHaveBeenCalledTimes(2);
    vi.clearAllTimers();
  });

  it('persists only allowlisted terminal state under the exact deferred owner', async () => {
    vi.useFakeTimers();
    const sensitive = 'terminal-secret-must-not-persist';
    harness.getCompletedResult.mockResolvedValue({
      status: 'failed',
      error: sensitive,
      output: { finalPrompt: 'safe prompt', credential: sensitive },
    });
    const { ctx, calls } = recordingContext();
    watchTask(ctx, 'vids-1', 'task-1', 'job-1', 'owner-a');
    await vi.advanceTimersByTimeAsync(5_000);
    const settled = calls.find((call) => /final_prompt = COALESCE/.test(call.text));
    expect(settled?.text).toMatch(/user_sub = \$6/);
    expect(settled?.params.at(-1)).toBe('owner-a');
    expect(JSON.stringify(settled?.params)).not.toContain(sensitive);
    expect(settled?.params).toContain('safe prompt');
    vi.clearAllTimers();
  });
});
