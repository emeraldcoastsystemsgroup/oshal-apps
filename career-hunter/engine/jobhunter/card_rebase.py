# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: a Work history card answered "could not run - Your main résumé changed"). A card carries the revision the concierge read, and the main résumé moves under it: two cards are written from one reading and the first is approved, or the My résumé document saves. Such a card is no longer refused whole. It is first applied to the version it read (kept as Undo keeps it), which says exactly which job and which bullet each change named; each of those is then found in the main résumé as it is now and must still be exactly what the person read on the card: the job by its title and employer, a bullet, competency or skill by its whole text, a removed job whole, a moved job or bullet in an unchanged order. Then the card is applied to the main résumé as it is now, all or nothing. Anything else is refused naming the change and the job.
"""Fit one approval card, written on an earlier revision, to the main résumé as it is now."""
from __future__ import annotations

from . import card_targets
from .card_targets import NAME_SHOWN, shown

SUMMARY_SHOWN = 70
NOTE = ('Applied to your work history as it is now: it had changed after this card was written, '
        'and everything this card names still read the same.')
_TAIL = '. Nothing was changed. Ask again and the concierge proposes it on your work history as it is now.'
_NOUNS = {'experience': 'bullet', 'competencies': 'core competency', 'skills': 'skill'}
_WHERE = {'competencies': 'in your core competencies', 'skills': 'in your skills'}


class Unfit(ValueError):
    """The card cannot be applied on the main résumé as it is now; the text is the whole refusal, for the person."""


def unknown() -> str:
    """@description The refusal for a card whose reading Career no longer keeps. @returns str"""
    return ('Your main résumé changed after this card was written, and the version it read is no longer kept, '
            'so Career cannot check the card against it' + _TAIL)


def refusal(card, edit, message: str) -> str:
    """@description The words a card refused on a later revision shows: which change, then which job and what is
    different now, first (an approval card shows about 200 characters), then that nothing changed and what to do.
    @param card the card (its number and total) @param edit the edit that no longer fits, or None for the card
    @param message what is different now @returns str of at most card_targets.ERROR_MAX_CHARS"""
    if edit is None:
        head = 'This change no longer fits'
    else:
        head = f'Change {card.number} of {card.total} ({shown(card_targets._described(edit), SUMMARY_SHOWN)}) no longer fits'
    body = message.rstrip('.')
    room = card_targets.ERROR_MAX_CHARS - len(head) - len(_TAIL) - 2
    return f'{head}: {body if len(body) <= room else body[:room - 1].rstrip() + "…"}{_TAIL}'


def _key(role) -> tuple:
    return (card_targets._value(role, 'title'), card_targets._value(role, 'org'))


def _name(role) -> str:
    title, org = _key(role)
    return shown(title or 'a job', NAME_SHOWN) + (' at ' + shown(org, NAME_SHOWN) if org else '')


def _bullets(role) -> list:
    items = role.get('deliverables') if isinstance(role, dict) else None
    return list(items) if isinstance(items, list) else []


def _twin(read: dict, now: list):
    """The job in the main résumé as it is now that is the job the card read: the same title and employer, and when
    two jobs share both, the same id or the same months."""
    same = [role for role in now if isinstance(role, dict) and _key(role) == _key(read)]
    for narrow in (lambda role: read.get('id') is not None and role.get('id') == read.get('id'),
                   lambda role: (role.get('start'), role.get('end')) == (read.get('start'), read.get('end'))):
        if len(same) > 1:
            same = [role for role in same if narrow(role)] or same
    if not same:
        raise Unfit(f'{_name(read)} was changed or removed after this card was written')
    if len(same) > 1:
        raise Unfit(f'more than one job is {_name(read)} now, so Career cannot tell which one this card means')
    return same[0]


def _job_checks(edit: dict, read: dict, twin: dict, same_order: bool) -> None:
    """What a job-level change needs beyond finding its job: a removed job whole as read, a move in the order read."""
    op, field = edit.get('op'), edit.get('field')
    if field == 'role' and op == 'remove' and twin != read:
        raise Unfit(f'{_name(read)} changed after this card was written, and the card removes it as it read then')
    if field == 'role' and op == 'move' and not same_order:
        raise Unfit('the order of your jobs changed after this card was written')
    if field == 'experience' and op == 'move' and _bullets(twin) != _bullets(read):
        raise Unfit(f'the bullets of {_name(read)} changed after this card was written')


def _item_checks(edit: dict, item, as_read: list, now: list, where: str) -> dict:
    """One list change (a job's bullets, the competencies, the skills) fitted to the list as it is now: the item it
    names must still read exactly as the card read it and is then named by its whole text, an add at the end stays an
    add at the end, and what an earlier change already added is not added twice."""
    fitted, noun = dict(edit), _NOUNS[edit['field']]
    if isinstance(item, str) and item in as_read:
        if item not in now:
            raise Unfit(f'the {noun} "{shown(item)}" {where} was changed or removed after this card was written')
        fitted['before'] = item
        fitted.pop('index', None)
    if edit['op'] == 'add':
        if edit.get('before') == '':
            fitted.pop('index', None)
        for line in card_targets.split_lines(edit.get('value') or ''):
            if line and line in now and line not in as_read:
                raise Unfit(f'"{shown(line)}" is already {where}')
    return fitted


def fit(read_card, read_roles: list, edits: list, raw: dict, lists_now: dict):
    """@description Turn a card written on an earlier revision into the same card for the main résumé as it is now.
    @param read_card the card_targets.Card after the card was applied to the version it read (its targets, items, made)
    @param read_roles that version's jobs as read, in order (deep copies taken before the card touched them)
    @param edits the card's edits @param raw the parsed profile as it is now
    @param lists_now the competencies and skills as they are now
    @returns (edits, pins, pin_made): the edits to apply now, each change's job as it is now, and for a change that
    names a job this card adds, the number of the change that adds it; raises Unfit with the whole refusal"""
    now = raw.get('roles') if isinstance(raw.get('roles'), list) else []
    place = {id(role): n for n, (role, _, _) in enumerate(read_card.read) if role is not None}
    made = {id(role): number for number, role in read_card.made.items()}
    same_order = [_key(role) for role in read_roles] == [_key(role) for role in now]
    fitted, pins, pin_made = [], {}, {}
    for number, edit in enumerate(edits, 1):
        read_card.number = number
        try:
            op, field, target = edit.get('op'), edit.get('field'), read_card.targets.get(number)
            read = twin = None
            if target is not None and id(target) in made:
                pin_made[number] = made[id(target)]
            elif target is not None:
                read = read_roles[place[id(target)]]
                twin = pins[number] = _twin(read, now)
                _job_checks(edit, read, twin, same_order)
            if field == 'role' and op == 'add' and not same_order and edit.get('index') != 0:
                raise Unfit(f'it puts the new job {shown(edit.get("value") or "", NAME_SHOWN)} at place '
                            f'{edit.get("index", 0) + 1 if type(edit.get("index")) is int else "that cannot be read"}, '
                            'and your jobs changed after this card was written')
            if field == 'experience' and twin is not None:
                edit = _item_checks(edit, read_card.items.get(number), _bullets(read), _bullets(twin), 'under ' + _name(read))
            elif field in _WHERE:
                edit = _item_checks(edit, read_card.items.get(number), read_card.lists.get(field, []),
                                    lists_now.get(field, []), _WHERE[field])
            elif field == 'experience' and op == 'add' and edit.get('before') == '':
                edit = {key: value for key, value in edit.items() if key != 'index'}
            fitted.append(edit)
        except Unfit as error:
            raise Unfit(refusal(read_card, edit, str(error))) from None
    return fitted, pins, pin_made
