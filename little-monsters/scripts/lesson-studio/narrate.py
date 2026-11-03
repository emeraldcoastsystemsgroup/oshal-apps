#!/usr/bin/env python3
"""Voice one lesson: record a directed take, time every word, and measure the mouth.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Directed lesson takes from a speech model, word timing by transcribing the take in pause-cut chunks (one long pass drifted 4 s) and aligning it to the script, pauses spliced at beat boundaries, lip-sync and WebVTT captions; a take with a long unplaced stretch is refused; a finished take is kept in takes/ because it cannot be reproduced

A take is one continuous performance of the whole lesson, so the teacher's energy
carries from line to line. A take whose transcript does not match its script is refused,
because a speech model can read its direction aloud or drop a line.

Usage: narrate.py <lesson id> [--retake] [--engine gemini|kokoro] [--model NAME]
Needs GEMINI_API_KEY for the gemini engine. kokoro is a local rehearsal voice for
checking pictures before spending a take; it is never published.
"""
import argparse
import base64
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CACHE = Path(os.environ.get('LESSON_CACHE', Path.home() / '.cache/little-monsters-lessons'))
TAKES = HERE / 'takes'
FPS = 30
RATE = 24000
LEAD_IN = 1.3
TAIL = 2.4
PAGE_GAP = 1.0
BEAT_GAP = 0.32
MIN_MATCH = 0.9
MAX_UNHEARD_RUN = 6
SKIP_WORDS = 0.12


def lesson_script(lesson_id):
    """Ask node for the lesson's words, so scripts stay in one place."""
    out = subprocess.check_output(['node', str(HERE / 'lessons-json.cjs'), lesson_id], text=True)
    return json.loads(out)


def tokens_of(say):
    """Split a beat into spoken words, keeping cue markers and dropping direction tags."""
    clean = re.sub(r'\[[^\]]*\]\s*', '', say)
    tokens, pending = [], []
    for chunk in clean.split():
        marks = re.findall(r'\{(\w+)\}', chunk)
        pending += marks
        raw = re.sub(r'\{\w+\}', '', chunk)
        if not raw:
            continue
        tokens.append({'raw': raw, 'w': re.sub(r"^[^\w']+|[^\w']+$", '', raw), 'cues': pending})
        pending = []
    if pending:
        raise SystemExit(f'cue with no word after it: {pending} in: {say}')
    return tokens


def spoken_text(say):
    """The words handed to the voice: tags stay, they steer the delivery."""
    return re.sub(r'\s+', ' ', re.sub(r'\{\w+\}', '', say)).strip()


def direction(teacher):
    """Director's notes kept apart from the transcript, so they are acted and not read."""
    return (f"# AUDIO PROFILE: {teacher['name']}\n"
            f"## A small, fuzzy, friendly monster who is a teenager's favorite {teacher['subject']} tutor.\n\n"
            "## THE SCENE: A cozy classroom after school. The monster is at the chalkboard with one student, working through a trick together.\n\n"
            f"### DIRECTOR'S NOTES\nStyle: {teacher['notes']} Conversational and alive, never an announcer and never a textbook. "
            "Real reactions: surprise at the trap, delight when it clicks.\n"
            "Pace: lively but clear. Let numbers land. Take a real breath between paragraphs.\n"
            "Accent: friendly American.\n\n#### TRANSCRIPT\n")


def gemini_take(script, teacher, model, key):
    """One request for the whole lesson. Rate limits are waited out, quota errors are not."""
    body = {'contents': [{'parts': [{'text': direction(teacher) + '\n\n'.join(spoken_text(b['say']) for b in script['beats'])}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': teacher['voice']}}}}}
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    for attempt in range(5):
        req = urllib.request.Request(url, json.dumps(body).encode(), {'content-type': 'application/json', 'x-goog-api-key': key})
        try:
            reply = json.load(urllib.request.urlopen(req, timeout=420))
            data = base64.b64decode(reply['candidates'][0]['content']['parts'][0]['inlineData']['data'])
            return data if data[:4] == b'RIFF' else wav_header(data) + data
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:400]
            if e.code == 429 and 'per day' in detail:
                raise SystemExit(f'{model}: the daily quota is used up') from e
            if e.code in (429, 500, 503) and attempt < 4:
                print(f'{model}: {e.code}, waiting', file=sys.stderr, flush=True)
                time.sleep(35 * (attempt + 1))
                continue
            raise SystemExit(f'{model}: HTTP {e.code} {detail}') from e
    raise SystemExit(f'{model}: no take after retries')


def wav_header(pcm):
    import struct
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, RATE, RATE * 2, 2, 16)
            + b'data' + struct.pack('<I', len(pcm)))


def kokoro_take(script):
    text = ' '.join(re.sub(r'\[[^\]]*\]\s*', '', spoken_text(b['say'])) for b in script['beats'])
    body = {'model': 'kokoro', 'input': text, 'voice': 'af_heart', 'response_format': 'wav'}
    req = urllib.request.Request('http://127.0.0.1:8880/v1/audio/speech', json.dumps(body).encode(), {'content-type': 'application/json'})
    return urllib.request.urlopen(req, timeout=300).read()


def load_pcm(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ar', str(RATE), '-ac', '1', '-f', 's16le', '-'])
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
         'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def number_words(n):
    if n < 20:
        return [UNITS[n]]
    if n < 100:
        return [TENS[n // 10]] + ([UNITS[n % 10]] if n % 10 else [])
    if n < 1000:
        return [UNITS[n // 100], 'hundred'] + (number_words(n % 100) if n % 100 else [])
    return number_words(n // 1000) + ['thousand'] + (number_words(n % 1000) if n % 1000 else [])


def normalize(word):
    """Turn a heard word into the words a script would spell: 3x is three x, $50 is fifty dollar, 0.8 is point eight."""
    w = word.lower().strip().replace("’", "'")
    if w.strip(' .,!?') == '%':
        return ['percent']
    w = re.sub(r"^[^\w$.]+|[^\w%']+$", '', w)
    parts, money = [], False
    for piece in re.findall(r"\$|%|\d*\.\d+|\d+|[a-z']+", w):
        if piece == '$':
            money = True
            continue
        if piece == '%':
            parts.append('percent')
        elif '.' in piece:
            whole, frac = piece.split('.')
            parts += ([] if whole in ('', '0') else number_words(int(whole))) + ['point'] + [UNITS[int(d)] for d in frac]
        elif piece.isdigit():
            parts += number_words(int(piece))
        else:
            parts.append('dollar' if piece == 'dollars' else piece)
        if money and piece[-1:].isdigit():
            parts.append('dollar')
            money = False
    return parts


def chunk_bounds(audio, rate=16000, target=12.0, low=7.0, high=17.0):
    """Cut long audio at its quietest moments into chunks of about `target` seconds.

    Whisper's word times drift over a long file (a two-minute take was 4 s off in one stretch),
    so each chunk is transcribed on its own. Cuts fall in pauses, never inside a word.
    """
    hop = int(0.02 * rate)
    level = np.sqrt(np.convolve(audio ** 2, np.ones(hop) / hop, mode='same')[::hop])
    bounds, start = [], 0
    total = len(level)
    while (total - start) * hop / rate > high:
        a, b = start + int(low * rate / hop), start + int(high * rate / hop)
        quiet = a + int(np.argmin(np.convolve(level[a:b], np.ones(8) / 8, mode='same')))
        bounds.append((start * hop, quiet * hop))
        start = quiet
    bounds.append((start * hop, len(audio)))
    return bounds


def transcribe(pcm):
    """Word timestamps from a local transcriber, chunk by chunk."""
    from faster_whisper import WhisperModel
    model = WhisperModel(os.environ.get('LESSON_WHISPER', 'small.en'), device='cpu', compute_type='int8', cpu_threads=6)
    audio = np.interp(np.arange(0, len(pcm), RATE / 16000), np.arange(len(pcm)), pcm).astype(np.float32)
    words = []
    for a, b in chunk_bounds(audio):
        offset = a / 16000
        segments, _ = model.transcribe(audio[a:b], word_timestamps=True, language='en', vad_filter=False,
                                       condition_on_previous_text=False)
        words += [{'w': w.word, 't0': float(w.start) + offset, 't1': float(w.end) + offset} for s in segments for w in s.words]
    return words


def longest_gap(timed):
    """The longest run of script words the transcript did not place."""
    run = best = 0
    for tok in timed:
        run = run + 1 if tok.get('unheard') else 0
        best = max(best, run)
    return best


def align(script_tokens, heard):
    """Give every script word a start and end time. Unheard stretches are interpolated."""
    flat_s = []
    for i, tok in enumerate(script_tokens):
        for part in normalize(tok['w']) or ['_']:
            flat_s.append((part, i))
    flat_h = []
    for h in heard:
        parts = normalize(h['w']) or ['_']
        span = (h['t1'] - h['t0']) / len(parts)
        for k, part in enumerate(parts):
            flat_h.append((part, h['t0'] + k * span, h['t0'] + (k + 1) * span))
    matcher = difflib.SequenceMatcher(None, [p for p, _ in flat_s], [p for p, _, _ in flat_h], autojunk=False)
    t0 = [None] * len(flat_s)
    t1 = [None] * len(flat_s)
    matched = 0
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            t0[block.a + k], t1[block.a + k] = flat_h[block.b + k][1], flat_h[block.b + k][2]
            matched += 1
    extra = len(flat_h) - matched
    used = set()
    for block in matcher.get_matching_blocks():
        used.update(range(block.b, block.b + block.size))
    extra_words = [flat_h[k][0] for k in range(len(flat_h)) if k not in used]
    dropped = [flat_s[k][0] for k in range(len(flat_s)) if t0[k] is None]
    fill_gaps(flat_s, t0, t1, flat_h[-1][2] if flat_h else 0)
    heard_at = [False] * len(flat_s)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            heard_at[block.a + k] = True
    out = [dict(tok) for tok in script_tokens]
    for tok in out:
        tok['t0'], tok['t1'], tok['unheard'] = None, None, True
    for k, (_, i) in enumerate(flat_s):
        out[i]['t0'] = t0[k] if out[i]['t0'] is None else out[i]['t0']
        out[i]['t1'] = t1[k]
        if heard_at[k]:
            out[i]['unheard'] = False
    return out, matched / max(1, len(flat_s)), extra, extra_words, dropped


def fill_gaps(flat_s, t0, t1, last):
    """Share an unheard run of words across the time between its neighbors, by length."""
    n = len(flat_s)
    i = 0
    while i < n:
        if t0[i] is not None:
            i += 1
            continue
        j = i
        while j < n and t0[j] is None:
            j += 1
        start = t1[i - 1] if i else 0.0
        end = t0[j] if j < n else last
        weights = [max(1, len(flat_s[k][0])) for k in range(i, j)]
        total = sum(weights)
        now = start
        for k, weight in zip(range(i, j), weights):
            t0[k] = now
            now += (end - start) * weight / total
            t1[k] = now
        i = j


def splice(pcm, beats, script):
    """Build the final voice track with pauses cut in at the beat boundaries."""
    pieces = [np.zeros(int(LEAD_IN * RATE), dtype=np.float32)]
    offset = LEAD_IN
    cursor = 0.0
    for i, beat in enumerate(beats):
        spec = script['beats'][i]
        first, last = beat['tokens'][0]['t0'], beat['tokens'][-1]['t1']
        natural = first - cursor
        cut_at = max(cursor, first - min(0.08, natural / 2)) if i else max(0.0, first - 0.05)
        wanted = spec.get('gap')
        if wanted is None:
            wanted = PAGE_GAP if spec.get('page') else BEAT_GAP
        lead = max(0.0, wanted - (first - cut_at)) if i else 0.0
        if i:
            pieces.append(pcm[int(cursor * RATE):int(cut_at * RATE)])
            offset += cut_at - cursor
            pieces.append(np.zeros(int(lead * RATE), dtype=np.float32))
            offset += lead
        delta = offset - cut_at
        for tok in beat['tokens']:
            tok['t0'] += delta
            tok['t1'] += delta
        pieces.append(pcm[int(cut_at * RATE):int((last + 0.05) * RATE)])
        offset += last + 0.05 - cut_at
        cursor = last + 0.05
        if spec.get('pause'):
            pieces.append(np.zeros(int(spec['pause'] * RATE), dtype=np.float32))
            offset += spec['pause']
    pieces.append(np.zeros(int(TAIL * RATE), dtype=np.float32))
    return np.concatenate(pieces), offset + TAIL


def mouth_tracks(pcm, duration):
    """Per-frame mouth opening and shape from the voice: open with loudness, round when dark, wide when bright."""
    n = int(duration * FPS) + 2
    win = int(0.045 * RATE)
    hann = np.hanning(win)
    rms = np.zeros(n)
    centroid = np.zeros(n)
    freqs = np.fft.rfftfreq(win, 1 / RATE)
    for i in range(n):
        center = int((i + 0.5) / FPS * RATE)
        chunk = pcm[max(0, center - win // 2):center + win // 2]
        if len(chunk) < win:
            chunk = np.pad(chunk, (0, win - len(chunk)))
        rms[i] = np.sqrt(np.mean(chunk ** 2))
        spec = np.abs(np.fft.rfft(chunk * hann))
        centroid[i] = (freqs * spec).sum() / (spec.sum() + 1e-6)
    top = np.percentile(rms[rms > 1e-4], 96) if (rms > 1e-4).any() else 1.0
    level = np.clip((rms / top - 0.08) / 0.92, 0, 1) ** 0.72
    level = np.convolve(level, [0.22, 0.56, 0.22], mode='same')
    shape = np.clip((centroid - 700) / 2600, 0, 1)
    shape = np.convolve(shape, [0.25, 0.5, 0.25], mode='same')
    return [int(round(v * 100)) for v in level], [int(round(v * 100)) for v in shape]


def stamp(sec):
    ms = int(round(sec * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}.{ms % 1000:03}'


def captions(beats):
    """Phrase-sized WebVTT cues that follow the speech."""
    lines = ['WEBVTT', '']
    for beat in beats:
        phrase = []
        for k, tok in enumerate(beat['tokens']):
            phrase.append(tok)
            text = ' '.join(p['raw'] for p in phrase)
            ends = tok['raw'][-1] in '.?!:;,' and len(phrase) >= 3
            if ends or len(text) > 54 or k == len(beat['tokens']) - 1:
                t1 = max(phrase[-1]['t1'], phrase[0]['t0'] + 0.9)
                lines += [f"{stamp(phrase[0]['t0'])} --> {stamp(t1)}", text, '']
                phrase = []
    return '\n'.join(lines)


def voice_check(pcm):
    """Pitch spread in semitones: how much the voice moves. A flat synthesizer sits near 3."""
    win, hop = int(0.04 * RATE), int(0.01 * RATE)
    found = []
    lo, hi = int(RATE / 450), int(RATE / 70)
    window = np.hanning(win)
    for i in range(0, len(pcm) - win, hop * 2):
        w = pcm[i:i + win] * window
        if np.sqrt(np.mean(w ** 2)) < 0.015:
            continue
        c = np.fft.irfft(np.abs(np.fft.rfft(w, 2 * win)) ** 2)[:win]
        k = lo + int(np.argmax(c[lo:hi]))
        if c[k] / (c[0] + 1e-9) > 0.45:
            found.append(RATE / k)
    if not found:
        return 0.0, 0.0
    f0 = np.array(found)
    st = 12 * np.log2(f0 / np.median(f0))
    return float(np.percentile(st, 95) - np.percentile(st, 5)), float(np.median(f0))


def measure_loudness(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af', 'loudnorm=I=-16:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'],
                         stderr=subprocess.PIPE, text=True).stderr
    return json.loads(out[out.rindex('{'):])


def record(lesson_id, script, teacher, args, home):
    """Return the raw take, reusing the saved one while the words have not changed."""
    words = json.dumps([b['say'] for b in script['beats']], ensure_ascii=False)
    digest = hashlib.sha256((words + teacher['voice'] + direction(teacher)).encode()).hexdigest()
    take = home / f'take-{args.engine}.wav'
    meta = home / f'take-{args.engine}.json'
    if not args.retake and take.exists() and meta.exists() and json.loads(meta.read_text()).get('digest') == digest:
        return take, json.loads(meta.read_text())
    if args.engine == 'gemini':
        key = os.environ.get('GEMINI_API_KEY')
        if not key:
            raise SystemExit('GEMINI_API_KEY is required for the gemini engine')
        model = args.model or teacher['model']
        data = gemini_take(script, teacher, model, key)
        info = {'engine': 'gemini', 'model': model, 'voice': teacher['voice'], 'digest': digest}
    else:
        data = kokoro_take(script)
        info = {'engine': 'kokoro', 'model': 'kokoro', 'voice': 'af_heart', 'digest': digest}
    take.write_bytes(data)
    meta.write_text(json.dumps(info))
    return take, info


def keep_take(lesson_id, voice, timing, vtt):
    """Store the finished voice, timing and captions in the repository: a take cannot be reproduced."""
    TAKES.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(voice), '-c:a', 'libopus', '-b:a', '56k', '-ac', '1', str(TAKES / f'{lesson_id}.voice.ogg')], check=True)
    (TAKES / f'{lesson_id}.timing.json').write_text(json.dumps(timing))
    (TAKES / f'{lesson_id}.vtt').write_text(vtt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lesson')
    ap.add_argument('--retake', action='store_true')
    ap.add_argument('--engine', default='gemini', choices=['gemini', 'kokoro'])
    ap.add_argument('--model')
    ap.add_argument('--accept', action='store_true', help='keep a take below the match bar after listening to it')
    args = ap.parse_args()
    script = lesson_script(args.lesson)
    teacher = script['teacher']
    home = CACHE / args.lesson
    home.mkdir(parents=True, exist_ok=True)
    take_path, info = record(args.lesson, script, teacher, args, home)
    pcm = load_pcm(take_path)
    heard = transcribe(pcm)
    all_tokens, ranges = [], []
    for beat in script['beats']:
        toks = tokens_of(beat['say'])
        ranges.append((len(all_tokens), len(all_tokens) + len(toks)))
        all_tokens += toks
    timed, match, extra, extra_words, dropped = align(all_tokens, heard)
    print(f'{args.lesson}: take {len(pcm) / RATE:.1f}s, {len(all_tokens)} words, matched {match:.0%}, {extra} extra heard', flush=True)
    if extra_words or dropped:
        print(f'  heard but not in the script: {extra_words}\n  in the script but not clearly heard: {dropped}', flush=True)
    gap = longest_gap(timed)
    if gap >= 4:
        print(f'  longest run of unplaced words: {gap}', flush=True)
    if (match < MIN_MATCH or gap > MAX_UNHEARD_RUN or extra > max(4, SKIP_WORDS * len(all_tokens))) and not args.accept:
        (home / f'take-{args.engine}.json').unlink(missing_ok=True)
        raise SystemExit(f'take refused: it does not match the script. Heard: {" ".join(h["w"].strip() for h in heard)[:900]}')
    beats = [{'tokens': timed[a:b]} for a, b in ranges]
    track, duration = splice(pcm, beats, script)
    voice = home / f'voice-{args.engine}.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-', '-c:a', 'pcm_s16le', str(voice)],
                   input=track.tobytes(), check=True)
    spread, median = voice_check(track)
    mouth_o, mouth_c = mouth_tracks(track, duration)
    timing = {'lesson': args.lesson, 'fps': FPS, 'duration': round(duration, 3), 'voice': info,
              'check': {'wordMatch': round(match, 3), 'longestUnplacedRun': gap, 'extraHeard': extra, 'extraWords': extra_words, 'notHeard': dropped, 'pitchSpreadSemitones': round(spread, 1), 'medianPitchHz': round(median, 1)},
              'mouthO': mouth_o, 'mouthC': mouth_c, 'beats': []}
    for beat in beats:
        words = [{'w': t['w'], 'raw': t['raw'], 't0': round(t['t0'], 3), 't1': round(t['t1'], 3)} for t in beat['tokens']]
        cues = {name: round(t['t0'], 3) for t in beat['tokens'] for name in t['cues']}
        timing['beats'].append({'start': words[0]['t0'], 'end': words[-1]['t1'], 'cues': cues, 'words': words})
    (home / f'timing-{args.engine}.json').write_text(json.dumps(timing))
    (home / f'captions-{args.engine}.vtt').write_text(captions(beats))
    if args.engine == 'gemini':
        keep_take(args.lesson, voice, timing, captions(beats))
    print(f'{args.lesson}: final {duration:.1f}s, pitch spread {spread:.1f} semitones, engine {info["engine"]} {info["model"]} {info["voice"]}', flush=True)


if __name__ == '__main__':
    main()
