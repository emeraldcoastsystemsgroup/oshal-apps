"use strict";
/**
 * The weather forecast for a place, from the National Weather Service.
 *
 * Why this exists: asked "what is the weather like today?", Jarvis answered that no weather source was installed,
 * and a forecast question went to an unrelated app. The old platform read forecasts the same keyless way: geocode
 * the place on Nominatim (OpenStreetMap), ask api.weather.gov for that point's forecast office, and read its
 * forecast periods. Both hosts are public and need no credential; under the native kernel the manifest declares
 * them as egress and the global fetch carries the requests. Coverage is the United States (NWS).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: geocode (US) on Nominatim, NWS points to forecast, the next periods with temperature, unit, wind and the short and detailed forecast, the source named; a place outside NWS coverage or not found is said in words.
 *
 * @module home-weather
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE = exports.USER_AGENT = void 0;
exports.forecast = forecast;
/** NWS asks every client to identify itself. */
exports.USER_AGENT = 'oshal-home-weather/1.0 (maintainer@emeraldcoastsystemsgroup.com)';
/** The source every answer names. */
exports.SOURCE = 'National Weather Service (weather.gov)';
/** How many forecast periods an answer carries (today, tonight, then the coming days). */
const PERIODS = 8;
/** GET one JSON document, or throw a WeatherError naming the step. */
async function getJson(fetchImpl, url, step) {
    const r = await fetchImpl(url, { headers: { 'User-Agent': exports.USER_AGENT, Accept: 'application/geo+json, application/json' } });
    if (!r || !r.ok)
        throw Object.assign(new Error(`${step} answered ${r ? r.status : 'nothing'}`), { step, status: r ? r.status : 0 });
    return r.json();
}
/**
 * @description The forecast for a place: its resolved name, the next periods and the source.
 * @param fetchImpl - The fetch to use (the global fetch; a test passes its own).
 * @param location - A US city, address or ZIP as the person said it.
 * @returns {ok, place, periods, source} or {ok:false, error, message} in words.
 */
async function forecast(fetchImpl, location) {
    const where = String(location || '').trim().slice(0, 200);
    if (!where)
        return { ok: false, error: 'location_required', message: 'Say which city or ZIP code to forecast.' };
    const places = await getJson(fetchImpl, `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(where)}`, 'geocode');
    const hit = Array.isArray(places) ? places[0] : null;
    if (!hit || !hit.lat || !hit.lon)
        return { ok: false, error: 'place_not_found', message: `No US place named "${where}" was found; the forecast covers the United States.` };
    const lat = Number(hit.lat).toFixed(4), lon = Number(hit.lon).toFixed(4);
    let point;
    try {
        point = await getJson(fetchImpl, `https://api.weather.gov/points/${lat},${lon}`, 'points');
    }
    catch (err) {
        if (err.status === 404)
            return { ok: false, error: 'outside_coverage', message: `${hit.display_name} is outside National Weather Service coverage.` };
        throw err;
    }
    const url = point && point.properties && point.properties.forecast;
    if (!url)
        return { ok: false, error: 'outside_coverage', message: `${hit.display_name} has no National Weather Service forecast.` };
    const fc = await getJson(fetchImpl, url, 'forecast');
    const periods = ((fc && fc.properties && fc.properties.periods) || []).slice(0, PERIODS).map((p) => ({
        name: String(p.name || ''), startTime: p.startTime || null, isDaytime: Boolean(p.isDaytime),
        temperature: Number.isFinite(Number(p.temperature)) ? Number(p.temperature) : null, unit: p.temperatureUnit || 'F',
        wind: [p.windSpeed, p.windDirection].filter(Boolean).join(' '),
        precipitationChance: p.probabilityOfPrecipitation && Number.isFinite(Number(p.probabilityOfPrecipitation.value)) ? Number(p.probabilityOfPrecipitation.value) : null,
        shortForecast: String(p.shortForecast || ''), detailedForecast: String(p.detailedForecast || '').slice(0, 400),
    }));
    if (!periods.length)
        return { ok: false, error: 'no_forecast', message: 'The National Weather Service returned no forecast periods for that place.' };
    return { ok: true, place: String(hit.display_name || where), latitude: Number(lat), longitude: Number(lon), periods, source: exports.SOURCE, updated: fc.properties.updated || null };
}
