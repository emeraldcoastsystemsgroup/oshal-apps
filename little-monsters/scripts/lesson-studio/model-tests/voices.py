#!/usr/bin/env python3
"""Local voices for one lesson: Kokoro voices measured, Qwen3-TTS and VoxCPM2 takes, and the shared lesson text.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Local voice candidates for a lesson: every English Kokoro voice voiced and measured; one-call takes from Qwen3-TTS VoiceDesign and VoxCPM2 voice design, each run in its own Python environment with the official PyTorch CUDA 13 wheels (no third-party image), 2026-11-02

Usage:
  python3 voices.py kokoro <lesson> --out <dir>                       every English Kokoro voice, measured (studio Python)
  python3 voices.py qwen3 <lesson> --describe "<voice>" --out <wav>   one take (a Python with torch and qwen-tts)
  python3 voices.py voxcpm2 <lesson> --describe "<voice>" --out <wav> one take (a Python with torch and voxcpm>=2.0.2)

A take is then registered with register_take.py and timed with narrate.py like any rehearsal take.
"""
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parent
KOKORO = 'http://127.0.0.1:8880'


def lesson_text(lesson_id):
    """The words of a lesson as one passage, the way narrate.py hands them to Kokoro: no cues, no delivery tags."""
    script = json.loads(subprocess.check_output(['node', str(STUDIO / 'lessons-json.cjs'), lesson_id], text=True))
    lines = [re.sub(r'\s+', ' ', re.sub(r'\{\w+\}', '', b['say'])).strip() for b in script['beats']]
    return ' '.join(re.sub(r'\[[^\]]*\]\s*', '', line) for line in lines)


def kokoro(lesson_id, out):
    """Voice the lesson with every English Kokoro voice and measure each take's pitch movement."""
    sys.path.insert(0, str(HERE))
    from robust_pitch import robust
    text = lesson_text(lesson_id)
    listed = json.load(urllib.request.urlopen(KOKORO + '/v1/audio/voices', timeout=30))
    names = sorted(v if isinstance(v, str) else v['id'] for v in listed.get('voices', listed))
    rows = []
    for name in [n for n in names if n[:2] in ('af', 'am', 'bf', 'bm')]:
        wav = out / f'{name}.wav'
        body = {'model': 'kokoro', 'input': text, 'voice': name, 'response_format': 'wav'}
        req = urllib.request.Request(KOKORO + '/v1/audio/speech', json.dumps(body).encode(), {'content-type': 'application/json'})
        wav.write_bytes(urllib.request.urlopen(req, timeout=300).read())
        rows.append({'voice': name, **(robust(wav) or {})})
        print(json.dumps(rows[-1]), flush=True)
    (out / 'voices.json').write_text(json.dumps(rows, indent=1))


def save(out, wav, rate, started):
    """Write a take and report its length, speed and peak GPU memory."""
    import numpy as np
    import soundfile as sf
    import torch
    wav = np.asarray(wav, dtype=np.float32).reshape(-1)
    sf.write(str(out), wav, rate)
    secs = len(wav) / rate
    took = time.time() - started
    print(f'{out}: {secs:.1f} s of audio in {took:.0f} s ({took / secs:.2f} s per second), peak GPU {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB', flush=True)


def qwen3(lesson_id, describe, out):
    """One Qwen3-TTS VoiceDesign take of the whole lesson, so the designed voice stays the same throughout."""
    import torch
    from qwen_tts import Qwen3TTSModel
    model = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')
    started = time.time()
    wavs, rate = model.generate_voice_design(text=lesson_text(lesson_id), instruct=describe, language='English', do_sample=True, temperature=0.9, max_new_tokens=4096)
    save(out, wavs[0], rate, started)


def voxcpm2(lesson_id, describe, out):
    """One VoxCPM2 voice-design take: the description goes in parentheses before the words."""
    from voxcpm import VoxCPM
    model = VoxCPM.from_pretrained('openbmb/VoxCPM2', load_denoiser=False)
    rate = getattr(getattr(model, 'tts_model', None), 'sample_rate', None) or 48000
    started = time.time()
    wav = model.generate(text=f'({describe}){lesson_text(lesson_id)}', cfg_value=2.5, inference_timesteps=15, max_len=4096)
    save(out, wav, rate, started)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('engine', choices=['kokoro', 'qwen3', 'voxcpm2'])
    ap.add_argument('lesson')
    ap.add_argument('--describe', default='', help='voice description for qwen3 and voxcpm2')
    ap.add_argument('--out', required=True, help='a folder for kokoro, a .wav file for the others')
    args = ap.parse_args()
    out = Path(args.out)
    if args.engine == 'kokoro':
        out.mkdir(parents=True, exist_ok=True)
        kokoro(args.lesson, out)
    elif args.engine == 'qwen3':
        qwen3(args.lesson, args.describe, out)
    else:
        voxcpm2(args.lesson, args.describe, out)


if __name__ == '__main__':
    main()
