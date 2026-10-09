# Futures Research

This headless companion supplies a dedicated workflow and tool-less research worker. Trading
owns the console controls; the framework owns study admission, exact owner/run/ticket binding,
strict output validation and durable review state. The equity decision workflow is unchanged.

Install the matching framework and this package, then enable `futures-research-worker` in the
Bots console. On Compose, its optional service has the same name as the bot, so the existing
console start/stop operation addresses it directly. No CLI login or connector secret is mounted
on this worker. A configured hosted provider is required for supported unattended reasoning.

In Trading → Strategies → Tuning, opt into **Queue research-bot review after new evidence** and
save. The schedule owner must still be an operator, the schedule active and opt-in enabled when
the queue executes. Installation alone does not enroll anyone or create a schedule. New completed
or insufficient-sample evidence may be reviewed. With the matching framework, newly settled forward
outcomes also permit review of unchanged historical studies. Identical historical/settled evidence
is visibly skipped without spending; pending calls alone do not trigger reviews. Failed studies
do not trigger reasoning.
Results and workflow ticket IDs appear with the study. Loading a proposal changes only the form;
explicit Save is the approval that selects future studies. The bot never places orders.

`bound-workflow-results` is a fail-closed core compatibility floor. The worker uses the ordinary
signed bot transport and task/cost accounting, not inference from a detached scheduler callback.
Forged tickets without an exact durable binding fail before inference. Late results cannot replace
a newer attempt, and completed reviews are not regenerated on queue replay.

Version 1.1.0 interprets the framework's frozen forward context separately from historical OOS.
It must cite the exact supplied context fingerprint. The latest 25 graded and 25 other owner
receipts disclose total available counts and separate contract/model/study/horizon cohorts.
Unscored and flat cases are not wins; overlapping horizons are not independent and signed ticks
are not trade P&L or probabilities. Outcome-informed proposals consume that holdout and require
new untouched evidence. Later outcomes do not rewrite a completed review; a later run carries
later evidence. Trading 1.25.0 displays these snapshots and the explicit adoption boundary.

Tests are registered in `tests/test-lab.yaml`. Local synthetic/fixture tests do not prove installed
provider cost receipts, a real nightly observation, forward prediction grading or paper acceptance.
Those remain required before closing the Futures backlog.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| futures-study-review | study review | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
