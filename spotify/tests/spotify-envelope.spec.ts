/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 10:25:00 | roger.murphy@emeraldcoastsystemsgroup.com  | ADR-085 Wave 2 carve #2: the spotify-owned blocks of core's concierge-envelope.test.ts (parseEnvelope, normTrack normalization) move here with the app. The shared envelope helpers stay tested in core.
 */

import { describe, it, expect } from 'vitest';
import { parseEnvelope as parseSpotify } from '../src-routes/spotify-routes';

describe('parseEnvelope (Spotify) — full reply → typed envelope', () => {
  it('builds a playlist envelope from fenced JSON', () => {
    const t = '```json\n{"say":"made it","show":["t1"],"playlist":{"name":"Focus","trackIds":["t1","t2"]},"remember":["likes lo-fi"]}\n```';
    expect(parseSpotify(t)).toEqual({
      say: 'made it', show: ['t1'],
      playlist: { name: 'Focus', trackIds: ['t1', 't2'] },
      remember: ['likes lo-fi'],
    });
  });
  it('null playlist when trackIds missing/empty', () => {
    expect(parseSpotify('{"say":"ok","playlist":{"name":"x","trackIds":[]}}').playlist).toBeNull();
    expect(parseSpotify('{"say":"ok"}').playlist).toBeNull();
  });
  it('non-JSON reply becomes a plain say (turn never dropped)', () => {
    const r = parseSpotify('just talking, no json');
    expect(r.say).toBe('just talking, no json');
    expect(r.show).toEqual([]);
    expect(r.playlist).toBeNull();
  });
});

// (normTrack tests stay in core — spotify-client.ts never vendored; the platform spotify
//  connector runtime imports it, so the module and its specs remain framework-side.)
