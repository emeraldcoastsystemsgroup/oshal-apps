/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "What is the weather like today?" from Jarvis answered that no weather source was installed. The compiled home-weather module geocodes on Nominatim, reads the NWS point and its forecast, and answers the periods with the source named; a missing place, a place not found and one outside NWS coverage are answered in words; the manifest declares both hosts as keyless egress, the home-weather tool on GET /api/home/weather, and weather routing words.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Weather phrases are declared: the single keyword claimed "the weather like today in Chicago" only weakly and the assistant kept it.
 *
 * Dependency-free `node --test` suite apart from the store toolchain's js-yaml.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const weather = require('../routes/home-weather.js');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));

/** A fetch answering the three NWS-chain URLs from fixed documents; every URL and User-Agent recorded. */
function fakeFetch({ places = [{ lat: '47.6038', lon: '-122.3301', display_name: 'Seattle, Washington' }], pointStatus = 200 } = {}) {
  const asked = [];
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  const impl = async (url, init) => {
    asked.push({ url, agent: init && init.headers && init.headers['User-Agent'] });
    if (url.startsWith('https://nominatim.openstreetmap.org/search')) return json(places);
    if (url.startsWith('https://api.weather.gov/points/')) return pointStatus === 200 ? json({ properties: { forecast: 'https://api.weather.gov/gridpoints/SEW/124,67/forecast' } }) : json({}, pointStatus);
    if (url === 'https://api.weather.gov/gridpoints/SEW/124,67/forecast') return json({ properties: { updated: '2026-10-16T20:00:00Z', periods: [
      { name: 'Tonight', isDaytime: false, temperature: 56, temperatureUnit: 'F', windSpeed: '3 to 14 mph', windDirection: 'SSW', probabilityOfPrecipitation: { value: 52 }, shortForecast: 'Chance Light Rain', detailedForecast: 'A chance of rain after 1am.' },
      { name: 'Saturday', isDaytime: true, temperature: 62, temperatureUnit: 'F', windSpeed: '10 mph', windDirection: 'S', probabilityOfPrecipitation: { value: 80 }, shortForecast: 'Rain', detailedForecast: 'Rain.' }] } });
    return json({}, 404);
  };
  return { impl, asked };
}

test('a US place answers its NWS forecast periods with the source named', async () => {
  const { impl, asked } = fakeFetch();
  const r = await weather.forecast(impl, 'Seattle, WA');
  assert.equal(r.ok, true);
  assert.equal(r.place, 'Seattle, Washington');
  assert.deepEqual(r.periods.map((p) => [p.name, p.temperature, p.unit, p.shortForecast, p.precipitationChance]), [['Tonight', 56, 'F', 'Chance Light Rain', 52], ['Saturday', 62, 'F', 'Rain', 80]]);
  assert.equal(r.source, 'National Weather Service (weather.gov)');
  assert.equal(asked[1].url, 'https://api.weather.gov/points/47.6038,-122.3301');
  assert.ok(asked.every((a) => /oshal-home-weather/.test(a.agent)), 'every request identifies itself as NWS asks');
});

test('no place, an unknown place and one outside coverage are said in words, never a forecast', async () => {
  assert.equal((await weather.forecast(fakeFetch().impl, '  ')).error, 'location_required');
  assert.equal((await weather.forecast(fakeFetch({ places: [] }).impl, 'Atlantis')).error, 'place_not_found');
  const outside = await weather.forecast(fakeFetch({ pointStatus: 404 }).impl, 'Somewhere');
  assert.equal(outside.error, 'outside_coverage');
  assert.match(outside.message, /outside National Weather Service coverage/);
});

test('the manifest declares the keyless hosts, the tool on GET /api/home/weather and weather routing words', () => {
  const m = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const hosts = m.egress.filter((e) => !e.credential).map((e) => e.host);
  assert.deepEqual(hosts.sort(), ['api.weather.gov', 'nominatim.openstreetmap.org']);
  const t = m.tools.find((x) => x.name === 'home-weather');
  assert.equal(t.executor.apiEndpoint, 'GET /api/home/weather?location={input.location}');
  assert.equal(t.requiresApproval, false);
  for (const word of ['weather', 'the weather', 'weather like', 'weather in', 'weather forecast', 'will it rain']) assert.ok(m.bots[0].routingKeywords.includes(word), word);
  assert.ok(fs.readFileSync(path.join(ROOT, 'routes', 'home-routes.js'), 'utf8').includes("router.get('/weather'"));
});
