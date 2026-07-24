"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-23 14:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial — read-only OHLCV bars
 *            |          | + vendored TradingView Lightweight Charts, so the Trading surface renders real
 *            |          | candlestick charts. Self-contained (own file): does its own Alpaca Data API fetch
 *            |          | with the same key resolution as the broker, so it does not touch the trading
 *            |          | engine's trading-routes.ts / market-data.ts. Mounted at /api/trading-charts.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Standard (ctx) factory; the vendored chart lib now serves from the package's tools/vendor (ctx.appPackageDir per D10, load-time env fallback, then the relative dev fallback) — the kernel src/api/vendor copy ripped with the app. The split posture is UNCHANGED and declared auth: public in the manifest (EXACTLY what core server.ts mounted, ADR-085 D2): the lib is a public MIT JS asset, GET /bars self-gates via callerSub → 401.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTradingChartsRoutes = createTradingChartsRoutes;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-charts-routes' });
/** Alpaca bar timeframes the chart offers, mapped to a sensible lookback window (calendar days). */
const TIMEFRAMES = {
    '5Min': { tf: '5Min', days: 5, limit: 400 },
    '15Min': { tf: '15Min', days: 12, limit: 400 },
    '1Hour': { tf: '1Hour', days: 45, limit: 400 },
    '1Day': { tf: '1Day', days: 400, limit: 400 },
    '1Week': { tf: '1Week', days: 2200, limit: 400 },
};
/** The authenticated caller's OIDC sub (matches the other app routes). */
function callerSub(req) {
    const oidc = req.oidc;
    if (oidc?.isAuthenticated?.())
        return oidc.user?.sub || oidc.user?.oid;
    return req.userSub;
}
/** Resolve the Alpaca data-API keys — same precedence as the broker adapter (incl. the ALPAKA_ typo alias). */
function alpacaKeys() {
    const first = (...names) => { for (const n of names) {
        const v = process.env[n];
        if (v)
            return v;
    } return ''; };
    return {
        id: first('ALPACA_PAPER_KEY_ID', 'ALPACA_KEY_ID', 'ALPACA_KEY', 'ALPAKA_KEY'),
        secret: first('ALPACA_PAPER_SECRET_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_SECRET', 'ALPAKA_SECRET'),
    };
}
/** ISO date `days` ago (UTC), used as the Alpaca `start` param. */
function startFor(days) {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Read-only chart routes for the Trading surface — OHLCV bars + the vendored chart lib.
 * @param ctx - The per-package app context (appPackageDir locates tools/vendor per D10; no pool use).
 * @returns An Express router mounted at /api/trading-charts.
 */
function createTradingChartsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const appPackageDir = ctx.appPackageDir;
    // Serve the vendored TradingView Lightweight Charts bundle (presentation asset; no data/creds).
    router.get('/vendor/lightweight-charts.js', (_req, res) => {
        const candidates = [
            appPackageDir ? path_1.default.join(appPackageDir, 'tools', 'vendor', 'lightweight-charts.js') : '',
            LOAD_TIME_PACKAGE_DIR ? path_1.default.join(LOAD_TIME_PACKAGE_DIR, 'tools', 'vendor', 'lightweight-charts.js') : '',
            path_1.default.resolve(__dirname, '../tools/vendor/lightweight-charts.js'),
        ].filter(Boolean);
        const file = candidates.find((p) => (0, fs_1.existsSync)(p));
        if (!file) {
            res.status(404).type('text/plain').send('// chart lib not vendored');
            return;
        }
        // Direct read+send: res.sendFile() returned an empty body off the read-only bind mount.
        try {
            const buf = (0, fs_1.readFileSync)(file);
            res.type('application/javascript');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(buf);
        }
        catch (err) {
            logger.error({ err, file }, 'failed to read vendored chart lib');
            res.status(500).type('text/plain').send('// chart lib read error');
        }
    });
    /**
     * GET /bars?symbol=AAPL&timeframe=1Day — ascending OHLCV bars for a candlestick chart.
     * Returns { symbol, timeframe, bars: [{ t(unix sec), o, h, l, c, v }] }.
     */
    router.get('/bars', async (req, res) => {
        if (!callerSub(req)) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z.\-]/g, '');
        const tfKey = String(req.query.timeframe || '1Day');
        const tf = TIMEFRAMES[tfKey] || TIMEFRAMES['1Day'];
        if (!symbol) {
            res.status(400).json({ error: 'symbol_required' });
            return;
        }
        const { id, secret } = alpacaKeys();
        if (!id || !secret) {
            res.status(503).json({ error: 'broker_not_configured', message: 'Set the Alpaca paper keys to load charts.' });
            return;
        }
        // Hard timeout: without it a stalled Alpaca data feed leaves the request hanging until an
        // upstream gateway kills it with a generic (bodyless) 502 — the surface then shows a bare
        // "HTTP 502" with no cause. Abort fast and hand the UI a real, explainable JSON error instead.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
            const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`
                + `?timeframe=${encodeURIComponent(tf.tf)}&start=${encodeURIComponent(startFor(tf.days))}`
                + `&limit=${tf.limit}&adjustment=all&feed=iex&sort=asc`;
            const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret, Accept: 'application/json' }, signal: ctrl.signal });
            if (!r.ok) {
                res.status(502).json({ error: `alpaca_${r.status}`, message: await r.text().catch(() => '') });
                return;
            }
            const j = (await r.json());
            const bars = (j.bars || []).map((b) => ({ t: Math.floor(new Date(b.t).getTime() / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
            res.json({ symbol, timeframe: tf.tf, bars });
        }
        catch (err) {
            const aborted = err.name === 'AbortError';
            logger.error({ err, symbol, tf: tfKey }, 'trading chart bars failed');
            res.status(aborted ? 504 : 502).json({
                error: aborted ? 'data_feed_timeout' : (err.message || 'chart_fetch_failed'),
                message: aborted ? 'The Alpaca market-data feed did not respond in time.' : '',
            });
        }
        finally {
            clearTimeout(timer);
        }
    });
    return router;
}
//# sourceMappingURL=trading-charts-routes.js.map