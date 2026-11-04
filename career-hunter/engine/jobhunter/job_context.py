# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep selected employer descriptions in the original owner's private generation when the shared corpus is read-only, bound to the exact listing and reused by scoring, documents and interview preparation.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Expire and revalidate bounded employer evidence, bind all relevant listing facts, and retain authoritative complete replacements without silent clipping.
# 3 | maintainer@emeraldcoastsystemsgroup.com | A saved copy no longer expires after a day: it stays until the pull sees the listing change, so scoring re-reads only what changed. A person's action still rechecks an old copy once, and keeps it when the employer refuses.
"""Owner-private employer context; never writes or substitutes a shared posting."""
from __future__ import annotations
import datetime
import hashlib
import json
import math
import os
import re
import stat
import threading
import uuid
from . import config, db

LIMIT = 384 * 1024
MAX_CHARS = 64000
MAX_ENTRIES = 1000
TTL_SECONDS = 24 * 60 * 60
VERSION = 2
_LOCK = threading.Lock()


def _hash(text):
    try:
        return hashlib.sha256(text.encode('utf-8')).hexdigest()
    except UnicodeError as error:
        raise ValueError('job_context_unavailable') from error


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return (result or 0) if math.isfinite(result) else None


def snapshot(row):
    # Exclude observation times, private workflow/AI signals and AI-estimated pay.
    # These fields describe the listing to which an employer detail response belongs.
    text_fields = {'atsJobId': 'ats_job_id', 'title': 'title', 'url': 'url',
                   'location': 'location', 'department': 'department', 'jobType': 'job_type',
                   'postedAt': 'posted_at', 'postedDate': 'posted_date', 'state': 'state', 'city': 'city'}
    result = {'postingId': int(row['id']), 'companyId': int(row['company_id'])}
    result.update((key, str(row.get(field) or '')) for key, field in text_fields.items())
    result.update(remote=bool(row.get('remote')), lat=_number(row.get('lat')), lon=_number(row.get('lon')),
                  listingSha256=_hash(str(row.get('description') or '')))
    listed = row.get('salary_source') != 'ai_estimated'
    for field in ('salary_min', 'salary_max', 'salary_currency', 'salary_period', 'salary_raw'):
        value = row.get(field) if listed else None
        result[field] = _number(value) if field in ('salary_min', 'salary_max') else str(value or '')
    return result


def _path(row):
    if type(row.get('id')) is not int or not 0 < row['id'] <= 999999999999999:
        raise ValueError('invalid_posting')
    directory = config.DATA_DIR / 'job-context'
    if directory.is_symlink():
        raise ValueError('job_context_unavailable')
    return directory / f"{row['id']}.json"


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _age(value):
    """Seconds since this copy was retrieved; None for an unreadable or future stamp."""
    try:
        stamp = value['retrievedAt']
        if not isinstance(stamp, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', stamp):
            return None
        then = datetime.datetime.fromisoformat(stamp[:-1] + '+00:00')
        age = (_now() - then).total_seconds()
        return age if age >= 0 else None
    except (KeyError, TypeError, ValueError):
        return None


def _fresh(value):
    age = _age(value)
    return age is not None and age < TTL_SECONDS


def _load(path):
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > LIMIT:
        raise ValueError('job_context_unavailable')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        description = value.get('description') if isinstance(value, dict) else None
        if (not isinstance(description, str) or not description.strip() or len(description) > MAX_CHARS
                or value.get('descriptionSha256') != _hash(description)):
            raise ValueError('job_context_unavailable')
        if value.get('version') == VERSION and (not isinstance(value.get('snapshot'), dict)
                or value.get('basis') != 'employer-detail'
                or value.get('truncated') is not False or type(value.get('sourceChars')) is not int
                or value['sourceChars'] != len(description) or type(value.get('sourceBytes')) is not int
                or value['sourceBytes'] != len(description.encode('utf-8'))):
            raise ValueError('job_context_unavailable')
        return value
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('job_context_unavailable') from error


def _bound_snapshot(row, value):
    result = snapshot(row)
    context = row.get('description_context') or {}
    # ensure()/apply() may be called again by preparation. Reuse the original listing
    # binding only when the current body and provenance both match this exact cache.
    if (value and value.get('version') == VERSION and isinstance(context, dict)
            and context.get('descriptionSha256') == value['descriptionSha256'] == result['listingSha256']
            and context.get('listingSha256') == (value.get('snapshot') or {}).get('listingSha256')):
        result['listingSha256'] = context['listingSha256']
    return result


def read(row):
    """The saved copy for this exact listing, however old: age alone never takes a job's details away."""
    value = _load(_path(row))
    if (not value or value.get('version') != VERSION or _age(value) is None
            or value.get('snapshot') != _bound_snapshot(row, value)):
        return None
    return value


def needs_refresh(row):
    """An existing legacy or changed-listing cache must be revalidated.

    A missing cache alone does not invalidate an unchanged listing-only score.
    """
    path = _path(row)
    return (path.exists() or path.is_symlink()) and read(row) is None


def _reclaim(directory):
    # Reclaim only expired, validated derived cache files in this owner's directory.
    # Suspicious paths and historical application packets are never removed here.
    for path in directory.glob('*.json'):
        if not path.stem.isascii() or not path.stem.isdigit():
            continue
        try:
            value = _load(path)
            if value and value.get('version') in (1, VERSION) and not _fresh(value):
                path.unlink()
        except (OSError, ValueError):
            continue


def remember(row, fetched):
    description = fetched.get('description') if isinstance(fetched, dict) else None
    if not isinstance(description, str) or not description.strip():
        return None
    if len(description) > MAX_CHARS:
        raise ValueError('job_context_too_large')
    digest = _hash(description)
    path = _path(row)
    path.parent.mkdir(mode=0o700, exist_ok=True)
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise ValueError('job_context_unavailable')
    with _LOCK:
        old = _load(path)
        value = {'version': VERSION, 'snapshot': _bound_snapshot(row, old), 'description': description,
                 'descriptionSha256': digest, 'retrievedAt': _now().isoformat().replace('+00:00', 'Z'),
                 'basis': 'employer-detail', 'sourceChars': len(description),
                 'sourceBytes': len(description.encode('utf-8')), 'truncated': False}
        rendered = json.dumps(value, ensure_ascii=False)
        if len(rendered.encode('utf-8')) > LIMIT:
            raise ValueError('job_context_too_large')
        if old is None and sum(1 for _ in path.parent.glob('*.json')) >= MAX_ENTRIES:
            _reclaim(path.parent)
            if sum(1 for _ in path.parent.glob('*.json')) >= MAX_ENTRIES:
                raise ValueError('job_context_limit_reached')
        temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('x', encoding='utf-8') as stream:
                os.chmod(temporary, 0o600)
                stream.write(rendered)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return value


def _apply(row, saved):
    row = dict(row)
    if saved:
        row['description'] = saved['description']
        row['description_context'] = {key: saved[key] for key in
            ('basis', 'retrievedAt', 'descriptionSha256', 'sourceChars', 'sourceBytes', 'truncated')}
        row['description_context']['listingSha256'] = saved['snapshot']['listingSha256']
    return row


def apply(row):
    return _apply(row, read(row))


def hydrate(row, company=None, *, recheck=False):
    """Hydrate a short or changed listing, with at most one employer GET.

    A saved copy is reused without a request until the pull sees its listing change. `recheck` is
    for a person about to rely on the text: an old copy gets one GET, and the copy stands if the
    employer refuses. A successful employer response is authoritative even when shorter. A changed
    listing the employer refuses preserves the previous file and refuses to treat that old body as
    this listing's.
    """
    saved = read(row)
    resolved = _apply(row, saved)
    path = _path(row)
    due = saved is None and (path.exists() or path.is_symlink())
    if saved and not (recheck and not _fresh(saved)):
        return resolved, None
    if not saved and not due and len(resolved.get('description') or '') >= 1000:
        return resolved, None
    if company is None:
        with db.connect() as conn:
            company = conn.execute(f'SELECT ats_type,ats_token FROM {db.companies_table()} WHERE id=?',
                                   (row['company_id'],)).fetchone()
    from . import detail
    fetched = detail.fetch(company['ats_type'], company['ats_token'], row.get('ats_job_id'), row.get('url')) if company else {}
    if isinstance(fetched.get('description'), str) and fetched['description'].strip():
        saved = remember(row, fetched)
        return _apply(row, saved), {**fetched, 'description': saved['description']}
    if saved:
        return resolved, None
    if due or not (resolved.get('description') or '').strip():
        raise ValueError('job_details_unavailable')
    if len(resolved['description']) < 1000:
        resolved['description_context'] = {'basis': 'listing-summary', 'retrievedAt': None,
            'descriptionSha256': _hash(resolved['description'])}
    return resolved, None


def ensure(row):
    return hydrate(row, recheck=True)[0]
