/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Build sanitized read-only campaign replay recaps and export them as Markdown, self-contained HTML, and canonical JSON.
 */

'use strict';

const EXPORT_FORMATS = Object.freeze({
  md: { ext: 'md', contentType: 'text/markdown; charset=utf-8' },
  html: { ext: 'html', contentType: 'text/html; charset=utf-8' },
  json: { ext: 'json', contentType: 'application/json; charset=utf-8' },
});

/** @description Escape untrusted text for safe insertion into HTML text and attributes. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** @description Allow only safe relative /api/ or http(s) URLs in exported recaps. */
function safeExportUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u001f\u007f\s<>"]/.test(raw)) return '';
  if (raw.startsWith('/api/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch (_error) {
    return '';
  }
}

/** @description Produce a safe lowercase attachment filename slug from a campaign name. */
function safeFilenameSlug(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'campaign';
}

/** @description Resolve an authored scene title from the adventure catalog when available. */
function sceneTitleFor(adventure, sceneId) {
  const scenes = adventure && Array.isArray(adventure.scenes) ? adventure.scenes : [];
  const found = scenes.find((scene) => scene && scene.id === sceneId);
  return (found && found.title) || String(sceneId || 'Unknown scene');
}

/** @description Strip private and hidden data from a board token for export summaries. */
function publicTokenSummary(token) {
  const hp = Number(token.hp) || 0;
  const maxHp = Number(token.maxHp) || 0;
  const status = token.dead ? 'dead' : token.fled ? 'fled' : hp <= 0 ? 'down' : 'living';
  return {
    id: String(token.id || ''),
    name: String(token.name || token.id || 'Token'),
    kind: String(token.kind || 'token'),
    x: Number.isFinite(Number(token.x)) ? Number(token.x) : null,
    y: Number.isFinite(Number(token.y)) ? Number(token.y) : null,
    hp,
    maxHp,
    ac: Number.isFinite(Number(token.ac)) ? Number(token.ac) : null,
    status,
  };
}

/** @description Summarize one sanitized board frame without exposing hidden tokens. */
function boardSummaryFor(board, adventure) {
  if (!board || typeof board !== 'object' || !Array.isArray(board.tokens)) return null;
  const tokens = board.tokens.filter((token) => token && !token.hidden).map(publicTokenSummary);
  const livingPcs = tokens.filter((token) => token.kind === 'pc' && token.status === 'living').length;
  const livingEnemies = tokens.filter((token) => token.kind === 'monster' && token.status === 'living').length;
  const sceneId = String(board.sceneId || '');
  return {
    sceneId,
    sceneTitle: sceneTitleFor(adventure, sceneId),
    mode: String(board.mode || 'unknown'),
    round: Number(board.round) || 0,
    livingPcs,
    livingEnemies,
    tokens,
  };
}

/** @description Project persisted dice groups into flat public roll records. */
function publicRollsFor(payload) {
  const rolls = payload && Array.isArray(payload.rolls) ? payload.rolls : [];
  return rolls.map((roll) => ({
    actorName: String(roll.actorName || 'Roller'),
    actionName: String(roll.actionName || roll.kind || 'roll'),
    targetName: roll.targetName ? String(roll.targetName) : null,
    kind: String(roll.kind || 'roll'),
    dice: String(roll.dice || ''),
    faces: Array.isArray(roll.faces) ? roll.faces.map((face) => Number(face) || 0) : [],
    bonus: Number(roll.bonus) || 0,
    total: Number(roll.total) || 0,
    outcome: String(roll.outcome || ''),
  }));
}

/** @description Sanitize a cutaway link so unsafe schemes never enter an export. */
function publicCutawayFor(cutaway) {
  if (!cutaway || typeof cutaway !== 'object') return null;
  const url = safeExportUrl(cutaway.url);
  if (!url) return null;
  return {
    url,
    title: String(cutaway.title || 'Scene illustration').slice(0, 140),
    caption: String(cutaway.caption || '').slice(0, 320),
    kind: String(cutaway.kind || 'cutaway'),
    key: String(cutaway.key || '').slice(0, 120),
    archiveSeq: Number.isFinite(Number(cutaway.archiveSeq)) ? Number(cutaway.archiveSeq) : null,
    createdAt: cutaway.createdAt || null,
  };
}

/** @description Build a readable frame title matching the playback viewer. */
function frameTitleFor(frame) {
  if (frame.type === 'snapshot' || frame.type === 'current' || frame.type === 'revision') {
    return String(frame.label || 'Saved board');
  }
  return `#${Number(frame.seq) || 0} ${String(frame.kind || 'story').replaceAll('-', ' ')}`;
}

/** @description Assemble a public party roster from campaign sheets and the final board. */
function buildPartyRoster(sheets, finalBoard) {
  const bySlug = new Map();
  const boardPcs = (finalBoard && Array.isArray(finalBoard.tokens) ? finalBoard.tokens : [])
    .filter((token) => token.kind === 'pc');
  for (const [slug, raw] of Object.entries(sheets || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const token = boardPcs.find((entry) => entry.id === slug || entry.name === raw.name);
    bySlug.set(slug, {
      slug,
      name: String(raw.name || (token && token.name) || slug),
      race: String(raw.race || ''),
      className: String(raw.class || ''),
      level: Number(raw.level) || 1,
      hp: token ? token.hp : Number(raw.maxHp) || 0,
      maxHp: Number(raw.maxHp) || (token ? token.maxHp : 0),
      ac: Number(raw.ac) || (token && token.ac) || null,
      status: token ? token.status : 'living',
    });
  }
  for (const token of boardPcs) {
    if (bySlug.has(token.id)) continue;
    bySlug.set(token.id, {
      slug: token.id, name: token.name, race: '', className: '', level: 1,
      hp: token.hp, maxHp: token.maxHp, ac: token.ac, status: token.status,
    });
  }
  return Array.from(bySlug.values());
}

/** @description Extract memorable roll and milestone highlights from timeline entries. */
function buildHighlights(timeline) {
  const highlights = [];
  for (const entry of timeline) {
    if (entry.kind === 'milestone' || entry.kind === 'discovery' || entry.kind === 'level-up') {
      if (entry.content) highlights.push({ type: entry.kind, text: entry.content, createdAt: entry.createdAt });
    }
    for (const roll of entry.rolls) {
      if (/crit|fumble|kill|defeat/i.test(roll.outcome) || roll.faces.includes(20) || roll.faces.includes(1)) {
        highlights.push({ type: 'roll', text: formatRollLine(roll), createdAt: entry.createdAt });
      }
    }
  }
  return highlights.slice(0, 24);
}

/** @description Format one dice roll into a concise single-line summary. */
function formatRollLine(roll) {
  const faces = roll.faces.length ? ` [${roll.faces.join(', ')}]` : '';
  const bonus = roll.bonus ? ` ${roll.bonus > 0 ? '+' : '-'} ${Math.abs(roll.bonus)}` : '';
  const target = roll.targetName ? ` vs ${roll.targetName}` : '';
  const outcome = roll.outcome ? ` — ${roll.outcome}` : '';
  return `${roll.actorName}: ${roll.actionName}${target} (${roll.dice}${faces}${bonus} = ${roll.total}${outcome})`;
}

/** @description Project one playback frame into a sanitized recap timeline entry. */
function recapTimelineEntry(frame, adventure) {
  const cutaway = publicCutawayFor(frame.cutaway);
  return {
    id: String(frame.id || ''),
    type: String(frame.type || 'archive'),
    seq: Number.isFinite(Number(frame.seq)) ? Number(frame.seq) : null,
    archiveSeq: Number.isFinite(Number(frame.archiveSeq)) ? Number(frame.archiveSeq) : null,
    kind: frame.kind ? String(frame.kind) : null,
    title: frameTitleFor(frame),
    content: frame.kind === 'cutaway' ? (cutaway ? cutaway.caption : '') : String(frame.content || ''),
    createdAt: frame.createdAt || null,
    fidelity: frame.fidelity === 'exact-board' ? 'exact-board' : 'archive-only',
    fidelityNote: String(frame.fidelityNote || ''),
    branch: frame.branch ? String(frame.branch) : null,
    rolls: publicRollsFor(frame.payload),
    cutaway,
    boardSummary: boardSummaryFor(frame.board, adventure),
  };
}

/** @description Collect unique chapter titles visited across exact-board frames. */
function chaptersVisited(timeline) {
  const seen = new Set();
  const chapters = [];
  for (const entry of timeline) {
    const title = entry.boardSummary && entry.boardSummary.sceneTitle;
    if (title && !seen.has(title)) { seen.add(title); chapters.push(title); }
  }
  return chapters;
}

/** @description Build a structured, sanitized, read-only campaign recap from playback data. */
function buildReplayRecap(playbackData, opts = {}) {
  const data = playbackData && typeof playbackData === 'object' ? playbackData : {};
  const campaign = data.campaign && typeof data.campaign === 'object' ? data.campaign : {};
  const adventure = opts.adventure || null;
  const rawFrames = Array.isArray(data.frames) ? data.frames : [];
  const timeline = rawFrames.map((frame) => recapTimelineEntry(frame, adventure));
  const cutaways = [];
  const seenUrls = new Set();
  for (const entry of timeline) {
    if (entry.cutaway && !seenUrls.has(entry.cutaway.url)) {
      seenUrls.add(entry.cutaway.url);
      cutaways.push(entry.cutaway);
    }
  }
  const exactBoardFrames = timeline.filter((entry) => entry.fidelity === 'exact-board').length;
  const archiveOnlyFrames = timeline.filter((entry) => entry.fidelity !== 'exact-board').length;
  const rollCount = timeline.reduce((sum, entry) => sum + entry.rolls.length, 0);
  const finalBoard = [...timeline].reverse().map((entry) => entry.boardSummary).find(Boolean) || null;
  return {
    schemaVersion: 1,
    readOnly: true,
    exportedAt: opts.exportedAt || new Date().toISOString(),
    campaign: {
      id: String(campaign.campaign_id || ''),
      name: String(campaign.name || 'Untitled Campaign'),
      adventureId: String(campaign.adventure_id || ''),
      adventureTitle: String((adventure && adventure.title) || campaign.adventure_id || 'Adventure'),
      status: String(campaign.status || 'active'),
      mode: data.mode ? String(data.mode) : null,
      ended: Boolean(data.ended),
      rev: Number(data.rev) || 0,
    },
    chapters: chaptersVisited(timeline),
    stats: {
      totalFrames: timeline.length,
      exactBoardFrames,
      archiveOnlyFrames,
      snapshotFrames: timeline.filter((entry) => entry.type === 'snapshot').length,
      revisionFrames: timeline.filter((entry) => entry.type === 'revision').length,
      cutawayCount: cutaways.length,
      rollCount,
    },
    party: buildPartyRoster(opts.sheets, finalBoard),
    cutaways,
    highlights: buildHighlights(timeline),
    timeline,
    finalBoard,
  };
}

/** @description Render one timeline entry as Markdown lines. */
function markdownEntryLines(entry) {
  const badge = entry.fidelity === 'exact-board' ? 'EXACT BOARD' : 'LOG ONLY';
  const when = entry.createdAt ? ` · ${entry.createdAt}` : '';
  const lines = [`### ${entry.title} \`[${badge}]\`${when}`];
  if (entry.content) lines.push('', entry.content);
  if (entry.rolls.length) {
    lines.push('');
    entry.rolls.forEach((roll) => lines.push(`- Roll: ${formatRollLine(roll)}`));
  }
  if (entry.cutaway) {
    lines.push('', `![${entry.cutaway.title}](${entry.cutaway.url})`);
    if (entry.cutaway.caption) lines.push(`*${entry.cutaway.caption}*`);
  }
  if (entry.boardSummary) {
    const b = entry.boardSummary;
    lines.push('', `> Board: **${b.sceneTitle}** (${b.mode}, round ${b.round}) — ${b.livingPcs} living PCs, ${b.livingEnemies} living enemies`);
  }
  lines.push('');
  return lines;
}

/** @description Render a sanitized recap as human-readable GitHub-flavored Markdown. */
function renderReplayMarkdown(recap) {
  const c = recap.campaign, s = recap.stats;
  const lines = [
    `# ${c.name} — Campaign Recap`,
    '',
    `- **Adventure:** ${c.adventureTitle}`,
    `- **Status:** ${c.ended ? 'Ended / Archived' : c.status}${c.mode ? ` (${c.mode})` : ''}`,
    `- **Chapters:** ${recap.chapters.length ? recap.chapters.join(' → ') : 'Not recorded'}`,
    `- **Coverage:** ${s.totalFrames} frames · ${s.exactBoardFrames} exact board · ${s.archiveOnlyFrames} log-only · ${s.cutawayCount} cutaways · ${s.rollCount} dice rolls`,
    `- **Exported:** ${recap.exportedAt} (read-only)`,
    '',
  ];
  if (recap.party.length) {
    lines.push('## Party', '', '| Hero | Lineage & Class | Level | HP | AC | Status |', '| --- | --- | ---: | ---: | ---: | --- |');
    for (const hero of recap.party) {
      const role = [hero.race, hero.className].filter(Boolean).join(' ') || 'Adventurer';
      lines.push(`| ${hero.name} | ${role} | ${hero.level} | ${hero.hp}/${hero.maxHp} | ${hero.ac == null ? '—' : hero.ac} | ${hero.status} |`);
    }
    lines.push('');
  }
  if (recap.highlights.length) {
    lines.push('## Highlights & Key Rolls', '');
    recap.highlights.forEach((item) => lines.push(`- **[${item.type}]** ${item.text}`));
    lines.push('');
  }
  lines.push('## Chronological Chronicle', '');
  recap.timeline.forEach((entry) => lines.push(...markdownEntryLines(entry)));
  lines.push('## Board Fidelity', '', s.archiveOnlyFrames > 0
    ? `${s.exactBoardFrames} of ${s.totalFrames} frames carry an exact persisted board revision; ${s.archiveOnlyFrames} legacy log-only frames omit token positions rather than reconstructing them.`
    : `All ${s.exactBoardFrames} frames carry exact persisted board revisions.`, '');
  return lines.join('\n');
}

/** @description Inline stylesheet for self-contained printable HTML exports. */
function htmlStyles() {
  return [
    ':root{--bg:#12100e;--panel:#1c1815;--line:#3a3128;--ink:#f4ece1;--muted:#b7a999;--amber:#e0a44c;--good:#64c27b}',
    '*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,sans-serif}',
    'main{max-width:920px;margin:0 auto;display:grid;gap:20px}header,section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}',
    'h1,h2,h3{margin:0 0 8px;color:var(--amber)}h1{font-size:26px}h2{font-size:18px}h3{font-size:15px;color:var(--ink)}',
    '.meta,.badges{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:13px}.badge{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px}',
    '.badge.exact{border-color:var(--good);color:var(--good)}.badge.gap{border-color:var(--amber);color:var(--amber)}',
    'table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}',
    '.entry{border-top:1px solid var(--line);padding:12px 0}.entry:first-of-type{border-top:0}',
    '.rolls{margin:8px 0;padding-left:18px;color:var(--amber);font-size:13px}.board-note{color:var(--muted);font-size:13px;margin:6px 0 0}',
    'figure{margin:10px 0;max-width:480px}figure img{max-width:100%;border-radius:10px;border:1px solid var(--line);display:block}figcaption{font-size:12px;color:var(--muted);margin-top:4px}',
    '@media print{body{background:#fff;color:#111}header,section{background:#fff;border-color:#ccc}h1,h2{color:#333}}',
  ].join('');
}

/** @description Render one timeline entry as escaped, script-free HTML. */
function htmlEntryMarkup(entry) {
  const badgeClass = entry.fidelity === 'exact-board' ? 'exact' : 'gap';
  const badgeText = entry.fidelity === 'exact-board' ? 'Exact Board' : 'Log Only';
  const copy = entry.content ? `<p>${escapeHtml(entry.content)}</p>` : '';
  const rolls = entry.rolls.length
    ? `<ul class="rolls">${entry.rolls.map((roll) => `<li>${escapeHtml(formatRollLine(roll))}</li>`).join('')}</ul>`
    : '';
  const safeUrl = entry.cutaway ? safeExportUrl(entry.cutaway.url) : '';
  const cutaway = safeUrl
    ? `<figure><a href="${escapeHtml(safeUrl)}"><img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(entry.cutaway.title)}" loading="lazy" /></a><figcaption>${escapeHtml(entry.cutaway.caption || entry.cutaway.title)}</figcaption></figure>`
    : '';
  const board = entry.boardSummary
    ? `<p class="board-note">Board: ${escapeHtml(entry.boardSummary.sceneTitle)} (${escapeHtml(entry.boardSummary.mode)}, round ${entry.boardSummary.round}) — ${entry.boardSummary.livingPcs} living PCs, ${entry.boardSummary.livingEnemies} living enemies</p>`
    : '';
  return `<article class="entry"><div class="badges"><span class="badge ${badgeClass}">${badgeText}</span><span>${escapeHtml(entry.createdAt || '')}</span></div><h3>${escapeHtml(entry.title)}</h3>${copy}${rolls}${cutaway}${board}</article>`;
}

/** @description Render the party roster section as escaped HTML. */
function htmlPartySection(party) {
  if (!party.length) return '';
  const rows = party.map((hero) => {
    const role = [hero.race, hero.className].filter(Boolean).join(' ') || 'Adventurer';
    return `<tr><td>${escapeHtml(hero.name)}</td><td>${escapeHtml(role)}</td><td>${hero.level}</td><td>${hero.hp}/${hero.maxHp}</td><td>${hero.ac == null ? '—' : hero.ac}</td><td>${escapeHtml(hero.status)}</td></tr>`;
  }).join('');
  return `<section><h2>Party</h2><table><thead><tr><th>Hero</th><th>Lineage &amp; Class</th><th>Level</th><th>HP</th><th>AC</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

/** @description Render a sanitized recap as a single-file, script-free HTML document. */
function renderReplayHtml(recap) {
  const c = recap.campaign, s = recap.stats;
  const highlights = recap.highlights.length
    ? `<section><h2>Highlights &amp; Key Rolls</h2><ul>${recap.highlights.map((item) => `<li><strong>[${escapeHtml(item.type)}]</strong> ${escapeHtml(item.text)}</li>`).join('')}</ul></section>`
    : '';
  const entries = recap.timeline.map(htmlEntryMarkup).join('');
  const fidelityCopy = s.archiveOnlyFrames > 0
    ? `${s.exactBoardFrames} of ${s.totalFrames} frames carry an exact persisted board revision; ${s.archiveOnlyFrames} log-only frames omit token positions rather than reconstructing them.`
    : `All ${s.exactBoardFrames} frames carry exact persisted board revisions.`;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    `<title>${escapeHtml(c.name)} — Campaign Recap</title>`,
    `<style>${htmlStyles()}</style></head><body><main>`,
    `<header><h1>${escapeHtml(c.name)} — Campaign Recap</h1><div class="meta"><span>Adventure: ${escapeHtml(c.adventureTitle)}</span><span>Status: ${escapeHtml(c.ended ? 'Ended' : c.status)}</span><span>Exported: ${escapeHtml(recap.exportedAt)}</span></div>`,
    `<div class="badges"><span class="badge">${s.totalFrames} frames</span><span class="badge exact">${s.exactBoardFrames} exact boards</span><span class="badge gap">${s.archiveOnlyFrames} log-only</span><span class="badge">${s.cutawayCount} cutaways</span><span class="badge">${s.rollCount} rolls</span></div></header>`,
    htmlPartySection(recap.party),
    highlights,
    `<section><h2>Chronological Chronicle</h2>${entries || '<p>No persisted story beats were recorded.</p>'}</section>`,
    `<section><h2>Board Fidelity</h2><p>${escapeHtml(fidelityCopy)}</p></section>`,
    '</main></body></html>',
  ].join('\n');
}

/** @description Render a sanitized recap as canonical read-only JSON. */
function renderReplayJson(recap) {
  return JSON.stringify(recap, null, 2);
}

/** @description Format a validated replay export document with attachment metadata. */
function exportReplayDocument(playbackData, rawFormat, opts = {}) {
  const format = rawFormat === undefined || rawFormat === null || rawFormat === ''
    ? 'md'
    : String(rawFormat).trim().toLowerCase();
  const spec = EXPORT_FORMATS[format];
  if (!spec) {
    return { ok: false, code: 'INVALID_FORMAT', error: 'Export format must be md, html, or json.' };
  }
  const recap = buildReplayRecap(playbackData, opts);
  const body = format === 'html'
    ? renderReplayHtml(recap)
    : format === 'json'
      ? renderReplayJson(recap)
      : renderReplayMarkdown(recap);
  const slug = safeFilenameSlug(recap.campaign.name);
  return {
    ok: true,
    format,
    contentType: spec.contentType,
    filename: `${slug}-recap.${spec.ext}`,
    body,
    recap,
  };
}

module.exports = {
  buildReplayRecap,
  exportReplayDocument,
  renderReplayHtml,
  renderReplayJson,
  renderReplayMarkdown,
  _test: { escapeHtml, safeExportUrl, safeFilenameSlug },
};
