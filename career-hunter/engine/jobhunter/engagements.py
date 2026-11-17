# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.4 (Roger, 2026-11-16 20:45Z: "i can not find where to see my expanded experience.. it doesnt show anywhere ... it covers like 20 different companies over a 4 year span when i was consulting in the field"). His client engagements (`project_ledger`) and client accounts (`named_accounts`) were always in the main résumé file, intact, and no screen read them except two flat lines lists at the end of Download my data. view() gives Work history every engagement and every account group, whole, in the order saved, each engagement with the job it was done under; apply_edit() adds, changes, moves and removes an engagement, its bullets and an account group through the same revision-checked, backed-up, audited main-résumé edit every Work history change uses. Stored in the keys they already had, so nothing moves: an entry gains `start`, `end`, `bullets` and `job` (the id of its job) only when the person writes them, and keys this page does not know are kept as they are.
"""Client engagements (project_ledger) and client accounts (named_accounts): the Work history view and its edits."""
from __future__ import annotations

import json

from . import card_targets, profile, work_history
from .card_targets import CardRefusal, plural, shown

FIELDS = ('engagement', 'engagement-bullet', 'accounts')
_KEYS = {
    'engagement': {'op', 'field', 'index', 'before', 'value', 'to', 'summary'},
    'engagement-bullet': {'op', 'field', 'engagementIndex', 'engagementName', 'index', 'before', 'value', 'to', 'summary'},
    'accounts': {'op', 'field', 'key', 'before', 'value', 'summary'},
}
_OPS = {'engagement': ('add', 'set', 'remove', 'move'), 'engagement-bullet': ('add', 'set', 'remove', 'move'),
        'accounts': ('add', 'set', 'remove')}
# What the page calls a field, and where it is stored. `months` is the length the ledger has always recorded.
_STORED = {'project': 'project', 'role': 'role', 'industry': 'industry', 'start': 'start', 'end': 'end',
           'months': 'duration_months', 'tech': 'tech', 'job': 'job', 'public': 'public'}
_KNOWN = {*_STORED.values(), 'bullets'}
MAX_ENGAGEMENTS = 300
NAME_MAX = 200
TEXT_MAX = 200
TECH_MAX_ITEMS = 60
TECH_MAX_CHARS = 120
MONTHS_MAX = 600
GROUPS_MAX = 60
NAMES_MAX = 500
SCORING_MAX_BYTES = 128 * 1024
MOVED = ('Your work history changed while this page was open. It has been read again as saved; '
         'make the change again. Nothing was changed.')


def _text(value) -> str:
    if isinstance(value, bool):
        return ''
    if isinstance(value, (int, float)):
        return str(value)
    return value.strip() if isinstance(value, str) else ''


def _texts(value) -> list:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    return [_text(item) for item in value if _text(item)] if isinstance(value, list) else []


def _human(key) -> str:
    words = ' '.join(str(key).replace('_', ' ').replace('-', ' ').split())
    return words[:1].upper() + words[1:]


def _name(item) -> str:
    """The name a person reads for one engagement: its project, or the text of an entry saved as plain text."""
    return _text(item.get('project')) if isinstance(item, dict) else _text(item)


def _jobs(raw: dict) -> list:
    roles = raw.get('roles')
    return roles if isinstance(roles, list) else []


def _job_of(item: dict, roles: list):
    """The job an engagement was done under, as {index, title, org}, or None when it names none still on file."""
    wanted = item.get('job')
    if not isinstance(wanted, str) or not wanted:
        return None
    for index, role in enumerate(roles):
        if isinstance(role, dict) and str(role.get('id') or '') == wanted:
            return {'index': index, 'title': work_history.role_value(role, 'title'),
                    'org': work_history.role_value(role, 'org') or work_history.role_value(role, 'employer')}
    return None


def _other(item: dict) -> list:
    """Every saved detail this page has no field for, as [label, text], so nothing saved is hidden."""
    out = []
    for key, value in item.items():
        if key in _KNOWN or str(key).startswith('_'):
            continue
        shown_value = ', '.join(_texts(value)) if isinstance(value, list) else _text(value)
        if isinstance(value, dict):
            shown_value = json.dumps(value, ensure_ascii=False)
        if shown_value:
            out.append([_human(key), shown_value])
    return out


def _bullets_of(entry: dict) -> list:
    """An engagement's bullets exactly as saved (so a page names each by its place and text as the edit finds it)."""
    bullets = entry.get('bullets')
    if isinstance(bullets, list) and all(isinstance(item, str) for item in bullets):
        return list(bullets)
    return _texts(bullets)


def _engagement_view(index: int, item, roles: list) -> dict:
    entry = item if isinstance(item, dict) else {}
    months = entry.get('duration_months')
    return {
        'index': index, 'project': _name(item), 'role': _text(entry.get('role')), 'industry': _text(entry.get('industry')),
        'start': _text(entry.get('start')), 'end': _text(entry.get('end')),
        'months': months if isinstance(months, (int, float)) and not isinstance(months, bool) else None,
        'tech': _texts(entry.get('tech')), 'bullets': _bullets_of(entry),
        'job': _job_of(entry, roles), 'public': entry.get('public') is not False, 'other': _other(entry),
    }


def view(raw: dict) -> dict:
    """@description Everything Work history shows of the person's expanded experience, read straight from the main
    résumé: every client engagement in saved order (whole: no entry, bullet or technology is left out at any count or
    size), every client account group, and the link to a detailed work addendum the profile keeps outside Career.
    @param raw the parsed main résumé @returns {engagements, accounts, addendum}"""
    roles = _jobs(raw)
    ledger = raw.get('project_ledger')
    engagements = [_engagement_view(n, item, roles) for n, item in enumerate(ledger if isinstance(ledger, list) else [])]
    groups = raw.get('named_accounts')
    accounts = [{'key': str(key), 'label': _human(key), 'items': _texts(names)}
                for key, names in (groups.items() if isinstance(groups, dict) else [])]
    web = ((raw.get('profile') or {}).get('web_presence') or {}) if isinstance(raw.get('profile'), dict) else {}
    addendum = _text(web.get('addendum')) if isinstance(web, dict) else ''
    return {'engagements': engagements, 'accounts': accounts,
            'addendum': addendum if addendum.lower().startswith(('https://', 'http://')) else ''}


def touches(edits) -> bool:
    """@description Whether a patch changes client engagements or accounts. @param edits the patch's edits @returns bool"""
    return isinstance(edits, list) and any(isinstance(edit, dict) and edit.get('field') in FIELDS for edit in edits)


def _checked(edit: dict) -> str:
    field = edit['field']
    if set(edit) - _KEYS[field]:
        raise CardRefusal('it carries something Career cannot change here')
    op = edit.get('op')
    if op not in _OPS[field]:
        raise CardRefusal('Career cannot make that kind of change here')
    if 'summary' in edit and (not isinstance(edit['summary'], str) or len(edit['summary']) > 300):
        raise CardRefusal('its summary must be one line of at most 300 characters')
    return op


def _ledger(raw: dict) -> list:
    ledger = raw.setdefault('project_ledger', [])
    if not isinstance(ledger, list):
        raise CardRefusal('your client engagements cannot be read as a list')
    return ledger


def _place(value, size: int, label: str) -> int:
    if type(value) is not int or not 0 <= value < size:
        place = value + 1 if type(value) is int else 'that cannot be read'
        raise CardRefusal(f'it names {label} at place {place}, and there {"is" if size == 1 else "are"} {size}')
    return value


def _find(ledger: list, index, before) -> tuple:
    at = _place(index, len(ledger), 'an engagement')
    if not isinstance(before, str) or _name(ledger[at]) != before:
        raise CardRefusal(f'the engagement at place {at + 1} reads "{shown(_name(ledger[at])) or "nothing"}" now, '
                          f'not "{shown(before) if isinstance(before, str) else "nothing"}"')
    if not isinstance(ledger[at], dict):
        ledger[at] = {'project': _name(ledger[at])}
    return at, ledger[at]


def _bounded(value, limit: int, label: str) -> str:
    if not isinstance(value, str):
        raise CardRefusal(f'the {label} must be text')
    text = ' '.join(value.split())
    if len(text) > limit:
        raise CardRefusal(f'the {label} is longer than {limit} characters')
    return text


def _month(value, label: str) -> str:
    text = _bounded(value, 7, label + ' month')
    if text and not work_history._MONTH.fullmatch(text):
        raise CardRefusal(f'the {label} month must be a year, or a year and month (for example 2007-03); '
                          f'it reads "{shown(text)}"')
    return text


def _months(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= MONTHS_MAX:
        raise CardRefusal(f'the length must be a number of months from more than 0 to {MONTHS_MAX}, or none')
    return value


def _tech(value) -> list:
    if not isinstance(value, list) or len(value) > TECH_MAX_ITEMS:
        raise CardRefusal(f'the technology must be a list of at most {TECH_MAX_ITEMS} names')
    items = [_bounded(item, TECH_MAX_CHARS, 'technology name') for item in value]
    return [item for item in items if item]


def _job(value, raw: dict):
    """A job named as {index, title} exactly as the page read it, stored as that job's id (given one if it had none)."""
    if value is None:
        return None
    roles = _jobs(raw)
    if not isinstance(value, dict) or set(value) - {'index', 'title'}:
        raise CardRefusal('the job it names cannot be read')
    at = _place(value.get('index'), len(roles), 'a job')
    role = roles[at]
    if not isinstance(role, dict) or work_history.role_value(role, 'title') != value.get('title'):
        raise CardRefusal(f'the job at place {at + 1} is not "{shown(value.get("title"), card_targets.NAME_SHOWN)}" now')
    if not str(role.get('id') or ''):
        role['id'] = work_history._new_id(roles)
    return str(role['id'])


def _written(key: str, value, raw: dict):
    if key == 'project':
        text = _bounded(value, NAME_MAX, 'client or project name')
        if not text:
            raise CardRefusal('an engagement needs the client or project name')
        return text
    if key in ('role', 'industry'):
        return _bounded(value, TEXT_MAX, 'role' if key == 'role' else 'industry')
    if key in ('start', 'end'):
        return _month(value, key)
    if key == 'months':
        return _months(value)
    if key == 'tech':
        return _tech(value)
    if key == 'job':
        return _job(value, raw)
    if not isinstance(value, bool):
        raise CardRefusal('"marked not public" must be yes or no')
    return value


def _filled(value) -> bool:
    if isinstance(value, (str, list)):
        return bool(_texts(value))
    return value is not None


def _unchanged(key: str, current, written) -> bool:
    """A value that reads the same as the one saved is left exactly as saved (spacing included)."""
    if key == 'tech':
        return _texts(current) == written
    if key in ('project', 'role', 'industry', 'start', 'end'):
        return isinstance(current, str) and ' '.join(current.split()) == written
    return current == written and type(current) is type(written)


def _write(entry: dict, values: dict, raw: dict) -> None:
    """Write the given fields into one entry: an empty text or list, no length and no job take the key away; a
    value that reads as saved, and every detail the page does not know, stay exactly as saved; marked not public
    is kept as false only."""
    if not isinstance(values, dict) or not values or set(values) - set(_STORED):
        raise CardRefusal('it names details of an engagement Career does not keep')
    for key, value in values.items():
        stored, written = _STORED[key], _written(key, value, raw)
        current = entry.get(stored)
        if key == 'public':
            if written is False:
                entry['public'] = False
            elif current is False:
                entry.pop('public')
        elif written in ('', None, []):
            if _filled(current):
                entry.pop(stored, None)
        elif not _unchanged(key, current, written):
            entry[stored] = written
    start, end = _text(entry.get('start')), _text(entry.get('end'))
    if start and end and work_history._ordinal(end, True) < work_history._ordinal(start, False):
        raise CardRefusal(f'the end month of {shown(_name(entry))} is before its start month')


def _engagement(raw: dict, edit: dict, op: str, changelog: list) -> bool:
    ledger = _ledger(raw)
    if op == 'add':
        if len(ledger) >= MAX_ENGAGEMENTS:
            raise CardRefusal(f'your work history holds at most {MAX_ENGAGEMENTS} client engagements')
        if edit.get('before') != '' or 'to' in edit:
            raise CardRefusal('a new engagement names only its place and its details')
        at = _place(edit.get('index'), len(ledger) + 1, 'a new engagement')
        entry = {}
        _write(entry, edit.get('value'), raw)
        if 'project' not in entry:
            raise CardRefusal('an engagement needs the client or project name')
        ledger.insert(at, entry)
        changelog.append(f'engagement added at {at + 1} ({_name(entry)})')
        return True
    at, entry = _find(ledger, edit.get('index'), edit.get('before'))
    if op == 'set':
        before = json.dumps(entry, sort_keys=True)
        _write(entry, edit.get('value'), raw)
        changed = json.dumps(entry, sort_keys=True) != before
        if changed:
            changelog.append(f'engagement {at + 1} ({_name(entry)}) set')
        return changed
    if 'value' in edit:
        raise CardRefusal('a removal or a move carries no new details')
    if op == 'remove':
        ledger.pop(at)
        changelog.append(f'engagement {at + 1} ({edit["before"]}) removed')
        return True
    to = _place(edit.get('to'), len(ledger), 'a new place for the engagement')
    ledger.insert(to, ledger.pop(at))
    changelog.append(f'engagement {at + 1} ({edit["before"]}) moved to {to + 1}')
    return to != at


def _bullet_values(edit: dict, name: str) -> list:
    """The bullets an add or set writes: one per line of its text (a pasted block), each within the bullet limit."""
    if not isinstance(edit.get('value'), str):
        raise CardRefusal('it has no new text')
    values = [line.strip() for line in card_targets.split_lines(edit['value'])]
    if not values or not all(values):
        raise CardRefusal(f'the new bullet under {shown(name)} is empty')
    for line in values:
        if len(line) > profile._MASTER_BULLET_MAX_CHARS:
            raise CardRefusal(f'a bullet under {shown(name)} is longer than {profile._MASTER_BULLET_MAX_CHARS} characters')
    return values


def _bullet(raw: dict, edit: dict, op: str, changelog: list) -> bool:
    """One bullet of one engagement added, changed, removed or moved; the engagement and the bullet are named by their
    place and their exact current text, as they read when the edit applies."""
    at, entry = _find(_ledger(raw), edit.get('engagementIndex'), edit.get('engagementName'))
    old = entry.get('bullets', [])
    if not isinstance(old, list) or any(not isinstance(item, str) for item in old):
        raise CardRefusal(f'the bullets of {shown(_name(entry))} are not plain text')
    bullets, before = list(old), edit.get('before')
    if op == 'add':
        n = _place(edit.get('index'), len(bullets) + 1, 'a new bullet')
        if before != (bullets[n] if n < len(bullets) else ''):
            raise CardRefusal(f'the bullets of {shown(_name(entry))} read differently now')
        bullets[n:n] = _bullet_values(edit, _name(entry))
    else:
        n = _place(edit.get('index'), len(bullets), 'a bullet')
        if before != bullets[n]:
            raise CardRefusal(f'bullet {n + 1} of {shown(_name(entry))} reads "{shown(bullets[n])}" now')
        if op == 'set':
            bullets[n:n + 1] = _bullet_values(edit, _name(entry))
        elif op == 'remove':
            bullets.pop(n)
        else:
            bullets.insert(_place(edit.get('to'), len(bullets), 'a new place for the bullet'), bullets.pop(n))
    if len(bullets) > max(profile._MASTER_MAX_BULLETS, len(old)):
        raise CardRefusal(f'{shown(_name(entry))} would have more than {profile._MASTER_MAX_BULLETS} bullets')
    if bullets == old:
        return False
    if bullets:
        entry['bullets'] = bullets
    else:
        entry.pop('bullets', None)
    changelog.append(f'engagement {at + 1} ({_name(entry)}) bullet {n + 1} {op}')
    return True


def _names(value) -> list:
    if not isinstance(value, list) or len(value) > NAMES_MAX:
        raise CardRefusal(f'a client account group holds a list of at most {NAMES_MAX} names')
    names = [_bounded(item, NAME_MAX, 'account name') for item in value]
    return [item for item in names if item]


def _accounts(raw: dict, edit: dict, op: str, changelog: list) -> bool:
    """One client account group: a new group, its names replaced, or the group removed. A group is named by its key
    and, for a change or a removal, by its exact current names."""
    groups = raw.setdefault('named_accounts', {})
    if not isinstance(groups, dict):
        raise CardRefusal('your client accounts cannot be read as groups')
    key = edit.get('key')
    if op == 'add':
        label = _bounded(key, 80, 'group name')
        if not label or any(_human(other).casefold() == _human(label).casefold() for other in groups):
            raise CardRefusal('a new group needs a name no other group has')
        if len(groups) >= GROUPS_MAX or edit.get('before') != []:
            raise CardRefusal(f'your client accounts hold at most {GROUPS_MAX} groups, and a new group quotes no names')
        names = _names(edit.get('value'))
        if not names:
            raise CardRefusal('a new group needs at least one name')
        groups[label] = names
        changelog.append(f'client accounts group added ({label}, {plural(len(names), "name")})')
        return True
    if not isinstance(key, str) or key not in groups:
        raise CardRefusal(f'there is no client account group "{shown(key)}" now')
    if edit.get('before') != _texts(groups[key]):
        raise CardRefusal(f'the client account group {shown(_human(key))} reads differently now')
    if op == 'remove':
        del groups[key]
        changelog.append(f'client accounts group removed ({_human(key)})')
        return True
    names = _names(edit.get('value'))
    if not names:
        raise CardRefusal('a group needs at least one name; remove the group instead')
    if names == groups[key]:
        return False
    groups[key] = names
    changelog.append(f'client accounts group set ({_human(key)}, {plural(len(names), "name")})')
    return True


def apply_edit(raw: dict, edit: dict, changelog: list) -> bool:
    """@description Apply one client engagement, engagement bullet or client account edit to the parsed main résumé in
    place, as it reads at that moment (the edits before it in the same patch included).
    @param raw the parsed main résumé @param edit one edit whose field is in FIELDS
    @param changelog receives one line per change @returns whether the main résumé changed"""
    op = _checked(edit)
    if edit['field'] == 'engagement':
        return _engagement(raw, edit, op, changelog)
    if edit['field'] == 'engagement-bullet':
        return _bullet(raw, edit, op, changelog)
    return _accounts(raw, edit, op, changelog)


def scoring_bytes(raw: dict) -> int:
    """@description The size of what job scoring reads (profile.scoring_context with the person's active other
    experience), for a main résumé not yet saved. @param raw the parsed main résumé @returns bytes"""
    document = dict(raw)
    try:
        from . import experience_bank
        extra = [entry for entry in experience_bank.read()['entries']
                 if not entry['archived'] and entry['id'] != experience_bank.LEGACY]
        if extra:
            document['additional_experience'] = extra
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return len(json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def check_budget(raw: dict, before: dict) -> None:
    """@description Job scoring reads the whole main résumé and refuses one over 128 KiB (profile.scoring_context), so
    an engagement change that would grow it past that is refused in words, before anything is saved; a change that
    shrinks one already over it is allowed. @param raw the main résumé after the patch @param before the one before
    @returns None; raises ValueError"""
    after = scoring_bytes(raw)
    if after > SCORING_MAX_BYTES and after > scoring_bytes(before):
        raise ValueError(f'Career scores jobs against your whole main résumé, which can be at most '
                         f'{SCORING_MAX_BYTES // 1024} KB; with this change it would be {after // 1024} KB. Shorten or '
                         f'leave out some engagement bullets, then save again. Nothing was changed.')
