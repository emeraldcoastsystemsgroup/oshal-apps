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

- **Status:** SHIPPED
- **Shipped (v2, 2026-08-01):** earnings are rows, each carrying a workweek index
  (`src-routes/payroll-ledger.ts`), so overtime is computed **per workweek** and never averaged
  across them — 30 hours one week and 50 the next owes ten hours of premium even though the period
  total is 80 (29 CFR 778.104). The regular rate is weighted across multiple rates and a
  nondiscretionary bonus lifts it (29 CFR 778.117). The derived row is **premium-only**: an early
  draft emitted a full time-and-a-half row on top of hours already paid straight and paid the base
  hours twice, which is why `src-routes/payroll-codes.ts` says so where the derivation lives.
- **Shipped (v2.4, 2026-11-20): hours by the workday, and the 29 CFR 516.2 record from stored rows.**
  An earning row carries the day it was worked (`work_date`), and a dated row's workweek comes from
  the date and the employer's fixed workweek start (Settings: the day and the time of day, 516.2(a)(5)),
  never from a typed index; a date outside the period, or an undated hour beside dated ones, is refused
  in words (`src-routes/payroll-workweek.ts`). The register's **Hours by day** editor records them.
  **Reports → FLSA payroll record** (`src-routes/payroll-flsa-records.ts`) answers each 516.2(a) item
  for an employee and date range from the rows stored when the run was paid: name and number, home
  address, date of birth if under 19, the title the regulation allows for sex and the occupation, the
  workweek start, hours each workday and each workweek, the regular rate in a workweek with overtime,
  the basis of pay, payments left out of the regular rate, straight time, premium, every addition and
  deduction, wages paid, and the date and period, with each period's keep-until date (516.5(a): three
  years; 516.6(a)(1): two for time cards). An item not on file is named, and a period whose hours were
  entered for the period rather than by the day says so. Paid runs are never deleted (a void corrects
  them) and an employee with history is terminated, not deleted, so the record is the stored rows.
- **The defect this closed:** a workweek that two checks split (every semimonthly period splits some)
  was computed on each check's share alone, so 18 hours on one check and 32 on the next owed no
  overtime anywhere. With dated rows, the later check reads what earlier paid checks recorded for that
  workweek (voided ones left out) and pays the premium over the whole workweek at its weighted regular
  rate, less any premium already paid. A line moved to earning rows keeps the deductions set on the
  employee form.
- **Where it stops:** a line entered as hours for the whole period (the hours-and-rate line) still
  cannot answer 516.2(a)(7)'s daily half or split a workweek with another check; the record names that
  period, and entering its hours by the day fixes both.

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

- **Status:** PARTLY SHIPPED
- **Shipped (v2, 2026-08-01):** deductions are typed rows (`src-routes/payroll-codes.ts`) with annual
  caps, arrears when net pay runs out, and garnishment codes for support, a federal levy, a student loan
  and an ordinary creditor writ.
- **The defect this closed then:** before it, a single garnishment field had no CCPA Title III cap at all
  and could exceed the legally protected wage.
- **Corrected (v2.4, 2026-11-20): the shipped orders did not reach a paid run, and their ceilings were
  wrong.** Four defects, each read in the code: approval recomputed every line from hours and rate, so
  a line built from earning rows lost its rows and its deduction elections at the moment it was paid;
  the balance write-back that moves arrears and year-to-date was never called; it would have counted
  carried arrears twice; and the one shared room every order drew on was the 25 percent creditor limit,
  so a support order was held to 25 percent where 15 U.S.C. 1673(b)(2) allows 50 to 65, and a levy and
  an agency order were held to the creditor limit too. `src-routes/payroll-garnish.ts` is now the one
  allocator both engines use:
  - **cumulative federal ceilings** (29 CFR 870.11(b)(2) and its four illustrations): support up to its
    own percentage, a creditor writ up to the 15 U.S.C. 1673(a) limit (29 CFR 870.10's 30-times-minimum-
    wage floor per pay period), each less what orders with priority already took;
  - **a federal agency order, including a student loan** (31 CFR 285.11(i)): the order's amount up to 15
    percent of disposable *pay*, which is also after health insurance premiums, and behind an order with
    priority at most 25 percent of disposable pay less that order;
  - **a federal tax levy**: no CCPA ceiling (15 U.S.C. 1673(b)(1)(C)); it takes take-home pay above the
    amount IRS Publication 1494 (Rev. 12-2025) exempts for 2026, by the employee's filing status,
    dependents and additional standard deductions (a statement not returned counts as married filing
    separately with none, IRM 5.11.5.4.1), until the amount owed is paid;
  - **priority**: support before other legal process (42 U.S.C. 666(b)(7); 31 CFR 285.11(i)(3)(i)),
    except that a levy goes ahead of support entered after it (26 U.S.C. 6334(a)(8)).
  Approval keeps an earning-row line on its own engine, moves each order's own balance once the run is
  paid, and refuses (409, with each employee's reason) a run whose garnishment facts are missing.
  Employees → **orders** is where a person enters each order and its facts.
- **Refused rather than guessed, by design:** which of two or more non-support orders comes first is
  State law or other federal law (29 CFR 870.1(a)), so the person states it and a check without it is
  refused; how several support orders share a ceiling they exceed together is the work state's law (42
  U.S.C. 666(b)(6)(A)(i)(IV)), so that check is refused until each order's amount is entered as
  allocated; a levy whose statement year is not 2026 is refused, because only the 2026 Publication 1494
  is held. A state's own lower garnishment limit is entered on the order; no state's limits are held.
- **Still open:** voiding a paid run negates its lines but does not roll back the balances (year-to-date,
  lifetime, arrears) that approval moved on its orders; per-order *remittance* (the payment and reference
  each agency wants) is not modelled, so the employer remits what the stub shows withheld; and the
  Publication 1494 held is 2026's (`PUB1494_BASE`, `PUB1494_PER_DEPENDENT`, `PUB1494_ADDITIONAL`,
  `LEVY_TABLE_YEAR`).
- **Done when:** a void restores each election's balance from the voided run's deduction rows, with a
  test that approve-then-void leaves every balance where it began; each order's withheld amounts can be
  listed per pay date with its payee and case number for remittance; and each new year's Publication 1494
  is transcribed from that year's publication when the IRS issues it.

## 8. Deposit schedule and due dates

- **Status:** SHIPPED
- **Shipped (v2.2, 2026-08-02):** a depositor status of monthly or semiweekly drives a per-payday
  deposit amount and due date (`src-routes/payroll-calendar.ts`, surfaced through
  `src-routes/payroll-reports.ts`), including the $100,000 next-business-day rule that overrides the
  status, and Pub 15's extra-day-per-legal-holiday allowance for the semiweekly window — which is
  **not** a next-business-day roll and can land later than one.
- **Corrected (v2.4, 2026-11-20): the deposit report did not use the calendar it was credited with.**
  `GET /reports/deposits` rolled a due date off weekends only and tested the $100,000 rule on each
  payday alone. January 2026 liabilities came out due Monday February 16 (Washington's Birthday)
  instead of Tuesday the 17th; a Friday payday before Memorial Day came out due Wednesday instead of
  Thursday; and two paydays adding to $100,000 in one month never triggered the next-day rule. The
  report now goes through `src-routes/payroll-deposits.ts`, which groups paydays by **deposit period**
  (the calendar month, or Wednesday to Friday and Saturday to Tuesday, split where a period spans two
  quarters), takes every due date from the IRS legal-holiday calendar (item 14), makes the One-Day
  test on taxes **accumulated in the period** and starts anew after the day it is met, turns a monthly
  depositor semiweekly from the next day for the rest of the year and the next, and reports the
  $2,500 pay-with-return test per quarter. Sources: 26 CFR 31.6302-1(b), (c) and (f)(4) (eCFR, current
  to 2026-11-18) and Publication 15 (2026), section 11; the tests are built from that publication's
  Spruce Co., Green, Inc., Elm, Inc., Fir Co. and Rose Co. examples and the regulation's Memorial Day
  example.
- **The depositor status is worked out, not guessed:** Settings has a lookback helper that takes the
  four Form 941 line 12 amounts (July 2024 to June 2025 for 2026, or calendar 2024 for a Form 944
  filer) and answers monthly or semiweekly against the $50,000 line. The package holds no payroll
  from the lookback period, so it asks for the amounts. Form 943, 944 and 945 depositors are not
  modelled; the package produces Form 941 only.
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
- **Shipped (v2.4, 2026-11-20): both calendars are transcribed tables with the years they hold.**
  The Federal Reserve calendar is the Board's K.8 schedule for 2026 to 2030 (last update July 8,
  2026), row for row with its own Saturday and Sunday footnote markers. The IRS calendar is the
  twelve-line list in Publication 15 (2026), section 11, plus the thirteen-line 2027 list from the
  IRS **early-release draft** of Publication 15 (2027) dated October 15, 2026. A draft is marked
  "not for filing", so the 2027 list is returned with `verified: false` and its basis named. The
  observance rules (5 U.S.C. 6103(a) for K.8, D.C. Code 28-2701 for the IRS lists) are kept only as
  cross-checks the tests run against the tables.
- **What changed in behaviour:** a date in a year a table does not hold is **refused by name**
  (`CalendarCoverageError`, a 422 in words on every route) where it used to be computed from the
  rules and flagged. A due date reports unverified when either the payday's year or the due date's
  year is unverified, so a December 2026 payday due in January 2027 says so. And two defects closed:
  creating a run shifted a pay date off a weekend only, so a pay date on a Reserve Bank holiday
  (Christmas Friday 2026) was kept and would not have funded; and a pay date outside the tax year
  surfaced as a 500 from the first line. Run creation now uses the Federal Reserve calendar and
  answers with the reason, and the tax-year refusal is a 422 in words.
- **Still open, annually:** `IRS_HOLIDAYS_VERIFIED_THROUGH` is 2026. On 2026-11-20 the final
  Publication 15 (2027) had not been published (`irs.gov/pub/irs-pdf/p15.pdf` was still the 2026
  edition), so the 2027 list could only be read from the draft. No IRS list is held for 2028 or
  later, and K.8 prints no year after 2030.
- **Done when:** each new tax year's Pub 15 legal-holiday list is transcribed from that year's
  **final** publication and `IRS_HOLIDAYS_VERIFIED_THROUGH` moves with it (for 2027: compare the
  thirteen lines with the final Publication 15 (2027), set the list's basis to `publication` and move
  the constant), and each new K.8 column is added when the Board publishes it. Re-read the document
  rather than trusting the cross-check rule.

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
