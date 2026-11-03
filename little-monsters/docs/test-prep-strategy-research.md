# Official practice and question-type strategy research

Reviewed 2026-10-28. The initial Study Lab research established exam formats and a starter
curriculum. This follow-up adds downloaded publisher practice, a broader question-type guide,
and inspected question references. It does **not** claim that every question or every useful
technique has been reviewed.

## Downloaded material

All **32 PDFs** were downloaded successfully, opened by `pdfinfo`, extracted for local research,
and verified against SHA-256 checksums. Total PDF size: **71,450,063 bytes**.

| Publisher | Forms | Files | Scoring distinction |
|---|---|---:|---|
| College Board | SAT 4–11 | 8 tests + 8 scoring guides + 8 answer-explanation documents | Nonadaptive paper forms; use each form's matching guide |
| ACT | Practice tests 1–4 | 4 booklets + 4 separate online scoring keys | Paper scoring is inside each booklet; the separate keys are explicitly for online forms |

Source listings: [College Board paper tests](https://satsuite.collegeboard.org/practice/practice-tests/paper)
and [ACT free practice](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/free-act-test-prep.html).
The latter also links timed and untimed online section practice.

The files are in `data/test-prep/official-downloads/`, organized by exam and test number.
The [resource index](../data/test-prep/official-resources.json) records the exact publisher URL,
discovery page, local filename, form/mode, page count, byte count and checksum for each file.
PDFs and extracted text are local study/research downloads, ignored by Git. The application
publishes publisher links and original instructional notes; it does not serve copies of the PDFs
or insert their questions into the original question bank. Public store publishing uses a tracked
Git snapshot. Do not package an arbitrary filesystem copy of the local download directory.

To reproduce or verify the downloads (Python 3.9+, `pdfinfo` and `pdftotext` required):

```bash
python3 little-monsters/scripts/download-official-practice.py
```

The downloader uses approved HTTPS publisher hosts, bounded downloads, PDF signatures and pinned
checksums. Existing verified files are reused. Changed publisher files are refused until someone
reviews the change and deliberately uses `--refresh-index`; update the review date and any form
annotations after that review. A failed download exits nonzero and does not report the set complete.

## Format findings that affect advice

- Each downloaded SAT paper form has **33 + 33 Reading and Writing** and **27 + 27 Math**
  questions, totaling 120. They must not inherit the 98-question digital simulation's question
  counts, timers or scoring. [Bluebook](https://bluebook.app.collegeboard.org/) supplies adaptive
  rehearsal. Previewing paper forms can expose material later encountered in digital practice.
- The current ACT test 1 booklet is **2026–2027**, 82 pages. Its section instructions specify
  English 50/35 minutes, Math 45/50, Reading 36/40 and Science 40/40. The other three downloaded
  forms have those same multiple-choice counts and time limits. Use the booklet's scoring
  directions, which distinguish scored items from embedded unscored items.
- The [ACT Science tips page](https://www.act.org/content/act/en/students-and-parents/high-school-success/testing-advice-for-the-act/act-science-test-tips.html)
  still states **35 minutes**. Its reasoning advice is useful, but that time is superseded by the
  current booklet's **40 minutes**. The Writing tips page also contains unrelated Science
  promotional text; only its actual writing guidance was used.
- [Desmos testing calculators](https://help.desmos.com/hc/en-us/articles/18228147914381-Practice-With-Testing-Calculators)
  can differ from the consumer calculator. Practice a calculator method in the actual SAT
  environment; do not promise undocumented calculator shortcuts will be available.

## Strategy coverage

The [strategy catalog](../data/test-prep/strategies.json) contains **47 distinct original study
methods**, with 13 primary sources. Each method has exam/section applicability, a full approach,
a shortcut, a limitation, an original example and source references. Shared methods appear in
both exams, so the section counts below are not additive across exams.

| Exam / section | Methods | Question types and useful techniques |
|---|---:|---|
| SAT Reading and Writing | 16 | Context vocabulary; central idea; evidence; inference; structure; paired texts; quantitative evidence; sentence boundaries; asides; agreement; pronouns/ownership; tense; modifiers/parallelism; concision; transitions; rhetorical notes |
| SAT Math | 20 | Requested expression; backsolving; chosen values; estimation; units; percent changes; ratios; systems; Desmos intersections; quadratic forms; discriminant; exponential change; functions; rational/radical equations; scaling; trig; circles; means; conditional probability; statistical claims |
| ACT English | 11 | Boundaries; asides; agreement; pronouns/ownership; tense; modifiers/parallelism; concision; transitions; add/delete; placement; tone/precision |
| ACT Math | 19 | Shared algebra, number, geometry, probability and data methods; SAT-specific calculator instructions excluded |
| ACT Reading | 6 | Context vocabulary; central idea; detail/evidence; inference; function/structure; paired viewpoints |
| ACT Science | 5 | Table/graph lookup; trends; experiment design; competing explanations; necessary background concepts |
| ACT Writing, optional | 2 | Argument planning and perspective analysis; support, organization and revision |
| Both exams | 1 shared | Pacing, flags, fresh practice and separating knowledge from speed |

The sources establish official content coverage, general guidance and tool behavior. The detailed
methods and examples are our instructional derivations, not quotations or publisher endorsements.
For example, substituting a value can disprove an identity but a single match does not prove one;
starting with a middle numeric answer only supports directional elimination when the relationship
is monotonic; the shortest grammatical choice still must preserve meaning. These limitations belong
in the lesson, not in an administrative footnote.

Further primary guidance is linked inside every method:
[SAT Reading and Writing](https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing),
[SAT Algebra](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/types/algebra),
[SAT Advanced Math](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/types/advanced),
[SAT Data Analysis](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/types/problem-solving),
[SAT Geometry](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/types/geometry-trigonometry),
[ACT English](https://www.act.org/content/act/en/students-and-parents/high-school-success/testing-advice-for-the-act/act-english-test-tips.html),
[ACT Math](https://www.act.org/content/act/en/students-and-parents/high-school-success/testing-advice-for-the-act/act-math-test-tips.html),
[ACT Reading](https://www.act.org/content/act/en/students-and-parents/high-school-success/testing-advice-for-the-act/act-reading-test-tips.html),
[ACT Writing](https://www.act.org/content/act/en/students-and-parents/high-school-success/testing-advice-for-the-act/act-writing-test-tips.html),
and [Desmos graphing](https://help.desmos.com/hc/en-us/articles/4406040715149-Getting-Started-Desmos-Graphing-Calculator).

## Question-level inspection

There are **16 inspected references**, with exact exam/form, section/module, question number,
PDF page, strategy ID and a short original coaching note. No official question text or answer
key is reproduced. SAT references open the relevant explanation page and are labeled as containing
answers; ACT references open the booklet page.

| Form | Inspected references |
|---|---|
| SAT 4 | Reading and Writing module 1: Q1, Q4, Q5, Q6, Q9, Q11; Math module 1: Q1, Q2 |
| ACT 1 | English Q7, Q9; Math Q14, Q20; Reading Q25, Q27; Science Q1, Q10 |

This is an initial question-to-strategy crosswalk, **not a completed annotation of all 12 exams**.
It supports the review workflow and demonstrates how more annotations should be recorded. Form
hashes matter: if a publisher changes a PDF, recheck question numbers, pages and scoring before
reusing annotations. Reserve unseen forms for later transfer checks.

## Delivered behavior and remaining work

Study Lab now filters methods by exam/section and search text. Methods link related foundation
lessons/videos and the selected official examples. The same notes appear under related lessons,
so a weak/slow recommendation can lead to a more specific approach. Official resource cards match
tests with their paper guides and distinguish ACT online keys. External practice is clearly labeled
as **not automatically timed or imported into Little Monsters progress**.

The existing 21 videos remain available; this research does not create 47 new videos. New topics
without a foundation lesson are readable methods with source references. Remaining course work:

1. Educator review of each method and broader question-type coverage, including more advanced ACT
   number/quantity topics and realistic shared-passage practice.
2. Complete question-level annotations, with form/version checks and documented applicability.
3. New original worked examples, independent practice families and captioned videos for the added
   methods; field-test accuracy and timing on unfamiliar questions before claiming an improvement.
4. A deliberate companion/import workflow for official practice, retaining form/mode, exposure,
   provenance and the limits of self-reported timing. Do not infer publisher-site telemetry.

Do not treat strategy reading or an externally opened PDF as evidence of mastery. Progress still
requires saved responses to fresh in-app questions, and repeated template families remain a known
limitation. See [release verification and blockers](test-prep-release.md).
