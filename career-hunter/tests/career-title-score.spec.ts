/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 17:28:14 | roger.murphy@emeraldcoastsystemsgroup.com   | Unit tests for the career title-pass pure logic: the persistent >20h cursor guard (the fix for api recreates re-running hours of scoring), term normalization (newline is the CH_TITLES wire separator so it must never survive inside a term; tiny terms would defeat the bounding), resume-role derivation (real seed, never a hardcoded guess), and the exact score-titles invocation the Python side parses (CH_TITLES newline-joined + CH_LIMIT).
 */
import { describe, it, expect } from 'vitest';
import {
  dueSince,
  normalizeTitleTerms,
  deriveTitleTermsFromRoles,
  buildTitlePassInvocation,
} from '../src-routes/career-title-score';

describe('dueSince — the persistent >20h cursor guard (title pass + boot catch-up score)', () => {
  const now = Date.parse('2026-07-15T13:00:00Z');
  it('is due when never run', () => {
    expect(dueSince(null, now)).toBe(true);
  });
  it('is NOT due again a few hours after a run — an api recreate must not re-score the day', () => {
    expect(dueSince('2026-07-15T11:00:00Z', now)).toBe(false);
  });
  it('is due again the next day (>20h)', () => {
    expect(dueSince('2026-07-14T13:00:00Z', now)).toBe(true);
  });
  it('is NOT due at exactly the guard boundary (strict >20h, mirrors the digest)', () => {
    expect(dueSince('2026-07-14T17:00:00Z', now)).toBe(false);
  });
  it('fails open on an unparseable timestamp (broken cursor must never disable scoring)', () => {
    expect(dueSince('not-a-date', now)).toBe(true);
  });
});

describe('normalizeTitleTerms', () => {
  it('splits a comma/newline string, trims, and drops empties', () => {
    expect(normalizeTitleTerms('SAP Architect, Basis Administrator\n Platform Engineer ,, '))
      .toEqual(['SAP Architect', 'Basis Administrator', 'Platform Engineer']);
  });
  it('accepts an array input', () => {
    expect(normalizeTitleTerms([' SAP Architect ', 'DevOps Engineer']))
      .toEqual(['SAP Architect', 'DevOps Engineer']);
  });
  it('de-duplicates case-insensitively, keeping first casing', () => {
    expect(normalizeTitleTerms('SAP Architect, sap architect, SAP ARCHITECT')).toEqual(['SAP Architect']);
  });
  it('drops 1-2 char terms (an "ai" LIKE term would match half the corpus and defeat the bound)', () => {
    expect(normalizeTitleTerms('ai, ML, SRE, SAP Basis')).toEqual(['SRE', 'SAP Basis']);
  });
  it('drops over-long terms and caps the list at 16', () => {
    expect(normalizeTitleTerms('x'.repeat(61))).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `Role Number ${i}`).join(',');
    expect(normalizeTitleTerms(many)).toHaveLength(16);
  });
  it('strips control characters so a term can never smuggle the CH_TITLES newline separator', () => {
    // Array input bypasses the [,\n] split, so tab/CR (and any control char) must be stripped here.
    expect(normalizeTitleTerms(['SAP\tArchitect\r'])).toEqual(['SAPArchitect']);
    expect(normalizeTitleTerms(['Basis  Admin'])).toEqual(['Basis Admin']);
    for (const term of normalizeTitleTerms(['A\rB CDE', 'Platform\nEngineer'])) {
      expect(term).not.toMatch(/[\r\n\t]/);
    }
  });
  it('null/undefined/garbage input yields []', () => {
    expect(normalizeTitleTerms(undefined)).toEqual([]);
    expect(normalizeTitleTerms(null)).toEqual([]);
    expect(normalizeTitleTerms(42)).toEqual([]);
  });
});

describe('deriveTitleTermsFromRoles — the resume-based default profile', () => {
  it('derives from role titles, stripping seniority prefixes (LIKE already matches any seniority)', () => {
    expect(deriveTitleTermsFromRoles([
      { title: 'Senior SAP Basis Administrator' },
      { title: 'Sr. Staff Platform Engineer' },
    ])).toEqual(['SAP Basis Administrator', 'Platform Engineer']);
  });
  it('splits multi-role titles and strips trailing level markers', () => {
    expect(deriveTitleTermsFromRoles([{ title: 'SAP Architect / DevOps Engineer II' }]))
      .toEqual(['SAP Architect', 'DevOps Engineer']);
  });
  it('drops parentheticals and de-duplicates across roles', () => {
    expect(deriveTitleTermsFromRoles([
      { title: 'SAP Solution Architect (Contract)' },
      { title: 'Lead SAP Solution Architect' },
    ])).toEqual(['SAP Solution Architect']);
  });
  it('returns [] for no roles / empty titles — real derivation or empty, never a guess', () => {
    expect(deriveTitleTermsFromRoles([])).toEqual([]);
    expect(deriveTitleTermsFromRoles([{ title: '' }, { title: undefined }])).toEqual([]);
    expect(deriveTitleTermsFromRoles(null as unknown as [])).toEqual([]);
  });
  it('caps the derived set at 12', () => {
    const roles = Array.from({ length: 20 }, (_, i) => ({ title: `Specialist Role ${String.fromCharCode(65 + i)}x` }));
    expect(deriveTitleTermsFromRoles(roles).length).toBeLessThanOrEqual(12);
  });
});

describe('buildTitlePassInvocation — the exact wire format the score-titles verb parses', () => {
  it('uses the score-titles verb with newline-joined CH_TITLES and CH_LIMIT', () => {
    const inv = buildTitlePassInvocation(['SAP Architect', 'Basis Administrator'], 150);
    expect(inv.args).toEqual(['score-titles']);
    expect(inv.env.CH_TITLES).toBe('SAP Architect\nBasis Administrator');
    expect(inv.env.CH_LIMIT).toBe('150');
  });
  it('floors and clamps the limit to at least 1 (a run must always be bounded)', () => {
    expect(buildTitlePassInvocation(['SAP Basis'], 12.7).env.CH_LIMIT).toBe('12');
    expect(buildTitlePassInvocation(['SAP Basis'], 0).env.CH_LIMIT).toBe('1');
    expect(buildTitlePassInvocation(['SAP Basis'], -5).env.CH_LIMIT).toBe('1');
  });
});
