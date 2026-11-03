# SAT and ACT Study Lab

Status: implementation specification, 2026-10-28. Owner: Little Monsters study-prep lane.

## Product outcome

A student opens **SAT & ACT**, takes a short diagnostic, and gets a manageable next step:
learn one concept, watch its worked example, practice it, then demonstrate improvement on
fresh questions. Accuracy and pace are separate. A correct but slow answer needs fluency;
a fast wrong answer needs understanding. Watching a video alone never establishes mastery.

## Verified formats

| Exam | Section | Questions | Standard working time |
|---|---|---:|---:|
| Digital SAT | Reading and Writing | 27 + 27 | 32 + 32 minutes |
| Digital SAT | Math | 22 + 22 | 35 + 35 minutes |
| Enhanced ACT | English | 50 | 35 minutes |
| Enhanced ACT | Math | 45 | 50 minutes |
| Enhanced ACT | Reading | 36 | 40 minutes |
| Enhanced ACT, optional | Science | 40 | 40 minutes |
| Enhanced ACT, optional | Writing | 1 essay | 40 minutes |

SAT has a ten-minute break before Math and adaptively selects the second module in each
section. ACT's composite uses English, Math and Reading. School-day science requirements
can differ. Practice time multipliers are student settings, not approval for exam accommodations.

Sources checked 2026-10-28:
- [College Board test structure](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure)
- [ACT enhanced format FAQ](https://www.act.org/content/act/en/products-and-services/the-act-educator/the-act-test/enhancements-k12/faqs.html)
- [ACT section guide](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html)
- [College Board calculator policy](https://satsuite.collegeboard.org/in-school-assessments/calculator-policy)
- [Official SAT practice](https://satsuite.collegeboard.org/practice)
- [Official ACT preparation](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation.html)

## Learning experience

1. Select SAT or ACT, a test date and a daily study budget. ACT science is selectable.
2. A diagnostic samples every supported skill; it is explicitly too small for a score prediction.
3. The focus queue explains *why*: insufficient evidence, accuracy below 80%, correct answers
   taking over 125% of the practice target, or a spaced review due. Limit today's focus to three skills.
4. Each lesson has prerequisites/concept, a worked example, a faster method where valid,
   a failure case, a common mistake and a short captioned video. Students can read instead.
5. A focused practice set favors unseen items and mixes weak/slow skills with spaced review.
6. Each question records answer, active time, confidence, flag, and later a mistake category
   and lesson learned. Review shows the explanation and links to the relevant lesson.
7. Progress compares first and recent fresh-question samples for the *same exam and skill*.
   Show sample counts; repeated question IDs do not raise mastery or inflate improvement.
   Variants share template families, so transfer to unfamiliar problems still needs external validation.
8. Save session state on answer changes, navigation and periodic checkpoints. Resume after reload.
   Timed working periods continue while the tab is hidden or closed; active question time pauses
   when hidden. Practice does not claim proctor-grade timing.

## Implementation contract

- Use issuer-bound Little Monsters identity. Never accept a student ID from the browser.
- Persist profiles, lesson completion and sessions in package SQL storage with tenant/owner
  predicates and native row policies. Student data is private even from other school learners.
- Snapshot versioned original questions into sessions. Grade on the server. An active session
  response exposes no answer keys or explanations. Do not scrape or redistribute official banks.
- Persist server deadlines. A late submission uses the last saved answers; retries cannot
  change a completed score. Use revision checks so two tabs cannot overwrite each other.
- Save individual question telemetry as bounded cumulative milliseconds. Reject negative,
  nonfinite, excessive or decreasing times. Total active time cannot exceed the module's elapsed
  wall time. Confidence and reflection are self-reported, not inferred psychological traits.
- Keep math, language, reading and science skills explicit. Never promise that the shortest
  answer is always right, that answer positions predict correctness, or that guessing guarantees points.
- A full-length **pacing simulation** uses the current counts/timers but original template-based
  items and fixed SAT modules. Label it clearly; it is not a calibrated official mock, does not
  reproduce SAT adaptation, and reports raw practice accuracy rather than invented 400–1600/1–36 scores.
- Recommendations use up to the latest 200 completed sessions. Surface the window and avoid
  implying an unlimited longitudinal research dataset.
- Captions/transcripts are available for every initial video. No autoplay, endless feed or penalty
  for missed days. Keyboard access, phone layouts, hide-clock control and readable contrast required.

## Initial release and expansion

The first release must deliver the whole saved diagnostic → lesson/video → practice → review →
progress loop, plus fixed full-length pacing simulations, across an initial original skill library.
A finite library is a foundation, not a claim to cover every possible SAT/ACT trick.

Expansion backlog, in order:
- Educator review and larger independently authored question families; reading passage sets,
  SAT student-produced responses, mixed difficulty, calibrated adaptive routing and validation
  against official practice results. Never market simulation accuracy as a predicted score.
- ACT essay lessons, timed writing, rubric-guided revision and separately validated feedback.
- More algebra/functions/trigonometry/geometry/rhetoric/science techniques, each with source,
  applicability, counterexample, reviewed item bank and captioned video before publication.
- Goal-based multiweek planning, explicit test-date reminders, opt-in guardian/teacher summaries,
  and retention/deletion controls integrated with school policy.
- Instructor review of the monster-taught lessons; track video revision and
  never confuse completion with mastery. Refresh exam formats before each school-year release.

## Acceptance evidence

Verify original answer keys and unique options; enough distinct IDs for every simulation section;
no answers leaked before completion; two-student/two-school isolation; race and retry behavior;
expired sessions, hidden tabs, reload and failed saves; correct-but-slow recommendations; repeated
items excluded from mastery; video/transcript coverage; phone layout and keyboard operation.
Run package tests and the repository's required store gate. Deployment must apply the new schema,
row policies and authorization catalog together; a pushed branch alone is not a live rollout.
