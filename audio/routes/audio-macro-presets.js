/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | ADR-208 standard formula macro presets and deterministic channel-strip recipe compiler for Audio Studio.
 */
'use strict';

const MACRO_PRESETS = {
  clean_voice: {
    id: 'clean_voice',
    label: 'Clean Voice',
    trackPatch: { hpf: true, gateThresholdDb: -45, eqMidDb: 3.0, eqHighDb: 1.5, compThresholdDb: -20, compRatio: 3.0 },
    note: '85 Hz Butterworth HPF, -45 dB gate, +3.0 dB speech presence, 3:1 compression',
  },
  auto_duck_music: {
    id: 'auto_duck_music',
    label: 'Auto-Duck Music',
    trackPatch: { ducking: true, duckDepthDb: -14, compRatio: 6.0 },
    note: 'Sidechain envelope ducking (-14 dB attenuation, 120 ms attack, 600 ms release)',
  },
  broadcast_master: {
    id: 'broadcast_master',
    label: 'Broadcast Master',
    masterPatch: { targetLufs: -14.0, ceilingDb: -1.0 },
    note: 'ITU-R BS.1770 -14.0 LUFS loudness normalization with -1.0 dBTP true-peak ceiling',
  },
  acoustic_space: {
    id: 'acoustic_space',
    label: 'Acoustic Space',
    trackPatch: { reverbMix: 0.28 },
    note: '20 ms pre-delay Schroeder diffused room reverb (28% wet)',
  },
  vintage_warmth: {
    id: 'vintage_warmth',
    label: 'Vintage Warmth',
    trackPatch: { distortionMode: 'tube', driveDb: 4.0, eqLowDb: 2.0, eqHighDb: -1.5 },
    note: '+4.0 dB harmonic tube saturation with +2.0 dB low shelf and -1.5 dB top roll-off',
  },
  punchy_drums: {
    id: 'punchy_drums',
    label: 'Punchy Rhythm',
    trackPatch: { eqLowDb: 3.5, eqMidDb: -2.0, eqHighDb: 2.0, compThresholdDb: -16, compRatio: 4.5 },
    note: '+3.5 dB low punch, -2.0 dB mud cut, +2.0 dB transient snap, 4.5:1 bus compression',
  },
};

function selectTargetStems(stems, targetTrack, textLower) {
  if (!Array.isArray(stems) || stems.length === 0) return [];
  const matched = stems.filter((s) => {
    const role = String(s.trackName || s.role || '').toLowerCase();
    const label = String(s.name || '').toLowerCase();
    if (targetTrack) {
      const want = String(targetTrack).toLowerCase();
      return s.id === targetTrack || role === want || label.includes(want);
    }
    if ((textLower.includes('vocal') || textLower.includes('voice')) && (role.includes('vocal') || label.includes('vocal'))) return true;
    if ((textLower.includes('bass') || textLower.includes('sub') || textLower.includes('duck') || textLower.includes('sidechain')) && (role.includes('bass') || label.includes('bass'))) return true;
    if ((textLower.includes('drum') || textLower.includes('snare')) && (role.includes('drum') || label.includes('drum'))) return true;
    if ((textLower.includes('guitar') || textLower.includes('synth') || textLower.includes('other')) && (role.includes('other') || role.includes('guitar') || label.includes('guitar') || label.includes('synth'))) return true;
    return false;
  });
  return matched.length > 0 ? matched : [stems[0]];
}

function applyExplicitAdjustments(cfg, adjustments) {
  if (!adjustments || typeof adjustments !== 'object') return;
  for (const key of ['gainDb', 'volume', 'pan', 'eqLowDb', 'eqMidDb', 'eqHighDb', 'compRatio', 'compThresholdDb', 'reverbMix', 'driveDb']) {
    if (adjustments[key] !== undefined) cfg[key] = Number(adjustments[key]);
  }
  for (const flag of ['muted', 'solo', 'ducking', 'hpf']) {
    if (adjustments[flag] !== undefined) cfg[flag] = Boolean(adjustments[flag]);
  }
  if (adjustments.distortionMode) cfg.distortionMode = String(adjustments.distortionMode);
}

function applyStemInstruction(cfg, stemName, textLower, adjustments) {
  const notes = [];
  applyExplicitAdjustments(cfg, adjustments);
  if (textLower.includes('clean voice') || textLower.includes('remove hum')) {
    Object.assign(cfg, MACRO_PRESETS.clean_voice.trackPatch);
    notes.push(`${stemName}: ${MACRO_PRESETS.clean_voice.note}`);
  }
  if (textLower.includes('warm') || textLower.includes('body') || textLower.includes('presence')) {
    cfg.eqLowDb = Number(((cfg.eqLowDb || 0) + 2.5).toFixed(1));
    cfg.eqMidDb = Number(((cfg.eqMidDb || 0) + 1.8).toFixed(1));
    cfg.compRatio = 4.0;
    notes.push(`${stemName}: +2.5 dB low warmth, +1.8 dB presence, 4:1 compression`);
  }
  if (textLower.includes('air') || textLower.includes('bright') || textLower.includes('crisp') || textLower.includes('treble')) {
    cfg.eqHighDb = Number(((cfg.eqHighDb || 0) + 3.5).toFixed(1));
    notes.push(`${stemName}: +3.5 dB 8 kHz high shelf`);
  }
  if (textLower.includes('sub') || textLower.includes('punch') || textLower.includes('boost bass') || textLower.includes('low end')) {
    cfg.eqLowDb = Number(((cfg.eqLowDb || 0) + 4.0).toFixed(1));
    cfg.eqMidDb = Number(((cfg.eqMidDb || 0) - 2.0).toFixed(1));
    cfg.compRatio = 5.0;
    notes.push(`${stemName}: +4.0 dB @ 100 Hz, -2.0 dB mud cut, 5:1 compression`);
  }
  if (textLower.includes('duck') || textLower.includes('sidechain')) {
    cfg.ducking = true;
    cfg.duckDepthDb = -14;
    cfg.compRatio = 6.0;
    notes.push(`${stemName}: sidechain ducking enabled (-14 dB depth, 6:1 ratio)`);
  }
  if (textLower.includes('reverb') || textLower.includes('space') || textLower.includes('hall') || textLower.includes('wet')) {
    cfg.reverbMix = 0.42;
    notes.push(`${stemName}: Schroeder room reverb set to 42% wet`);
  }
  applyPanAndGainTokens(cfg, stemName, textLower, notes);
  if (notes.length === 0) {
    cfg.eqMidDb = Number(((cfg.eqMidDb || 0) + 2.0).toFixed(1));
    cfg.gainDb = Number(((cfg.gainDb || 0) + 1.5).toFixed(1));
    cfg.volume = Number(Math.pow(10, cfg.gainDb / 20).toFixed(2));
    notes.push(`${stemName}: +1.5 dB gain and +2.0 dB midrange clarity`);
  }
  return notes;
}

function applyPanAndGainTokens(cfg, stemName, textLower, notes) {
  if (textLower.includes('wide') || textLower.includes('stereo') || textLower.includes('pan right')) {
    cfg.pan = 0.45;
    notes.push(`${stemName}: stereo pan +0.45 R`);
  } else if (textLower.includes('pan left')) {
    cfg.pan = -0.45;
    notes.push(`${stemName}: stereo pan -0.45 L`);
  } else if (textLower.includes('center')) {
    cfg.pan = 0.0;
    notes.push(`${stemName}: stereo pan centered`);
  }
  if (textLower.includes('unmute')) { cfg.muted = false; notes.push(`${stemName}: unmuted`); }
  else if (textLower.includes('mute')) { cfg.muted = true; notes.push(`${stemName}: muted`); }
  if (textLower.includes('unsolo')) { cfg.solo = false; notes.push(`${stemName}: solo off`); }
  else if (textLower.includes('solo')) { cfg.solo = true; notes.push(`${stemName}: solo on`); }
  if (textLower.includes('louder') || textLower.includes('boost gain') || textLower.includes('turn up')) {
    cfg.gainDb = Math.min(12, Number(((cfg.gainDb || 0) + 3.0).toFixed(1)));
    cfg.volume = Number(Math.pow(10, cfg.gainDb / 20).toFixed(2));
    notes.push(`${stemName}: channel gain ${cfg.gainDb >= 0 ? '+' : ''}${cfg.gainDb} dB`);
  } else if (textLower.includes('quieter') || textLower.includes('lower') || textLower.includes('turn down')) {
    cfg.gainDb = Math.max(-36, Number(((cfg.gainDb || 0) - 3.0).toFixed(1)));
    cfg.volume = Number(Math.pow(10, cfg.gainDb / 20).toFixed(2));
    notes.push(`${stemName}: channel gain ${cfg.gainDb} dB`);
  }
}

function buildStemDirectives(stem, cfg) {
  const roleKey = String(stem.trackName || stem.role || 'vocals').toLowerCase();
  return [
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:gainDb`, value: String(cfg.gainDb) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:pan`, value: String(cfg.pan) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:eqLowDb`, value: String(cfg.eqLowDb) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:eqMidDb`, value: String(cfg.eqMidDb) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:eqHighDb`, value: String(cfg.eqHighDb) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:compRatio`, value: String(cfg.compRatio) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: `track:${roleKey}:reverbMix`, value: String(cfg.reverbMix) },
    { channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'custom', name: 'set_track_param', data: { trackId: stem.id, role: roleKey, config: cfg } },
  ];
}

module.exports = {
  MACRO_PRESETS,
  selectTargetStems,
  applyStemInstruction,
  buildStemDirectives,
};
