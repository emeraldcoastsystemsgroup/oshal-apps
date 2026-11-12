/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Show actual refresh health, owner-scoped imported LinkedIn leads and official community sources without automatic external pulls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Explain installation-managed refreshes without treating application-local cron memory as the native pull status.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Import pasted saved-job CSV through the same owner-scoped validation as file uploads.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Allow durable private imports to settle and show the installation's actual pull timer when the operator may read it.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Prefer safe native corpus observations for every admitted Career reader, keeping current work, prior publication and source coverage distinct.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Drive automation controls from verified installation mode and keep legacy toggles unavailable when capabilities cannot be read.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 3: Pull jobs now is out of the page whenever GET /run/refresh says manualRefreshAvailable is false, for everyone. On the native kernel the installation refreshes the shared job sources and POST /run/pull refuses every caller, so an administrator was shown a button that could only fail (it was greyed until the first press ended, then live again). Where a pull can be started from this page the administrator's button is unchanged. Guard: tests/career-settings-administrator.test.mjs.
 */
(function () {
  'use strict';
  const byId = id => document.getElementById(id), API = '/api/career-hunter';
  let installationManaged = false, sourceManagementKnown = false;
  byId('targetAdd').disabled = true;
  const say = (id, text) => { byId(id).textContent = text; };
  async function json(url, options, timeoutMs = 15000) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(value.message || value.error || 'Could not complete this request.');
    return value;
  }
  /* native-refresh:start */
  function nativeRefreshText(timer) {
    if (!timer) return 'Shared job pulls are managed by this installation. Live progress could not be checked. New jobs become visible when a pull completes. AI fit scoring runs separately.';
    const when = value => {
      const date = new Date(value);
      return value != null && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'not recorded';
    };
    const observed=timer.observationAvailable===true;
    const completed = (timer.history || []).find(run => run.outcome === 'completed' && run.publishedAt != null);
    let text = observed&&timer.status==='disabled'
      ? 'Nightly shared-job pulls are disabled on this installation.'
      : typeof timer.running!=='boolean'||observed&&timer.status==='unavailable'
        ? 'Live pull progress could not be checked.'
      : timer.running
      ? 'Pull running since ' + when(timer.lastStartedAt) + '. It is fetching jobs into a private copy; refreshed jobs appear when the pull completes.'
      : timer.lastOk === false
        ? 'The latest pull failed. The previously published jobs remain available.'
        : 'No pull is running.';
    const sources=observed?timer.lastPublication?.sources:null;
    const coverage=sources&&Number.isSafeInteger(sources.confirmed)&&Number.isSafeInteger(sources.unconfirmed)
      ? ' That publication reported '+sources.confirmed+' confirmed and '+sources.unconfirmed+' unconfirmed sources.' : '';
    return text + ' Last successful publication: ' + when(observed?timer.lastPublishedAt:completed?.publishedAt)
      + '.'+coverage+' AI fit scoring runs separately.';
  }
  /* native-refresh:end */
  async function refreshHealth() {
    say('refreshHealth', 'Checking refresh status…');
    try {
      const data = await json(API + '/run/refresh');
      if(!['installation-managed','application-managed'].includes(data.refreshMode)&&!(data.refreshMode==null&&typeof data.running==='boolean'))
        throw Error('Installation capabilities are unavailable.');
      sourceManagementKnown = true;
      installationManaged = data.refreshMode === 'installation-managed';
      if(typeof setCareerOperationMode==='function')setCareerOperationMode(installationManaged);
      byId('targetAdd').disabled = installationManaged;
      // A pull this page cannot start is not offered: its route refuses everyone, an administrator included, where the installation refreshes the shared sources.
      byId('runPull').disabled = byId('runPull').hidden = data.manualRefreshAvailable === false;
      if (data.refreshMode === 'installation-managed') {
        say('targetOut', 'This installation manages shared-source enrollment. The regional directory below links to available hiring sites.');
        if(data.observationAvailable===true){say('refreshHealth',nativeRefreshText(data));return;}
        let timer = null;
        try {
          const jobs = await json('/api/admin/jobs');
          timer = (jobs.timers || []).find(row => row.id === 'career-corpus-ingest') || null;
        } catch (_) { /* Native timer observations remain restricted to the operator. */ }
        say('refreshHealth', nativeRefreshText(timer));
        return;
      }
      say('refreshHealth', (data.running ? 'A refresh is running. ' : 'No refresh is running. ')
        + 'Last completed refresh: ' + (data.lastCompletedAt || 'not recorded') + '. '
        + 'Corpus freshness marker: ' + (data.corpusFreshAt || 'not recorded') + '.');
    } catch (error) {
      sourceManagementKnown=false;
      byId('targetAdd').disabled=true;
      byId('runPull').disabled=true;
      if(typeof setCareerOperationMode==='function')setCareerOperationMode(null);
      say('refreshHealth', 'Could not check refresh status: ' + error.message);
    }
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
  /* saved-jobs-file:start */
  function savedJobsFile(file, csv) {
    const text = String(csv || '').trim();
    if (file && text) throw Error('Choose a CSV file or paste CSV, using one source at a time.');
    if (!file && !text) throw Error('Choose a Saved Jobs CSV file or paste its contents.');
    const source = file || new File([text], 'linkedin-saved-jobs.csv', { type: 'text/csv' });
    if (source.size > 2 * 1024 * 1024) throw Error('Saved Jobs CSV exceeds 2 MiB.');
    return source;
  }
  /* saved-jobs-file:end */
  byId('linkedinJobsImport').onclick = async () => {
    let file;
    try { file = savedJobsFile(byId('linkedinJobsFile').files?.[0], byId('linkedinJobsCsv').value); }
    catch (error) { return say('linkedinJobsStatus', error.message); }
    const button = byId('linkedinJobsImport'); button.disabled = true;
    say('linkedinJobsStatus', 'Importing your saved leads…');
    try {
      const body = new FormData(); body.append('kind', 'linkedin-jobs'); body.append('files', file);
      const result = await json(API + '/artifacts/upload', { method: 'POST', body }, 60000);
      if (!result.ok) throw Error('Import was not accepted.');
      await loadJobs();
      say('linkedinJobsStatus', result.new + ' new, ' + result.updated + ' updated; ' + result.total + ' saved leads in your private list.');
      byId('linkedinJobsFile').value = '';
      byId('linkedinJobsCsv').value = '';
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
