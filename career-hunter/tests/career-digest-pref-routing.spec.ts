/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:50:04 | roger.murphy@emeraldcoastsystemsgroup.com   | Review fix: unit-cover the four notification-pref override branches in sendDigestForUser (prefs-none skip, prefs-telegram-unavailable skip, sms pref phone override beating the settings phone, explicit-email pref suppressing the auto text fallback) plus the no-pref contrast proving the legacy auto fallback survives — a future inversion of the wantChannel/phone derivation now fails loudly instead of routing every pref'd digest to the wrong channel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserNotificationPref } from '../../src/features/notifications';

// Everything sendDigestForUser touches outside its own module is mocked: no Postgres, no
// per-user SQLite store, no Gmail, no Twilio subprocess. The branches under test are the
// pure routing decisions between readUserPref's answer and the legacy settings row.
const mocks = vi.hoisted(() => ({
  readUserPref: vi.fn(),
  getValidAccessToken: vi.fn(),
  sendGmail: vi.fn(),
  openUserDb: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@/features/notifications', () => ({ readUserPref: mocks.readUserPref }));
vi.mock('@/app/routes/connectors-routes', () => ({ getValidAccessToken: mocks.getValidAccessToken }));
vi.mock('@/app/routes/email-routes', () => ({ sendGmail: mocks.sendGmail }));
// career-digest imports its sibling RELATIVELY ('./career-hunter-routes') since the ADR-085
// carve — mock the resolved module, not the retired '@/app/routes/…' kernel path, or the real
// module (and its whole kernel import chain) loads and the mock silently misses.
vi.mock('../src-routes/career-hunter-routes', () => ({
  callerSub: vi.fn(),
  listStoreUsers: vi.fn(() => []),
  openUserDb: mocks.openUserDb,
}));
// Partial mock: keep the REAL module surface (kernel modules promisify execFile at load — a
// bare {spawn} mock explodes the suite at import) and override only the spawn the digest uses.
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: mocks.spawn,
}));

import { sendDigestForUser, type DigestHit } from '../src-routes/career-digest';

const SUB = 'oidc|digest-user';
const HITS: DigestHit[] = [
  { id: 1, title: 'Staff SAP Developer', company: 'Monster Beverage', fit: 89, location: 'Corona, CA', url: 'https://x/1', salaryMax: 165000 },
  { id: 2, title: 'SAP Solution Architect', company: 'L3Harris', fit: 82, location: 'Remote', url: null, salaryMax: null },
];

/** Fake per-user SQLite store: the new-hits query returns HITS, close() is a no-op. */
function fakeUserDb() {
  return { prepare: () => ({ all: () => HITS }), close: vi.fn() };
}

/** Fake pg pool answering the three query shapes sendDigestForUser issues; captures SQL. */
function poolFor(opts: {
  settings?: Record<string, unknown> | null;
  connections?: Array<{ provider: string; scopes?: string }>;
} = {}) {
  const calls: string[] = [];
  const query = vi.fn(async (text: string) => {
    calls.push(text);
    if (/FROM career_digest_settings/.test(text)) return { rows: opts.settings ? [opts.settings] : [] };
    if (/FROM oshal_connections/.test(text)) return { rows: opts.connections ?? [] };
    return { rows: [] }; // the cursor-advance INSERT
  });
  return { pool: { query } as never, calls };
}

/** A saved 'career-digest' pref as readUserPref would map it. */
function pref(over: Partial<UserNotificationPref> = {}): UserNotificationPref {
  return {
    userSub: SUB, topic: 'career-digest', channel: 'email', enabled: true,
    quietHoursStart: null, quietHoursEnd: null, phone: null, telegramChatId: null,
    updatedAt: '2026-07-15T12:00:00Z', ...over,
  };
}

/** A fake spawned Twilio CLI process that exits with the given code on the next tick. */
function fakeProc(exitCode = 0) {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    stderr: { on: vi.fn() },
    on(event: string, cb: (arg?: unknown) => void) {
      handlers[event] = cb;
      if (event === 'exit') setImmediate(() => handlers['exit']?.(exitCode));
      return this;
    },
  };
}

const cursorAdvanced = (calls: string[]) => calls.some((c) => /INSERT INTO career_digest_settings/.test(c));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openUserDb.mockReturnValue(fakeUserDb());
  mocks.spawn.mockImplementation(() => fakeProc(0));
  mocks.getValidAccessToken.mockResolvedValue(null);
});

describe('sendDigestForUser — notification-pref override branches', () => {
  it('pref channel "none" is a skip with the cursor untouched (hits stay pending)', async () => {
    mocks.readUserPref.mockResolvedValue(pref({ channel: 'none' }));
    const { pool, calls } = poolFor({ connections: [{ provider: 'google', scopes: 'gmail.send' }] });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: false, hits: HITS.length, reason: 'prefs-none' });
    expect(cursorAdvanced(calls)).toBe(false);
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('a disabled pref is the same prefs-none skip (mute wins over connected channels)', async () => {
    mocks.readUserPref.mockResolvedValue(pref({ enabled: false, channel: 'email' }));
    const { pool, calls } = poolFor({ connections: [{ provider: 'google', scopes: 'gmail.send' }] });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: false, hits: HITS.length, reason: 'prefs-none' });
    expect(cursorAdvanced(calls)).toBe(false);
  });

  it('pref channel "telegram" is a logged skip (no digest leg yet) with the cursor untouched', async () => {
    mocks.readUserPref.mockResolvedValue(pref({ channel: 'telegram', telegramChatId: '4242' }));
    const { pool, calls } = poolFor({ connections: [{ provider: 'google', scopes: 'gmail.send' }, { provider: 'twilio' }] });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: false, hits: HITS.length, reason: 'prefs-telegram-unavailable' });
    expect(cursorAdvanced(calls)).toBe(false);
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('an sms pref with its own phone texts THAT phone, not the settings phone, and never tries email', async () => {
    mocks.readUserPref.mockResolvedValue(pref({ channel: 'sms', phone: '+15559990000' }));
    const { pool, calls } = poolFor({
      settings: { digest_enabled: true, last_digest_at: null, notify_channel: 'email', notify_phone: '+15551110000' },
      connections: [{ provider: 'google', scopes: 'gmail.send' }, { provider: 'twilio' }],
    });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: true, channel: 'text', hits: HITS.length });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn.mock.calls[0][1][2]).toBe('+15559990000'); // [cli, 'sms', phone, ...]
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled(); // email leg fully skipped
    expect(cursorAdvanced(calls)).toBe(true); // real send → cursor advances
  });

  it('an sms pref without a phone falls back to the settings phone', async () => {
    mocks.readUserPref.mockResolvedValue(pref({ channel: 'sms', phone: null }));
    const { pool } = poolFor({
      settings: { digest_enabled: true, last_digest_at: null, notify_channel: null, notify_phone: '+15551110000' },
      connections: [{ provider: 'twilio' }],
    });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: true, channel: 'text', hits: HITS.length });
    expect(mocks.spawn.mock.calls[0][1][2]).toBe('+15551110000');
  });

  it('an explicit email pref does NOT fall through to text when the email send fails', async () => {
    mocks.readUserPref.mockResolvedValue(pref({ channel: 'email' }));
    mocks.getValidAccessToken.mockResolvedValue(null); // email leg fails cleanly (no token)
    const { pool, calls } = poolFor({
      settings: { digest_enabled: true, last_digest_at: null, notify_channel: null, notify_phone: '+15551110000' },
      connections: [{ provider: 'google', scopes: 'gmail.send' }, { provider: 'twilio' }],
    });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: false, hits: HITS.length, reason: 'no-channel' });
    expect(mocks.spawn).not.toHaveBeenCalled(); // the by-design behavior change
    expect(cursorAdvanced(calls)).toBe(false); // nothing sent → hits stay pending
  });

  it('CONTRAST: no pref row keeps the legacy auto fallback (failed email → text)', async () => {
    mocks.readUserPref.mockResolvedValue(null);
    mocks.getValidAccessToken.mockResolvedValue(null); // same email failure as above
    const { pool, calls } = poolFor({
      settings: { digest_enabled: true, last_digest_at: null, notify_channel: null, notify_phone: '+15551110000' },
      connections: [{ provider: 'google', scopes: 'gmail.send' }, { provider: 'twilio' }],
    });
    const r = await sendDigestForUser(pool, SUB);
    expect(r).toEqual({ sent: true, channel: 'text', hits: HITS.length });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(cursorAdvanced(calls)).toBe(true);
  });
});
