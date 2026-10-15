"""Prepare a NEW owned runtime from original hash-pinned dependencies.

Default is offline and refuses absent artifacts. --allow-download is explicit.
No system installation, source modification, or fallback renderer.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import venv

HERE = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--typst-archive')
    parser.add_argument('--wheel-dir')
    parser.add_argument('--allow-download', action='store_true')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if root.exists(): raise SystemExit('Refusing an existing runtime root; supply a new exclusively owned directory.')
    lock = json.loads((HERE / 'source-lock.json').read_text())
    if not args.allow_download and (not args.typst_archive or not args.wheel_dir):
        raise SystemExit('Offline preparation requires --typst-archive and --wheel-dir with the exact original artifacts.')
    root.mkdir(mode=0o700, parents=True)
    try:
        archive = Path(args.typst_archive) if args.typst_archive else root / 'typst.tar.xz'
        if not args.typst_archive:
            with urllib.request.urlopen(lock['typst']['archiveUrl'], timeout=60) as response, archive.open('xb') as output:
                size = 0
                while block := response.read(65536):
                    size += len(block)
                    if size > 32 * 1024 * 1024: raise ValueError('Typst archive size limit')
                    output.write(block)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != lock['typst']['archiveSha256']:
            raise ValueError('Typst original archive hash mismatch')
        binary = root / 'typst'
        with tarfile.open(archive, 'r:xz') as packed:
            matches = [member for member in packed.getmembers() if member.name.endswith('/typst') and member.isfile()]
            if len(matches) != 1 or matches[0].size > 64 * 1024 * 1024: raise ValueError('Unexpected Typst archive binary')
            # Read only the explicitly named ordinary file; never extract paths.
            with packed.extractfile(matches[0]) as source, binary.open('xb') as output: shutil.copyfileobj(source, output)
        if hashlib.sha256(binary.read_bytes()).hexdigest() != lock['typst']['binarySha256']:
            raise ValueError('Typst binary hash mismatch')
        binary.chmod(0o555)
        for font in lock['fonts']:
            if hashlib.sha256((HERE / 'fonts' / font['file']).read_bytes()).hexdigest() != font['sha256']:
                raise ValueError('Pinned font source hash mismatch')
        python_root = root / 'python'
        # Ambient pip target/prefix/config must never redirect writes outside this
        # newly owned runtime. Isolated Python also refuses injected module paths.
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith('PIP_') and key not in ('PYTHONPATH', 'PYTHONHOME')}
        # --isolated alone still reads global/site configuration; devnull disables
        # all configuration files. Explicit CLI locations remain authoritative.
        environment['PIP_CONFIG_FILE'] = os.devnull
        temporary = root / 'tmp'
        temporary.mkdir(mode=0o700)
        environment['TMPDIR'] = str(temporary)
        venv.create(python_root, with_pip=False)
        python = python_root / 'bin' / 'python'
        subprocess.run([str(python), '-I', '-B', '-m', 'ensurepip', '--upgrade', '--default-pip'],
                       env=environment, check=True, timeout=120, stdout=subprocess.DEVNULL)
        command = [str(python), '-I', '-B', '-m', 'pip', '--isolated', '--disable-pip-version-check',
                   'install', '--prefix', str(python_root), '--no-user', '--no-cache-dir',
                   '--require-hashes', '--no-deps', '--only-binary=:all:', '-r', str(HERE / 'requirements.txt')]
        if args.wheel_dir:
            command.extend(['--no-index', '--find-links', str(Path(args.wheel_dir).resolve())])
        else:
            command.extend(['--index-url', 'https://pypi.org/simple'])
        subprocess.run(command, env=environment, check=True, timeout=120, stdout=subprocess.DEVNULL)
        subprocess.run([str(python), '-I', '-B', '-c',
                        "import sys,pypdf; from pathlib import Path; "
                        "assert pypdf.__version__ == '6.20.1'; "
                        "assert Path(sys.prefix).resolve() == Path(sys.argv[1]); "
                        "assert Path(pypdf.__file__).resolve().is_relative_to(Path(sys.argv[1]))", str(python_root)],
                       env=environment, check=True, timeout=30)
        version = subprocess.check_output([str(binary), '--version'], env=environment, text=True, timeout=30).strip()
        if version != 'typst 0.15.1 (9dfd3a08)': raise ValueError('Typst version mismatch')
        receipt = {'version': 1, 'typst': str(binary), 'python': str(python), 'binarySha256': lock['typst']['binarySha256'],
                   'typstVersion': version, 'pypdfVersion': '6.20.1', 'fonts': [font['sha256'] for font in lock['fonts']]}
        (root / 'runtime-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt))
    except BaseException:
        # Only this newly created, exclusively owned runtime is removed.
        shutil.rmtree(root)
        raise

if __name__ == '__main__': main()
