# payroll — run payroll for your team, ADP-style

An installable OSHAL app package (ADR-085; design in [ADR-123](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/123-payroll-app.md)).
One OIDC sub = one company: your roster, pay runs, stubs, and reports are yours alone (owner-scoped
tables, tier-1 RLS applied at table creation, `guestTier: blocked`).

> **oshal computes payroll and produces the artifacts; your bank and the tax agencies execute
> them.** It holds no funds, and it **transmits nothing** — no e-file, no EFTPS, no upload happens
> from here. You get the ACH file, the checks, the 941/940/RT-6 worksheets, the W-2s and the SSA
> EFW2 submission, and you send them.

## What it does

- **Employees** — salary or hourly, the 2020+ Form W-4 (filing status, Step 2 checkbox, Step 3
  credits, 4a/4b/4c, and the 2026 exemption checkbox), pre-tax elections (401(k) %, Section-125
  health), post-tax (Roth %, flat deductions), work state and allowances, birth date for the 401(k)
  catch-up tier, hire/termination dates, and a tipped-occupation code.
- **Pay runs** — drafts the next period from your pay frequency with a line for every employee
  actually employed during it. Per line: hours, overtime (with an FLSA-qualified flag), bonus (paid
  aggregated or at the supplemental flat rate), cash tips, reimbursement, and salary proration for
  mid-period hires and terminations. Every edit recomputes server-side with year-to-date awareness.
  **Approve** is the money action: explicit confirmation, recorded approver and timestamp, immutable
  afterward.
- **Corrections** — a paid run is never edited. **Void** appends a linked run whose every amount is
  the exact negation of the original, so year-to-date totals, the liability report and the W-2
  preview self-correct while the original stays as history. A void cannot be voided, and a run can
  only be voided once (enforced by a unique index, not just the handler).
- **Mid-year switch** — prior-YTD fields feed the wage-base caps and the 401(k) limit so the rest of
  the year is right. They are deliberately excluded from the W-2 preview; the previous provider
  issues its own W-2.
- **Pay stubs** — printable per employee per run, with year-to-date.
- **Reports** — payroll register, quarterly tax liability (941-style, both FICA halves plus
  FUTA/SUTA/state), and a per-employee **W-2 preview** including box 12 codes D / TT / TP and box 14b.

## The tax engine — deterministic by design

No LLM computes a dollar. `src-routes/payroll-engine.ts` is pure arithmetic over versioned constants
in `src-routes/payroll-tax-tables.ts` and `src-routes/payroll-state-tax.ts`. Integer cents end to end.

**Every federal constant was verified against the retrieved primary document** and cites it inline:
IRS Rev. Proc. 2025-32 §4.01 (all three rate schedules and the standard deductions), the SSA 2026
COLA release ($184,500 wage base), IRS Pub. 15-T (2026) (the withholding method and the supplemental
rates), IRS Notice 2025-67 (the 402(g) limits), and the Florida DOR rate page (SUTA).

The engine implements Pub 15-T's percentage method for automated payroll systems (Worksheet 1A), and
the equivalence is **proven in the test suite rather than asserted**: the engine subtracts the full
standard deduction and applies the Rev. Proc. brackets, while Pub 15-T subtracts Worksheet 1A line 1g
($8,600 / $12,900) and carries the remainder in each schedule's 0% band — the same computation. With
Step 2 checked, line 1g is zero and every threshold and the deduction are exactly halved, which is
the engine's `scale = 0.5`. Both are executable assertions with worked figures.

Also modelled: Social Security to the wage base and Medicare with the additional 0.9% over $200,000
(no employer match on that part); Section-125 reducing FICA wages while elective deferrals do not;
the IRC 402(g) deferral ceiling with SECURE 2.0 catch-up tiers; supplemental wages at 22% with the
mandatory 37% above $1M; and employer FICA/FUTA/SUTA including a configurable FUTA credit reduction.

**A new tax year invalidates the tables.** They are data with citations, not logic.

## State coverage — declared, never implied

| Outcome | States | Behavior |
|---|---|---|
| No wage income tax | AK, FL, NH, NV, SD, TN, TX, WA, WY | Withholds a **known** zero. |
| Verified flat | PA 3.07%; IL 4.95% less $2,925/allowance; KY 3.5% after a $3,360 deduction | From the verified table. |
| Verified progressive | MO — eight brackets, whole-dollar rounding | From the verified schedule. |
| **No verified table** | everything else | Falls back to the operator's rate **and warns**. A zero rate produces a louder warning. |

Indiana and North Carolina are deliberately absent with reasons recorded in `KNOWN_UNSUPPORTED`.
Local/city taxes, state disability and paid-leave contributions, reciprocity, and multi-state
allocation are not modelled — see the backlog.

## Tax year 2026 (OBBBA)

The tips and overtime deductions are claimed by the employee on their return; they are **not**
withholding exclusions, so the dollar math deliberately does not change. What 2026 makes mandatory is
reporting: box 12 code **TT** (qualified overtime — the FLSA half-time **premium** only, never the
whole payment) and code **TP** (cash tips), with the occupation code in box 14b. Both are accumulated
per employee per year.

## v2 — what changed, and the honest scorecard

v1.1 was an excellent tax **calculator** with a thin shell. A spec review against
a commercial small-business payroll system put it near **25–30% complete**: the
tax engine scored ~85%, the system around it much lower. v2 attacks the
structural gap that every other one inherited — a paycheck stored as scalar
columns.

**Earnings are ROWS now.** A code carries its own taxability across four
independent axes (FIT / FICA / FUTA / state) plus its FLSA regular-rate
treatment. That makes expressible: PTO and holiday (paid but not hours worked,
so they create no overtime), double time, shift differential, commission,
discretionary vs nondiscretionary bonus, cash tips vs charge tips, severance,
retro, imputed group-term life and personal vehicle use (taxed but never paid),
and accountable-plan reimbursement (paid but never taxed).

**Overtime is computed PER WORKWEEK.** 30 hours one week and 50 the next owes
ten hours of premium, even though the period total is 80 — FLSA overtime may
never be averaged across weeks (29 CFR 778.104). The regular rate is weighted
across multiple rates, and a nondiscretionary bonus lifts it (29 CFR 778.117).

**Deductions are ROWS too** — typed codes with annual caps, arrears when net pay
runs out, and multiple garnishments applied in statutory priority (support, levy,
student loan, creditor) under ONE shared CCPA disposable-earnings ceiling.

**A W-2 can stop being a preview.** Encrypted SSN and EIN (AES-256-GCM through
the framework's vault crypto), addresses, and worker classification. Exactly one
route returns a full SSN, it requires an explicit confirm, and it writes the
audit row before the value leaves. `GET /reports/w2-readiness/:id` computes
whether a real W-2 can be issued and names what is still missing.

**Also new:** gross-up (net-to-gross by bisection, correct across the Social
Security wage base and the additional-Medicare threshold where a flat-rate
shortcut silently breaks), off-cycle and final run kinds, payment records with
direct-deposit splits and check-number uniqueness, an append-only change audit
log, and the GL journal + federal deposit schedule (monthly vs semiweekly, with
the $100,000 next-business-day rule).

### Still NOT built — deliberately

**Nothing transmits.** There is no e-file and no EFTPS enrolment, so every artifact is something you
send. Verified state tables cover **four states plus the nine with no wage income tax**; every other
state falls back to an operator-entered rate *with a warning*. No local or city taxes, no state
disability/paid-leave contributions, no employee self-service, no 1099 contractor path, no PTO
accrual engine, and no segregation of duties (one login is still the whole company). The backlog
records each with a done-when.

## Try it

Install the package, open the cockpit with `?app=payroll`, set your company in **Settings**, add an
employee in **Employees**, then **Run payroll → New pay run → Approve**. Warnings appear above the
register and are meant to be read before approving.

## Tests

`payroll/tests/` runs dependency-free `node --test` suites against the **compiled** `routes/*.js` —
the same bytes the framework mounts. Coverage includes the two Pub 15-T equivalence proofs, the
Missouri DOR's own worked example, wage-base and additional-Medicare crossings, the 402(g) cap, the
supplemental thresholds, the gross↔net identity under both bonus methods, hostile-input hardening,
both confirm gates with the database provably untouched, void-run negation of every signed column,
and a sweep proving no payroll query reaches the database without a tenant predicate. Wired as the
`payroll` store-ci job.

## v2.1 — pay and file

The direction here is deliberate: **oshal computes payroll and produces the artifacts; your bank and
EFTPS execute them.** No money moves through oshal, no third-party payroll provider runs your
payroll, and there is nothing to sign up for. The alternative — delegating to an embedded provider —
would mean *their* engine computes withholding and this one becomes decorative.

- **NACHA ACH file.** `Pay & file → Download .ach` builds the fixed-width PPD credit file your own
  bank ingests. Every record is exactly 94 characters, the file is blocked to a multiple of 10, and
  the entry hash and control totals reconcile — a bank rejects the whole file on any one of those, so
  they are what the guards assert rather than a sample output. A **prenote** mode emits zero-dollar
  entries when the bank wants accounts validated first. Generating the file is confirm-gated and
  audited, because it is the artifact that moves money even though we do not send it.
- **Form 941.** The quarterly worksheet with real line numbers — 5a is Social Security *wages* at the
  combined 12.4%, 5c Medicare at 2.9%, 5d the additional 0.9% with no employer share. It also
  **reconciles** line 5e against the FICA actually withheld and says so when they disagree, because a
  gap there means a wage base or threshold was applied inconsistently.
- **Form 940.** Annual FUTA, with the $7,000 base applied **per employee** — the company-wide
  shortcut understates the exclusion badly for anyone earning above it.
- **W-2.** A real document now, not a preview, once the SSN, EIN and addresses are on file.
  Producing one is confirm-gated and audited because it decrypts both identifiers; when identity is
  incomplete it returns `issuable: false` and names exactly what is missing.

## v2.2 — settlement: did everyone actually get paid?

Approving a run says who *should* be paid. v2.2 answers who **was**.

- **ACH returns and notifications of change.** Paste the file your bank hands back and every payment
  moves: a **return** (R02 account closed, R03 no account) marks that person unpaid and says what to
  do next; a **notification of change** does the opposite — the money arrived, and the bank is
  correcting the details for next time. Before this, a payment sat at `pending` forever and a failed
  deposit was indistinguishable from a successful one. Generating an ACH file now also **records the
  trace numbers**, which is the only handle a return gives back; without them nothing can be matched.
  Applying an NOC to an employee's account is confirm-gated and re-checks the ABA check digit.
- **Two banking calendars, because they disagree.** The Federal Reserve decides whether payroll
  funds; the IRS decides when a deposit is due. A holiday falling on a Saturday costs the Fed
  nothing — Reserve Banks stay open the preceding Friday — while the IRS observes it on that Friday.
  DC Emancipation Day moves the deposit deadline with the banks fully open. Friday 2026-07-03 is
  both: money moves, deadline shifts. Pay dates are checked against the first calendar and deposit
  due dates against the second, including Pub 15's extra-day-per-legal-holiday allowance that a
  plain next-business-day roll gets wrong.
- **Florida RT-6.** The first state return, built from the same ledger and reconciled against the
  reemployment tax actually accrued. The $7,000 base is applied **per employee per calendar year**
  with the quarterly year-to-date carry — the same trap as FUTA. It does not generate the payment
  coupon's OCR scanline: no published document describes that string, and a wrong one misroutes a
  payment.
- **SSA EFW2.** The electronic W-2 submission, with its RT totals read back **out of the finished
  file** rather than compared to the builder's own arithmetic. The layout is versioned per tax year
  and an **unverified year is refused by name** — tax year 2026 adds Box 12 codes TT and TP, which
  have no field in the verified 2025 layout, and guessing their positions yields a file the SSA
  rejects or silently truncates.
- **Checks** get numbers from a sequence that cannot reissue one, an amount in words, and the
  six-month staleness legend from UCC § 4-404's actual text. **No MICR line is generated** — see
  below.

### Why there is no MICR line

The standard that governs the MICR band (ANSI X9.100-160-1) is paywalled, and every obtainable
vendor document contradicts the others: 62 versus 65 character positions, the EPC field at 44 versus
44–45, the auxiliary on-us field starting at 44 versus 45, and one manual describing the on-us field
as "positions 13-32" and "nineteen spaces" in consecutive sentences. A MICR line one position out is
rejected by the bank's reader-sorter or posted to the wrong account, and the band needs magnetic
toner no software can supply. Checks therefore print onto your bank's pre-encoded stock. This is the
same rule the state tax tables follow: **a wrong table is worse than an absent one, because the
operator cannot tell it is wrong.**
