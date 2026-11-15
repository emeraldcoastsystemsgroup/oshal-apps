# Settled nightly scoring: the measurement and its rule

This page fixes, before any model is asked, how Career's settled nightly scoring (three runs on the
local model, the majority's side of the 70 line, the median as the score, close calls to the stronger
model) is compared with Sonnet's own settled shortlist. It is committed before the first call, so git
dates it. The rule is not changed after the results are seen; a change is proposed, not applied.

## What is scored

- **The candidate:** the made-up candidate of the kernel's `ops/audit/career_scoring_agreement.py`
  (`PROFILE`, a senior data engineer). No real person's résumé, saved jobs or scores are read.
- **The postings:** 50, all made up. The kernel script's 24 (`JOBS`, Token Chase's case: six each of
  tiers A strong, B adjacent, C weak, D unrelated) and the 26 in
  [`scripts/measure-settled-scoring-postings.json`](../scripts/measure-settled-scoring-postings.json):
  8 clear fits (A), 10 designed near the line (N), 8 clear misses (D).
- **The prompt:** Career's own, as the kernel script builds it: `score.py` `SYSTEM`, `PROMPT` and
  `SCORING_MAX_TOKENS`, the bot's persona from `personas/career-hunter.yaml`, the kernel's system
  contract from `crates/inference/src/assembly.rs`, the rail's "JSON only" line, Career's one retry
  (2048 tokens with the compact-JSON line). Each posting's three calls on a model are byte-identical
  (the sha256 of each call's input is recorded).

## The reference: Sonnet's settled shortlist

- Sonnet (`claude-account`/`sonnet`) is asked three times per posting, through the code the Claude
  account relay runs (`ops/claude_account_protocol.py`'s command, as a process of its own), **one
  call at a time, each only when the relay's own service runs no turn**.
- **The 24 kernel postings are not asked again.** Token Chase's three Sonnet runs of 2026-11-14
  11:28:07Z to 11:35:13Z
  (`oshal-handover/lanes/lane-tc2/career-case-20261114/arms.json`, sha256
  `ac85fd803c98289b342c72967d2dc1bd8014393f9241ad1686514021b74c1fb3`) are reused, only when the file
  has that sha256, was measured the same UTC day, and every posting's rebuilt Sonnet input hashes to
  the stored input digest of all three runs. Otherwise the measurement stops before any call.
- **The 26 new postings:** 78 Sonnet calls, plus any retries. The lane's ceiling is 120 Sonnet calls;
  the measurement stops before a call that would pass it.
- **A posting is on Sonnet's shortlist** when a strict majority of its three runs scores 70 or more.
  A run with no valid score after the retry is a side of its own. A posting with no strict majority
  stops the comparison (no verdict), as Token Chase's rule does.

## The new scoring (what the package ships)

- The local model (`vllm`/`bot-fast` on its own endpoint) is asked three times per posting, **at most
  three calls at once** (it is shared with the owner's training).
- **Settled:** all three runs have a valid score, all three are on one side of 70, and their median
  lies outside the band, that is below 64 or above 75 (6 points, Token Chase's band, half-open:
  `64 <= median < 76` is inside). The recorded score is the median.
- **Close call:** anything else: the runs disagree about the side, the median is inside the band, or a
  run has no valid score (a failed run counts as a run on neither side: the rule was measured with
  three answers, and two answers that agree are not a majority of three).
- **A close call goes to the stronger model.** In this measurement the stronger model's answer for a
  posting is **Sonnet's first run on that posting**: its input is byte-identical to the call the
  stronger order would make, so asking again would only be another sample of the same model on the
  same input. It costs no further Sonnet call. Its score at 70 or more puts the posting on the
  shortlist; no valid score leaves the posting undecided (not on the shortlist).
- **The variant the package can run today** (no stronger order reachable from a nightly run, see
  the operations guide): every close call is undecided, so it is not on the shortlist.

## What is reported

- **Shortlist agreement**, for the shipped rule with the stronger model and for the variant without
  it: the two shortlists are equal, or each posting on one and not the other with all six of its
  scores. No tolerance.
- **Calls:** local calls (with retries), Sonnet calls made, Sonnet calls reused.
- **Close calls:** how many, which, and why (sides, band, failed run).
- **Seconds:** each local call's seconds, the wall time of the local runs at three at once, seconds
  per posting.
- **Production-shaped speed (time only, not judged):** the same three local runs, three at once, on
  prompts padded with made-up surroundings to about the length production's nightly calls had
  (MODEL1: about 16,500 prompt tokens), to say how many jobs a night the defaults give.
- **What stops a measurement (not a result):** a call that raises (an account refusal, a timeout, an
  HTTP error), or a posting whose three inputs are not byte-identical. What was measured until then is
  kept apart and nothing is judged.

## Result: measured 2026-11-14 16:36:21Z to 16:54:05Z under the rule above (added after the run; the rule is unchanged)

Evidence (made-up data only): `oshal-handover/lanes/lane-cr9/measure-20261114/arms.json` (sha256
`ec32f9696fd4e9c2cc53530cd5c2e5ca142fa06635c1a0ea8ecda0fc670514c9`) and `result.json`, written by
`scripts/measure-settled-scoring.py`: the local and Sonnet phases as of commit `c9f9ba41`, the production-shaped
redo with its change 2 (below, committed in `938ec891`).

- **Calls:** 151 local (150 runs, one retry), three at once; 78 new Sonnet calls one at a time (none waited
  on the relay, no retry, $1.14 at the CLI's reported price, a shadow price on a subscription), plus Token
  Chase's 72 reused under its three checks. Every posting's three inputs on each model were byte-identical.
- **The shortlist with the stronger model (the rule as designed) differs from Sonnet's on 1 of 50:**
  posting 33, Data Engineering Manager (N): the local model settled it **on** the shortlist at 85
  (88, 82, 85); Sonnet settles it below (66, 66, 72), 19 points lower at the median. A manager role whose
  must-have is three years of managing engineers; the candidate led four engineers for two.
- **Without the stronger model (what the package can run today) it differs on 2 of 50:** posting 33 as
  above, and posting 35, Big Data Engineer (N): Sonnet shortlists it (80, 80, 78); the local runs (82, 75,
  72) are a close call (median 75 inside the band), so it is left undecided and not on the shortlist.
- **On Token Chase's 24 the two shortlists are equal** in both forms (the six strong postings).
- **Close calls: 5 of 50** (postings 11, 32, 34, 35, 39; three for the band, two for the sides). The
  stronger model's answer would put only 35 on the shortlist.
- **Seconds:** short prompts (about 3,450 tokens) 6.4 s a call, 6.45 s a job at three at once (wall
  322.4 s for 50 jobs). **Production-shaped** (16,732 prompt tokens on average, made-up padding; time only):
  7.4 s a call, **7.61 s a job** at three at once (wall 182.6 s for 24 jobs).
- **The script's change 2:** the first production-shaped attempt (16:47Z) stopped on a local answer with
  no text, which the kernel reads as empty text and Career then retries; the script now reads it the same
  way. The redo (16:51Z to 16:54Z) had none in 72 calls. Nothing judged was measured by the stopped attempt.

**Proposal, not applied (the rule stands):** three runs cannot catch a model that is wrong the same way
three times; posting 33 is that case (MODEL1 named the kind: an adjacent role whose must-have is a kind of
experience). When a stronger order can be reached from a nightly run, also send every job the local model
settles **above** the line to it, not only the close calls: on these 50 data that is 22 stronger calls
(17 settled above, 5 close) and, taking Sonnet's first run as the stronger answer, a shortlist equal to
Sonnet's on all 50. This is a counterfactual on the same data, for the reader; it was not fixed beforehand.

**Changed after the run, on the coordinator's instruction (no measured posting is affected: every one of the
151 local and 78 Sonnet runs had a valid score):** a job with fewer than two valid runs is not scored (it stays
pending and reads Not scored yet) instead of a close call, and an answer with no text, which the kernel refuses
as unavailable, is one unanswered try (Career's retry follows) instead of ending the whole pass. The rule above
is otherwise what ships.
