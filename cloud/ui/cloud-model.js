/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Cloud Accounts screen's state, as a pure model the page and its test share (UX audit 2026-11-05, cloud-accounts, D): from GET /api/cloud/home-summary it decides whether Google Cloud is connected, which tiles to show and the one primary action (Connect Google Cloud, or Ask the cloud bot), and builds the kernel's connect address for the gcp connector.
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

  root.CloudHome = { view: view, connectUrl: connectUrl, FIRST_QUESTION: FIRST_QUESTION };
})(typeof window !== 'undefined' ? window : this);
