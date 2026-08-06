/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove LoRA dispatch awaits the durable journal and never returns or logs exception text.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  enqueueTask: vi.fn(),
  listClients: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/app/routes/remote-client-routes', () => ({
  remoteClientRegistry: {
    enqueueTask: harness.enqueueTask,
    listClients: harness.listClients,
  },
}));
vi.mock('@/shared/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), error: harness.logError }),
}));

import { dispatchBoxCommand } from '../src-routes/lora-train-dispatch';

describe('LoRA durable remote dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.listClients.mockReturnValue([{
      clientId: 'gpu-1',
      agentId: 'gpu-agent',
      status: 'online',
      healthy: true,
      tailnetHostname: 'edge-node-1',
      capabilities: ['shell.exec'],
    }]);
  });

  it('does not report success until the durable enqueue resolves', async () => {
    let accept!: (value: { taskId: string }) => void;
    harness.enqueueTask.mockReturnValue(new Promise((resolve) => { accept = resolve; }));
    const dispatch = dispatchBoxCommand('safe-command', 'ticket-1');
    let settled = false;
    void dispatch.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    accept({ taskId: 'durable-task-1' });
    await expect(dispatch).resolves.toMatchObject({ ok: true, taskId: 'durable-task-1' });
  });

  it('returns and logs only a sanitized failure when enqueue rejects', async () => {
    const sensitive = 'provider-secret-must-not-escape';
    harness.enqueueTask.mockRejectedValue(new Error(sensitive));
    const result = await dispatchBoxCommand('safe-command', 'ticket-1');
    expect(result).toEqual({ ok: false, error: 'The GPU edge worker could not accept the task.' });
    expect(JSON.stringify(harness.logError.mock.calls)).not.toContain(sensitive);
  });
});
