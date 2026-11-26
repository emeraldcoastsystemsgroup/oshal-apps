/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: Stages 5-7 of Meeting Recap — chronological timeline assembly, text-only end-to-end summary/highlight structuring with verbatim timestamped quotes, and image+text PPTX outline adapter (zero charts).
 */
import { formatTimestamp } from './recap-media.mjs';

export const MAX_DECK_IMAGES = 10;
export const MAX_SECTION_SLIDES = 10;
const DECISION_RE = /\b(decided|agreed|approved|confirmed|resolved|finalized|decision|we will use|go with|greenlit)\b/i;
const ACTION_RE = /\b(action item|todo|follow up|will send|will prepare|will share|next step|assigned to|owner:|by monday|by tuesday|by wednesday|by thursday|by friday|by tomorrow)\b/i;

/** Stage 5: Chronologically merge transcript segments and cropped keyframes into timeline.md. */
export function assembleTimelineMarkdown(title, segments, keyframes) {
  const safeTitle = String(title || 'Meeting Recap').trim();
  const events = [];
  for (const seg of segments || []) {
    events.push({ kind: 'seg', ts: Number(seg.startTime || 0), end: Number(seg.endTime || seg.startTime || 0), text: seg.text, speaker: seg.speakerKey });
  }
  for (const kf of keyframes || []) {
    events.push({ kind: 'kf', ts: Number(kf.timestampSec || 0), kf });
  }
  events.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'kf' ? -1 : 1)));

  const lines = [
    `# ${safeTitle} — Timeline`,
    '',
    `> Chronological meeting record (${segments.length} transcript segments, ${keyframes.length} cropped screen captures).`,
    '',
  ];
  for (const ev of events) {
    if (ev.kind === 'kf') {
      const label = ev.kf.label || `Scene ${ev.kf.index} at ${formatTimestamp(ev.ts)}`;
      const file = ev.kf.file || `keyframe-${ev.kf.index}.png`;
      lines.push('', `### [${formatTimestamp(ev.ts)}] ${label}`, '', `![${label}](keyframes/${file})`, '');
    } else {
      const who = ev.speaker ? `**${ev.speaker}:** ` : '';
      lines.push(`- **[${formatTimestamp(ev.ts)}]** ${who}${ev.text}`);
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Build text-only prompt for Stage 6 — NEVER carries audio, video, or image binary bytes. */
export function buildSummaryPrompt({ title, durationSec, segments, keyframes }) {
  const kfList = (keyframes || []).map((k) => ({ id: k.id, timestamp: formatTimestamp(k.timestampSec), timestampSec: k.timestampSec, label: k.label || `Scene ${k.index}` }));
  const transcript = (segments || []).map((s) => `[${formatTimestamp(s.startTime)}] ${s.speakerKey ? `${s.speakerKey}: ` : ''}${s.text}`).join('\n');
  return [
    `You are summarizing a meeting titled "${String(title || 'Meeting Recap')}" (duration ${formatTimestamp(durationSec)}).`,
    'Produce ONLY valid JSON (no markdown fences) matching this exact schema:',
    '{"overview":"2-3 sentence summary","sections":[{"title":"...","startSec":0,"endSec":120,"bullets":["..."],"quotes":[{"timestampSec":45,"text":"exact verbatim quote"}],"keyframeIds":["kf-1"]}],"decisions":["..."],"actionItems":["..."]}',
    'Strict integrity rules:',
    `1. Cover the ENTIRE duration from 00:00 through ${formatTimestamp(durationSec)} in chronological sections — NEVER drop the tail.`,
    '2. Every quote MUST be verbatim from the transcript with its exact timestampSec.',
    '3. Every section MUST reference >= 1 keyframeId from the provided list when keyframes are present.',
    '4. Use ONLY facts present in the transcript; never invent metrics or names.',
    '',
    `Keyframes (metadata only): ${JSON.stringify(kfList)}`,
    '',
    'Full Transcript:',
    transcript,
  ].join('\n');
}

/** Find keyframes whose timestamps fall inside [startSec, endSec], or nearest keyframe fallback. */
function matchKeyframesForRange(keyframes, startSec, endSec) {
  if (!Array.isArray(keyframes) || !keyframes.length) return [];
  const inside = keyframes.filter((k) => k.timestampSec >= startSec - 0.5 && k.timestampSec <= endSec + 0.5);
  if (inside.length) return inside.slice(0, 3).map((k) => k.id);
  const mid = (startSec + endSec) / 2;
  let nearest = keyframes[0];
  let best = Math.abs(nearest.timestampSec - mid);
  for (const kf of keyframes) {
    const dist = Math.abs(kf.timestampSec - mid);
    if (dist < best) { best = dist; nearest = kf; }
  }
  return [nearest.id];
}

/** Partition full duration 0..durationSec into contiguous chronological buckets. */
function buildChronologicalBuckets(durationSec, segments) {
  const maxSegEnd = segments.reduce((m, s) => Math.max(m, Number(s.endTime || s.startTime || 0)), 0);
  const totalDur = Math.max(durationSec || 0, maxSegEnd, 1);
  const targetCount = totalDur <= 60 ? Math.min(Math.max(2, segments.length ? Math.min(3, segments.length) : 2), 3)
    : Math.min(6, Math.max(3, Math.ceil(totalDur / 300)));
  const span = totalDur / targetCount;
  const buckets = [];
  for (let i = 0; i < targetCount; i += 1) {
    const startSec = Number((i * span).toFixed(2));
    const endSec = i === targetCount - 1 ? Number(totalDur.toFixed(2)) : Number(((i + 1) * span).toFixed(2));
    const segs = segments.filter((s) => s.startTime >= startSec && (i === targetCount - 1 ? s.startTime <= endSec + 0.01 : s.startTime < endSec));
    buckets.push({ index: i + 1, startSec, endSec, segs });
  }
  return { totalDur, buckets };
}

/** Build section title from its leading spoken text or chronological range. */
function deriveSectionTitle(bucket) {
  const first = bucket.segs[0]?.text || '';
  const words = first.replace(/[^\w\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 7).join(' ');
  if (words.length >= 12) return `${words}${first.length > words.length ? '…' : ''}`;
  return `Segment ${bucket.index} (${formatTimestamp(bucket.startSec)} – ${formatTimestamp(bucket.endSec)})`;
}

/** Stage 6 deterministic fallback (`degrade: template`): end-to-end chronological coverage. */
export function deterministicSummarize({ title, durationSec, segments, keyframes }) {
  const segs = Array.isArray(segments) ? segments : [];
  const kfs = Array.isArray(keyframes) ? keyframes : [];
  const { totalDur, buckets } = buildChronologicalBuckets(durationSec, segs);
  const decisions = [];
  const actionItems = [];

  for (const seg of segs) {
    if (DECISION_RE.test(seg.text)) decisions.push(`[${formatTimestamp(seg.startTime)}] ${seg.text}`);
    if (ACTION_RE.test(seg.text)) actionItems.push(`[${formatTimestamp(seg.startTime)}] ${seg.text}`);
  }

  const sections = buckets.map((b) => {
    const bullets = b.segs.slice(0, 4).map((s) => s.text.slice(0, 220));
    if (!bullets.length) bullets.push(`Visual activity captured between ${formatTimestamp(b.startSec)} and ${formatTimestamp(b.endSec)}.`);
    const quotes = b.segs.slice(0, 2).map((s) => ({
      timestampSec: s.startTime,
      timestamp: formatTimestamp(s.startTime),
      text: s.text,
    }));
    return {
      title: deriveSectionTitle(b),
      startSec: b.startSec,
      endSec: b.endSec,
      bullets,
      quotes,
      keyframeIds: matchKeyframesForRange(kfs, b.startSec, b.endSec),
    };
  });

  const overview = `${String(title || 'Meeting Recap')} spans ${formatTimestamp(totalDur)} across ${sections.length} chronological sections, ${segs.length} transcript segments, and ${kfs.length} cropped visual captures.`;
  return {
    overview,
    durationSec: totalDur,
    sections,
    decisions: decisions.slice(0, 12),
    actionItems: actionItems.slice(0, 12),
    mode: 'deterministic',
  };
}

/** Normalize one Stage 6 section with bounded title, bullets, quotes, and valid keyframeIds. */
function normalizeSection(sec, idx, kfIds, kfs) {
  const startSec = Math.max(0, Number(sec.startSec ?? 0) || 0);
  const endSec = Math.max(startSec, Number(sec.endSec ?? startSec) || startSec);
  const validKfs = (Array.isArray(sec.keyframeIds) ? sec.keyframeIds : []).filter((id) => kfIds.has(id));
  const keyframeIds = validKfs.length ? validKfs : matchKeyframesForRange(kfs, startSec, endSec);
  const quotes = (Array.isArray(sec.quotes) ? sec.quotes : [])
    .filter((q) => q && typeof q.text === 'string' && q.text.trim())
    .map((q) => {
      const ts = Math.max(0, Number(q.timestampSec ?? startSec) || 0);
      return { timestampSec: ts, timestamp: formatTimestamp(ts), text: q.text.trim().slice(0, 320) };
    });
  const bullets = (Array.isArray(sec.bullets) ? sec.bullets : [])
    .map((b) => String(b || '').trim().slice(0, 240)).filter(Boolean);
  return {
    title: String(sec.title || `Section ${idx + 1}`).trim().slice(0, 140),
    startSec, endSec,
    bullets: bullets.length ? bullets : ['Section summary captured from meeting timeline.'],
    quotes, keyframeIds,
  };
}

/** Validate and repair coverage so no tail is dropped and every section names timestamps + >=1 keyframe. */
export function repairCoverage(notes, { title, durationSec, segments, keyframes }) {
  const segs = Array.isArray(segments) ? segments : [];
  const kfs = Array.isArray(keyframes) ? keyframes : [];
  const maxSegEnd = segs.reduce((m, s) => Math.max(m, Number(s.endTime || s.startTime || 0)), 0);
  const totalDur = Math.max(Number(durationSec || 0), maxSegEnd, 1);
  const kfIds = new Set(kfs.map((k) => k.id));
  const rawSections = Array.isArray(notes?.sections) ? notes.sections : [];
  if (!rawSections.length) return deterministicSummarize({ title, durationSec: totalDur, segments: segs, keyframes: kfs });

  const fixed = rawSections.slice(0, MAX_SECTION_SLIDES).map((s, i) => normalizeSection(s, i, kfIds, kfs))
    .sort((a, b) => a.startSec - b.startSec);
  const lastEnd = fixed.at(-1).endSec;
  if (totalDur - lastEnd > Math.max(5, totalDur * 0.1)) {
    const tailSegs = segs.filter((s) => s.startTime >= lastEnd);
    fixed.push({
      title: `Closing (${formatTimestamp(lastEnd)} – ${formatTimestamp(totalDur)})`,
      startSec: lastEnd, endSec: totalDur,
      bullets: tailSegs.slice(0, 4).map((s) => s.text.slice(0, 220)).concat(tailSegs.length ? [] : ['Closing segment covered to end of recording.']),
      quotes: tailSegs.slice(0, 1).map((s) => ({ timestampSec: s.startTime, timestamp: formatTimestamp(s.startTime), text: s.text })),
      keyframeIds: matchKeyframesForRange(kfs, lastEnd, totalDur),
    });
  }
  return {
    overview: String(notes?.overview || '').trim() || `Recap covering ${formatTimestamp(totalDur)} across ${fixed.length} sections.`,
    durationSec: totalDur, sections: fixed,
    decisions: (Array.isArray(notes?.decisions) ? notes.decisions : []).map((d) => String(d).trim()).filter(Boolean).slice(0, 15),
    actionItems: (Array.isArray(notes?.actionItems) ? notes.actionItems : []).map((a) => String(a).trim()).filter(Boolean).slice(0, 15),
    mode: notes?.mode || 'ai',
  };
}

/** Stage 6 entrypoint: runs accountable bot on text+keyframe metadata only, degrading deterministically. */
export async function summarizeRecap({ title, durationSec, segments, keyframes, botRunner = null, useAiSummary = false }) {
  if (useAiSummary && typeof botRunner === 'function') {
    const prompt = buildSummaryPrompt({ title, durationSec, segments, keyframes });
    try {
      const raw = await botRunner(prompt);
      const match = String(raw || '').match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return repairCoverage({ ...parsed, mode: 'ai' }, { title, durationSec, segments, keyframes });
      }
    } catch { /* degrade to template per manifest rating */ }
  }
  return deterministicSummarize({ title, durationSec, segments, keyframes });
}

/** Render structured Stage 6 notes into shareable summary.md with timestamps and cropped keyframes. */
export function renderSummaryMarkdown(title, notes, keyframes) {
  const byId = new Map((keyframes || []).map((k) => [k.id, k]));
  const lines = [
    `# ${String(title || 'Meeting Recap')} — Summary`,
    '',
    notes.overview,
    '',
    '## Chronological Sections',
    '',
  ];
  for (const sec of notes.sections || []) {
    lines.push(`### ${sec.title} (${formatTimestamp(sec.startSec)} – ${formatTimestamp(sec.endSec)})`, '');
    for (const kfId of sec.keyframeIds || []) {
      const kf = byId.get(kfId);
      if (kf) lines.push(`![${kf.label || `Scene at ${formatTimestamp(kf.timestampSec)}`}](keyframes/${kf.file})`, '');
    }
    for (const b of sec.bullets || []) lines.push(`- ${b}`);
    if (sec.quotes?.length) {
      lines.push('');
      for (const q of sec.quotes) {
        lines.push(`> "${q.text}" — [${q.timestamp || formatTimestamp(q.timestampSec)}]`);
      }
    }
    lines.push('');
  }
  lines.push('## Decisions', '');
  if (notes.decisions?.length) {
    for (const d of notes.decisions) lines.push(`- ${d}`);
  } else {
    lines.push('- No explicit decisions flagged in transcript.');
  }
  lines.push('', '## Action Items', '');
  if (notes.actionItems?.length) {
    for (const a of notes.actionItems) lines.push(`- [ ] ${a}`);
  } else {
    lines.push('- No explicit action items flagged in transcript.');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Guard bullet text so slide-content-parser NEVER mistakes a recap bullet for a chart or KPI syntax line. */
function sanitizeRecapBullet(text) {
  let clean = String(text || '').replace(/[\r\n]+/g, ' ').replace(/^#\s*/g, '').replace(/::/g, '—').trim();
  if (/^[^:]{1,40}:\s*[-+]?\$?\d/.test(clean)) clean = clean.replace(/:\s*/, ' — ');
  if (clean.startsWith('|') || clean.startsWith('>') || clean.startsWith('##')) clean = `Note — ${clean.replace(/^[|>#\s]+/, '')}`;
  return clean.slice(0, 220);
}

/** Build one image+text (or bullets-only) section slide with zero chart directives. */
function buildSectionSlide(sec, byId, keyframeDataUris, imgBudget) {
  const primaryKfId = (sec.keyframeIds || []).find((id) => keyframeDataUris.has(id));
  const kf = primaryKfId ? byId.get(primaryKfId) : null;
  const dataUri = primaryKfId && imgBudget.used < MAX_DECK_IMAGES ? keyframeDataUris.get(primaryKfId) : null;
  const body = [];
  if (dataUri) {
    imgBudget.used += 1;
    body.push('#layout: image-right', `#image: ${dataUri}`, `#caption: ${kf?.label || `Scene at ${formatTimestamp(kf?.timestampSec || sec.startSec)}`}`);
  } else {
    body.push('#layout: bullets');
  }
  for (const b of (sec.bullets || []).slice(0, 4)) body.push(sanitizeRecapBullet(b));
  if (sec.quotes?.[0]) {
    const q = sec.quotes[0];
    body.push(sanitizeRecapBullet(`Quote [${q.timestamp || formatTimestamp(q.timestampSec)}] "${q.text}"`));
  }
  return {
    title: `${sec.title.slice(0, 90)} (${formatTimestamp(sec.startSec)}–${formatTimestamp(sec.endSec)})`,
    content: body.join('\n'),
    notes: sec.quotes?.length ? `Verbatim quote [${sec.quotes[0].timestamp}]: ${sec.quotes[0].text}` : undefined,
  };
}

/**
 * Stage 7: Build structured outline for PresentationEngine.renderPptx.
 * Image + text layouts only — ZERO chart parts per meeting-recap-spec.md.
 */
export function buildRecapDeckOutline({ title, durationSec, notes, keyframes, keyframeDataUris = new Map(), cropMode = 'right-strip' }) {
  const safeTitle = String(title || 'Meeting Recap').trim().slice(0, 120);
  const byId = new Map((keyframes || []).map((k) => [k.id, k]));
  const subtitle = `Meeting Recap · ${formatTimestamp(durationSec || notes?.durationSec || 0)} · ${notes.sections.length} sections`;
  const agendaLines = ['#layout: bullets', ...notes.sections.map((s) => sanitizeRecapBullet(`${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} — ${s.title}`))];
  const imgBudget = { used: 0 };
  const sectionSlides = notes.sections.slice(0, MAX_SECTION_SLIDES).map((s) => buildSectionSlide(s, byId, keyframeDataUris, imgBudget));
  const decLines = [
    '#layout: bullets',
    ...(notes.decisions || []).slice(0, 5).map((d) => sanitizeRecapBullet(`Decision — ${d}`)),
    ...(notes.actionItems || []).slice(0, 5).map((a) => sanitizeRecapBullet(`Action — ${a}`)),
  ];
  if (decLines.length === 1) decLines.push('No formal decisions or follow-up actions were logged.');
  const appendix = {
    title: 'Appendix — Full Timeline Record',
    content: [
      '#layout: bullets',
      `Full chronological record is preserved in timeline.md (${keyframes.length} cropped screen captures).`,
      'Summary notes with timestamped verbatim quotes are preserved in summary.md.',
      `Privacy treatment applied before capture export — camera crop mode ${cropMode}.`,
      'Raw recording and uncropped media remain strictly inside the owner workspace.',
    ].join('\n'),
  };
  return {
    title: safeTitle, subtitle,
    sections: [{ title: 'Agenda', content: agendaLines.join('\n') }, ...sectionSlides, { title: 'Decisions & Action Items', content: decLines.join('\n') }, appendix],
  };
}
