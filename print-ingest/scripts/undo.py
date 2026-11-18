#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1   | maintainer@emeraldcoastsystemsgroup.com   | Version-controlled undo for Print Inbox curated shelf & personal
#     |                                           | my-knowledge filings (moved from QUANTLIB2's local state directory with
#     |                                           | receipt, publisher, and tenant arguments required explicitly — zero
#     |                                           | hardcoded tenant or principal UUIDs). Uses oshal_compare_exchange as
#     |                                           | oshal_writer conditioned on the exact prior row; dry run unless --apply.
"""usage:
  undo.py books --receipt FILE [--pg-container NAME] [--apply]
  undo.py shelf --slot blue|production --publisher PRINCIPAL (--tenant TENANT | --receipt FILE)
                [--collection ID] [--pg-container NAME] [--expect N] [--apply]
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

COLLECTION = 'pkg:print-ingest:native_rag_collections'
PG = {'blue': 'oshal-kernel-pg-green', 'production': 'oshal-kernel-pg'}
SAFE_ID = re.compile(r'^[A-Za-z0-9_.:-]+$')


def say(step, **data):
    print(json.dumps({'step': step, **data}), flush=True)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def check_safe_sql_token(label, value):
    if not value or not SAFE_ID.match(value):
        raise SystemExit(f'invalid {label}')
    return value


def psql(container, sql=None, stdin=None):
    docker_bin = os.environ.get('OSHAL_UNDO_DOCKER_BIN', 'docker')
    cmd = [
        docker_bin, 'exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', container,
        'psql', '-U', 'kernel', '-d', 'kernel', '-v', 'ON_ERROR_STOP=1', '-At', '-q',
    ]
    if stdin is None:
        cmd += ['-c', sql]
    out = subprocess.run(cmd, input=stdin, capture_output=True, text=True, encoding='utf-8', check=False)
    if out.returncode != 0:
        raise SystemExit(f'psql failed: {out.stderr.strip()[:400]}')
    return out.stdout


def tenant_key(tenant):
    digest = hashlib.sha256()
    digest.update(b'oshal:scope:v1')
    digest.update(b'\x1f')
    digest.update(b'tenant')
    digest.update(b'\x1f')
    digest.update(tenant.encode('utf-8'))
    return digest.hexdigest()


def read_row(container, key, row_id):
    safe_key = check_safe_sql_token('scope_key', key)
    safe_row = check_safe_sql_token('row_id', row_id)
    query = (
        f"select body::text from documents where scope_key = '{safe_key}' "
        f"and collection = '{COLLECTION}' and id = '{safe_row}'"
    )
    out = psql(container, query)
    return json.loads(out) if out.strip() else None


def exchange(container, key, change):
    safe_key = check_safe_sql_token('scope_key', key)
    payload = compact([change])
    tag = '$qlib2undo$'
    if tag in payload:
        raise SystemExit('payload contains the quoting tag')
    sql = (
        "RESET ROLE; RESET ALL; SET client_encoding = 'UTF8'; "
        f"SET oshal.scope_key = '{safe_key}'; SET ROLE oshal_writer;\n"
        f"SELECT oshal_compare_exchange('{COLLECTION}', {tag}{payload}{tag}::jsonb);\n"
    )
    return psql(container, stdin=sql).strip()


def apply_removal(container, key, row_id, current, keep, apply_flag, what):
    removed = len(current['chunks']) - len(keep)
    if keep:
        after = dict(current)
        after['chunks'] = keep
        change = {'id': row_id, 'before': current, 'after': after}
    else:
        after = None
        change = {'id': row_id, 'before': current}
    say(
        'plan', what=what, row=row_id, scopeKeyPrefix=key[:12],
        chunksNow=len(current['chunks']), remove=removed, keep=len(keep),
        deleteRow=after is None, apply=apply_flag,
    )
    if not apply_flag or removed == 0:
        return 0
    result = exchange(container, key, change)
    now = read_row(container, key, row_id)
    say('done', what=what, exchange=result, rowNow=None if now is None else len(now['chunks']), matches=(now == after))
    return 0 if result == '1' and now == after else 1


def books(args):
    with open(args.receipt, encoding='utf-8') as handle:
        receipt = json.load(handle)
    store = receipt['store']
    container = args.pg_container or store['database']
    key, row_id = store['scopeKey'], store['id']
    current = read_row(container, key, row_id)
    if current is None:
        say('nothing to undo', row=row_id, scopeKeyPrefix=key[:12])
        return 0
    docs = {doc['docId'] for doc in receipt['documents']}
    owner = receipt['person']['principal']
    keep = [
        chunk for chunk in current['chunks']
        if not (
            chunk.get('document') in docs
            and chunk.get('indexSource', {}).get('ownerId') == owner
            and chunk.get('indexSource', {}).get('package') == 'print-ingest'
        )
    ]
    return apply_removal(container, key, row_id, current, keep, args.apply, 'books')


def resolve_tenant(args):
    if args.tenant:
        return args.tenant
    if args.receipt:
        with open(args.receipt, encoding='utf-8') as handle:
            receipt = json.load(handle)
        found = receipt.get('tenant') or receipt.get('person', {}).get('tenant')
        if found:
            return found
    raise SystemExit('shelf needs --tenant TENANT (or --receipt FILE carrying tenant)')


def shelf(args):
    container = args.pg_container or PG[args.slot]
    tenant = resolve_tenant(args)
    row_id = args.collection or 'quant-library'
    key = tenant_key(tenant)
    current = read_row(container, key, row_id)
    if current is None:
        say('nothing to undo', row=row_id, scopeKeyPrefix=key[:12])
        return 0
    keep = [chunk for chunk in current['chunks'] if chunk.get('indexSource', {}).get('ownerId') != args.publisher]
    removed = len(current['chunks']) - len(keep)
    if args.expect is not None and removed != args.expect:
        raise SystemExit(f'expected to remove {args.expect} chunks, found {removed}; nothing done')
    return apply_removal(container, key, row_id, current, keep, args.apply, 'shelf')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('what', choices=['books', 'shelf'])
    parser.add_argument('--receipt')
    parser.add_argument('--slot', choices=list(PG))
    parser.add_argument('--publisher')
    parser.add_argument('--tenant')
    parser.add_argument('--collection', default='quant-library')
    parser.add_argument('--pg-container')
    parser.add_argument('--expect', type=int)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.what == 'books' and not args.receipt:
        raise SystemExit('books needs --receipt')
    if args.what == 'shelf' and not (args.slot and args.publisher):
        raise SystemExit('shelf needs --slot and --publisher')
    sys.exit(books(args) if args.what == 'books' else shelf(args))


if __name__ == '__main__':
    main()
