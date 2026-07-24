/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 08:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | ADR-085 Wave 2 carve #1: the movies-owned blocks of core's concierge-envelope.test.ts (parseEnvelope, isV4 TMDB key detection, normTitle normalization) move here with the app. The shared envelope helpers stay tested in core. Run from the package root with the framework checkout on the vitest alias path.
 */

import { describe, it, expect } from 'vitest';
import { parseEnvelope as parseMovies } from '../src-routes/movies-routes';
import { isV4, normTitle } from '../src-routes/tmdb-client';

describe('parseEnvelope (Movies) — full reply → typed envelope', () => {
  it('builds a watchlist envelope', () => {
    const r = parseMovies('{"say":"try these","show":["movie:1"],"watchlist":["movie:1"],"remember":["likes sci-fi"]}');
    expect(r).toEqual({ say: 'try these', show: ['movie:1'], watchlist: ['movie:1'], remember: ['likes sci-fi'] });
  });
  it('non-JSON reply becomes a plain say', () => {
    expect(parseMovies('hi there').say).toBe('hi there');
  });
});

describe('isV4 — TMDB key shape detection', () => {
  it('a JWT (v4 read-access token) is v4', () => {
    expect(isV4('eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe(true);
  });
  it('a v3 API key is not v4', () => {
    expect(isV4('261d63abc123def4567890')).toBe(false);
  });
});

describe('normTitle (TMDB) — movie/tv normalization', () => {
  it('normalizes a movie + composite key + year slice', () => {
    const t = normTitle({ id: 603, title: 'The Matrix', release_date: '1999-03-31', vote_average: 8.2, media_type: 'movie' });
    expect(t).toMatchObject({ id: 603, mediaType: 'movie', key: 'movie:603', title: 'The Matrix', year: '1999', rating: 8.2 });
  });
  it('infers tv from name/first_air_date', () => {
    const t = normTitle({ id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17', media_type: 'tv' });
    expect(t).toMatchObject({ mediaType: 'tv', key: 'tv:1399', title: 'Game of Thrones', year: '2011' });
  });
  it('skips person results and id-less rows', () => {
    expect(normTitle({ id: 5, name: 'Some Actor', media_type: 'person' })).toBeNull();
    expect(normTitle({ media_type: 'movie', title: 'No Id' })).toBeNull();
  });
});
