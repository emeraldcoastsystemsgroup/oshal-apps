#!/usr/bin/env python3
"""Put the lesson and curriculum videos in an installation's lasting storage for Little Monsters.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Copies each video, checked against the manifest, into the package's lasting directory under the name the media route asks for; a video that is already right is left alone
2   | maintainer@emeraldcoastsystemsgroup.com | Install verified 168-topic curriculum MP4, poster JPG, and caption VTT assets alongside Study Lab lessons while preserving prune safety

Every package file is copied into every person's sandbox and every dependent's, so the videos do
not travel in the package. They live outside the exported package root, and this script installs
verified copies into <OSHAL_PACKAGE_DATA_DIR>/little-monsters/prep-media where the kernel streams them.

Usage:
  install-videos.py --data <OSHAL_PACKAGE_DATA_DIR>/little-monsters [--videos dir] [--prune]
  install-videos.py --data <OSHAL_PACKAGE_DATA_DIR>/little-monsters --curriculum-sources verified.json [--hardlink]
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


def atomic_place(source, target, expected_sha256, folder, prefix, allow_hardlink=False, mode=0o600):
    if target.is_file() and digest(target) == expected_sha256:
        return False
    if not source.is_file() or digest(source) != expected_sha256:
        raise SystemExit(f'{source} does not match the manifest: it is not the video that was filmed')
    if allow_hardlink:
        try:
            temp_link = folder / f'.link-{prefix}-{os.getpid()}'
            temp_link.unlink(missing_ok=True)
            os.link(source, temp_link)
            os.replace(temp_link, target)
            return True
        except OSError:
            pass
    with tempfile.NamedTemporaryFile(dir=folder, prefix=f'.{prefix}-', delete=False) as out, open(source, 'rb') as src:
        partial = Path(out.name)
        while chunk := src.read(1 << 20):
            out.write(chunk)
    try:
        if digest(partial) != expected_sha256:
            raise SystemExit(f'copy of {source} came out different')
        os.chmod(partial, mode)
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)
    return True


def install(lesson, sha256, videos, folder):
    """Copy one Study Lab video in whole or not at all. Returns True when it wrote the file."""
    target = folder / f'{lesson}-{sha256[:16]}.mp4'
    source = videos / f'{lesson}.mp4'
    return atomic_place(source, target, sha256, folder, lesson, allow_hardlink=False)


def iter_topic_variants(topic):
    if isinstance(topic.get('levels'), dict):
        return list(topic['levels'].values())
    return list(topic.get('variants', []))


def install_curriculum(sources_json, curr_manifest_path, folder, allow_hardlink):
    manifest_lessons = json.loads(curr_manifest_path.read_text())['lessons']
    verified = json.loads(sources_json.read_text())
    wrote = 0
    for topic in verified.get('topics', []):
        for variant in iter_topic_variants(topic):
            vid = variant['mediaId']
            spec = manifest_lessons.get(vid)
            if not spec:
                raise SystemExit(f'curriculum mediaId {vid} missing from {curr_manifest_path}')
            mp4_src = Path(variant.get('mp4Source') or variant['mp4Path'])
            jpg_src = Path(variant.get('jpgSource') or variant['jpgPath'])
            vtt_src = Path(variant.get('vttSource') or variant['vttPath'])
            mp4_target = folder / f'{vid}-{spec["sha256"][:16]}.mp4'
            if atomic_place(mp4_src, mp4_target, spec['sha256'], folder, vid, allow_hardlink):
                wrote += 1
            if spec.get('posterSha256'):
                atomic_place(jpg_src, folder / f'{vid}.jpg', spec['posterSha256'], folder, f'{vid}-jpg', allow_hardlink)
            if spec.get('captionsSha256'):
                atomic_place(vtt_src, folder / f'{vid}.vtt', spec['captionsSha256'], folder, f'{vid}-vtt', allow_hardlink)
    return wrote


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, type=Path, help="the package's lasting directory")
    ap.add_argument('--videos', type=Path, default=PACKAGE / '.videos')
    ap.add_argument('--manifest', type=Path, default=PACKAGE / 'tools/prep-media/manifest.json')
    ap.add_argument('--curriculum-manifest', type=Path, default=None)
    ap.add_argument('--curriculum-sources', type=Path, default=None)
    ap.add_argument('--skip-study-lab', action='store_true')
    ap.add_argument('--hardlink', action='store_true')
    ap.add_argument('--prune', action='store_true', help='remove videos the manifest no longer names')
    return ap.parse_args()


def main():
    args = parse_args()
    if not args.data.is_dir():
        raise SystemExit(f'{args.data} is not a directory: use the lasting directory of little-monsters')
    folder = args.data / 'prep-media'
    folder.mkdir(exist_ok=True)
    lessons = json.loads(args.manifest.read_text())['lessons']
    wrote = 0
    if not args.skip_study_lab:
        wrote += sum(install(lesson, entry['sha256'], args.videos, folder) for lesson, entry in lessons.items())
    wanted = {f'{lesson}-{entry["sha256"][:16]}.mp4' for lesson, entry in lessons.items()}
    curr_manifest = args.curriculum_manifest or (args.manifest.parent / 'curriculum-manifest.json')
    if curr_manifest.is_file():
        curr_lessons = json.loads(curr_manifest.read_text()).get('lessons', {})
        wanted |= {f'{cid}-{entry["sha256"][:16]}.mp4' for cid, entry in curr_lessons.items()}
        if args.curriculum_sources:
            wrote += install_curriculum(args.curriculum_sources, curr_manifest, folder, args.hardlink)
    removed = 0
    if args.prune:
        for path in folder.iterdir():
            if re.fullmatch(r'[a-z0-9-]+-[0-9a-f]{16}\.mp4', path.name) and path.name not in wanted:
                path.unlink()
                removed += 1
    present = [name for name in wanted if (folder / name).is_file()]
    size = sum((folder / name).stat().st_size for name in present)
    print(f'{len(present)} lesson videos in {folder} ({size / 1048576:.0f} MB): {wrote} copied, {removed} removed')


if __name__ == '__main__':
    sys.exit(main())
