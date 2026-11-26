/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.4 (CREATE-TOOL-MOTION-STUDIO-09): render the on-screen Revision History sheet backed by the same revision list and non-destructive restore route used by concierge tools.
 */

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTimestamp(iso) {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso || '');
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso || '');
  }
}

function buildRevisionRow({ row, currentRevision, shownRevision, canEdit, onRestore }) {
  const item = make('li', 'motion-history-row');
  item.dataset.revision = String(row.revision);
  const meta = make('div', 'motion-history-meta');
  const head = make('div', 'motion-history-head');
  head.append(make('strong', 'motion-history-num', 'Revision ' + row.revision));
  if (row.revision === currentRevision) {
    head.append(make('span', 'motion-history-badge', 'Current'));
  } else if (row.revision === shownRevision) {
    head.append(make('span', 'motion-history-badge', 'Active content'));
  }
  const summary = make('span', 'motion-history-summary', `${row.title} · ${formatTimestamp(row.createdAt)}`);
  meta.append(head, summary);
  const restore = make('button', 'motion-history-restore', 'Restore');
  restore.type = 'button';
  restore.dataset.restoreRevision = String(row.revision);
  restore.setAttribute('aria-label', 'Restore revision ' + row.revision);
  restore.disabled = !canEdit || row.revision === currentRevision;
  restore.onclick = () => onRestore(row.revision);
  item.append(meta, restore);
  return item;
}

/** Populate a modal Revision History sheet with live saved revisions and non-destructive Restore controls. */
export async function populateHistorySheet({ container, adapter, onDone }) {
  container.replaceChildren(make('p', 'motion-history-status', 'Loading revision history…'));
  if (!adapter.state.project) {
    container.replaceChildren(make('p', 'motion-history-status', 'Open a saved composition to browse its revision history.'));
    return;
  }
  const data = await adapter.listRevisions();
  const revisions = Array.isArray(data?.revisions) ? data.revisions : [];
  if (!revisions.length) {
    container.replaceChildren(make('p', 'motion-history-status', 'No saved revisions yet.'));
    return;
  }
  const intro = make('p', 'motion-history-status', 'Restoring appends a new revision with that version’s content; earlier revisions stay preserved.');
  const list = make('ol', 'motion-history-list');
  list.id = 'historyList';
  const currentRevision = adapter.state.project.revision;
  const shown = adapter.shownRevision();
  const canEdit = adapter.canEdit();
  for (const row of revisions) {
    list.append(buildRevisionRow({
      row,
      currentRevision,
      shownRevision: shown,
      canEdit,
      onRestore: async target => {
        await onDone();
        await adapter.restoreRevision(target);
      },
    }));
  }
  container.replaceChildren(intro, list);
}
