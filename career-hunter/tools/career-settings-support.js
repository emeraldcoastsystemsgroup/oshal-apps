/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Show actual refresh health, owner-scoped imported LinkedIn leads and official community sources without automatic external pulls.
 */
(function () {
  'use strict';
  const byId = id => document.getElementById(id), API = '/api/career-hunter';
  let installationManaged = false, sourceManagementKnown = false;
  byId('targetAdd').disabled = true;
  const say = (id, text) => { byId(id).textContent = text; };
  async function json(url, options) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(value.message || value.error || 'Could not complete this request.');
    return value;
  }
  async function refreshHealth() {
    say('refreshHealth', 'Checking refresh status…');
    try {
      const data = await json(API + '/run/refresh');
      sourceManagementKnown = true;
      installationManaged = data.refreshMode === 'installation-managed';
      byId('targetAdd').disabled = installationManaged;
      byId('runPull').disabled = data.manualRefreshAvailable === false;
      if (data.refreshMode === 'installation-managed') {
        say('targetOut', 'This installation manages shared-source enrollment. The regional directory below links to available hiring sites.');
        say('refreshHealth', 'This installation manages shared-source refreshes. Review Sources & pull health for individual employer outcomes.'
          + ' Latest recorded corpus activity: ' + (data.corpusFreshAt || 'not recorded') + '.');
        return;
      }
      say('refreshHealth', (data.running ? 'A refresh is running. ' : 'No refresh is running. ')
        + 'Last completed refresh: ' + (data.lastCompletedAt || 'not recorded') + '. '
        + 'Corpus freshness marker: ' + (data.corpusFreshAt || 'not recorded') + '.');
    } catch (error) { say('refreshHealth', 'Could not check refresh status: ' + error.message); }
  }
  function link(url, title) {
    const anchor = document.createElement('a'); anchor.textContent = title;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw Error('Invalid source link.');
    anchor.href = parsed.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor;
  }
  async function loadJobs() {
    try {
      const data = await json(API + '/artifacts');
      if (data.importedJobsUnavailable) throw Error('Your saved leads could not be read.');
      const rows = data.importedJobs || [], list = byId('linkedinJobsList'); list.replaceChildren();
      for (const job of rows) {
        const row = document.createElement('p'); row.className = 'hint';
        row.append(link(job.url, job.title + ' · ' + job.company), document.createTextNode(' · imported lead; location and pay not verified'));
        list.append(row);
      }
      return rows.length;
    } catch (error) { say('linkedinJobsStatus', 'Could not load imported leads: ' + error.message); return null; }
  }
  byId('linkedinJobsImport').onclick = async () => {
    const file = byId('linkedinJobsFile').files?.[0];
    if (!file) return say('linkedinJobsStatus', 'Choose the Saved Jobs CSV from your LinkedIn archive.');
    const button = byId('linkedinJobsImport'); button.disabled = true;
    say('linkedinJobsStatus', 'Importing your saved leads…');
    try {
      const body = new FormData(); body.append('kind', 'linkedin-jobs'); body.append('files', file);
      const result = await json(API + '/artifacts/upload', { method: 'POST', body });
      if (!result.ok) throw Error('Import was not accepted.');
      await loadJobs();
      say('linkedinJobsStatus', result.new + ' new, ' + result.updated + ' updated; ' + result.total + ' saved leads in your private list.');
      byId('linkedinJobsFile').value = '';
    } catch (error) { say('linkedinJobsStatus', 'Could not import: ' + error.message); }
    finally { button.disabled = false; }
  };
  async function loadSources() {
    try {
      await refreshReady;
      const data = await json(API + '/static/career-local-sources.json');
      let configured = null;
      if (installationManaged) {
        try { configured = (await json(API + '/companies-admin/list')).companies || []; }
        catch (_) { /* The administrator source list remains protected; everyone can use official hiring links. */ }
      }
      const list = byId('communitySourceList'); list.replaceChildren();
      if (data.region) { const region = document.createElement('p'); region.textContent = data.region; list.append(region); }
      for (const source of data.sources || []) {
        const row = document.createElement('p'); row.append(link(source.url, source.name));
        const included = configured?.some(company => company.careers_url === source.feedUrl);
        const status = source.status === 'available-feed'
          ? included ? 'Included in this installation' : installationManaged ? 'Supported feed · enrollment managed by this installation' : 'Supported feed available to add'
          : 'Official vacancies · external only';
        row.append(document.createTextNode(' · ' + source.category + ' · ' + status));
        if (source.feedUrl && sourceManagementKnown && !installationManaged) {
          const button = document.createElement('button'); button.className = 'btn'; button.type = 'button'; button.textContent = 'Add supported feed';
          button.onclick = async () => {
            button.disabled = true; say('communitySourceStatus', 'Checking ' + source.name + '…');
            try {
              const result = await json(API + '/settings/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: source.feedUrl }) });
              if (!result.ok) throw Error(result.reason || 'This feed was not accepted.');
              say('communitySourceStatus', source.name + ' accepted. Your target list shows whether its first pull completes.');
              if (typeof refreshTargets === 'function') refreshTargets();
            } catch (error) { say('communitySourceStatus', 'Could not add ' + source.name + ': ' + error.message); }
            finally { button.disabled = false; }
          }; row.append(document.createTextNode(' '), button);
        }
        list.append(row);
      }
    } catch (error) { say('communitySourceStatus', 'Could not load the source directory: ' + error.message); }
  }
  byId('checkRefreshHealth').onclick = refreshHealth;
  const refreshReady = refreshHealth();
  loadSources(); loadJobs().then(count => { if (count !== null) say('linkedinJobsStatus', count + ' imported saved leads. Reimporting the same jobs does not duplicate them.'); });
}());
