/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Plot only recorded job coordinates, group shared city centroids, and show an approximate radius beside the same page of search results.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Fit returned geographic bounds without zoom animation so fixed-size job points are never presented as oversized transient circles.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep radius/center overlays from intercepting job waypoint clicks, support keyboard activation, and expose safe direct posting links.
 */
(function (global) {
  'use strict';
  let map, points, radius, center, latest, tilesFailed = false;
  const valid = job => typeof job.lat === 'number' && typeof job.lon === 'number'
    && Number.isFinite(job.lat) && Number.isFinite(job.lon) && Math.abs(job.lat) <= 90 && Math.abs(job.lon) <= 180;
  function label(text) { const node = document.createElement('span'); node.textContent = text; return node; }
  function notice(text) { const el = document.getElementById('mapNote'); if (el) el.textContent = text; }
  function ensure() {
    if (map) return true;
    if (!global.L) { notice('The map could not load. Job listings remain available below.'); return false; }
    map = global.L.map('jobMap', { scrollWheelZoom: false }).setView([38, -97], 4);
    global.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).on('tileerror', () => { tilesFailed = true; paintNotice(); }).addTo(map);
    points = global.L.featureGroup().addTo(map);
    global.L.control.scale({ imperial: true, metric: false }).addTo(map);
    return true;
  }
  function paintNotice() {
    if (!latest) return;
    const mapped = latest.jobs.filter(valid).length, missing = latest.jobs.length - mapped;
    notice(mapped + ' of ' + latest.jobs.length + ' jobs on this page mapped. Pins are approximate city/base centers, not exact worksites.'
      + (missing ? ' ' + missing + ' without coordinates remain in the list.' : '')
      + (latest.location ? ' Radius and distances are straight-line, not driving time; jobs without coordinates cannot be included in a radius search.' : '')
      + (tilesFailed ? ' Background map tiles are unavailable; the job list still works.' : ''));
  }
  function popup(jobs) {
    const box = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = (jobs[0].city || jobs[0].location || 'Approximate location') + ' · ' + jobs.length + ' job' + (jobs.length === 1 ? '' : 's');
    box.append(heading);
    for (const job of jobs) {
      const row = document.createElement('div'); row.className = 'map-job-link';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn';
      button.textContent = job.title + (job.company ? ' · ' + job.company : '');
      button.onclick = () => {
        const card = document.getElementById('job-' + job.id);
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.focus({ preventScroll: true }); }
      };
      row.append(button);
      try {
        const url = new URL(job.url);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
          const link = document.createElement('a'); link.className = 'btn primary';
          link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = 'View & apply'; row.append(link);
        }
      } catch (_) { /* A missing or invalid provider URL leaves the listing button available. */ }
      box.append(row);
    }
    return box;
  }
  function paint(data) {
    latest = { jobs: data.jobs || [], location: data.location || null };
    const panel = document.getElementById('mapPanel');
    if (!panel || panel.hidden || !ensure()) return;
    map.invalidateSize(); points.clearLayers();
    if (radius) { map.removeLayer(radius); radius = null; }
    if (center) { map.removeLayer(center); center = null; }
    const groups = new Map();
    for (const job of latest.jobs.filter(valid)) {
      const key = job.lat + ',' + job.lon;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(job);
    }
    for (const jobs of groups.values()) {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5';
      const marker = global.L.circleMarker([jobs[0].lat, jobs[0].lon], { radius: Math.min(22, 8 + Math.sqrt(jobs.length) * 2), color, weight: 2, fillOpacity: 0.65 })
        .bindPopup(popup(jobs), { maxWidth: 340, maxHeight: 280 })
        .bindTooltip(label(jobs.length + ' job' + (jobs.length === 1 ? '' : 's') + ' · ' + (jobs[0].city || jobs[0].location || 'Approximate location')))
        .addTo(points);
      const element = marker.getElement();
      if (element) {
        element.setAttribute('tabindex', '0'); element.setAttribute('role', 'button');
        element.setAttribute('aria-label', jobs.length + ' job' + (jobs.length === 1 ? '' : 's') + ' · '
          + (jobs[0].city || jobs[0].location || 'Approximate location'));
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); marker.openPopup(); }
        });
      }
    }
    const location = latest.location;
    if (location) {
      const position = [location.center.lat, location.center.lon];
      radius = global.L.circle(position, { radius: location.radius_miles * 1609.344, color: '#0f766e', weight: 2, fillOpacity: 0.06, interactive: false }).addTo(map);
      center = global.L.circleMarker(position, { radius: 5, color: '#0f766e', fillOpacity: 1, interactive: false }).bindTooltip(label('Search center: ' + location.label)).addTo(map);
      map.fitBounds(radius.getBounds(), { padding: [20, 20], maxZoom: 12, animate: false });
    } else if (groups.size) map.fitBounds(points.getBounds(), { padding: [30, 30], maxZoom: 11, animate: false });
    paintNotice();
  }
  global.CareerSearchMap = { paint, show() { if (latest) paint(latest); }, clear() {
    latest = { jobs: [], location: null }; if (points) points.clearLayers();
    if (radius) { map.removeLayer(radius); radius = null; }
    if (center) { map.removeLayer(center); center = null; }
    notice('Waiting for the current search results.');
  } };
}(window));
