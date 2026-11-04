# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Load only the original owner's optional experience, verify exact selected revisions, and preserve the core profile.
"""Additional work evidence selected per application; independent of the core resume."""
from __future__ import annotations
import hashlib
import json
import re
import stat
from . import config

LEGACY = 'saved-portfolio'


def _bytes(path, limit):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return b''
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError('experience_unavailable')
    return path.read_bytes()


def read():
    raw = _bytes(config.DATA_DIR / 'experience-bank.json', 512 * 1024)
    master = _bytes(config.DATA_DIR / 'career_db.json', 4 * 1024 * 1024)
    data = json.loads(raw) if raw else {'version': 1, 'entries': []}
    if data.get('version') != 1 or not isinstance(data.get('entries'), list) or len(data['entries']) > 64:
        raise ValueError('experience_unavailable')
    entries = data['entries']
    if any(not isinstance(e, dict) or not re.fullmatch(r'[A-Za-z0-9-]{8,80}', str(e.get('id', '')))
           or not isinstance(e.get('facts'), str) or len(e['facts']) > 32000
           or not isinstance(e.get('archived'), bool) for e in entries):
        raise ValueError('experience_unavailable')
    if not any(e['id'] == LEGACY for e in entries) and master:
        portfolio = json.loads(master).get('oss_portfolio')
        if isinstance(portfolio, dict) and portfolio:
            detail=portfolio.get('entry') if isinstance(portfolio.get('entry'),dict) else {}
            entries = [{'id': LEGACY, 'title': str(portfolio.get('name') or detail.get('org') or portfolio.get('label') or 'Saved independent work')[:160],
                        'kind': 'project', 'organization': detail.get('org') or 'Independent project', 'period': detail.get('span') or '',
                        'facts': json.dumps(portfolio, ensure_ascii=False, indent=2), 'skills': portfolio.get('skills') if isinstance(portfolio.get('skills'),list) else [],
                        'archived': False, 'source': 'Saved career portfolio'}] + entries
    revision = hashlib.sha256(b'experience-bank/v1\0' + raw + b'\0' + master).hexdigest()
    return {'entries': entries, 'revision': revision}


def selected(ids, revision=''):
    if not isinstance(ids, list) or len(ids) > 12 or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('experience_selection_invalid')
    bank = read()
    if ids and bank['revision'] != revision:
        raise ValueError('experience_selection_changed')
    available = {e['id']: e for e in bank['entries'] if not e['archived']}
    if any(i not in available for i in ids):
        raise ValueError('experience_selection_changed')
    return [available[i] for i in ids]
