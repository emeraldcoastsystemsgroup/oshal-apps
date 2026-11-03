#!/usr/bin/env python3
"""Mix a lesson's soundtrack: the voice in front, small sound effects and a jingle under it.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Original sound effects synthesized here (chalk, pop, ding, eraser, tick, a mallet jingle), mixed under the narration and leveled to one loudness across every lesson

Every sound is generated, so there is nothing to license. Effects stay well under the
voice: they punctuate the moving parts and must never compete with the teacher.

Usage: mix.py <voice.wav> <events.json> <out.wav>
"""
import json
import subprocess
import sys

import numpy as np

RATE = 48000
SEED = 20261102


def env(n, attack, decay):
    t = np.arange(n) / RATE
    return np.minimum(t / max(attack, 1e-4), 1) * np.exp(-t / decay)


def tone(freq, dur, attack=0.002, decay=0.12, partials=((1, 1.0),)):
    n = int(dur * RATE)
    t = np.arange(n) / RATE
    wave = sum(a * np.sin(2 * np.pi * freq * m * t) for m, a in partials)
    return wave * env(n, attack, decay)


def noise(n, rng):
    return rng.standard_normal(n)


def band(sig, low, high):
    """Quick band-limit by FFT mask: effects do not need a sharper filter."""
    spec = np.fft.rfft(sig)
    freqs = np.fft.rfftfreq(len(sig), 1 / RATE)
    spec[(freqs < low) | (freqs > high)] = 0
    return np.fft.irfft(spec, len(sig))


def chalk(dur, rng):
    """Short rasping strokes, like letters being written."""
    n = int(max(dur, 0.15) * RATE)
    out = np.zeros(n)
    pos = 0
    while pos < n:
        stroke = int(rng.uniform(0.05, 0.13) * RATE)
        seg = band(noise(stroke, rng), 2200, 7500) * np.sin(np.linspace(0, np.pi, stroke)) ** 1.2 * rng.uniform(0.5, 1)
        end = min(n, pos + stroke)
        out[pos:end] += seg[:end - pos]
        pos += stroke + int(rng.uniform(0.012, 0.05) * RATE)
    return 0.16 * out


def pop():
    n = int(0.11 * RATE)
    t = np.arange(n) / RATE
    freq = 780 * np.exp(-t * 24) + 240
    return 0.55 * np.sin(2 * np.pi * np.cumsum(freq) / RATE) * env(n, 0.001, 0.035)


def ding():
    bell = ((1, 1), (2.76, 0.45), (5.4, 0.18))
    out = tone(1318.5, 0.8, 0.002, 0.26, bell)
    late = int(0.07 * RATE)
    out[late:] += 0.7 * tone(1760, 0.8, 0.002, 0.24, bell)[:len(out) - late]
    return 0.34 * out


def erase(dur, rng):
    n = int(max(dur, 0.2) * RATE)
    sweep = np.abs(np.sin(np.linspace(0, 3 * np.pi, n))) ** 0.7
    return 0.13 * band(noise(n, rng), 500, 4200) * sweep


def swipe(rng):
    n = int(0.2 * RATE)
    return 0.10 * band(noise(n, rng), 1200, 6000) * np.sin(np.linspace(0, np.pi, n)) ** 2


def whoosh(rng):
    n = int(0.32 * RATE)
    return 0.14 * band(noise(n, rng), 280, 2600) * np.sin(np.linspace(0, np.pi, n)) ** 2


def tick():
    return 0.28 * tone(1900, 0.05, 0.0005, 0.008) + 0.2 * tone(620, 0.05, 0.0005, 0.012)


def boing():
    n = int(0.3 * RATE)
    t = np.arange(n) / RATE
    freq = 170 + 200 * np.sin(np.minimum(t * 11, np.pi / 2))
    wob = 1 + 0.08 * np.sin(2 * np.pi * 24 * t)
    return 0.26 * np.sin(2 * np.pi * np.cumsum(freq * wob) / RATE) * env(n, 0.004, 0.11)


def poof(rng):
    n = int(0.3 * RATE)
    return 0.14 * band(noise(n, rng), 200, 1800) * env(n, 0.01, 0.09)


def mallet(freq, dur=0.7):
    return tone(freq, dur, 0.002, 0.22, ((1, 1), (4, 0.26), (10, 0.05)))


def tune(notes, dur=1.6):
    """A short mallet phrase: (start seconds, frequency) pairs."""
    n = int(dur * RATE)
    out = np.zeros(n)
    for start, freq in notes:
        s = int(start * RATE)
        note = mallet(freq)
        end = min(n, s + len(note))
        out[s:end] += note[:end - s]
    return 0.3 * out


def jingle():
    return tune([(0, 523.25), (0.14, 659.25), (0.28, 783.99), (0.5, 1046.5), (0.5, 659.25)])


def tada():
    return tune([(0, 523.25), (0.1, 659.25), (0.2, 783.99), (0.34, 1046.5), (0.34, 783.99), (0.5, 1318.5)], 1.9)


def render(event, rng):
    name, dur = event['name'], event.get('dur', 0)
    table = {'pop': pop, 'ding': ding, 'tick': tick, 'boing': boing, 'jingle': jingle, 'tada': tada}
    if name in table:
        return table[name]()
    if name == 'chalk':
        return chalk(dur, rng)
    if name == 'erase':
        return erase(dur, rng)
    if name == 'swipe':
        return swipe(rng)
    if name == 'whoosh':
        return whoosh(rng)
    if name == 'poof':
        return poof(rng)
    raise SystemExit('unknown sound: ' + name)


def main():
    voice_path, events_path, out_path = sys.argv[1:4]
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', voice_path, '-ar', str(RATE), '-ac', '1', '-f', 'f32le', '-'])
    voice = np.frombuffer(raw, dtype=np.float32).copy()
    peak = np.percentile(np.abs(voice[np.abs(voice) > 1e-4]), 99.5) if (np.abs(voice) > 1e-4).any() else 1
    voice = voice / max(peak, 1e-3) * 0.62
    bed = np.zeros(len(voice))
    rng = np.random.default_rng(SEED)
    events = json.loads(open(events_path).read())
    for e in events + [{'name': 'jingle', 't': 0.05, 'gain': 0.8}]:
        sound = render(e, rng) * e.get('gain', 1)
        at = int(max(0, e['t']) * RATE)
        end = min(len(bed), at + len(sound))
        if end > at:
            bed[at:end] += sound[:end - at]
    # Duck the effects under speech so the voice always leads.
    level = np.abs(voice)
    size = int(0.05 * RATE)
    level = np.convolve(level, np.ones(size) / size, mode='same')
    duck = 1 - 0.55 * np.clip(level / 0.06, 0, 1)
    mixed = voice + bed * duck * 0.72
    mixed = np.tanh(mixed * 1.05) * 0.92
    stereo = np.stack([mixed, mixed], axis=1).astype(np.float32)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-i', '-',
                    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', str(RATE), '-c:a', 'pcm_s16le', out_path],
                   input=stereo.tobytes(), check=True)


if __name__ == '__main__':
    main()
