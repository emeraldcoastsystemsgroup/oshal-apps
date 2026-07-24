/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 07:25:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Unit tests for the career daily-digest pure logic: the once/day guard (dueForDigest) and both notification renderers (email + SMS), including the mandatory opt-out pointer (the digest is opt-out by default, so every send must say how to turn it off).
 */
import { describe, it, expect } from 'vitest';
import { dueForDigest, formatDigestEmail, formatDigestSms, type DigestHit } from '../src-routes/career-digest';

const HITS: DigestHit[] = [
  { id: 825905, title: 'Staff SAP Developer', company: 'Monster Beverage', fit: 89, location: 'Corona, CA', url: 'https://x/1', salaryMax: 165000 },
  { id: 824122, title: 'SAP Solution Architect', company: 'L3Harris', fit: 82, location: 'Remote', url: 'https://x/2', salaryMax: null },
  { id: 983852, title: 'Principal SAP Architect', company: 'Honeywell', fit: 78, location: 'Charlotte, NC', url: 'https://x/3', salaryMax: null },
  { id: 1149617, title: 'Principal ABAP BTP Engineer', company: 'Moderna', fit: 78, location: null, url: null, salaryMax: null },
];

describe('dueForDigest — the persistent once/day guard', () => {
  const now = Date.parse('2026-07-15T13:00:00Z');
  it('is due when never sent', () => {
    expect(dueForDigest(null, now)).toBe(true);
  });
  it('is NOT due again a few hours after a send (no double-send on boot catch-up)', () => {
    expect(dueForDigest('2026-07-15T11:00:00Z', now)).toBe(false);
  });
  it('is due again the next day (>20h)', () => {
    expect(dueForDigest('2026-07-14T13:00:00Z', now)).toBe(true);
  });
  it('fails open on an unparseable timestamp', () => {
    expect(dueForDigest('not-a-date', now)).toBe(true);
  });
});

describe('formatDigestEmail', () => {
  const { subject, body } = formatDigestEmail(HITS, 'https://oshal.example/cockpit/?app=career-hunter');
  it('subject carries the count', () => {
    expect(subject).toContain('4 new high-fit matches');
  });
  it('body lists every hit with match % and company', () => {
    for (const h of HITS) {
      expect(body).toContain(h.title);
      expect(body).toContain(h.company);
      expect(body).toContain(`[${h.fit}% match]`);
    }
  });
  it('body includes the board link and the opt-out pointer (opt-out product rule)', () => {
    expect(body).toContain('https://oshal.example/cockpit/?app=career-hunter');
    expect(body.toLowerCase()).toContain('turn it off');
  });
  it('singular subject for one hit', () => {
    expect(formatDigestEmail(HITS.slice(0, 1), 'https://b').subject).toContain('1 new high-fit match (');
  });
});

describe('formatDigestSms', () => {
  const sms = formatDigestSms(HITS, 'https://oshal.example/c');
  it('names the top 3 and rolls up the rest', () => {
    expect(sms).toContain('89% Staff SAP Developer @ Monster Beverage');
    expect(sms).toContain('+1 more');
    expect(sms).not.toContain('Moderna'); // 4th hit rolls into the count
  });
  it('carries the board link and the opt-out pointer, and stays SMS-sized', () => {
    expect(sms).toContain('https://oshal.example/c');
    expect(sms.toLowerCase()).toContain('turn off');
    expect(sms.length).toBeLessThan(480);
  });
});
