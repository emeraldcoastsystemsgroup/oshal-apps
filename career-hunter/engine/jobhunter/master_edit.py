# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The messages a person reads say main résumé and My résumé (were master resume and Resume Studio). Words only; the error codes are unchanged.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Read bounded master sections and apply exact revision-checked text/list edits through existing owner backup, audit and atomic persistence rails.
"""Model-free bounded access to the current owner's master resume."""
from __future__ import annotations

import hashlib
import json
import re

from . import profile

MAX_BYTES = 12 * 1024
MAX_EDITS = 20
EDIT_FIELDS = ('headline', 'summary', 'clearance', 'competencies', 'skills', 'experience')
QUALIFICATIONS = ('education', 'certifications', 'licenses')
FIELDS = ('overview', *EDIT_FIELDS, *QUALIFICATIONS)


def _encoded(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def _snapshot():
    text = profile._read_profile_text()
    raw = json.loads(text)
    if not isinstance(raw, dict):
        raise ValueError('the master profile must be an object')
    return text, raw, hashlib.sha256(text.encode('utf-8')).hexdigest()


def _integer(value, label, maximum):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError(f'{label} must be an integer from 0 to {maximum}')
    return value


def read_section(field='overview', index=0, offset=0, limit=20):
    """Return an explicitly paged, byte-bounded view from one exact profile revision."""
    try:
        if field not in FIELDS:
            raise ValueError('unsupported master section')
        _integer(index, 'role index', 9999)
        if field != 'experience' and index:
            raise ValueError('role index must be zero for this section')
        _integer(offset, 'offset', 1_000_000)
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ValueError('limit must be an integer from 1 to 50')
        _, raw, revision = _snapshot()
        doc = profile.base_document(raw)['resume']
        result = {'ok': True, 'revision': revision, 'field': field, 'offset': offset}
        if field == 'overview':
            result['fields'] = [{'field': key, 'kind': 'text' if isinstance(value, str) else 'list',
                                 'count': len(value), 'editable': True} for key, value in doc.items()]
            result['fields'].extend({'field': key, 'kind': 'list' if isinstance(raw.get(key, []), list) else 'unsupported',
                                     'count': len(raw.get(key, [])) if isinstance(raw.get(key, []), list) else None,
                                     'editable': False} for key in QUALIFICATIONS)
            values = [{'index': n, 'title': role['title'], 'org': role['org'], 'span': role['span'],
                       'bullets': len(role['bullets']), 'stories': len(role['stories'])}
                      for n, role in enumerate(doc['experience'])]
        elif field == 'experience':
            if index >= len(doc['experience']):
                raise ValueError('role index is outside the current profile')
            role = doc['experience'][index]
            result['role'] = {key: role[key] for key in ('title', 'org', 'span')}
            result['role']['index'] = index
            values = role['bullets']
        else:
            if index:
                raise ValueError('role index must be zero for this section')
            values = raw.get(field, []) if field in QUALIFICATIONS else doc[field]
            if field in QUALIFICATIONS and (not isinstance(values, list) or any(not isinstance(item, str) for item in values)):
                raise ValueError('this qualification section needs a supported list of source statements')
        result['total'] = len(values)
        if offset > len(values):
            raise ValueError('offset is outside the current section')
        if isinstance(values, str):
            # Character offsets remain code-point boundaries, including non-ASCII text.
            end = min(len(values), offset + 6000)
            while end > offset:
                trial = {**result, 'value': values[offset:end], 'nextOffset': end if end < len(values) else None,
                         'complete': end == len(values)}
                if len(_encoded(trial)) <= MAX_BYTES:
                    return trial
                end = offset + (end - offset) // 2
            if offset == len(values):
                return {**result, 'value': '', 'nextOffset': None, 'complete': True}
            raise ValueError('master section metadata exceeds the read limit')
        items = []
        end = offset
        for n in range(offset, min(len(values), offset + limit)):
            candidate = {'index': n, 'value': values[n]}
            trial = {**result, 'items': [*items, candidate], 'nextOffset': n + 1,
                     'complete': n + 1 == len(values)}
            if len(_encoded(trial)) > MAX_BYTES:
                break
            items.append(candidate)
            end = n + 1
        if not items and offset < len(values):
            raise ValueError('one item of this section exceeds the read limit; use the My résumé page')
        return {**result, 'items': items, 'nextOffset': end if end < len(values) else None,
                'complete': end == len(values)}
    except OSError:
        return {'ok': False, 'error': 'The master profile is unavailable. Upload a resume or restore its backup.'}
    except (ValueError, TypeError, AttributeError, KeyError) as error:
        return {'ok': False, 'error': str(error)}


def _list_edit(items, edit):
    index = _integer(edit.get('index'), 'item index', len(items))
    op = edit['op']
    if index == len(items) and op != 'add':
        raise ValueError('item index is outside the current section')
    before = items[index] if index < len(items) else ''
    if edit['before'] != before:
        raise ValueError('the selected text does not match; read the section again')
    result = list(items)
    if op == 'add':
        result.insert(index, edit['value'])
    elif op == 'set':
        result[index] = edit['value']
    else:
        result.pop(index)
    return result


def _skill_refs(raw):
    groups = raw.setdefault('skills', {})
    if not isinstance(groups, dict):
        raise ValueError('the existing skill groups are unavailable')
    refs = []
    for name, group in groups.items():
        if group is None:
            continue
        if not isinstance(group, dict) or not isinstance(group.get('items', []), list):
            raise ValueError('the existing skill group is unavailable')
        for index, item in enumerate(group.get('items', [])):
            if not isinstance(item, str):
                raise ValueError('existing skill items must contain text')
            refs.append((name, index, item))
    return groups, refs


def apply_edits(revision, edits):
    """Apply all edits or none, checking the revision and each exact old value first."""
    try:
        if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{64}', revision):
            raise ValueError('read the current master revision before saving')
        if not isinstance(edits, list) or not 1 <= len(edits) <= MAX_EDITS:
            raise ValueError(f'provide between 1 and {MAX_EDITS} master edits')
        if len(_encoded({'revision': revision, 'edits': edits})) > MAX_BYTES:
            return {'ok': False, 'error': 'master_patch_too_large',
                    'message': 'Save a smaller group of edits; the master profile was not changed.'}
        text, raw, current = _snapshot()
        if current != revision:
            return {'ok': False, 'error': 'master_changed',
                    'message': 'Your main résumé changed. Read the affected section again before saving.'}
        changelog = []
        changed = False
        for edit in edits:
            if not isinstance(edit, dict) or set(edit) - {'op', 'field', 'index', 'roleIndex', 'roleTitle', 'before', 'value'}:
                raise ValueError('unsupported master edit fields')
            op, field = edit.get('op'), edit.get('field')
            if op not in ('set', 'add', 'remove') or field not in EDIT_FIELDS:
                raise ValueError('unsupported master edit operation or section')
            if not isinstance(edit.get('before'), str):
                raise ValueError('each edit must include the exact current text')
            if op != 'remove' and not isinstance(edit.get('value'), str):
                raise ValueError('replacement text must be a string')
            if op == 'remove' and 'value' in edit:
                raise ValueError('a removal must not include replacement text')
            doc = profile.base_document(raw)['resume']
            if field in ('headline', 'summary', 'clearance'):
                if op != 'set' or any(key in edit for key in ('index', 'roleIndex', 'roleTitle')):
                    raise ValueError('text fields accept only a direct replacement')
                if edit['before'] != doc[field]:
                    raise ValueError('the selected text does not match; read the section again')
                changed = profile._apply_master_texts(raw, {field: edit['value']}, changelog) or changed
            elif field == 'experience':
                role_index = _integer(edit.get('roleIndex'), 'role index', len(doc['experience']))
                if role_index >= len(doc['experience']) or edit.get('roleTitle') != doc['experience'][role_index]['title']:
                    raise ValueError('the selected role does not match the current profile')
                old = raw['roles'][role_index].get('deliverables', [])
                if not isinstance(old, list) or any(not isinstance(item, str) for item in old):
                    raise ValueError('existing role bullets must contain text')
                if op != 'remove':
                    edit = {**edit, 'value': profile._bounded_master_str(edit['value'], profile._MASTER_BULLET_MAX_CHARS, 'bullet')}
                    if not edit['value']:
                        raise ValueError('a bullet must not be empty')
                bullets = _list_edit(old, edit)
                if len(bullets) > max(profile._MASTER_MAX_BULLETS, len(old)):
                    raise ValueError('the role exceeds the supported bullet count')
                if bullets != old:
                    raw['roles'][role_index]['deliverables'] = bullets
                    changelog.append(f'role {role_index + 1} ({edit["roleTitle"]}) bullet {edit["index"] + 1} {op}')
                    changed = True
            else:
                if any(key in edit for key in ('roleIndex', 'roleTitle')):
                    raise ValueError('this section has no role anchor')
                old = doc[field]
                if op != 'remove':
                    edit = {**edit, 'value': profile._bounded_master_str(edit['value'], profile._MASTER_ITEM_MAX_CHARS, field + ' item')}
                    if not edit['value']:
                        raise ValueError('a list item must not be empty')
                items = _list_edit(old, edit)
                maximum = profile._MASTER_MAX_SKILLS if field == 'skills' else profile._MASTER_MAX_COMPETENCIES
                if len(items) > max(maximum, len(old)):
                    raise ValueError('the section exceeds the supported item count')
                if items == old:
                    continue
                if field == 'competencies':
                    original = raw.get('competencies', [])
                    if not isinstance(original, list) or any(not isinstance(item, str) for item in original):
                        raise ValueError('existing competencies must contain text')
                    raw['competencies'] = items
                else:
                    groups, refs = _skill_refs(raw)
                    n = edit['index']
                    if op == 'add' and n == len(refs):
                        group = groups.setdefault(profile._MASTER_EXTRA_SKILL_GROUP, {'items': []})
                        if not isinstance(group, dict) or not isinstance(group.get('items'), list):
                            raise ValueError('the existing additions skill group is unavailable')
                        group['items'].append(edit['value'])
                    else:
                        name, position, _ = refs[n]
                        target = groups[name]['items']
                        if op == 'add':
                            target.insert(position, edit['value'])
                        elif op == 'set':
                            target[position] = edit['value']
                        else:
                            target.pop(position)
                changelog.append(f'{field} item {edit["index"] + 1} {op}')
                changed = True
        if changed and raw == json.loads(text):
            changed, changelog = False, []
        if changed:
            # Native owner writes are serialized by the retained store lease. Recheck
            # its exact preimage before backup/publish as well as at request admission.
            if profile._read_profile_text() != text:
                return {'ok': False, 'error': 'master_changed',
                        'message': 'Your main résumé changed. Read the affected section again before saving.'}
            profile._persist_augmentation(text, raw, 'resume-studio bounded master edit', changelog)
        after = hashlib.sha256(profile._read_profile_text().encode('utf-8')).hexdigest()
        return {'ok': True, 'changed': changed, 'revision': after, 'changelog': changelog}
    except OSError:
        return {'ok': False, 'error': 'The master edit could not be confirmed. Read the affected section before retrying.'}
    except (ValueError, TypeError, AttributeError, KeyError) as error:
        return {'ok': False, 'error': str(error)}
