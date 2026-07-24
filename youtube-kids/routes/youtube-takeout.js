"use strict";
/**
 * YouTube Takeout parser — turns a Google Takeout `watch-history.json` export into a
 * compact, prompt-sized aggregate (channel frequencies, monthly trend, a recent-titles
 * sample). This is the CHEAP, deterministic half of the Kid Lens app (ADR-036): the
 * controller parses + aggregates the (potentially huge) raw history here so the bot
 * only ever reasons over a few KB of distilled signal — never the full row dump.
 *
 * Takeout row shape (YouTube + YouTube Music history, JSON format):
 *   { header, title: "Watched <video title>", titleUrl,
 *     subtitles: [{ name: <channel>, url }], time: <ISO8601> }
 * Ads and removed/private videos arrive without `subtitles` (no channel) — those are
 * counted toward the total but skipped for channel attribution.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 23:05:27 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — parse Takeout watch-history.json into a compact aggregate (top channels w/ sample titles, monthly trend, recent-titles sample) for the Kid Lens analyzer bot.
 *
 * @module youtube-takeout
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTakeoutWatchHistory = parseTakeoutWatchHistory;
const TOP_CHANNELS = 30;
const SAMPLES_PER_CHANNEL = 4;
const RECENT_TITLES = 50;
const TREND_MONTHS = 8;
const TREND_CHANNELS_PER_MONTH = 5;
/**
 * @description Coerces the raw upload (JSON string or already-parsed value) into the
 * Takeout entry array, tolerating a stray BOM / wrapper object.
 * @param raw - The uploaded file contents (string) or a pre-parsed array.
 * @returns The array of raw Takeout entries (empty if unparseable).
 */
function coerceEntries(raw) {
    let value = raw;
    if (typeof raw === 'string') {
        const cleaned = raw.replace(/^﻿/, '').trim();
        try {
            value = JSON.parse(cleaned);
        }
        catch {
            return [];
        }
    }
    if (Array.isArray(value))
        return value;
    // Some exports wrap the list — accept the first array-valued property.
    if (value && typeof value === 'object') {
        const arr = Object.values(value).find(Array.isArray);
        if (Array.isArray(arr))
            return arr;
    }
    return [];
}
/**
 * @description Normalizes one raw Takeout entry into a watch row, or null if it is not a
 * watch event (e.g. a survey/search row). Strips the localized "Watched " title prefix.
 * @param entry - One element of the Takeout array.
 * @returns A normalized {title, channel, time} row, or null to skip.
 */
function extractRow(entry) {
    if (!entry || typeof entry !== 'object')
        return null;
    const e = entry;
    const rawTitle = typeof e.title === 'string' ? e.title : '';
    if (!rawTitle)
        return null;
    const title = rawTitle.replace(/^Watched\s+/, '').trim();
    const subs = Array.isArray(e.subtitles) ? e.subtitles : [];
    const channel = subs[0]?.name ? String(subs[0].name) : null;
    const time = typeof e.time === 'string' ? e.time : null;
    return { title, channel, time };
}
/** @description YYYY-MM bucket for an ISO timestamp, or null if unparseable. */
function monthKey(iso) {
    if (!iso || iso.length < 7)
        return null;
    const m = iso.slice(0, 7);
    return /^\d{4}-\d{2}$/.test(m) ? m : null;
}
/** @description Top N [key,count] pairs from a count map, highest first. */
function topPairs(counts, n) {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([channel, count]) => ({ channel, count }));
}
/** @description Builds the per-month top-channel trend (most recent TREND_MONTHS months). */
function buildMonthlyTrend(byMonth) {
    return [...byMonth.keys()]
        .sort()
        .slice(-TREND_MONTHS)
        .map((month) => ({
        month,
        topChannels: topPairs(byMonth.get(month), TREND_CHANNELS_PER_MONTH),
    }));
}
/**
 * @description Parses a Google Takeout `watch-history.json` export into a compact aggregate
 * (top channels with sample titles, monthly trend, a recent-titles sample). Pure and
 * deterministic — no I/O, no LLM. The product is small enough to drop straight into a prompt.
 * @param raw - The uploaded file contents (JSON string) or a pre-parsed entry array.
 * @returns The {@link WatchAggregate} distillation (zeroed totals if nothing parsed).
 */
function parseTakeoutWatchHistory(raw) {
    const entries = coerceEntries(raw);
    const channelCounts = new Map();
    const channelSamples = new Map();
    const byMonth = new Map();
    const dated = [];
    let total = 0, from = null, to = null;
    for (const entry of entries) {
        const row = extractRow(entry);
        if (!row)
            continue;
        total += 1;
        if (row.time) {
            dated.push(row);
            if (!from || row.time < from)
                from = row.time;
            if (!to || row.time > to)
                to = row.time;
        }
        if (!row.channel)
            continue;
        channelCounts.set(row.channel, (channelCounts.get(row.channel) ?? 0) + 1);
        const samples = channelSamples.get(row.channel) ?? [];
        if (samples.length < SAMPLES_PER_CHANNEL && row.title && !samples.includes(row.title))
            samples.push(row.title);
        channelSamples.set(row.channel, samples);
        const mk = monthKey(row.time);
        if (mk) {
            const mm = byMonth.get(mk) ?? new Map();
            mm.set(row.channel, (mm.get(row.channel) ?? 0) + 1);
            byMonth.set(mk, mm);
        }
    }
    const topChannels = topPairs(channelCounts, TOP_CHANNELS)
        .map(({ channel, count }) => ({ channel, count, sampleTitles: channelSamples.get(channel) ?? [] }));
    const recentTitles = dated
        .filter((r) => r.channel) // drop ads / removed videos — they carry no signal for the brief
        .sort((a, b) => String(b.time).localeCompare(String(a.time)))
        .slice(0, RECENT_TITLES)
        .map((r) => ({ title: r.title, channel: r.channel, time: r.time }));
    return {
        totalWatched: total,
        distinctChannels: channelCounts.size,
        dateRange: { from, to },
        topChannels,
        monthlyTrend: buildMonthlyTrend(byMonth),
        recentTitles,
    };
}
//# sourceMappingURL=youtube-takeout.js.map