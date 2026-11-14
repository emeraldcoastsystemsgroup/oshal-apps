# Source reader recovery

Career 1.60.13 repairs three shared source paths.

- Oracle's reader uses the public candidate site's requisition listing, retries transient HTTP errors, deduplicates overlapping pages and returns the rows already received when a later request fails. It reads up to 200 jobs per request, up to 3 passes on an ordinary search and one pass per partition on a large board, with 3,000 requests shared across the entire read. A board over the 10,000-result search window is read through its own public facets and state suggestions. The existing geographic state names identify suggestions; their counts never prove whole-board coverage. It proves completion only when the number of distinct valid requisitions equals the board's stated count. Job links use the Oracle candidate site, including its full /hcmUI/CandidateExperience/ path.
- Workday saves completed facet searches only when the shared-corpus ingest writer supplies JOBHUNTER_SOURCE_REQUESTS. The files live under that writer's existing private scratch data directory. A restart rereads each search's first page and reuses a checkpoint only when its count still matches and it is less than four hours old. Changed, malformed and expired progress is reread. Completion removes the progress file. The existing request, depth and whole-board coverage limits remain in force.
- The anonymous page reader allows AWS WAF's exact multipart browser proof only after a navigation reports a challenge. It retains the public-address check and accepts only solution_metadata and solution_data, with no files and at most 64 KiB. It waits up to twenty seconds within the existing source deadline. An unresolved CAPTCHA or sign-in remains a named failed read. Avature listings keep their filters, request 100 results per page and follow their mixed-case next-page control; talent-community forms are excluded from jobs.

No account or external solving service is needed for this anonymous AWS browser check.
Marquee's existing FlareSolverr helper was used to compare the CBRE response during diagnosis;
Career uses its own isolated anonymous browser and does not depend on Marquee or its service.

A source that moved between providers still needs its saved board changed. In Companies, Resolve
queues the verified new board for the native ingest writer; the page's queued acknowledgement is
not a completed pull. Dollar General's careers homepage links to its replacement Oracle board.
Resolve verifies up to three actual Oracle jobs before changing a source. This preview closes nothing and never marks the source finished: even a resumed pull reopens the old checkpoint and enumerates the replacement board. A short or failed read cannot close the jobs saved from its earlier Jibe board.

The provider classes remain exported by jobhunter.ats; their implementations are split into
bounded provider modules. The maintenance brief locates each class through its actual module.

Run tests/career-source-readers.test.mjs, tests/career-browser-check.test.mjs and
tests/browser/career-source-browser-proof.mjs, using the package's pinned Python and browser
toolchain. The Oracle regression crosses a real local HTTP connection into real temporary SQLite.
The browser regression uses Chromium and disposable listing pages, including a delayed challenge,
Avature pagination, cookie notices, refused applicant forms and unresolved human checks.
