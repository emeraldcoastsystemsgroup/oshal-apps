# CHANGE LOG
# 6 | maintainer@emeraldcoastsystemsgroup.com | Resolve explicit additional experience revisions before scoring or generation and retain per-job selection receipts.
# 5 | maintainer@emeraldcoastsystemsgroup.com | Explain unavailable or changed scoring configuration through bounded terminal receipts without replacing existing fits.
# 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact employer-detail size, verification and storage refusals in preparation receipts for actionable user feedback.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Score selected jobs from the whole recorded profile and report a context-size refusal without silently dropping skills.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve selected employer details before scoring and document generation, and report missing details before a model call.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prepare exactly one explicitly selected job through the existing scoring and document generators, recording owner-private terminal receipts without submitting an application.
"""Single selected job: dynamic fit first, then optional resume/cover preparation."""
from __future__ import annotations
import datetime
import json
import os
import re
import uuid
from . import config, db, profile, score, generate, render, job_context, enrich, experience_bank


def _state():
    path = config.DATA_DIR / 'job-board-state.json'
    if not path.exists():
        return path, {'version': 1, 'jobs': {}}
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('saved job state unavailable')
    value = json.loads(path.read_text())
    if value.get('version') != 1 or not isinstance(value.get('jobs'), dict) or len(value['jobs']) > 2000 or any(not re.fullmatch(r'[1-9]\d{0,14}', k) or not isinstance(v, dict) for k, v in value['jobs'].items()):
        raise ValueError('saved job state invalid')
    return path, value


def _receipt(posting_id, **patch):
    path, state = _state()
    key = str(posting_id)
    if key not in state['jobs'] and len(state['jobs']) >= 2000:
        raise ValueError('saved job limit reached')
    state['jobs'][key] = {**state['jobs'].get(key, {}), **patch}
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x') as out:
            os.chmod(temporary, 0o600)
            json.dump(state, out)
            out.write('\n')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return state['jobs'][key]


def prepare_job(posting_id: int, documents=True, include_oshal=False, request_id='', guidance='', experience_ids=None, experience_revision=''):
    if isinstance(posting_id, bool) or not isinstance(posting_id, int) or posting_id <= 0:
        raise ValueError('invalid posting')
    _, previous = _state()
    prior = previous['jobs'].get(str(posting_id), {})
    if request_id and prior.get('requestId') == request_id and prior.get('completedAt'):
        return {'ok': prior.get('phase') != 'failed', 'postingId': posting_id, 'phase': prior.get('phase'), 'duplicate': True}
    now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
    try:
        saved = profile.load()
        if not saved.get('roles') and not saved.get('profile', {}).get('experience_summary'):
            raise ValueError('resume_required')
        selected_experience=experience_bank.selected(experience_ids or [],experience_revision)
        if documents:
            try:
                render._chromium_binary()
            except RuntimeError as error:
                raise ValueError('renderer_unavailable') from error
        with db.connect() as conn:
            value = conn.execute('SELECT * FROM postings WHERE id=?', (posting_id,)).fetchone()
            if not value:
                raise ValueError('posting_not_found')
            row = dict(value)
            if documents and row.get('status') in ('applied', 'interview', 'offer', 'rejected'):
                raise ValueError('already_submitted')
        selection_patch={'experienceIds':experience_ids or [],'experienceRevision':experience_revision} if documents else {}
        _receipt(posting_id, favorite=True, savedAt=prior.get('savedAt') or now(), requestId=request_id,
                 phase='scoring', requestedAt=now(), completedAt=None, error=None, **selection_patch)
        row = job_context.ensure(row)
        scored = score._score_one(row, profile.scoring_context(include_oshal=True))
        fit = (scored.get('data') or {}).get('fit_score')
        if isinstance(fit, bool) or not isinstance(fit, (int, float)) or not 0 <= fit <= 100:
            raise ValueError('score_unavailable')
        if not score._commit_one(scored, enrich.model_name(config.ANTHROPIC_SCORE_MODEL)):
            raise ValueError('score_unavailable')
        if documents:
            _receipt(posting_id, phase='generating')
            generate.generate_for(posting_id, include_oshal=include_oshal, guidance=guidance, additional_experience=selected_experience)
        phase = 'ready' if documents else 'scored'
        _receipt(posting_id, phase=phase, completedAt=now(), error=None)
        return {'ok':True,'postingId':posting_id,'phase':phase,'fitScore':int(fit)}
    except Exception as error:
        failure = (error.reason.replace('-', '_') if isinstance(error, enrich.CareerWorkerUnavailable)
                   and error.reason in ('model-identity-unavailable', 'model-identity-mismatch') else str(error))
        reason = failure if failure in ('resume_required','posting_not_found','score_unavailable','already_submitted','renderer_unavailable','job_details_unavailable','profile_too_large_for_scoring','job_context_too_large','job_context_unavailable','job_context_limit_reached','model_identity_unavailable','model_identity_mismatch','experience_selection_invalid','experience_selection_changed','experience_unavailable') else 'preparation_failed'
        _receipt(posting_id, requestId=request_id, phase='failed', completedAt=now(), error=reason)
        return {'ok':False,'postingId':posting_id,'phase':'failed','error':reason}
