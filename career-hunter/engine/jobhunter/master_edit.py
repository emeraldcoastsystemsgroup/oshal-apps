# CHANGE LOG
# 6 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "i cant use the tools to update my resume and see it in the resume tab after adding experience"): earlier_documents() answers the main résumé document as it read at an earlier revision (the one the My résumé Word document says it was made from), or the few most recent earlier ones, from the kept backups, so the page can tell a document that is only behind from one that holds typed text. Read-only and bounded to what one engine answer carries.
# 5 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: a card answered "could not run - Your main résumé changed"). A card whose revision has moved is no longer refused whole: apply_edits fits it to the main résumé as it is now (card_rebase) when every job and bullet it names still reads exactly as the card read it, applies it all or nothing with one backup, and answers rebased with a note the card shows; a change that no longer fits is refused naming the change and the job (error master_changed, 409 at the route), and a card on the revision it read behaves as before.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The messages a person reads say main résumé and My résumé (were master resume and Resume Studio). Words only; the error codes are unchanged.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Read bounded master sections and apply exact revision-checked text/list edits through existing owner backup, audit and atomic persistence rails.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0, Work history: an edit may also change a job (field role: set its title, employer, start or end month, add, move or remove it, work_history.py) or move a bullet (op move), and may carry a one-line summary the approval card shows the person. The overview and a role page carry each job's start and end month, base_with_revision() gives the main résumé document with its exact revision, and every touched job is checked whole at the end of the patch, so it stays all or nothing.
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13: a Work history card of four edits, two bullets under a job with none and two jobs removed, answered "item index must be an integer from 0 to 0" and changed nothing). One card means what the person read on it: each edit finds its job and its list item through card_targets.Card, made once from the profile at the card's revision, so an earlier edit of the card never renumbers a later one; a bullet, competency or skill is the one whose exact text the edit quotes, and an add that quotes none goes at the end in the order written. A refused edit says which change of the card, which job and what is wrong in words, and still changes nothing. apply_edits is split into one helper per kind of edit; an edit may also name its job's employer (roleOrg).
"""Model-free bounded access to the current owner's master resume."""
from __future__ import annotations

import copy
import hashlib
import json
import re

from . import card_rebase, card_targets, profile, work_history
from .card_targets import CardRefusal

MAX_BYTES = 12 * 1024
MAX_EDITS = 20
EDIT_FIELDS = ('headline', 'summary', 'clearance', 'competencies', 'skills', 'experience')
QUALIFICATIONS = ('education', 'certifications', 'licenses')
FIELDS = ('overview', *EDIT_FIELDS, *QUALIFICATIONS)
EDIT_KEYS = {'op', 'field', 'index', 'roleIndex', 'roleTitle', 'roleOrg', 'before', 'value', 'key', 'to', 'summary'}
SUMMARY_MAX_CHARS = 300
EARLIER_MAX = 8
EARLIER_MAX_BYTES = 160 * 1024


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
                       'start': role['start'], 'end': role['end'],
                       'bullets': len(role['bullets']), 'stories': len(role['stories'])}
                      for n, role in enumerate(doc['experience'])]
        elif field == 'experience':
            if index >= len(doc['experience']):
                raise ValueError('role index is outside the current profile')
            role = doc['experience'][index]
            result['role'] = {key: role[key] for key in ('title', 'org', 'span', 'start', 'end')}
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


def _list_edit(items, read_items, edit, where, noun, values=None):
    """The list after one add, set, split or remove, and the place it acted on (see card_targets.list_position).
    `values` are the items an add or set writes (a job's pasted block is one bullet per line); default [value]."""
    index = card_targets.list_position(items, read_items, edit, where, noun)
    result, op = list(items), edit['op']
    if op == 'add':
        result[index:index] = values or [edit['value']]
    elif op == 'set':
        result[index:index + 1] = values or [edit['value']]
    elif op == 'split':
        result[index:index + 1] = card_targets.split_lines(items[index])
    else:
        result.pop(index)
    return result, index


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


def _checked_edit(edit):
    """The shape every edit shares: known keys, a known operation and section, the exact current text, a value only
    where one is written, and an optional one-line summary for the approval card (never read as the change)."""
    if not isinstance(edit, dict) or set(edit) - EDIT_KEYS:
        raise CardRefusal('it carries something Career cannot change here')
    op, field = edit.get('op'), edit.get('field')
    if op not in ('set', 'add', 'remove', 'move', 'split') or field not in (*EDIT_FIELDS, 'role'):
        raise CardRefusal('Career cannot make that kind of change here')
    if op == 'move' and field not in ('experience', 'role'):
        raise CardRefusal('only a job or a bullet can be moved')
    if op == 'split' and field != 'experience':
        raise CardRefusal('only a bullet can be split into one bullet per line')
    if not isinstance(edit.get('before'), str):
        raise CardRefusal('it does not quote the text it changes')
    if op in ('set', 'add') and not isinstance(edit.get('value'), str):
        raise CardRefusal('it has no new text')
    if op in ('remove', 'move', 'split') and 'value' in edit:
        raise CardRefusal('a removal, a move or a split carries no new text')
    if 'summary' in edit and (not isinstance(edit['summary'], str) or len(edit['summary']) > SUMMARY_MAX_CHARS):
        raise CardRefusal(f'its summary must be one line of at most {SUMMARY_MAX_CHARS} characters')
    return op, field


def base_with_revision():
    """@description The main résumé document (profile.base_document) with the exact revision of the profile it was
    read from, so a page that shows it can edit it with apply_edits and offer Undo. No profile reads as before.
    @returns {resume, cover, meta, revision?}"""
    try:
        _, raw, revision = _snapshot()
    except (OSError, ValueError):
        return profile.base_document()
    return {**profile.base_document(raw), 'revision': revision}


def earlier_documents(revision=None, **extra):
    """@description The main résumé document as it read earlier: at one exact `revision` (the one a My résumé Word
    document says it was made from), or with none the most recent earlier ones, newest first, each once. From the kept
    backups; read-only; at most EARLIER_MAX versions within EARLIER_MAX_BYTES.
    @param revision a 64-character digest, or None @returns {ok, versions: [{revision, resume}]} or {ok: False, error}"""
    try:
        if extra or (revision is not None and not (isinstance(revision, str) and re.fullmatch(r'[0-9a-f]{64}', revision))):
            raise ValueError('name one earlier revision, or none for the most recent ones')
        versions = []
        for digest, text in work_history.earlier_texts():
            if revision is not None and digest != revision:
                continue
            try:
                raw = json.loads(text)
                resume = profile.base_document(raw)['resume'] if isinstance(raw, dict) else None
            except (ValueError, TypeError, AttributeError, KeyError):
                resume = None
            if resume is None or (versions and versions[-1]['resume'] == resume):
                continue
            if len(_encoded([*versions, {'revision': digest, 'resume': resume}])) > EARLIER_MAX_BYTES:
                break
            versions.append({'revision': digest, 'resume': resume})
            if revision is not None or len(versions) >= EARLIER_MAX:
                break
        return {'ok': True, 'versions': versions}
    except OSError:
        return {'ok': False, 'error': 'The earlier versions of your main résumé could not be read.'}
    except (ValueError, TypeError, AttributeError, KeyError) as error:
        return {'ok': False, 'error': str(error)}


def _text_edit(raw, edit, doc, changelog):
    field = edit['field']
    if edit['op'] != 'set' or any(key in edit for key in ('index', 'roleIndex', 'roleTitle', 'roleOrg')):
        raise CardRefusal(f'{card_targets.FIELD_WORDS[field]} can only be replaced as a whole')
    if edit['before'] != doc[field]:
        raise CardRefusal(f'{card_targets.FIELD_WORDS[field]} reads differently now')
    return profile._apply_master_texts(raw, {field: edit['value']}, changelog)


def _bullet_values(edit, name):
    """The bullets an add or set writes: one per line of its text, each within the bullet limit and not empty."""
    if edit['op'] not in ('add', 'set'):
        return None
    values = [profile._bounded_master_str(line, profile._MASTER_BULLET_MAX_CHARS, 'a bullet')
              for line in card_targets.split_lines(edit['value'])]
    if not all(values):
        raise CardRefusal(f'the new bullet under {name} is empty')
    return values


def _bullet_edit(raw, edit, card, changelog):
    """One bullet of one job added, changed, split or removed; the job and the bullet are found as the card reads them.
    A text of several lines becomes one bullet per line, as a résumé shows them."""
    role_index, role = card_targets.find_job(card, raw, edit)
    old = role.get('deliverables') or []
    if not isinstance(old, list) or any(not isinstance(item, str) for item in old):
        raise CardRefusal(f'the bullets of {card.name(role)} are not plain text')
    values = _bullet_values(edit, card.name(role))
    bullets, at = _list_edit(old, card.bullets.get(id(role), []), edit, 'under ' + card.name(role), 'bullet', values)
    card.remember_item(old[at] if at < len(old) else None)
    if edit['op'] == 'split' and any(len(item) > profile._MASTER_BULLET_MAX_CHARS for item in bullets[at:at + len(bullets) - len(old) + 1]):
        raise CardRefusal(f'a line of that bullet under {card.name(role)} is longer than {profile._MASTER_BULLET_MAX_CHARS} characters')
    if len(bullets) > max(profile._MASTER_MAX_BULLETS, len(old)):
        raise CardRefusal(f'{card.name(role)} would have more than {profile._MASTER_MAX_BULLETS} bullets')
    if bullets == old:
        return False
    role['deliverables'] = bullets
    changelog.append(f'role {role_index + 1} ({work_history.role_value(role, "title")}) bullet {at + 1} {edit["op"]}')
    return True


def _skills_write(raw, edit, n):
    groups, refs = _skill_refs(raw)
    if edit['op'] == 'add' and n == len(refs):
        group = groups.setdefault(profile._MASTER_EXTRA_SKILL_GROUP, {'items': []})
        if not isinstance(group, dict) or not isinstance(group.get('items'), list):
            raise ValueError('the existing additions skill group is unavailable')
        group['items'].append(edit['value'])
        return
    name, position, _ = refs[n]
    target = groups[name]['items']
    if edit['op'] == 'add':
        target.insert(position, edit['value'])
    elif edit['op'] == 'set':
        target[position] = edit['value']
    else:
        target.pop(position)


def _section_list_edit(raw, edit, doc, card, changelog):
    """One core competency or skill added, changed or removed, named by its exact text."""
    field = edit['field']
    if any(key in edit for key in ('roleIndex', 'roleTitle', 'roleOrg')):
        raise CardRefusal('it names a job, and that part of the résumé has no jobs')
    old, noun = doc[field], ('skill' if field == 'skills' else 'core competency')
    if edit['op'] != 'remove':
        edit = {**edit, 'value': profile._bounded_master_str(edit['value'], profile._MASTER_ITEM_MAX_CHARS, 'the ' + noun)}
        if not edit['value']:
            raise CardRefusal(f'the new {noun} is empty')
    items, n = _list_edit(old, card.lists.get(field, []), edit, 'in your ' + ('skills' if field == 'skills' else 'core competencies'), noun)
    card.remember_item(old[n] if n < len(old) else None)
    maximum = profile._MASTER_MAX_SKILLS if field == 'skills' else profile._MASTER_MAX_COMPETENCIES
    if len(items) > max(maximum, len(old)):
        raise CardRefusal(f'your {"skills" if field == "skills" else "core competencies"} would hold more than {maximum}')
    if items == old:
        return False
    if field == 'competencies':
        original = raw.get('competencies', [])
        if not isinstance(original, list) or any(not isinstance(item, str) for item in original):
            raise ValueError('existing competencies must contain text')
        raw['competencies'] = items
    else:
        _skills_write(raw, edit, n)
    changelog.append(f'{field} item {n + 1} {edit["op"]}')
    return True


def _apply_one(raw, edit, card, changelog, touched):
    """Apply one edit of a card to the parsed profile in place; returns whether it changed anything."""
    op, field = _checked_edit(edit)
    if field == 'role':
        return work_history.apply_role(raw, edit, changelog, touched, card)
    if op == 'move':
        return work_history.move_bullet(raw, edit, changelog, card)
    if any(key in edit for key in ('key', 'to')):
        raise CardRefusal('it names a job detail or a new place, which only a job change or a move can')
    if field in ('headline', 'summary', 'clearance'):
        return _text_edit(raw, edit, profile.base_document(raw)['resume'], changelog)
    if field == 'experience':
        return _bullet_edit(raw, edit, card, changelog)
    return _section_list_edit(raw, edit, profile.base_document(raw)['resume'], card, changelog)


def _new_card(raw, total):
    """The card as it reads one profile: its jobs, their bullets, the competencies and the skills."""
    first = profile.base_document(raw)['resume']
    return card_targets.Card(raw, total, {field: first[field] for field in ('competencies', 'skills')})


def _apply_card(raw, edits, changelog, card=None, refuse=card_targets.refusal):
    """Every edit of one card against the profile it was read from, then each touched job checked whole. `card` is
    given when the card is applied on a later revision (its jobs are pinned); `refuse` words a refused change."""
    card = card or _new_card(raw, len(edits))
    touched, changed = [], False
    for number, edit in enumerate(edits, 1):
        card.number = number
        try:
            changed = _apply_one(raw, edit, card, changelog, touched) or changed
        except ValueError as error:
            raise ValueError(refuse(card, edit, str(error))) from None
    try:
        work_history.check_touched(touched)
    except ValueError as error:
        raise ValueError(refuse(card, None, str(error))) from None
    return changed


def _fitted(revision, edits, raw):
    """A card whose revision has moved, for the profile as it is now: (edits, card with each job pinned). The card is
    first applied to a copy of the version it read, which says which job and item each change named and refuses, in
    the usual words, a card that was never right; card_rebase.fit then finds each of those now. Raises card_rebase.Unfit
    with the whole refusal when the version is no longer kept or a change no longer fits."""
    earlier = work_history.earlier_text(revision)
    try:
        read = json.loads(earlier) if earlier is not None else None
    except ValueError:
        read = None
    if not isinstance(read, dict):
        raise card_rebase.Unfit(card_rebase.unknown())
    roles = read.get('roles') if isinstance(read.get('roles'), list) else []
    read_card, as_read = _new_card(read, len(edits)), copy.deepcopy(roles)
    _apply_card(read, edits, [], read_card)
    lists_now = profile.base_document(raw)['resume']
    fitted, pins, pin_made = card_rebase.fit(read_card, as_read, edits, raw, lists_now)
    card = _new_card(raw, len(edits))
    card.pins, card.pin_made = pins, pin_made
    return fitted, card


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
        card, changelog = None, []
        if current != revision:
            # The main résumé moved after this card was written (another card was approved, or the My résumé document
            # saved): apply it as it is now only when everything the card names still reads as the person read it.
            try:
                edits, card = _fitted(revision, edits, raw)
                changed = _apply_card(raw, edits, changelog, card, card_rebase.refusal)
            except card_rebase.Unfit as error:
                return {'ok': False, 'error': 'master_changed', 'message': str(error)}
            except ValueError as error:
                if card is None:
                    raise
                return {'ok': False, 'error': 'master_changed', 'message': str(error)}
        else:
            changed = _apply_card(raw, edits, changelog)
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
        result = {'ok': True, 'changed': changed, 'revision': after, 'changelog': changelog}
        if card is not None and changed:
            result.update(rebased=True, note=card_rebase.NOTE)
        return result
    except OSError:
        return {'ok': False, 'error': 'The master edit could not be confirmed. Read the affected section before retrying.'}
    except (ValueError, TypeError, AttributeError, KeyError) as error:
        return {'ok': False, 'error': str(error)}
