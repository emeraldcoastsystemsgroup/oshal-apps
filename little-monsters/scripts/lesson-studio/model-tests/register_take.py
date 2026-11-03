#!/usr/bin/env python3
"""Hand a take from another voice engine to narrate.py as the rehearsal take of a lesson.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Registers an outside take (Qwen3-TTS, VoxCPM2) in a lesson cache under the rehearsal engine, with the digest narrate.py checks, so narrate.py times and splices it and render.mjs films it; the rehearsal label keeps such a video out of publishing, because the guards refuse a manifest that names it

Usage:
  python3 register_take.py <lesson> <take audio> --cache <dir> --label voxcpm2
  LESSON_CACHE=<dir> python3 ../narrate.py <lesson> --engine kokoro
  LESSON_CACHE=<dir> node ../render.mjs <lesson> --engine kokoro --out <dir> --small <dir>
Run it with the studio's Python (numpy).
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

STUDIO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(STUDIO))
import narrate  # noqa: E402  (the studio's own digest and direction, so the take matches what narrate.py expects)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lesson')
    ap.add_argument('take')
    ap.add_argument('--cache', required=True)
    ap.add_argument('--label', required=True, help='the engine that made the take, kept in the take record')
    args = ap.parse_args()
    script = narrate.lesson_script(args.lesson)
    teacher = script['teacher']
    words = json.dumps([b['say'] for b in script['beats']], ensure_ascii=False)
    digest = hashlib.sha256((words + teacher['voice'] + narrate.direction(teacher)).encode()).hexdigest()
    home = Path(args.cache) / args.lesson
    home.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.take, home / 'take-kokoro.wav')
    (home / 'take-kokoro.json').write_text(json.dumps({'engine': 'kokoro', 'model': args.label, 'voice': f'outside:{args.label}', 'digest': digest}))
    print(f'{args.lesson}: {args.take} registered in {home}; now run narrate.py {args.lesson} --engine kokoro with LESSON_CACHE={args.cache}')


if __name__ == '__main__':
    main()
