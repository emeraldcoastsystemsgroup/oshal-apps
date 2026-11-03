#!/usr/bin/env python3
"""Put the lesson videos in an installation's lasting storage for Little Monsters.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Copies each video, checked against the manifest, into the package's lasting directory under the name the media route asks for; a video that is already right is left alone

Every package file is copied into every person's sandbox and every dependent's, so the videos do
not travel in the package. They live in the repository's .videos folder, which is left out of the
export and of git archive, and this copies one of each to where the kernel streams them from.

Run it before reloading a package that has new videos, and with --prune afterward.

Usage: install-videos.py --data <OSHAL_PACKAGE_DATA_DIR>/little-monsters [--videos dir] [--prune]
"""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def install(lesson, sha256, videos, folder):
    """Copy one video in whole or not at all. Returns True when it wrote the file."""
    target = folder / f'{lesson}-{sha256[:16]}.mp4'
    if target.is_file() and digest(target) == sha256:
        return False
    source = videos / f'{lesson}.mp4'
    if digest(source) != sha256:
        raise SystemExit(f'{source} does not match the manifest: it is not the video that was filmed')
    with tempfile.NamedTemporaryFile(dir=folder, prefix=f'.{lesson}-', delete=False) as out, open(source, 'rb') as src:
        partial = Path(out.name)
        while chunk := src.read(1 << 20):
            out.write(chunk)
    try:
        if digest(partial) != sha256:
            raise SystemExit(f'copy of {source} came out different')
        os.chmod(partial, 0o600)
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, type=Path, help="the package's lasting directory")
    ap.add_argument('--videos', type=Path, default=PACKAGE / '.videos')
    ap.add_argument('--manifest', type=Path, default=PACKAGE / 'tools/prep-media/manifest.json')
    ap.add_argument('--prune', action='store_true', help='remove videos the manifest no longer names')
    args = ap.parse_args()
    if not args.data.is_dir():
        raise SystemExit(f'{args.data} is not a directory: use the lasting directory of little-monsters')
    lessons = json.loads(args.manifest.read_text())['lessons']
    folder = args.data / 'prep-media'
    folder.mkdir(exist_ok=True)
    wrote = sum(install(lesson, entry['sha256'], args.videos, folder) for lesson, entry in lessons.items())
    wanted = {f'{lesson}-{entry["sha256"][:16]}.mp4' for lesson, entry in lessons.items()}
    removed = 0
    if args.prune:
        for path in folder.iterdir():
            if re.fullmatch(r'[a-z0-9-]+-[0-9a-f]{16}\.mp4', path.name) and path.name not in wanted:
                path.unlink()
                removed += 1
    size = sum((folder / name).stat().st_size for name in wanted)
    print(f'{len(wanted)} lesson videos in {folder} ({size / 1048576:.0f} MB): {wrote} copied, {removed} removed')


if __name__ == '__main__':
    sys.exit(main())
