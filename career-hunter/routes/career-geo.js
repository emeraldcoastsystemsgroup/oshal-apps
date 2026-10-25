"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RADIUS_MILES = exports.EARTH_MILES = exports.CareerLocationError = void 0;
exports.normalizeCareerCity = normalizeCareerCity;
exports.resolveCareerLocation = resolveCareerLocation;
exports.careerDistanceSql = careerDistanceSql;
exports.careerRadiusPredicate = careerRadiusPredicate;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve explicit local-search centers from packaged US places/ZCTAs or supplied coordinates and build exact bounded spherical distance predicates without a network geocoder.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** A bad location is a user-visible refusal, never permission to search everywhere. */
class CareerLocationError extends Error {
    status = 400;
    code = 'invalid_location';
    constructor(message) { super(message); this.name = 'CareerLocationError'; }
}
exports.CareerLocationError = CareerLocationError;
const DATA = path.resolve(__dirname, '..', 'engine', 'jobhunter', 'data');
exports.EARTH_MILES = 3958.7613;
exports.DEFAULT_RADIUS_MILES = 25;
const STATE_NAMES = 'Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|District of Columbia:DC|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY|Puerto Rico:PR';
const STATES = new Map(STATE_NAMES.split('|').map(pair => {
    const [name, code] = pair.split(':');
    return [name.toLowerCase(), code];
}));
let cities;
let zctas;
/** Match the ingest's normalized city keys without guessing a state. */
function normalizeCareerCity(value) {
    return value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Read only packaged deterministic centroid data, once per package process. */
function cityTable() {
    if (!cities) {
        cities = new Map();
        for (const row of fs.readFileSync(path.join(DATA, 'us_cities.tsv'), 'utf8').trim().split(/\r?\n/)) {
            const [state, city, lat, lon] = row.split('\t');
            cities.set(`${state}:${normalizeCareerCity(city)}`, [Number(lat), Number(lon)]);
        }
    }
    return cities;
}
/** The Census ZCTA internal point approximates a ZIP area; it is not an address lookup. */
function zipTable() {
    if (!zctas) {
        zctas = new Map();
        for (const row of fs.readFileSync(path.join(DATA, 'us_zcta_2025.tsv'), 'utf8').trim().split(/\r?\n/)) {
            const [zip, lat, lon] = row.split('\t');
            zctas.set(zip, [Number(lat), Number(lon)]);
        }
    }
    return zctas;
}
/** Validate one scalar query value; duplicate or nested inputs cannot drop a filter. */
function scalar(query, name) {
    const raw = query[name];
    if (raw === undefined)
        return '';
    if (typeof raw !== 'string' && typeof raw !== 'number')
        throw new CareerLocationError(`${name} must have one value.`);
    return String(raw).trim();
}
/** Resolve a requested search center and bounded radius, or null for an ordinary nationwide search. */
function resolveCareerLocation(query) {
    const near = scalar(query, 'near'), latText = scalar(query, 'lat'), lonText = scalar(query, 'lon');
    const radiusText = scalar(query, 'radius_miles');
    const radius = radiusText ? Number(radiusText) : exports.DEFAULT_RADIUS_MILES;
    if (!Number.isFinite(radius) || radius < 1 || radius > 250)
        throw new CareerLocationError('Choose a search radius between 1 and 250 miles.');
    if (!near && !latText && !lonText) {
        if (radiusText)
            throw new CareerLocationError('Enter a town and state or ZIP, or use your location, before choosing a radius.');
        return null;
    }
    if (near && (latText || lonText))
        throw new CareerLocationError('Choose a typed location or coordinates, not both.');
    let point, label, accuracy;
    if (latText || lonText) {
        if (!latText || !lonText)
            throw new CareerLocationError('Both latitude and longitude are required.');
        point = [Number(latText), Number(lonText)];
        if (!point.every(Number.isFinite) || Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180)
            throw new CareerLocationError('Latitude must be between -90 and 90 and longitude between -180 and 180.');
        label = 'Your location';
        accuracy = 'coordinates';
    }
    else if (/^\d{5}$/.test(near)) {
        point = zipTable().get(near);
        label = `ZIP ${near}`;
        accuracy = 'zcta-internal-point';
        if (!point)
            throw new CareerLocationError(`ZIP ${near} is not in the offline Census ZCTA data. Enter a nearby town and state instead.`);
    }
    else {
        if (near.length > 160)
            throw new CareerLocationError('Enter a town and state, for example a regional federal hub, FL.');
        const comma = near.lastIndexOf(',');
        const match = comma < 0 ? /^(.+)\s+([A-Za-z]{2})$/.exec(near) : null;
        const cityInput = comma >= 0 ? near.slice(0, comma).trim() : (match?.[1]?.trim() || '');
        const stateInput = comma >= 0 ? near.slice(comma + 1).trim() : (match?.[2] || '');
        const upper = stateInput.toUpperCase();
        const state = STATES.get(stateInput.toLowerCase()) || ([...STATES.values()].includes(upper) ? upper : undefined);
        if (!cityInput || !state)
            throw new CareerLocationError('Enter a town and state, for example a regional federal hub, FL, or a five-digit ZIP.');
        const key = normalizeCareerCity(cityInput).replace(/air force base/g, 'afb');
        point = cityTable().get(`${state}:${key}`);
        label = `${cityInput}, ${state}`;
        accuracy = 'city-centroid';
        if (!point)
            throw new CareerLocationError(`Could not find ${label} in the offline US places data. Check the town or use a ZIP or your location.`);
    }
    return { center: { lat: point[0], lon: point[1] }, label, radius_miles: radius, accuracy };
}
/** An exact Haversine great-circle distance. Validated numbers are emitted as literals, never input SQL. */
function careerDistanceSql(location, alias = 'p') {
    if (!/^[a-z][a-z0-9]*$/i.test(alias))
        throw new Error('invalid internal SQL alias');
    const { lat, lon } = location.center;
    return `${2 * exports.EARTH_MILES} * asin(sqrt(min(1.0, max(0.0, `
        + `sin(radians(${alias}.lat - ${lat}) / 2) * sin(radians(${alias}.lat - ${lat}) / 2) `
        + `+ cos(radians(${lat})) * cos(radians(${alias}.lat)) `
        + `* sin(radians(${alias}.lon - ${lon}) / 2) * sin(radians(${alias}.lon - ${lon}) / 2)))))`;
}
/** Conservative spherical bounding box, then exact radius, applied before any LIMIT. */
function careerRadiusPredicate(location, alias = 'p') {
    const { lat, lon } = location.center;
    const angular = location.radius_miles / exports.EARTH_MILES;
    const latDelta = angular * 180 / Math.PI;
    const bounds = [`${alias}.lat BETWEEN ${Math.max(-90, lat - latDelta)} AND ${Math.min(90, lat + latDelta)}`, `${alias}.lon BETWEEN -180 AND 180`];
    if (lat - latDelta > -90 && lat + latDelta < 90) {
        const delta = Math.asin(Math.min(1, Math.sin(angular) / Math.cos(lat * Math.PI / 180))) * 180 / Math.PI;
        const low = lon - delta, high = lon + delta;
        if (low < -180)
            bounds.push(`(${alias}.lon >= ${low + 360} OR ${alias}.lon <= ${high})`);
        else if (high > 180)
            bounds.push(`(${alias}.lon >= ${low} OR ${alias}.lon <= ${high - 360})`);
        else
            bounds.push(`${alias}.lon BETWEEN ${low} AND ${high}`);
    }
    bounds.push(`${alias}.city IS NOT NULL AND trim(${alias}.city) != ''`, `${careerDistanceSql(location, alias)} <= ${location.radius_miles}`);
    return bounds.join(' AND ');
}
