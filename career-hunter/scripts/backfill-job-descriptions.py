#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16: "there are a bunch of jobs from torch technology that i want to apply for but in the my jobs initial screen the popup says that there is no information about the job"): re-read, once, the descriptions of one employer's open postings that the shared corpus holds none for, from each posting's structured detail (the address and fields lib/career-employer-detail.js and lib/career-job-details.js read), and keep them in the corpus for every person. A dry run reads and prints counts only. The edit follows the corpus maintenance recipe: plan (reads, writes plan.json), prepare (under the pull's lock, an edited copy proven to differ only in those descriptions), publish (atomic rename, old corpus kept as a hard link). Only an empty description is ever filled, so a second run fills nothing it filled before; a refused, closed or empty read leaves the posting as it was.
"""Fill the shared Career corpus's empty descriptions for one employer's open postings, once.

Workday lists carry no description, and the pull's description stage leaves Workday, Oracle Recruiting Cloud and
SmartRecruiters to each person's own reads, so the corpus has none for those jobs (all 889 Torch Technologies postings on
2026-11-16). This reads each one's structured detail once and keeps the text where every person reads it.

Usage (the data root is the native Career root, `~/.local/state/oshal-native/data/career` on production):
    python3 -I career-hunter/scripts/backfill-job-descriptions.py dry-run <root> --company <id> [--company <id> ...]
    python3 -I career-hunter/scripts/backfill-job-descriptions.py plan    <root> <root>/maintenance/<name> --company <id> ...
    python3 -I career-hunter/scripts/backfill-job-descriptions.py prepare <root> <root>/maintenance/<name>
    python3 -I career-hunter/scripts/backfill-job-descriptions.py publish <root> <root>/maintenance/<name>

dry-run  reads each candidate posting once (public addresses only, never redirected or retried) and prints counts. It
         opens the corpus `mode=ro&immutable=1` and writes nothing.
plan     the same reads; writes plan.json (0600) in the maintenance folder with each description it would keep.
prepare  under the pull's own lock (`.corpus-ingest.lock`, refused while a pull runs and refusing one while it runs), copies
         the corpus, fills the planned descriptions that are still empty in one transaction, proves that nothing else
         differs, and writes receipt.json (prepared-not-published). Run it only when the corpus has not changed since plan.
publish  under the same lock, keeps the old corpus as corpus.before.db (a hard link) and renames the edited copy into place,
         as a pull publishes.

Counts printed: employers, candidates (open, no description), noReader (no structured detail address the kernel admits),
read, filled (dry-run and plan: would fill), closed, refused, empty, unavailable, and statuses (how many answers ended with
each status other than 200; "error" is no answer). No posting title or text is printed. Requests to one host are --pace
seconds apart (default 2); a 429 or 5xx answer, or none, is asked again after a pause, at most three times.
"""
from __future__ import annotations

import argparse
import datetime
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1] / 'engine'
os.environ.setdefault('JOBHUNTER_DATA', tempfile.mkdtemp(prefix='career-backfill-'))  # the engine's config makes this folder
sys.path.insert(0, str(ENGINE))
from jobhunter import http, posting_page  # noqa: E402  (the engine's own client and the pull's description text)

ORACLE_HOST = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fa(?:\.us2|\.us6|\.ocs)?\.oraclecloud\.com')
ORACLE_FIELDS = ('ExternalDescriptionStr', 'ExternalResponsibilitiesStr', 'ExternalQualificationsStr',
                 'OrganizationDescriptionStr', 'CorporateDescriptionStr')
SR_SECTIONS = ('jobDescription', 'qualifications', 'additionalInformation', 'companyDescription')
OUTCOMES = ('filled', 'closed', 'refused', 'empty', 'unavailable')
ATTEMPTS = 3
PAUSES = (5, 15)
PACE = 2.0  # seconds between two requests to one host (the engine's own default is 1.0)
FTS = re.compile(r'postings_fts.*')


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def read_only(path: Path) -> str:
    """The URI that opens a database without locks, journals or writes."""
    return 'file:' + urllib.parse.quote(str(path.resolve())) + '?mode=ro&immutable=1'


def attach(path: Path, readonly: bool) -> sqlite3.Connection:
    """The corpus names itself `corpus` in its own views, so it is always attached under that name."""
    conn = sqlite3.connect('file::memory:', uri=True)
    conn.row_factory = sqlite3.Row
    target = read_only(path) if readonly else 'file:' + urllib.parse.quote(str(path.resolve())) + '?mode=rw'
    conn.execute('ATTACH DATABASE ? AS corpus', (target,))
    return conn


def _admitted_workday(url: str) -> bool:
    """lib/career-employer-detail.js workdayDetailUrl: https, no query, the cxs path of one posting, no dot segment."""
    parts = urllib.parse.urlsplit(url)
    host = re.fullmatch(r'([a-z0-9-]+)\.wd[0-9]+\.myworkdayjobs\.com', parts.hostname or '')
    return bool(parts.scheme == 'https' and host and not parts.query and not parts.fragment and not parts.port
                and parts.path.startswith(f'/wday/cxs/{host[1]}/')
                and re.match(r'^/wday/cxs/[^/]+/[A-Za-z0-9_-]+/job/[^/]+/.+', parts.path)
                and not re.search(r'%2e|%2f|%5c|\\', parts.path, re.I)
                and not any(segment in ('.', '..') for segment in parts.path.split('/')))


def addresses(posting: dict, company: dict) -> list[tuple[str, str]]:
    """The structured detail addresses lib/career-job-details.js detailAddresses reads, in its order, without repeats."""
    found: list[tuple[str, str]] = []
    job_id, token, kind = str(posting.get('ats_job_id') or ''), str(company.get('ats_token') or ''), company.get('ats_type')

    def add(reader, address):
        if address and address not in [url for _, url in found]:
            found.append((reader, address))

    link = urllib.parse.urlsplit(str(posting.get('url') or ''))
    host = re.fullmatch(r'([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com', link.hostname or '')
    split = link.path.split('/job/', 1)
    if link.scheme == 'https' and host and len(split) == 2 and not link.username and not link.password:
        site, rest = split[0].strip('/').split('/')[-1], split[1].removesuffix('/apply').rstrip('/')
        candidate = f'https://{host[1]}.{host[2]}.myworkdayjobs.com/wday/cxs/{host[1]}/{site}/job/{rest}'
        if re.fullmatch(r'[A-Za-z0-9_-]+', site) and _admitted_workday(candidate):
            add('workday', candidate)
    if kind == 'workday' and len(token.split(':')) == 3:
        tenant, dc, site = token.split(':')
        candidate = f'https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{job_id}'
        if _admitted_workday(candidate):
            add('workday', candidate)
    if kind == 'oracle_orc':
        backend, site, *_ = (token + '||').split('|')
        if ORACLE_HOST.fullmatch(backend) and re.fullmatch(r'[A-Za-z0-9_-]{1,255}', site) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', job_id):
            add('oracle_orc', f'https://{backend}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails'
                              f'?onlyData=true&finder=ById;Id=%22{job_id}%22,siteNumber={site}')
    if kind == 'smartrecruiters' and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', token) and re.fullmatch(r'[0-9]{1,20}', job_id):
        add('smartrecruiters', f'https://api.smartrecruiters.com/v1/companies/{token}/postings/{job_id}')
    return found


def _obj(value) -> dict:
    return value if isinstance(value, dict) else {}


def describe(kind: str, data, job_id: str) -> tuple[str | None, str]:
    """(description, outcome) from one structured answer: the fields lib/career-job-details.js describe reads."""
    if not isinstance(data, dict):
        return None, 'empty'
    if kind == 'workday':
        text = posting_page.detail_text(_obj(data.get('jobPostingInfo')).get('jobDescription'))
    elif kind == 'oracle_orc':
        items = data.get('items')
        if isinstance(items, list) and not items:
            return None, 'closed'
        item = items[0] if isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict) else None
        if not item or str(item.get('Id')) != job_id:
            return None, 'empty'
        sections = [item.get(field) for field in ORACLE_FIELDS]
        if not any(isinstance(section, str) and section.strip() for section in sections):
            sections = [item.get('ShortDescriptionStr')]
        text = posting_page.detail_text(*sections)
    else:
        if str(data.get('id')) != job_id:
            return None, 'empty'
        sections = _obj(_obj(data.get('jobAd')).get('sections'))
        text = posting_page.detail_text(*[_obj(sections.get(key)).get('text') for key in SR_SECTIONS])
    return (text, 'filled') if text else (None, 'empty')


def _pause(seconds: float) -> None:
    """The wait before asking a rate-limited or failing site again."""
    time.sleep(seconds)


def _get(url: str):
    """One answer for one address: (status, response). A 429 or 5xx answer, or no answer, is asked again after a pause
    (its Retry-After, at most a minute, else 5 then 15 seconds), at most ATTEMPTS times; nothing is ever redirected."""
    status, response = 'error', None
    for attempt in range(ATTEMPTS):
        http._throttle(url)
        try:
            with http.public_only():
                response = http._session.get(url, timeout=20, allow_redirects=False, headers={'Accept': 'application/json'})
            status = response.status_code
        except (http.requests.RequestException, OSError):  # no connection, a private address, a timeout: nothing is kept
            status, response = 'error', None
        if status != 'error' and status != 429 and status < 500 or attempt == ATTEMPTS - 1:
            break
        after = response.headers.get('Retry-After', '') if response is not None else ''
        _pause(min(int(after), 60) if after.isdigit() else PAUSES[attempt])
    return status, response


def read_one(posting: dict, company: dict) -> tuple[str | None, str, str | int | None]:
    """(description, outcome, status of the last answer): at most the two addresses, public addresses only, never
    redirected; a rate-limited or failed answer is asked again (_get), anything else is final."""
    found = addresses(posting, company)
    if not found:
        return None, 'no-reader', None
    first = None
    for kind, url in found:
        status, response = _get(url)
        if status == 200:
            try:
                outcome = (*describe(kind, response.json(), str(posting.get('ats_job_id') or '')), status)
            except ValueError:
                outcome = (None, 'empty', status)
        elif status in (404, 410):
            outcome = (None, 'closed', status)
        elif status == 'error' or status == 429 or status >= 500:
            outcome = (None, 'unavailable', status)
        else:
            outcome = (None, 'refused', status)
        if outcome[0]:
            return outcome
        first = first or outcome
    return first


def candidates(conn: sqlite3.Connection, companies: list[int]) -> list[dict]:
    """The named employers' open postings with no description, in id order, with each employer's source."""
    marks = ','.join('?' * len(companies))
    return [dict(row) for row in conn.execute(
        f"""SELECT p.id, p.company_id, p.ats_job_id, p.url, c.ats_type, c.ats_token FROM corpus.postings_corpus p
            JOIN corpus.companies c ON c.id=p.company_id
            WHERE p.company_id IN ({marks}) AND p.active=1 AND TRIM(COALESCE(p.description,''))=''
            ORDER BY p.id""", companies).fetchall()]


def survey(source: Path, companies: list[int]) -> tuple[dict, list[dict]]:
    """Read every candidate once. Returns (counts, fills); a fill is {id, companyId, atsJobId, description, sha256}."""
    conn = attach(source, readonly=True)
    try:
        rows = candidates(conn, companies)
    finally:
        conn.close()
    counts = {'employers': len(companies), 'candidates': len(rows), 'noReader': 0, 'read': 0, **{key: 0 for key in OUTCOMES},
              'statuses': {}}
    fills = []
    for row in rows:
        text, outcome, status = read_one(row, {'ats_type': row['ats_type'], 'ats_token': row['ats_token']})
        if outcome == 'no-reader':
            counts['noReader'] += 1
            continue
        counts['read'] += 1
        counts[outcome] += 1
        if status != 200:
            counts['statuses'][str(status)] = counts['statuses'].get(str(status), 0) + 1
        if counts['read'] % 25 == 0:  # counts only, on stderr, so a long run shows it is moving
            print(json.dumps({'progress': counts['read'] + counts['noReader'], 'of': len(rows), 'filled': counts['filled']}),
                  file=sys.stderr, flush=True)
        if text:
            fills.append({'id': row['id'], 'companyId': row['company_id'], 'atsJobId': str(row['ats_job_id']),
                          'description': text, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()})
    return counts, fills


def source_stat(source: Path) -> dict:
    info = source.stat()
    return {'dev': info.st_dev, 'ino': info.st_ino, 'size': info.st_size, 'mtime_ns': info.st_mtime_ns}


def sync_dir(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def acl(path: Path) -> list[str]:
    """The file's access list as getfacl prints it (the kernel and the test slot read the corpus through it)."""
    if not shutil.which('getfacl'):
        return []
    out = subprocess.run(['getfacl', '-p', '-c', str(path)], check=True, capture_output=True, text=True).stdout
    return sorted(line for line in out.splitlines() if line.strip())


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_private(path: Path, value: dict) -> None:
    """A 0600 JSON record, written whole and synced."""
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        os.chmod(temporary, 0o600)
        stream.write(json.dumps(value, indent=1, ensure_ascii=False) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    sync_dir(path.parent)


def plan(root: Path, folder: Path, companies: list[int]) -> dict:
    """Read the candidates and record what prepare would keep; the corpus is not written."""
    source = root / 'corpus.db'
    before = source_stat(source)
    counts, fills = survey(source, companies)
    if source_stat(source) != before:
        raise SystemExit('the corpus was published again during the reads; plan again')
    folder.mkdir(mode=0o700, parents=False, exist_ok=True)
    write_private(folder / 'plan.json', {'version': 1, 'createdAt': now(), 'source': str(source), 'source_stat': before,
                                         'companies': companies, 'counts': counts, 'fills': fills})
    return counts


def table_counts(conn: sqlite3.Connection) -> dict:
    names = [row[0] for row in conn.execute("SELECT name FROM corpus.sqlite_master WHERE type='table' ORDER BY name")]
    return {name: conn.execute(f'SELECT count(*) FROM corpus."{name}"').fetchone()[0] for name in names if not FTS.fullmatch(name)}


def schema(conn: sqlite3.Connection) -> list:
    return [tuple(row) for row in conn.execute('SELECT type,name,tbl_name,sql FROM corpus.sqlite_master ORDER BY type,name')]


def planned_rows(conn: sqlite3.Connection, fills: list[dict]) -> dict:
    marks = ','.join('?' * len(fills))
    return {row['id']: dict(row) for row in conn.execute(
        f'SELECT * FROM corpus.postings_corpus WHERE id IN ({marks})', [fill['id'] for fill in fills])}


def fill(conn: sqlite3.Connection, fills: list[dict]) -> list[int]:
    """Keep each planned description where the posting is the planned one and still has none. Returns the ids filled."""
    filled = []
    conn.execute('BEGIN IMMEDIATE')
    for item in fills:
        done = conn.execute("""UPDATE corpus.postings_corpus SET description=? WHERE id=? AND company_id=? AND ats_job_id=?
            AND TRIM(COALESCE(description,''))=''""", (item['description'], item['id'], item['companyId'], item['atsJobId']))
        if done.rowcount == 1:
            filled.append(item['id'])
    conn.commit()
    return filled


def verify(before: dict, after: dict, fills: list[dict], filled: list[int]) -> None:
    """Every planned row is as it was, apart from the description of a row filled, which is the planned text."""
    wanted = {item['id']: item['description'] for item in fills}
    for posting_id, row in before.items():
        expected = dict(row, description=wanted[posting_id]) if posting_id in filled else row
        if after.get(posting_id) != expected:
            raise SystemExit(f'posting {posting_id} differs from the plan; nothing published')


def prepare(root: Path, folder: Path, record: dict) -> dict:
    """Copy the corpus, fill the planned descriptions in the copy, prove nothing else changed, and write the receipt."""
    source, candidate, receipt = root / 'corpus.db', folder / 'corpus.next.db', folder / 'receipt.json'
    if candidate.exists() or receipt.exists():
        raise SystemExit('this folder was prepared already; use a new maintenance folder')
    if not record['fills']:
        return {'status': 'nothing-to-fill', 'filled': 0}
    subprocess.run(['cp', '--reflink=auto', '--preserve=mode,timestamps', '--', str(source), str(candidate)], check=True)
    if acl(candidate) != acl(source):
        raise SystemExit('the copy lost the corpus access list; nothing published')
    old = attach(source, readonly=True)
    before_rows, before_counts, before_schema = planned_rows(old, record['fills']), table_counts(old), schema(old)
    old.close()
    conn = attach(candidate, readonly=False)
    try:
        filled = fill(conn, record['fills'])
        verify(before_rows, planned_rows(conn, record['fills']), record['fills'], filled)
        if schema(conn) != before_schema or table_counts(conn) != before_counts:
            raise SystemExit('a table or the schema changed beyond the planned descriptions; nothing published')
        if [tuple(row) for row in conn.execute('PRAGMA corpus.quick_check')] != [('ok',)]:
            raise SystemExit('the edited copy failed quick_check; nothing published')
    finally:
        conn.close()
    for suffix in ('-journal', '-wal', '-shm'):
        if Path(str(candidate) + suffix).exists():
            raise SystemExit('the edited copy left a journal behind; nothing published')
    result = {'status': 'prepared-not-published', 'preparedAt': now(), 'planned': len(record['fills']), 'filled': len(filled),
              'filledIds': filled, 'candidate': str(candidate), 'candidate_sha256': sha256(candidate),
              'source_stat': record['source_stat'], 'rollback': str(folder / 'corpus.before.db'), 'onlyColumn': 'description'}
    write_private(receipt, result)
    return {key: value for key, value in result.items() if key != 'filledIds'}


def publish(root: Path, folder: Path, record: dict) -> dict:
    """Rename the prepared copy over the corpus, keeping the old one as corpus.before.db."""
    source, candidate, receipt = root / 'corpus.db', folder / 'corpus.next.db', folder / 'receipt.json'
    result = json.loads(receipt.read_text(encoding='utf-8'))
    if result.get('status') != 'prepared-not-published' or sha256(candidate) != result['candidate_sha256']:
        raise SystemExit('the receipt or the prepared copy is not the one prepare wrote; nothing published')
    os.link(source, folder / 'corpus.before.db')
    sync_dir(folder)
    os.replace(candidate, source)
    sync_dir(root)
    result.update(status='published', publishedAt=now(), oldCorpusRetained=True)
    write_private(receipt, result)
    return {key: value for key, value in result.items() if key != 'filledIds'}


def locked(root: Path, folder: Path, step) -> dict:
    """Run prepare or publish under the pull's lock, only on the corpus the plan read."""
    record = json.loads((folder / 'plan.json').read_text(encoding='utf-8'))
    source = root / 'corpus.db'
    if record['source'] != str(source):
        raise SystemExit('the plan was made for another corpus')
    with (root / '.corpus-ingest.lock').open('a+b') as held:
        try:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)  # refused while a pull runs; a pull is refused while this runs
        except BlockingIOError:
            raise SystemExit('a pull holds the corpus; run this when no pull is running') from None
        if source_stat(source) != record['source_stat']:
            raise SystemExit('the corpus changed since the plan; plan again')
        if any(Path(str(source) + suffix).exists() for suffix in ('-journal', '-wal')):
            raise SystemExit('the corpus has a journal; nothing done')
        if (root / 'ingest').is_dir() and any((root / 'ingest').iterdir()):
            raise SystemExit('a stopped pull has work in progress; nothing done')
        return step(root, folder, record)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    parser.add_argument('step', choices=['dry-run', 'plan', 'prepare', 'publish'])
    parser.add_argument('root', type=Path)
    parser.add_argument('folder', type=Path, nargs='?')
    parser.add_argument('--company', type=int, action='append', default=[])
    parser.add_argument('--pace', type=float, default=PACE, help='seconds between two requests to one host (at least 1)')
    args = parser.parse_args(argv)
    http.config.PER_HOST_DELAY = max(1.0, args.pace)
    root = args.root.resolve()
    if not (root / 'corpus.db').is_file():
        parser.error('the data root holds no corpus.db')
    if args.step in ('dry-run', 'plan') and not args.company:
        parser.error('name the employer: --company <id>')
    if args.step != 'dry-run' and (args.folder is None or args.folder.resolve().parent != root / 'maintenance'):
        parser.error('the maintenance folder must be <root>/maintenance/<name>')
    if args.step == 'dry-run':
        counts, _ = survey(root / 'corpus.db', sorted(set(args.company)))
        out = dict(counts, wouldWrite=0)
    elif args.step == 'plan':
        out = plan(root, args.folder.resolve(), sorted(set(args.company)))
    else:
        out = locked(root, args.folder.resolve(), prepare if args.step == 'prepare' else publish)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
