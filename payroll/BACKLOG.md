# payroll — BACKLOG

The canonical queue of deferred work for the `payroll` package. It lives here, in the package,
because the package is what ships; the core repository keeps only the shared framework dependencies
this app installs against.

**The numbering is load-bearing.** [ADR-123](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/123-payroll-app.md)
cites these items by number ("backlog item 12", "Item 15", "Item 16"), so items keep their numbers
for life. A finished item stays in place with what it shipped and what it uncovered — the landmines
outlive the gap — rather than being deleted and renumbering everything after it.

**Nothing below is required for the shipped scope to be correct.** Each is a coverage or product
gap, and each says *why* it was deferred so it is not silently re-litigated. Anything commissioned
from this queue ships under the same bar the rest of the package meets:

1. **A primary-source citation wherever the answer is legally material** — a rate, a threshold, a
   field position or a deadline is transcribed from the retrieved document and cites it inline. A
   wrong table is worse than an absent one, because the operator cannot tell it is wrong.
2. **A focused calculation or isolation guard** — a known-value test derived from the source's own
   worked example, or an ownership test that fails when one company reaches another's row. Not a
   test that asserts whatever the implementation happened to produce.
3. **Clean-tenant output evidence** — the artifact produced from an empty company is shown to be
   empty and correct, not merely non-crashing.

Status vocabulary: `SHIPPED`, `PARTLY SHIPPED`, `OPEN`, `REFUSED`, `HUMAN TASK`.

`tests/payroll-backlog-queue.test.mjs` guards this file: contiguous numbering, a status per item, a
done-when on every unfinished item, coverage of every subject, and README references that actually
link here.

---

## 1. State withholding beyond the shipped set

- **Status:** OPEN
- **Where:** `src-routes/payroll-state-tax.ts` (`STATE_RULES`, `KNOWN_UNSUPPORTED`).
- **Today:** four states ship verified tables — PA 3.07% flat, IL 4.95% less $2,925 per allowance,
  KY 3.5% after a $3,360 standard deduction, and MO's eight-bracket progressive schedule with
  whole-dollar rounding — plus the nine states levying no wage income tax, which withhold a *known*
  zero. Every other state falls back to an operator-entered rate **with a warning**, and a zero rate
  warns louder.
- **Why deferred:** a wrong withholding table is worse than an absent one. Indiana cannot ship until
  its mandatory county tax is modelled (item 2), and North Carolina needs its withholding rate —
  deliberately higher than its tax rate — confirmed from NC-30. Both are recorded in
  `KNOWN_UNSUPPORTED` with the reason rather than approximated.
- **Done when:** the state's rule is in `STATE_RULES` with a retrieved primary-source citation, a
  known-value test derived from that state's own worked example (the Missouri pattern), and its
  removal from `KNOWN_UNSUPPORTED` if listed there.

## 2. Local and city taxes, state disability, and paid-leave contributions

- **Status:** OPEN
- **Scope:** Indiana counties, Ohio municipalities, PA Act 32 EIT/LST, NYC and Yonkers, the Maryland
  county piggyback, Michigan cities; CA SDI, NY DBL/PFL, NJ TDI/FLI, WA PFML and Cares, and the
  MA/CT/OR/CO PFML programs.
- **Why deferred:** these are a second withholding *dimension*, not a rate tweak. For Indiana and
  Maryland the local piece is part of the state answer, which is why those states cannot ship at all
  under item 1.
- **Done when:** an employee carries a jurisdiction list, each shipped jurisdiction has a cited rate
  table and a known-value test, and an employee in an unmodelled jurisdiction warns rather than
  silently withholding zero.

## 3. Per-workweek hours, and the FLSA records behind them

- **Status:** PARTLY SHIPPED
- **Shipped (v2, 2026-08-01):** earnings are rows, each carrying a workweek index
  (`src-routes/payroll-ledger.ts`), so overtime is computed **per workweek** and never averaged
  across them — 30 hours one week and 50 the next owes ten hours of premium even though the period
  total is 80 (29 CFR 778.104). The regular rate is weighted across multiple rates and a
  nondiscretionary bonus lifts it (29 CFR 778.117). The derived row is **premium-only**: an early
  draft emitted a full time-and-a-half row on top of hours already paid straight and paid the base
  hours twice, which is why `src-routes/payroll-codes.ts` says so where the derivation lives.
- **Still open:** the record-keeping half. Hours are recorded per workweek, not per workday, so the
  daily record 29 CFR 516.2 requires cannot be produced from stored rows.
- **Done when:** hours can be recorded per workday, and the 29 CFR 516.2 daily and weekly record set
  is retrievable for the full retention period from stored rows rather than reconstructed.

## 4. Protected identifiers — SSN, addresses, and the employer EIN

- **Status:** SHIPPED
- **Shipped (v2, 2026-08-01):** `src-routes/payroll-identity.ts` seals the SSN and EIN with the
  framework's vault crypto; `ssn_last4` backs a masked display, and the ciphertext envelope is
  scrubbed at the same chokepoint as date normalization — a guard caught `GET /employees` returning
  the envelope, which is still the value, wrapped. Exactly one route returns a full SSN
  (`POST /employees/:id/ssn`), it is confirm-gated with a 428, and it writes its audit row **before**
  the value leaves. `GET /reports/w2-readiness/:id` derives whether a real W-2 can be issued and
  names what is missing, so "preview" became a computed state rather than a permanent label.
- **What it cost:** the package is now a holder of the most sensitive identifier a person has. Any
  new read path for it is an isolation question first and a feature second.

## 5. Employee self-service

- **Status:** OPEN
- **Today:** one OIDC sub is the whole company. An employee cannot log in to fetch their own stub or
  W-2, and there is no segregation of duties — the person who edits a pay run is the person who
  approves it.
- **Why deferred:** it needs a second identity class scoped to a single `employee_id`, which is a
  platform decision about identity rather than a payroll feature.
- **Done when:** an invited employee reads ONLY their own stubs and W-2, proven by an isolation spec
  that fails if that identity reaches another employee's row or any company-level report.

## 6. Overpayment repayment across tax years

- **Status:** OPEN
- **Why deferred:** it is genuinely different from a void. The employee had constructive receipt, so
  for a prior year box 1 is **not** adjusted — only boxes 3–6 move, through a W-2c, with the employee
  taking a claim-of-right deduction on their own return. Getting that backwards is an IRS violation,
  so approximating it is worse than refusing it.
- **Done when:** same-year and prior-year repayment are separate transactions, each cited to the
  Publication 15 / W-2c instruction that governs it, with a test asserting the prior-year case leaves
  box 1 alone while boxes 3–6 move.

## 7. Multiple garnishment orders with statutory priority

- **Status:** SHIPPED
- **Shipped (v2, 2026-08-01):** deductions are typed rows (`src-routes/payroll-codes.ts`) with annual
  caps, arrears when net pay runs out, and garnishments carrying an explicit priority — an
  income-withholding order first with its own 50–65% CCPA percentages, then a federal levy, then a
  student loan, then an ordinary creditor writ at the 25%/30× ceiling — all applied under ONE shared
  CCPA disposable-earnings cap rather than per order.
- **The defect this closed:** before it, a single garnishment field had no CCPA Title III cap at all
  and could exceed the legally protected wage.
- **Still worth knowing:** per-order *remittance* — producing the payment and reference each agency
  wants — is not modelled; the deduction is computed, withheld and shown on the stub, and the
  employer remits it. That is the same "oshal computes, you execute" line the whole package holds.

## 8. Deposit schedule and due dates

- **Status:** SHIPPED
- **Shipped (v2.2, 2026-08-02):** a depositor status of monthly or semiweekly drives a per-payday
  deposit amount and due date (`src-routes/payroll-calendar.ts`, surfaced through
  `src-routes/payroll-reports.ts`), including the $100,000 next-business-day rule that overrides the
  status, and Pub 15's extra-day-per-legal-holiday allowance for the semiweekly window — which is
  **not** a next-business-day roll and can land later than one.
- **Note:** the amount is what the ledger says is owed. Whether it was *paid* is item 12.

## 9. Benefits, accruals, pay rates, payment records, and contractors

- **Status:** PARTLY SHIPPED
- **Shipped:** multiple pay rates with a weighted regular rate (item 3); payment records with
  direct-deposit splits, check-number uniqueness and the ACH trace numbers a return is matched by
  (items 13 and 15); bank-holiday pay-date shifting (item 14); and imputed group-term life and
  personal vehicle use as earnings codes that are taxed but never paid.
- **Still open, each an additional record type rather than a tax computation:** PTO and leave
  **accrual** (PTO is an earnings code and draws no balance — there is no accrual engine), the
  employer 401(k) match, workers' compensation, the employer share of benefit premiums, and the 1099
  contractor path. A worker can be classified `1099` (`src-routes/payroll-schema.ts`), but no
  1099-NEC is produced and no contractor payment path exists.
- **Done when:** each is a first-class record type with its own stub or report presentation, an
  accrual carries its balance forward across runs, and a clean company produces empty-and-correct
  output for each.

## 10. Money movement and filings

- **Status:** PARTLY SHIPPED
- **Shipped (v2.1, 2026-08-01):** the NACHA PPD ACH file the employer uploads to their OWN bank (with
  a prenote mode for zero-dollar account validation), Form 941 and Form 940 worksheets carrying real
  line numbers and reconciling against the tax actually withheld, and issuable W-2s once identity is
  on file. **oshal computes and produces; the employer's bank and EFTPS execute.**
- **Correction to this item's original premise, kept because it will be proposed again:** the Gusto
  connector is READ-ONLY (`GET /me`, `/companies/{id}/employees`, `/companies/{id}/payrolls`) and was
  never a filing path. More decisively, an embedded payroll provider computes its **own** withholding,
  so delegating would make the verified engine in this package decorative — a UI over someone else's
  payroll. That is why the self-contained direction was chosen.
- **Remainder:** items 11–16 below.
- **Done when:** items 11–16 are each shipped, refused with a recorded reason, or closed; this item
  is their rollup and closes with the last of them.

## 11. Electronic W-2 filing (SSA EFW2)

- **Status:** HUMAN TASK
- **Shipped (v2.2, 2026-08-02) for verified tax years:** `src-routes/payroll-efw2.ts` builds the
  RA/RE/RW/RT/RF submission at 512 fixed positions for tax year 2025, whose Publication 42-007 was
  retrieved in full and whose fields were verified to tile positions 1–512 with no gap or overlap.
  Its RT totals are read back **out of the finished file** rather than compared to the builder's own
  arithmetic. The RW and RT field ORDERS diverge (RW runs Q, C, V, Y, AA, BB, DD, FF; RT runs Q, DD,
  C, sick-pay, V, Y, AA, BB, FF), so a positional loop swaps DD and C and mis-aligns everything after
  them — both maps are keyed by name and a guard asserts it with distinguishable amounts.
- **The block, and it is not a code problem:** `EFW2_VERIFIED_TAX_YEARS` is `[2025]`. Publication
  42-007 for TY2026 could not be retrieved — `https://www.ssa.gov/employer/efw/26efw2.pdf` returns
  HTTP 403 to every automated fetch (WebFetch, curl and PowerShell, multiple user agents). TY2026
  **adds Box 12 codes TT and TP**, which this engine already computes and which have no field
  anywhere in the 2025 layout, so the builder refuses that year **by name** rather than guessing.
  A person with a browser downloads it in ten seconds; no amount of agent effort gets past the edge
  block.
- **Done when:** `26efw2.pdf` is retrieved, its layout is added to `EFW2_VERIFIED_TAX_YEARS` with the
  TT and TP money-field positions cited to that document, and a generated file is validated through
  AccuWage Online — itself a human step, an SSA web tool rather than an API.

## 12. Enrolled filing and payment rails — EFTPS deposits and 941 e-file

- **Status:** OPEN
- **Today:** the deposit schedule (item 8) and the 941 worksheet (item 10) both exist. **Nothing
  transmits.** There is no e-file and no EFTPS enrolment.
- **Why deferred:** both need an enrolment and credentials a human completes, and the worksheet
  already tells an employer exactly what to pay and by when. This is the one item in the group that
  is not a code problem.
- **Done when:** a deposit is initiated through an enrolled channel and its confirmation number is
  recorded against the obligation, so the deposit report shows paid-versus-owed rather than
  owed-only — with the credential resolved per request, used outbound, and never logged, stored in
  the clear, or returned.

## 13. ACH returns and notifications of change

- **Status:** SHIPPED
- **Shipped (v2.2, 2026-08-02):** `src-routes/payroll-ach-returns.ts` parses the file the bank hands
  back. A **return** (R02 account closed, R03 no account) marks that person unpaid with the statutory
  consequence attached; a **notification of change** means the opposite — the money arrived and the
  bank is correcting the details for next time. Treating an NOC as a failure is a common and
  expensive mistake, so it is asserted in both directions. Applying a correction to an employee's
  account is confirm-gated and re-validates the ABA check digit.
- **The prerequisite this uncovered:** `buildAchFile` assigned each entry a trace number and threw it
  away, and a return identifies its entry ONLY by that original trace — so there was nothing to match
  against. The builder now returns the traces and the ACH route persists them. **Runs whose ACH file
  was generated before v2.2 have no stored trace and must be matched by hand**; the settlement view
  reports that count rather than hiding it.
- **Provenance, stated in the module rather than implied away:** the Nacha Operating Rules are
  paywalled and were never read. The addenda 98/99 layouts are reconstructed from concurring
  secondary sources — a Nacha-member education deck, moov-io/ach's parser source, and a real
  bank-produced return file. The package **parses only** and never originates a return, dishonour or
  reversal, which is the safe direction at that level of confidence.

## 14. Bank-holiday calendars

- **Status:** PARTLY SHIPPED
- **Shipped (v2.2, 2026-08-02):** `src-routes/payroll-calendar.ts` drives both the pay-date shift and
  the deposit due date, chaining through consecutive closures, with the reason shown.
- **The finding that mattered: ONE holiday list is a bug — there are TWO calendars.** The Federal
  Reserve decides whether money moves; the IRS decides when a deposit is due, and they disagree. A
  holiday falling on a SATURDAY costs the Fed nothing (Reserve Banks stay open the preceding Friday)
  while the IRS observes it on that Friday. DC Emancipation Day is an IRS legal holiday the Fed does
  not observe at all. Friday 2026-07-03 is both at once: banks open, payroll funds, deposit deadline
  moves. A single shared `isHoliday()` gets one of the two wrong, silently.
- **Still open, annually:** `IRS_HOLIDAYS_VERIFIED_THROUGH` is 2026. Only that year's list has been
  read from that year's Pub 15; later years are computed from the same rules (which reproduce the
  verified 2026 list exactly) and returned with `verified: false`.
- **Done when:** each new tax year's Pub 15 legal-holiday list is transcribed from that year's
  publication and `IRS_HOLIDAYS_VERIFIED_THROUGH` moves with it. Re-read it rather than trusting the
  derivation.

## 15. Check printing, and the MICR line that is refused

- **Status:** PARTLY SHIPPED
- **Shipped (v2.2, 2026-08-02):** `src-routes/payroll-checks.ts` produces numbering from an atomic
  single-statement sequence that cannot reissue a number, the printable check with the amount in
  words, and the six-month staleness legend from UCC § 4-404's actual text.
- **Refusal:** **no MICR line is generated, ever.** ANSI X9.100-160-1 governs the MICR band and is
  paywalled, and every obtainable vendor source contradicts the others — 62 versus 65 character
  positions; the EPC field at "either, but not both, positions 44 or 45" versus "position 44–45"; the
  auxiliary on-us field starting at 44 versus 45; and one manual describing the on-us field as
  "positions 13-32" and "nineteen spaces" in consecutive sentences. A line one position out is
  rejected by a reader-sorter or posted to the wrong account, and the band needs magnetic toner no
  software supplies. Checks print onto the bank-encoded stock small employers already buy.
- **Done when (if ever):** someone buys ANSI X9.100-160-1 and X9.100-20, the field positions are
  cited from the standard rather than from vendors, and a printed sample is accepted by a real
  reader-sorter. Until a paid-for standard is in hand this stays refused — do NOT "fix" it by picking
  whichever vendor number appears most often.

## 16. State quarterly returns, starting with Florida RT-6

- **Status:** SHIPPED
- **Shipped (v2.2, 2026-08-02):** `src-routes/payroll-rt6.ts` produces every line from the same
  ledger and reconciles against the reemployment tax actually accrued, following the 941 pattern. The
  $7,000 base is applied per employee per calendar year with the quarterly year-to-date carry — the
  same trap as FUTA, where a company-wide shortcut understates the exclusion badly.
- **Why Florida was first:** the "never outrun correctness" rule. Florida levies no wage income tax,
  so there is no withholding table to be wrong about — it is the one state whose return can be
  trusted before the tables are.
- **Two deliberate omissions:** it does not generate the payment coupon's OCR scanline (no retrieved
  document describes that string's structure or check digit, and a wrong one misroutes a payment),
  and it does not roll the penalty-after date off a weekend (Florida's rule for that appears in none
  of the department's documents, and the IRS calendar is the wrong authority for a state deadline —
  it includes DC Emancipation Day).
- **Done when (next state):** the same, for a state whose withholding table is already verified under
  item 1 — which today means PA, IL, KY or MO, not an arbitrary next state.
