/* trading/ui/view-reports.js — VIEW 'reports' (ADR-136 D1/D2): Performance + Trade journal per account.
 *
 * Classic script; depends on app.js globals (BOOK/MODE/DISP/BOOKS/SUB, esc(), bookLabel(), subTabs(),
 * acctContextBar()/wireAcctContextBar(), stale()). The account is chosen with the shared "Acting on"
 * bar, which re-renders THROUGH navigate() — so the render token bumps, the URL carries the account,
 * and DISP follows. (A silent in-place rewrite of BOOK let an in-flight response for the previous
 * account paint under the new one — the 2026-09-03 review finding this replaces.)
 * loadPerformance()/drawPerformance()/loadJournal()/renderTrade() are account-view globals defined in
 * view-account.js — called here, never redefined. Positions across accounts live on the Accounts page.
 */

/* ── view entry ──────────────────────────────────────────────── */
async function renderReportsView(token) {
  main.innerHTML = '<div class="panel"><h2>Reports</h2>' +
    '<div class="sub">Performance and the trade journal, per account. Positions across every account are on the Accounts page.</div></div>' +
    acctContextBar('reports below are for this account') +
    '<div id="viewTabs"></div>';
  if (stale(token)) return;
  wireAcctContextBar();
  subTabs('viewTabs', [['perf','Performance'],['journal','Trade journal']], SUB || 'perf', (k) => {
    if (k === 'perf') loadPerformance(); else loadJournal();
  });
}
