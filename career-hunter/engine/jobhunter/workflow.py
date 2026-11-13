# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Carry only consented saved-job drafts through the existing preparation writer, never employer submission, replay or an automatic failure retry.
"""A single owner-leased preparation batch. Its terminal boundary is documents, never sending."""
import json
from . import config, db, prepare


def _enabled():
    file = config.DATA_DIR / 'application-workflow.json'
    if not file.exists():
        return False
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 1024:
        return False
    try:
        value = json.loads(file.read_text())
        return value.get('version') == 1 and value.get('enabled') is True and value.get('mode') in ('review', 'automatic')
    except (ValueError, OSError):
        return False


def prepare_saved(batch_id):
    if not isinstance(batch_id, str) or not batch_id or not _enabled():
        return {'processed': 0}
    _, state = prepare._state()
    processed = 0
    for key, saved in state['jobs'].items():
        flow, generation = saved.get('workflow', {}), saved.get('generationDraft', {})
        if flow.get('batchId') != batch_id or not saved.get('favorite') or generation.get('state') != 'requested':
            continue
        if saved.get('requestId') == generation.get('requestId') and saved.get('completedAt'):
            continue
        if not _enabled():
            break
        with db.connect() as conn:
            row = conn.execute('SELECT status FROM user_signals WHERE posting_id=?', (int(key),)).fetchone()
        if not row or row['status'] not in ('promoted', 'generated', 'deferred'):
            continue
        inputs = generation.get('inputs', {})
        prepare.prepare_job(int(key), documents=True, request_id=generation['requestId'],
                            guidance=inputs.get('guidance', ''), experience_ids=inputs.get('experienceIds', []),
                            experience_revision=inputs.get('experienceRevision', ''))
        processed += 1
    return {'processed': processed}
