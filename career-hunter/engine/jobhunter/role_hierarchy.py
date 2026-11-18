# CHANGE LOG
# SEQ | AUTHOR | DESCRIPTION
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep explicitly linked client roles as independent records under one employer, with bounded one-level relationships and pure presentation ordering.
"""Explicit employer/client relationships; no read migrates the owner's profile."""
from __future__ import annotations
import re

from .card_targets import CardRefusal

FIELDS = ('parent_role_id', 'engagements_heading')
HEADING = 'Selected Client Engagements'
_ID = re.compile(r'[A-Za-z0-9_.:-]{1,80}')


def _id(role):
    value = role.get('id') if isinstance(role, dict) else None
    return value if isinstance(value, str) and _ID.fullmatch(value) else ''


def validate(roles):
    """Refuse ambiguous, dangling, recursive or deeper-than-one-level links; untouched flat records stay valid."""
    ids = {}
    for role in roles:
        value = _id(role)
        if value:
            ids.setdefault(value, []).append(role)
    for role in roles:
        if not isinstance(role, dict):
            continue
        parent = role.get('parent_role_id')
        label = role.get('engagements_heading', '')
        if label not in ('', HEADING):
            raise CardRefusal('the client-engagement heading must be Selected Client Engagements or empty')
        if parent in (None, ''):
            continue
        if not isinstance(parent, str) or len(ids.get(parent, [])) != 1:
            raise CardRefusal('choose one existing employer entry for this client engagement')
        target = ids[parent][0]
        if target is role or target.get('parent_role_id'):
            raise CardRefusal('a client engagement must be under one top-level employer, never itself or another client engagement')
        if not _id(role) or len(ids.get(_id(role), [])) != 1:
            raise CardRefusal('this client engagement needs its own unique saved identity')
        if label:
            raise CardRefusal('the optional client-engagement heading belongs on the employer entry')


def metadata(role, roles):
    """Carry saved identity and optional relationship without inventing IDs or writing during a read."""
    validate(roles)
    result = {'id': _id(role)} if _id(role) else {}
    for key in FIELDS:
        if role.get(key):
            result[key] = role[key]
    return result


def document_roles(roles, stories):
    """The main document keeps every recorded role, date, bullet and evidence story independent.
    `stories` is the existing profile evidence mapper; no read writes or assigns identity.
    """
    return [{
        **metadata(r, roles),
        "title": r.get("title", ""),
        "org": r.get("org", ""),
        "span": f"{r.get('start', '')}–{r.get('end') or 'present'}",
        # 1.61.0: the months themselves, for the Work history page (an end of '' is present).
        "start": str(r.get("start") or ""),
        "end": str(r.get("end") or ""),
        "bullets": [str(b) for b in (r.get("deliverables") or [])],
        "stories": stories(r),
    } for r in roles]


def touches(edits):
    return any(isinstance(edit, dict) and edit.get('field') == 'role' and edit.get('key') in FIELDS for edit in edits)


def _ensure_id(role, roles):
    from .work_history import _new_id
    if not role.get('id'):
        role['id'] = _new_id(roles)
    if not _id(role) or sum(_id(item) == _id(role) for item in roles) != 1:
        raise CardRefusal('this entry has an ambiguous saved identity; its employer link was not changed')
    return role['id']


def _parent(value, roles, card):
    found = [role for role in roles if _id(role) == value]
    if not found and re.fullmatch(r'@index:[0-9]+', value):
        at = int(value.split(':')[1])
        originals = getattr(card, 'parent_reads', ())
        original = originals[at] if at < len(originals) else None
        if original is not None and any(role is original for role in roles):
            found = [original]
    if len(found) != 1:
        raise CardRefusal('choose one existing employer entry; your work history was not changed')
    return _ensure_id(found[0], roles)


def apply(raw, edit, card, changelog):
    """Apply one exact relationship edit inside the existing revision-checked atomic owner patch."""
    from .card_targets import find_job
    _, role = find_job(card, raw, edit)
    key, value = edit.get('key'), edit.get('value')
    if key not in FIELDS or edit.get('op') != 'set' or not isinstance(value, str):
        raise CardRefusal('an employer relationship is one explicit set change')
    current = role.get(key) or ''
    if edit.get('before') != current:
        raise CardRefusal('the employer relationship reads differently now; read your work history again')
    roles = raw.get('roles', [])
    if key == 'parent_role_id' and value:
        value = _parent(value, roles, card)
        _ensure_id(role, roles)
    if key == 'engagements_heading' and value not in ('', HEADING):
        raise CardRefusal('choose Selected Client Engagements or no subheading')
    if value == current:
        return False
    if value:
        role[key] = value
    else:
        role.pop(key, None)
    validate(roles)
    changelog.append(f'role {role.get("title", "")} {key} set')
    return True


def refuse_parent_removal(roles, role):
    if _id(role) and any(item.get('parent_role_id') == _id(role) for item in roles):
        raise CardRefusal("unlink this employer's client engagements before removing the employer entry")


def ordered(experience):
    """A new list in root/sibling saved order; each source record remains independent and unchanged."""
    validate(experience)
    output = []
    for role in experience:
        if role.get('parent_role_id'):
            continue
        output.append(dict(role))
        children = [child for child in experience if child.get('parent_role_id') == _id(role)] if _id(role) else []
        for index, child in enumerate(children):
            output.append({**child, 'group_heading': role.get('engagements_heading', '') if index == 0 else ''})
    return output


def require_parents(entries, roles):
    """A required child cannot be printed without its recorded employer; no dates or wording are inferred."""
    validate(roles)
    required = {roles[e['index']].get('parent_role_id') for e in entries if e['required']}
    for entry in entries:
        if _id(roles[entry['index']]) in required:
            entry['required'] = True


def has_links(roles):
    return any(any(role.get(key) for key in FIELDS) for role in roles if isinstance(role, dict))


def recorded_roles(item, entries, strict=False):
    """Only exact recorded title/employer anchors can bind generated text to a saved hierarchy identity."""
    text = lambda value: ' '.join(str(value or '').split()).casefold()
    found = [entry for entry in entries if text(item.get('title')) == text(entry['title'])
             and text(item.get('org')) == text(entry['org'])]
    key = text(item.get('role'))
    if key:
        found = [entry for entry in found if text(entry['key']) == key]
    return found if len(found) == 1 else []


def packet(experience, entries, prof):
    """Pin hierarchy from recorded identities, not model-provided parent links, before role keys are removed."""
    roles = prof.get('roles') or []
    linked = has_links(roles)
    for item in experience:
        for key in ('id', *FIELDS, 'group_heading'):
            item.pop(key, None)
        if not linked:
            continue
        found = recorded_roles(item, entries)
        if len(found) == 1:
            item.update(metadata(roles[found[0]['index']], roles))
    return ordered(experience)


def compact(experience, start_year):
    """Keep a linked employer/client group together in compact detail, without changing its recorded dates."""
    items = ordered(experience)
    parents = {item.get('parent_role_id') for item in items if item.get('parent_role_id')}
    recent, earlier = [], []
    for item in items:
        year = start_year(item.get('span'))
        if item.get('parent_role_id') or _id(item) in parents or year >= 2011:
            recent.append(item)
        elif 0 < year < 2011:
            earlier.append(item)
    if not recent:
        return items[:4], items[4:]
    return recent, earlier
