# CHANGE LOG
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0: a card applied on a later revision than it read (card_rebase) needs the version it read: earlier_text() answers it from the same backups Undo reads, and earlier_texts() lists them newest first for the My résumé document (master_edit.earlier_documents). A job add and a bullet move tell the card what they made and moved.
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: "we are missing the page to put in my experience"): the job-level edits the Work history page and the concierge's approved patch make to the main résumé. A job's title, employer, start and end month change against their exact current text; a job is added, moved or removed; a bullet is moved. Every edit runs inside master_edit.apply_edits, so it is revision-checked, all or nothing, backed up and audited like every other main-résumé edit, and restore() is Undo: it puts back the exact earlier profile from that backup only while nothing changed after it.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13: a Work history card of four edits answered "item index must be an integer from 0 to 0"): an edit finds its job and its bullet through card_targets (the exact title, and employer when named, where the concierge read it or where the card's earlier edits left it; the bullet by its exact text), so a later edit of one card is never numbered off by an earlier one. A job removal or move may repeat its place as index. A new job's place, a move's new place, a set's quoted value and a check of a touched job refuse in words that name the job.
"""Job-level (work history) edits of the owner's master profile, and Undo."""
from __future__ import annotations

import hashlib
import json
import re

from . import card_targets, config, profile
from .card_targets import CardRefusal, plural, shown

ROLE_KEYS = ('title', 'org', 'start', 'end')
KEY_WORDS = {'title': 'job title', 'org': 'employer', 'start': 'start month', 'end': 'end month'}
MAX_ROLES = 60
ANCHOR_MAX_CHARS = 200
UNDO_SEARCH = 30
_MONTH = re.compile(r'[0-9]{4}(-(0[1-9]|1[0-2]))?')


def role_value(role: dict, key: str) -> str:
    """The text a person sees for one anchor: a job with no end month reads as '' (present)."""
    value = role.get(key)
    return '' if value is None else str(value)


def _new_id(roles: list) -> str:
    taken = {str(role.get('id')) for role in roles if isinstance(role, dict)}
    number = len(roles) + 1
    while f'r{number}' in taken:
        number += 1
    return f'r{number}'


def _set_anchor(raw: dict, edit: dict, changelog: list, touched: list, card) -> bool:
    index, role = card_targets.find_job(card, raw, edit)
    key = edit.get('key')
    if key not in ROLE_KEYS:
        raise CardRefusal('a job change sets its job title, employer, start month or end month')
    current = role_value(role, key)
    if edit['before'] != current:
        raise CardRefusal(f'the {KEY_WORDS[key]} of {card.name(role)} reads "{shown(current) or "nothing"}" now, '
                          f'not "{shown(edit["before"]) or "nothing"}"')
    value = profile._bounded_master_str(edit['value'], ANCHOR_MAX_CHARS, KEY_WORDS[key])
    touched.append(role)
    if value == current:
        return False
    role[key] = None if key == 'end' and value == '' else value
    changelog.append(f'role {index + 1} ({role_value(role, "title")}) {key} set')
    return True


def _add_role(raw: dict, edit: dict, changelog: list, touched: list, card) -> bool:
    roles = raw.setdefault('roles', [])
    if not isinstance(roles, list):
        raise CardRefusal('your work history cannot be read as a list of jobs')
    if len(roles) >= MAX_ROLES:
        raise CardRefusal(f'the work history holds at most {MAX_ROLES} jobs')
    if edit['before'] != '' or any(key in edit for key in ('roleIndex', 'roleTitle', 'roleOrg', 'key', 'to')):
        raise CardRefusal('a new job names only its place and its title')
    title = profile._bounded_master_str(edit['value'], ANCHOR_MAX_CHARS, 'job title')
    index = edit.get('index')
    if type(index) is not int or not 0 <= index <= len(roles):
        place = index + 1 if type(index) is int else 'that cannot be read'
        raise CardRefusal(f'it puts the new job {shown(title, card_targets.NAME_SHOWN)} at place {place}, '
                          f'and the work history has {plural(len(roles), "job")}')
    role = {'id': _new_id(roles), 'title': title, 'org': '', 'start': '', 'end': None, 'deliverables': []}
    roles.insert(index, role)
    card.remember_added(role)
    touched.append(role)
    changelog.append(f'role added at {index + 1} ({title})')
    return True


def _remove_or_move_role(raw: dict, edit: dict, changelog: list, card) -> bool:
    index, role = card_targets.find_job(card, raw, edit)
    if edit['before'] not in (role_value(role, 'title'), card.read_title(role)):
        raise CardRefusal(f'it names {card.name(role)} but quotes its title as "{shown(edit["before"])}"')
    roles = raw['roles']
    if edit['op'] == 'remove':
        if 'to' in edit:
            raise CardRefusal(f'it removes {card.name(role)} and also gives it a new place')
        card.remember_removed(role)
        roles.pop(index)
        changelog.append(f'role {index + 1} ({edit["before"]}) removed')
        return True
    target = edit.get('to')
    if type(target) is not int or not 0 <= target < len(roles):
        place = target + 1 if type(target) is int else 'that cannot be read'
        raise CardRefusal(f'it moves {card.name(role)} to place {place}, and the work history has {plural(len(roles), "job")}')
    roles.insert(target, roles.pop(index))
    changelog.append(f'role {index + 1} ({edit["before"]}) moved to {target + 1}')
    return target != index


def apply_role(raw: dict, edit: dict, changelog: list, touched: list, card) -> bool:
    """@description Apply one job-level edit to the parsed profile in place.
    @param raw the parsed profile @param edit one validated edit (field role)
    @param changelog receives one line per change @param touched receives each job a set or add touched
    @param card the card being applied (card_targets.Card): what the concierge read and what earlier edits did
    @returns whether the profile changed"""
    if 'index' in edit and edit['op'] != 'add' and edit['index'] != edit.get('roleIndex'):
        raise CardRefusal(f'it names {shown(edit.get("roleTitle") or "the job", card_targets.NAME_SHOWN)} at two different places')
    if edit['op'] == 'set':
        return _set_anchor(raw, edit, changelog, touched, card)
    if edit['op'] == 'add':
        return _add_role(raw, edit, changelog, touched, card)
    return _remove_or_move_role(raw, edit, changelog, card)


def move_bullet(raw: dict, edit: dict, changelog: list, card) -> bool:
    """@description Move one bullet of one job, named by its exact text, to a new place in that job.
    @param raw the parsed profile @param edit field experience, op move @param changelog receives the change
    @param card the card being applied @returns whether the order changed"""
    index, role = card_targets.find_job(card, raw, edit)
    bullets = role.get('deliverables') or []
    if not isinstance(bullets, list) or any(not isinstance(item, str) for item in bullets):
        raise CardRefusal(f'the bullets of {card.name(role)} are not plain text')
    where = 'under ' + card.name(role)
    at = card_targets.list_position(bullets, card.bullets.get(id(role), []), edit, where, 'bullet')
    card.remember_item(bullets[at])
    to = edit.get('to')
    if type(to) is not int or not 0 <= to < len(bullets):
        place = to + 1 if type(to) is int else 'that cannot be read'
        raise CardRefusal(f'it moves the bullet "{shown(edit["before"])}" {where} to place {place}, and that job has '
                          f'{plural(len(bullets), "bullet")}')
    moved = list(bullets)
    moved.insert(to, moved.pop(at))
    role['deliverables'] = moved
    changelog.append(f'role {index + 1} ({role_value(role, "title")}) bullet {at + 1} moved to {to + 1}')
    return to != at


def _month(value: str, label: str, title: str) -> str:
    if not _MONTH.fullmatch(value):
        raise ValueError(f'the {label} month of {shown(title, card_targets.NAME_SHOWN)} must be a year, or a year and month '
                         f'(for example 2019-03); it reads "{shown(value) or "nothing"}"')
    return value


def _ordinal(value: str, last: bool) -> str:
    """A year alone is its January as a start and its December as an end, so 2019-05 to 2019 is allowed."""
    return value if len(value) == 7 else value + ('-12' if last else '-01')


def check_touched(touched: list) -> None:
    """@description A job the patch added or changed must end with a title, an employer, a start month and an end
    month that is not before it. Jobs it did not touch keep whatever an upload stored.
    @param touched the jobs the patch set or added @returns None; raises ValueError"""
    for role in touched:
        title = role_value(role, 'title').strip()
        if not title:
            raise ValueError('every job needs a job title')
        if not role_value(role, 'org').strip():
            raise ValueError(f'{shown(title, card_targets.NAME_SHOWN)} needs an employer; add it in the same change')
        start = _month(role_value(role, 'start'), 'start', title)
        end = role_value(role, 'end')
        if end and _ordinal(_month(end, 'end', title), True) < _ordinal(start, False):
            raise ValueError(f'the end month of {shown(title, card_targets.NAME_SHOWN)} is before its start month')


def _backup_with(digest: str) -> str | None:
    folder = config.CAREER_DB.parent / 'backups'
    if not folder.is_dir():
        return None
    for item in sorted(folder.glob('career_db.*.json'), key=lambda path: path.stat().st_mtime_ns, reverse=True)[:UNDO_SEARCH]:
        if not item.is_file() or item.stat().st_size > profile._PROFILE_MAX_BYTES:
            continue
        text = item.read_text(encoding='utf-8')
        if hashlib.sha256(text.encode('utf-8')).hexdigest() == digest:
            return text
    return None


def earlier_texts() -> list:
    """@description The kept earlier profiles, newest first, each as (its revision, its exact text). The same backups
    Undo reads, at most UNDO_SEARCH of them; one that cannot be read is left out. @returns list of (str, str)"""
    folder = config.CAREER_DB.parent / 'backups'
    if not folder.is_dir():
        return []
    found = []
    for item in sorted(folder.glob('career_db.*.json'), key=lambda path: path.stat().st_mtime_ns, reverse=True)[:UNDO_SEARCH]:
        try:
            if not item.is_file() or item.stat().st_size > profile._PROFILE_MAX_BYTES:
                continue
            text = item.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        found.append((hashlib.sha256(text.encode('utf-8')).hexdigest(), text))
    return found


def earlier_text(revision: str) -> str | None:
    """@description The exact text of the profile when its revision was `revision`, from the kept backups (the ones
    Undo reads), or None when that version is no longer kept. @param revision a 64-character digest @returns str | None"""
    return _backup_with(revision)


def restore(revision=None, restore=None, **extra):
    """@description Undo: put back the earlier profile whose exact revision is `restore`, through the same backup,
    audit and atomic publish as every edit, only while the current profile is still exactly `revision` (the change
    being undone). Anything written after that change makes Undo unavailable instead of overwriting it.
    @param revision the revision the change produced @param restore the revision before it
    @returns {ok, changed, revision, changelog} or {ok: False, error, message}"""
    try:
        if extra or not all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) for value in (revision, restore)):
            raise ValueError('name the current revision and the revision to put back')
        text = profile._read_profile_text()
        if hashlib.sha256(text.encode('utf-8')).hexdigest() != revision:
            return {'ok': False, 'error': 'master_changed',
                    'message': 'Your main résumé changed after that change, so Undo is no longer available.'}
        earlier = _backup_with(restore)
        if earlier is None:
            return {'ok': False, 'error': 'undo_unavailable',
                    'message': 'The earlier version is no longer kept, so Undo is not available.'}
        raw = json.loads(earlier)
        if not isinstance(raw, dict):
            raise ValueError('the earlier version is unreadable')
        changelog = ['undo: put back the earlier main résumé']
        profile._persist_augmentation(text, raw, 'resume-studio undo', changelog)
        after = hashlib.sha256(profile._read_profile_text().encode('utf-8')).hexdigest()
        return {'ok': True, 'changed': True, 'revision': after, 'changelog': changelog}
    except OSError:
        return {'ok': False, 'error': 'Undo could not be confirmed. Read your work history again.'}
    except (ValueError, TypeError) as error:
        return {'ok': False, 'error': str(error)}
