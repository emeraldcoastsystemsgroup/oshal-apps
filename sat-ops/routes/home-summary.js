"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.satHomeSummary = satHomeSummary;
function satHomeSummary(fleet, catalog, now = Date.now()) {
    const metrics = [{ id: 'sim-nodes', label: 'Simulation nodes', value: String(fleet.length) },
        { id: 'sim-online', label: 'Recent sim heartbeats', value: String(fleet.filter(s => s.online).length) },
        { id: 'sim-offline', label: 'Stale sim heartbeats', value: String(fleet.filter(s => !s.online).length) },
        { id: 'tle-records', label: 'Loaded TLE records', value: String(catalog.length) }];
    const items = fleet.slice().sort((a, b) => Number(a.online) - Number(b.online)).slice(0, 3).map(s => {
        const title = String(s.satId).slice(0, 100), detail = 'SIMULATION / ' + s.engine + ' / ' + (s.online ? 'recent heartbeat' : 'stale heartbeat');
        const notes = detail + '. Last received: ' + (s.lastSeenMs == null ? 'never' : new Date(s.lastSeenMs).toISOString()) + '. Shared process-local fleet, not a live spacecraft. Review the simulation before preparing an analysis.';
        return { text: title, detail, tone: s.online ? 'neutral' : 'warn', fix: 'sat-ops', actions: [{ integration: 'prepare-document', context: { title, notes } }] };
    });
    items.push({ text: 'Shared simulation registry; resets with the API process. TLE records are loaded inputs, not orbit-quality certification.', tone: 'neutral', fix: 'sat-ops' });
    return { metrics, tiles: metrics, items, partial: false, asOf: new Date(now).toISOString() };
}
//# sourceMappingURL=home-summary.js.map