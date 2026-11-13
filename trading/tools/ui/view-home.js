/* trading/ui/view-home.js — the first screen of Intelligent Trades (VIEW 'accounts').
 *
 * One card per account, drawn by account-story.js from GET /paper/today: is it running or parked and in what, what did it do
 * today, why did the value move, and one next step. The read is saved records only (no broker call, no write), so this screen
 * paints without waiting for the broker. Nothing here can change an order, a strategy, an approval or a job: every button and
 * link only opens the existing screen where that control already lives. The former landing (balances, holdings, the
 * cross-account positions) is one closed section at the bottom and is read from the broker only when the person opens it.
 *
 * Classic script: app.js provides main/$/api/esc/spinner/stale/navigate/openAccount/render and VIEW/SUB/RENDER_TOKEN/ACCOUNTS;
 * native-paper.js provides paperKernel; view-accounts.js provides accountsBodySkeleton/rosterPanelHtml/fillAccountsLanding/
 * wireDiscovered/paintDiscovered. When the read cannot be made, renderHomeView answers false and view-accounts.js draws the
 * former landing with one line saying why.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0: the screen no longer waits for the roster read (app.js starts it at boot). A later render (Refresh, Discover accounts, coming back from another screen) reads the roster again in the background, as the former landing did on every render, so a newly connected account appears; when that read fails the screen says so in one line and keeps the time of the last roster it did read.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0: the Accounts screen answers three questions in plain words from saved records (Roger, 2026-11-12: "its not clear if the trading is really happening or if we are just parked"). First-screen controls go from nine to three: each card's one button, its one link, and the closed broker section. The watchlist stays on Research, and the connected-login list stays in Settings.
 */

/* What the last paint used: the read, the job rows, the cards, the roster's time and state, and which reveal is pending. */
const HOME = { today: null, jobs: null, cards: [], accountsAt: null, rosterSeen: false, rosterFailed: false, reveal: 0, failed: null };
const HOME_JOBS = { watcher: { app: 'intelligent-trades', name: 'portfolio-watcher' }, paperJob: { app: 'intelligent-trades', name: 'paper-autopilot' } };

/**
 * @description The page's own job rows from the kernel's list (a read): the watcher and the paper job, or nulls when the
 *   list cannot be read. A card then rests on recorded checks alone.
 * @returns {Promise<{watcher:object|null, paperJob:object|null}>} The two rows.
 */
async function homeJobs() {
  try {
    const answer = await paperKernel('/api/v1/agent/schedules');
    const rows = answer.schedules || answer.jobs || [];
    const row = (job) => rows.find((r) => r.app === job.app && r.name === job.name) || null;
    return { watcher: row(HOME_JOBS.watcher), paperJob: row(HOME_JOBS.paperJob) };
  } catch {
    return { watcher: null, paperJob: null };   // the job list is unavailable: no job state is claimed
  }
}

/**
 * @description The skeleton of the first screen: headline, cards, one closed section for the broker read, and the hidden
 *   connected-login list that Settings shows.
 * @returns {string} HTML for #main.
 */
function homeSkeleton() {
  return '<div id="homeTop"></div><div id="homeCards" data-ds-work></div><p class="foot" id="homeFoot"></p>' +
    '<details class="panel story-broker" id="homeBroker"><summary>Balances and holdings, read from your broker now</summary><div id="homeBrokerBody"></div></details>' +
    rosterPanelHtml();
}

/**
 * @description A connected account the broker lists that has no saved record yet: it gets a card too, with the value the
 *   page read when it opened.
 * @param {object} account - One ACCOUNTS entry.
 * @returns {object} A fact in the shape account-story.js reads.
 */
function homeBareFact(account) {
  const identity = { accountId: account.accountId, connectionKey: account.connectionKey };
  return { kind: 'connected', ...identity, label: 'Account ' + (account.accountMasked || ''), strategy: null, status: { account: { ...identity, strategyId: null }, watch: null },
    monitor: null, plan: null, holdings: null, today: null, value: null,
    live: { equity: account.equity, at: HOME.accountsAt ? new Date(HOME.accountsAt).toISOString() : null } };
}

/**
 * @description Draw the headline and every card from the last read. Cards for saved records come first, then connected
 *   accounts with no saved record, then paper accounts.
 * @returns {void}
 */
function homePaint() {
  const top = $('homeTop'), host = $('homeCards'), today = HOME.today;
  if (!top || !host || !today) return;
  const options = { now: Date.now(), latestSession: today.latestCompletedSession, marketOpen: today.marketOpen, watcher: HOME.jobs.watcher, paperJob: HOME.jobs.paperJob };
  const known = new Set(today.connected.map((f) => f.connectionKey + '|' + f.accountId));
  const bare = ACCOUNTS.filter((a) => a.nativeReadOnly && a.accountId && !known.has(a.connectionKey + '|' + a.accountId)).map(homeBareFact);
  HOME.cards = [...today.connected, ...bare].map((f) => AccountStory.connected(f, options)).concat(today.paper.map((f) => AccountStory.paper(f, options)));
  top.innerHTML = AccountStory.headlineHtml(AccountStory.headline(HOME.cards, options));
  host.innerHTML = HOME.cards.map((card) => AccountStory.cardHtml(card, options)).join('');
  const notes = [];
  if (today.archivedPaper) notes.push(today.archivedPaper + (today.archivedPaper === 1 ? ' archived paper account is' : ' archived paper accounts are') + ' under Reports, Local paper accounts.');
  if (today.cut && (today.cut.connected || today.cut.paper)) notes.push('More accounts exist than this screen lists.');
  if (HOME.rosterFailed) notes.push('The list of accounts at your broker could not be read just now, so an account with no saved record may be missing here.');
  $('homeFoot').textContent = notes.join(' ');
}

/**
 * @description Once the page has opened the screen a card points to, open the section it names and bring it into view.
 *   It watches #main until the section is drawn, for at most twenty seconds, and stops when another reveal starts.
 * @param {string} selector - The section, or a control inside it.
 * @param {boolean} press - Press the control instead of opening a section (the paper account's Positions & history).
 * @returns {void}
 */
function homeReveal(selector, press) {
  const mine = HOME.reveal += 1;
  const done = () => { watcher.disconnect(); clearTimeout(timer); };
  const look = () => {
    if (mine !== HOME.reveal) { done(); return; }
    const found = main.querySelector(selector);
    if (!found) return;
    done();
    const section = found.closest('details');
    if (section) section.open = true;
    if (press) found.click(); else found.scrollIntoView({ block: 'start' });
  };
  const watcher = new MutationObserver(look);
  const timer = setTimeout(done, 20000);
  watcher.observe(main, { childList: true, subtree: true });
  look();
}

/**
 * @description Open one of this account's existing screens through its bookmarkable address, so the same code that serves a
 *   bookmark resolves the account from the person's current roster.
 * @param {object} card - The card.
 * @param {string} view - 'strategies' (Manage strategy) or 'accounts' (Account details).
 * @param {string} sub - 'accounts' or 'details'.
 * @returns {void}
 */
function homeOpenAddress(card, view, sub) {
  const p = new URLSearchParams(location.search);
  p.set('view', view); p.set('sub', sub); p.set('account', card.accountId); p.set('connection', card.connectionKey); p.delete('tab');
  history.replaceState(null, '', location.pathname + '?' + p.toString());
  VIEW = view; SUB = sub; RENDER_TOKEN += 1;
  render();
}

/**
 * @description Follow a card's button or link. Every destination is an existing screen; none is an action.
 * @param {object} card - The card.
 * @param {string} go - evidence | settings | schedule | refresh | details | open | journal | paper.
 * @returns {void}
 */
function homeGo(card, go) {
  if (go === 'open') { openAccount('paper', 'paper'); return; }
  if (go === 'journal') { navigate('account', { book: 'paper', kind: 'paper', sub: 'journal' }); return; }
  if (go === 'paper') { navigate('reports', { sub: 'paper' }); homeReveal('[data-lp-book="' + CSS.escape(card.ref) + '"] [data-lp="open"]', true); return; }
  if (go === 'details') { homeOpenAddress(card, 'accounts', 'details'); return; }
  homeOpenAddress(card, 'strategies', 'accounts');
  homeReveal(go === 'settings' ? '#nativeStrategySettings' : go === 'schedule' ? '.native-schedule-bar' : go === 'refresh' ? '[data-native-management="refresh"]' : '#nativeStatusEvidence', false);
}

/**
 * @description Wire the cards (one delegated listener; the surface carries no handler attribute) and the closed section,
 *   which reads the broker each time the person opens it.
 * @returns {void}
 */
function wireHome() {
  const host = $('homeCards'), broker = $('homeBroker');
  host.onclick = (e) => {
    const control = e.target.closest('[data-story-next],[data-story-link]');
    const article = control && control.closest('[data-story]');
    if (!article || !host.contains(article)) return;
    e.preventDefault();
    const card = HOME.cards.find((c) => c.key === article.getAttribute('data-story'));
    if (card) homeGo(card, control.getAttribute('data-story-next') || control.getAttribute('data-story-link'));
  };
  broker.addEventListener('toggle', () => {
    if (!broker.open) return;
    $('homeBrokerBody').innerHTML = accountsBodySkeleton(true);
    fillAccountsLanding(RENDER_TOKEN, true);
  });
  wireDiscovered();
}

/**
 * @description When the broker's account list arrives, fill the connected-login list Settings shows and add a card for any
 *   connected account that has no saved record yet. The page's first render uses the roster read boot() started; a later
 *   render reads the roster again, so Refresh and Discover accounts are reflected. A failed read keeps the last roster and
 *   its time, and the screen says the list could not be read.
 * @param {number} token - RENDER_TOKEN at dispatch time.
 * @returns {Promise<void>}
 */
async function homeAwaitAccounts(token) {
  if (HOME.rosterSeen) BOOKS_READY = loadBooks().catch(() => null);   // null: the roster could not be read; said below
  HOME.rosterSeen = true;
  const roster = await BOOKS_READY;
  if (stale(token) || !$('homeCards')) return;
  HOME.rosterFailed = !roster;
  if (roster) HOME.accountsAt = Date.now();
  paintDiscovered();
  if (HOME.rosterFailed || ACCOUNTS.some((a) => a.nativeReadOnly)) homePaint();
}

/**
 * @description VIEW 'accounts', first screen. Reads the saved records, then the job list, and paints. A bookmark that names
 *   an account, a page without the story module, or a read that fails is left to the former landing (answers false).
 * @param {number} token - RENDER_TOKEN at dispatch time.
 * @returns {Promise<boolean>} true when this screen took the render.
 */
async function renderHomeView(token) {
  HOME.failed = null;
  if (typeof AccountStory === 'undefined' || new URLSearchParams(location.search).get('account')) return false;
  let today;
  try { today = await api('/paper/today'); }
  catch (e) { HOME.failed = e.message || 'the read failed'; return false; }
  if (stale(token)) return true;
  if (!today || today.ok !== true || !Array.isArray(today.connected) || !Array.isArray(today.paper)) { HOME.failed = 'the answer could not be read'; return false; }
  const jobs = await homeJobs();
  if (stale(token)) return true;
  HOME.today = today; HOME.jobs = jobs;
  main.innerHTML = homeSkeleton();
  wireHome();
  homePaint();
  homeAwaitAccounts(token);
  return true;
}
