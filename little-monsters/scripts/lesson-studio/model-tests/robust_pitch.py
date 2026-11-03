#!/usr/bin/env python3
"""Pitch movement of a voice recording with octave jumps removed.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Robust pitch spread for voice comparisons: the same autocorrelation pitch track as narrate.py's voice check, but frames more than 9 semitones from their running median are dropped before p95-p5, and the middle-half range (IQR) is reported too. narrate.py's figure read the deep Kokoro voices an octave off (am_onyx 29.7 semitones, really 6.2)

Usage: python3 robust_pitch.py <audio file> [<audio file> ...]   prints one JSON object keyed by file name
"""
import json
import subprocess
import sys

import numpy as np

RATE = 24000


def pcm_of(path):
    """Mono float samples at RATE, through ffmpeg so any audio format works."""
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ar', str(RATE), '-ac', '1', '-f', 's16le', '-'])
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def f0_track(pcm):
    """Pitch per 20 ms hop by autocorrelation, NaN where the frame is quiet or unvoiced."""
    win, hop = int(0.04 * RATE), int(0.01 * RATE)
    lo, hi = int(RATE / 450), int(RATE / 60)
    window = np.hanning(win)
    out = []
    for i in range(0, len(pcm) - win, hop * 2):
        w = pcm[i:i + win] * window
        if np.sqrt(np.mean(w ** 2)) < 0.015:
            out.append(np.nan)
            continue
        c = np.fft.irfft(np.abs(np.fft.rfft(w, 2 * win)) ** 2)[:win]
        k = lo + int(np.argmax(c[lo:hi]))
        out.append(RATE / k if c[k] / (c[0] + 1e-9) > 0.45 else np.nan)
    return np.array(out)


def robust(path):
    """Raw and cleaned p95-p5 spread, the cleaned middle-half range, the share dropped and the median pitch."""
    f0 = f0_track(pcm_of(path))
    if np.count_nonzero(~np.isnan(f0)) < 50:
        return None
    vals = (12 * np.log2(f0 / np.nanmedian(f0)))[~np.isnan(f0)]
    keep = np.array([x for i, x in enumerate(vals) if abs(x - np.median(vals[max(0, i - 10): i + 11])) <= 9])
    return {'raw95_5': round(float(np.percentile(vals, 95) - np.percentile(vals, 5)), 1),
            'clean95_5': round(float(np.percentile(keep, 95) - np.percentile(keep, 5)), 1),
            'iqr': round(float(np.percentile(keep, 75) - np.percentile(keep, 25)), 1),
            'dropped%': round(100 * (1 - len(keep) / len(vals)), 1), 'medianHz': round(float(np.nanmedian(f0)))}


if __name__ == '__main__':
    print(json.dumps({p.split('/')[-1]: robust(p) for p in sys.argv[1:]}))
