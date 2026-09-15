# Career presentation

## 1.21.0 Job Board and open search

The board and standalone search now expose each other directly through the existing
Career surface routes and admitted Cockpit tool bridge. The board emphasizes matches
and application progress; open search remains a browse view with no resume requirement.
Mobile pages show results before optional filter fields. Desktop submission tools are
expandable, while computer readiness stays visible. Existing workflow actions and
provider/ownership boundaries remain unchanged.

The initial board now paints a loading status. Its existing feed and resume-status
requests have a 30-second bound; errors are distinct from valid empty matches and offer
an explicit Retry with current filters. Failed initial reads do not trigger an automatic
duplicate request. Older results cannot overwrite a newer filter request.

The registered `job-workspace-browser` recipe uses actual package screens/shared styles
with synthetic loopback data. It covers navigation, mobile results and filters, exact
queries, provenance/detail links, no-resume browsing, cancelled bulk confirmation, held
loading/timeout, retry, HTTP errors and valid empty results. Browser/core prerequisites
remain explicit; this recipe does not become an executable Node suite.

Focused source acceptance passed 90/90 checks: 19 new Chromium behaviors, all 18 existing
palette cases and 53 Board/Search/Resume script contracts. Before checks reproduced the
missing search entry, mobile results below the filter form and blank initial loading area.
The extracted inline scripts and changed test/fixture files pass scoped lint, including
undefined/unreachable code and the 50-line function limit. No route or engine build changed.

Package installation and native acceptance completed on 2026-09-12 from source `3395b937`.
The [Career navigation release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/career-navigation-2026-09-12.md)
records 80 Board results, the 50-result Open jobs search and return, retained filters, exact
installed bytes and 53 passing installed Node checks with cleanup. No generated document,
job application or business write was performed. Legacy harness prerequisites and the
pending package security audit remain unchanged.

## 1.20.0 source checkpoint

The thirteen Career-owned HTML screens now share the portal's selected palette and a small,
token-based Career stylesheet. The older parent-color copying and fixed Review palette are
removed. Existing screens, routes, permissions, draft workflows and white document previews
are preserved. The code-less Intelligent Career group borrows those member screens; its
manifest remains 1.0.0.

The new registered Chromium proof uses actual HTML and shared core theme code with synthetic
read-only HTTP data. It covers saved/live colors, application-color opt-in, drafts and filters,
mobile bounds and primary-label contrast. The unchanged board, Search and Resume script
contracts provide 53 focused checks. The original Review page failed the new saved-palette
regression before the fix. Final focused acceptance passed 18/18 Chromium cases and 53/53
existing script checks. The actual installed catalog also executed the 53 script checks in
the sealed container runner, with verified cleanup and no missing registrations.

Historical installed acceptance completed with the corresponding core appearance change on
2026-09-12. The [workspace facelift release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/workspace-facelift-2026-09-12.md)
records source `1eecfe1b`, native Career palette changes and installed Lab run
`bd66ffe0-c64a-4b1d-848e-3a1509319671` passing 53 checks with cleanup. This proves the documented
appearance flow; it does not claim every Career workflow, provider operation or job application
was exercised. The package security audit remains pending.

## Remaining test-harness work

The current catalog accounts for all 50 earlier test entries and both new browser entries. Five
legacy groups explicitly require the original complete package, Python engine or legacy core
import layout. Making those harnesses portable to the sealed runner is separate work; their
registration must not turn unavailable dependencies into a pass. No engine or business source
was changed as part of this presentation release.
