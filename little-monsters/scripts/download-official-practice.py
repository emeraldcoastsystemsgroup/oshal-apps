"""Fetch the official free PDFs listed in the checked-in resource index into local storage.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verified PDF downloads with provenance, hashes and page counts.
"""
import argparse, hashlib, json, subprocess, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'data/test-prep/official-resources.json'
DEST = ROOT / 'data/test-prep/official-downloads'
ALLOWED = {'satsuite.collegeboard.org', 'www.act.org'}

def fetch(resource, refresh):
    url = resource['url']; filename = resource['localFile']
    if urlparse(url).scheme != 'https' or urlparse(url).hostname not in ALLOWED:
        raise ValueError('Resource is not on an approved publisher host: ' + url)
    target = (DEST / filename).resolve()
    if not target.is_relative_to(DEST.resolve()): raise ValueError('Unsafe file path')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or refresh:
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={'User-Agent':'LittleMonsters-Official-Practice-Downloader/1.0'})
                with urllib.request.urlopen(request, timeout=60) as response:
                    redirect = urlparse(response.geturl())
                    if redirect.scheme != 'https' or redirect.hostname not in ALLOWED: raise ValueError('Unexpected redirect')
                    data = response.read(50*1024*1024+1)
                if not data.startswith(b'%PDF-') or len(data)>50*1024*1024: raise ValueError('Not a supported-size PDF')
                digest = hashlib.sha256(data).hexdigest()
                if resource.get('sha256') and not refresh and digest != resource['sha256']:
                    raise ValueError('Publisher PDF changed; review before using --refresh-index')
                temporary=target.with_suffix('.pdf.part'); temporary.write_bytes(data); temporary.replace(target)
                break
            except Exception:
                if attempt==2: raise
                time.sleep(attempt+1)
    data = target.read_bytes()
    if not data.startswith(b'%PDF-'): raise ValueError('Invalid local PDF: '+filename)
    digest = hashlib.sha256(data).hexdigest()
    if resource.get('sha256') and not refresh and digest != resource['sha256']: raise ValueError('Local checksum mismatch: '+filename)
    info = subprocess.check_output(['pdfinfo',str(target)],text=True)
    pages = next(int(line.split(':',1)[1].strip()) for line in info.splitlines() if line.startswith('Pages:'))
    resource.update(sha256=digest,bytes=len(data),pages=pages)
    # Local-only analysis sidecar; never added to the deployed question bank.
    subprocess.run(['pdftotext','-layout',str(target),str(target.with_suffix('.txt'))],check=True,stderr=subprocess.DEVNULL)
    print(f"{resource['id']}: {pages} pages, {len(data):,} bytes",flush=True)
    return resource

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-index',action='store_true',help='Accept changed PDFs and update their verified hashes after review')
    args=parser.parse_args(); manifest=json.loads(INDEX.read_text())
    with ThreadPoolExecutor(max_workers=4) as workers:
        resources=list(workers.map(lambda r:fetch(r,args.refresh_index),manifest['resources']))
    if args.refresh_index or any(not r.get('sha256') for r in json.loads(INDEX.read_text())['resources']):
        manifest['resources']=resources;INDEX.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    print(f'Verified {len(resources)} official PDFs in {DEST}')
