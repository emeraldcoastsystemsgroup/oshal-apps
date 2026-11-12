/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Cloud Accounts screen's state, as a pure model the page and its test share (UX audit 2026-11-05, cloud-accounts, D): from GET /api/cloud/home-summary it decides whether Google Cloud is connected, which tiles to show and the one primary action (Connect Google Cloud, or Ask the cloud bot), and builds the kernel's connect address for the gcp connector.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.1 (T73; Roger, 2026-11-12: "which projects have a real billing account"): projectsView turns GET /api/cloud/gcp/projects into the screen's Projects card: each project with its billing in words and a tone, tiles for projects and real billing, and Reconnect Google Cloud when Google would not show billing to this connection (a connection made before the billing permission was asked for), which the reconnect count never caught.
 */
(function (root) {
  'use strict';
  /** The question the primary "Ask the cloud bot" sends to the application's concierge (cloud-ops-bot). */
  var FIRST_QUESTION = 'What can you help me do with my Google Cloud?';

  /**
   * @description The value of one home-summary metric as a whole number.
   * @param {object} summary The GET /api/cloud/home-summary answer.
   * @param {string} id The metric id.
   * @returns {number} The count, 0 when absent or unreadable.
   */
  function count(summary, id) {
    var metric = (summary && Array.isArray(summary.metrics) ? summary.metrics : []).find(function (m) { return m && m.id === id; });
    var value = Number(metric && metric.value);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  /**
   * @description What the screen shows for one home-summary read.
   * @param {object|null} summary The answer body, or null when the read failed.
   * @returns {{state: string, accounts: number, reconnect: number, tiles: Array<object>, primary: string}} The view.
   */
  function view(summary) {
    if (!summary || !Array.isArray(summary.metrics)) {
      return { state: 'error', accounts: 0, reconnect: 0, tiles: [], primary: 'retry' };
    }
    var accounts = count(summary, 'gcp-accounts'), reconnect = count(summary, 'gcp-reconnect');
    if (!accounts) return { state: 'not-connected', accounts: 0, reconnect: 0, tiles: [], primary: 'connect' };
    var tiles = [{ label: accounts === 1 ? 'Google Cloud account' : 'Google Cloud accounts', value: String(accounts) }];
    if (reconnect) tiles.push({ label: 'Need reconnecting', value: String(reconnect), tone: 'warn' });
    return { state: 'connected', accounts: accounts, reconnect: reconnect, tiles: tiles, primary: 'ask' };
  }

  /**
   * @description The kernel's browser entry point that authorizes the person's own Google Cloud (gcp connector).
   * @param {string} back Same-origin path the provider returns the window to.
   * @returns {string} Same-origin URL.
   */
  function connectUrl(back) {
    return '/api/connect/gcp/start?return=' + encodeURIComponent(back || '/apps/cloud/ui/index.html?connected=gcp');
  }

  /** The tone a project's billing status is shown in. */
  var TONES = { 'real billing': 'ok', 'linked to a closed billing account': 'warn', 'no billing': 'muted' };

  /**
   * @description What the Projects card shows for one GET /api/cloud/gcp/projects answer.
   * @param {number} status The HTTP status (0 when the read failed). @param {object|null} body The answer body.
   * @returns {{state: string, rows: Array<object>, tiles: Array<object>, reconnect: boolean, connect: boolean, note: string}} The card.
   */
  function projectsView(status, body) {
    var none = { rows: [], tiles: [], reconnect: false, connect: false };
    if (status === 200 && body && Array.isArray(body.projects)) {
      var hidden = body.billingVisible === false;
      var rows = body.projects.map(function (p) {
        var status = String(p.status || '');
        return { name: String(p.name || p.projectId), id: String(p.projectId || ''), status: status,
          label: hidden ? 'billing hidden' : status + (p.billingAccountName ? ' · ' + String(p.billingAccountName) : ''),
          tone: hidden ? 'muted' : (TONES[status] || 'muted') };
      });
      var real = rows.filter(function (r) { return r.status === 'real billing'; }).length;
      var tiles = [{ label: rows.length === 1 ? 'Project' : 'Projects', value: String(rows.length) }];
      if (!hidden) tiles.push({ label: 'With real billing', value: String(real) });
      return { state: rows.length ? 'listed' : 'empty', rows: rows, tiles: tiles, reconnect: hidden, connect: false,
        note: hidden ? 'Google did not show billing to this connection. Press Reconnect Google Cloud and allow billing access to see which projects are paid for.'
          : (rows.length ? '' : 'Your Google account has no Google Cloud projects.') };
    }
    var code = body && body.error, words = body && typeof body.message === 'string' ? body.message : '';
    if (status === 409 && code === 'connect') return Object.assign({}, none, { state: 'refused', connect: true, note: words });
    if (status === 409 || status === 403) return Object.assign({}, none, { state: 'refused', reconnect: true, note: words || 'Google Cloud refused the saved connection.' });
    return Object.assign({}, none, { state: 'error', note: words || 'Your projects could not be read just now.' });
  }

  root.CloudHome = { view: view, connectUrl: connectUrl, projectsView: projectsView, FIRST_QUESTION: FIRST_QUESTION };
})(typeof window !== 'undefined' ? window : this);
