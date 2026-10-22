#!/usr/bin/env python3
"""Fetch only the reviewed, hash-pinned research samples into a local cache.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve dataset provenance, upstream notices and original bytes without shipping research data in the product.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def prepare(cache, fetch=urllib.request.urlopen):
    registry = json.loads((ROOT/'lab/datasets.json').read_text())
    results = []
    for dataset in registry['datasets']:
        folder = cache/dataset['id']/dataset['revision']
        for item in dataset['files']:
            target = folder/item['path']
            if target.exists():
                data = target.read_bytes()
            else:
                with fetch(item['url'], timeout=30) as response:
                    data = response.read(item['bytes']+1)
            if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Dataset bytes differ from the reviewed manifest: '+item['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                temporary = target.with_suffix(target.suffix+'.partial')
                temporary.write_bytes(data)
                temporary.replace(target)
            results.append({'dataset': dataset['id'], **item})
    receipt = {'kind': 'verified-dataset-cache', 'files': results,
               'totalBytes': sum(item['bytes'] for item in results),
               'evaluationPerformed': False, 'redistributedWithApplication': False}
    cache.mkdir(parents=True, exist_ok=True)
    (cache/'prepared.json').write_text(json.dumps(receipt, indent=2)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path.home()/'.cache/triagenorth/datasets')
    args = parser.parse_args()
    receipt = prepare(args.cache)
    print(json.dumps({'files': len(receipt['files']), 'bytes': receipt['totalBytes'],
                      'cache': str(args.cache), 'evaluationPerformed': False}))
