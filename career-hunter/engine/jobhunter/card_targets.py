# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "could not run - Your main résumé changed"): a Card remembers which job and which list item each change named (targets, items) and which job each add made (made), so a card written on an earlier revision can be fitted to the main résumé as it is now (card_rebase); when it is, each change's job is given (pins, pin_made) and is never looked up by a place that has moved.
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13, the Work history concierge: "it wasnt able to perform the change i asked for"; one card of four edits, two bullets under a job that had none and two other jobs removed, answered "item index must be an integer from 0 to 0" and changed nothing). A card is written from one reading of the work history, and the concierge numbers its edits in more than one way: on blue it wrote the new bullets as their final places (0, 1) and the removed jobs where it read them, each with index as well; Roger's card counted a bullet from one. Positions are therefore never the anchor. A job is the one whose exact title (and employer, when the edit names it) the edit names, at the place the concierge read it or the place the card's earlier edits left it; a job the card itself added is named where its add put it; two jobs that both fit are refused, never guessed. A bullet or list item is the one whose exact text the edit quotes; an add that quotes none goes at the end, in the order written. Every refusal names the change, the job and the text in words.
"""Which job and which bullet each edit of one approval card names, as the person read the card."""
from __future__ import annotations

import re

TEXT_SHOWN = 60
NAME_SHOWN = 60
SUMMARY_SHOWN = 120
ERROR_MAX_CHARS = 500
QUOTE_MIN = 30
_MARK = re.compile(r'^\s*(?:[•●▪◦‣∙·*\-–—]|\(?\d{1,2}[.)])\s+')
FIELD_WORDS = {'role': 'a job', 'experience': 'a bullet', 'competencies': 'a core competency', 'skills': 'a skill',
                'headline': 'the headline', 'summary': 'the summary', 'clearance': 'the clearance'}
_OP_WORDS = {'set': 'change', 'add': 'add', 'remove': 'remove', 'move': 'move', 'split': 'split'}


class CardRefusal(ValueError):
    """One edit of a card cannot apply; the text names the job and what is wrong, for the person."""


def shown(text, limit: int = TEXT_SHOWN) -> str:
    """@description Text as a refusal quotes it: one line, at most `limit` characters.
    @param text any value @param limit the longest quote @returns str"""
    line = ' '.join(str(text).split())
    return line if len(line) <= limit else line[:limit - 1].rstrip() + '…'


def plural(count: int, noun: str) -> str:
    """@description "1 bullet", "3 bullets". @param count @param noun @returns str"""
    return f'{count} {noun}' if count == 1 else f'{count} {noun}s'


def _spaced(text) -> str:
    return ' '.join(str(text).split())


def _continues(previous: str, line: str) -> bool:
    """A wrapped line (text copied out of a PDF or an email): the line before ends mid-sentence and this one goes on
    in lower case."""
    return not re.search(r'[.!?:;)\]"”]$', previous) and line[:1].islower()


def split_lines(text: str) -> list:
    """@description A pasted block as its bullets, the way a person reads it: one bullet per line; when lines carry a
    list mark (•, -, *, 1.) each mark starts a bullet and an unmarked line goes on the one before it; a line that goes
    on mid-sentence in lower case joins the line before. The marks are taken off. A one-line text is itself.
    @param text the bullet text @returns list of bullets"""
    lines = [line.strip() for line in str(text).splitlines() if line.strip()]
    if len(lines) < 2:
        return [str(text).strip()]
    marked = any(_MARK.match(line) for line in lines)
    bullets = []
    for line in lines:
        body = _MARK.sub('', line).strip()
        starts = bool(_MARK.match(line)) if marked else not (bullets and _continues(bullets[-1], body))
        if bullets and not starts:
            bullets[-1] = bullets[-1] + ' ' + body
        elif body:
            bullets.append(body)
    return bullets


def _value(role, key: str) -> str:
    value = role.get(key) if isinstance(role, dict) else None
    return '' if value is None else str(value)


def _same(a, b) -> bool:
    return ' '.join(str(a or '').split()).casefold() == ' '.join(str(b or '').split()).casefold()


class Card:
    """@description What the concierge read when it wrote one card (the profile at the card's revision) and what the
    card's earlier edits did since. Role dicts keep their identity while edits insert, remove and move them, so a job
    is followed by identity, never by its place."""

    def __init__(self, raw: dict, total: int, lists: dict | None = None):
        roles = raw.get('roles') if isinstance(raw.get('roles'), list) else []
        self.read = [(role, _value(role, 'title'), _value(role, 'org')) if isinstance(role, dict) else (None, '', '')
                     for role in roles]
        self._read = {id(role): (title, org) for role, title, org in self.read if role is not None}
        self.bullets = {id(role): list(role['deliverables']) if isinstance(role.get('deliverables'), list) else []
                        for role, _, _ in self.read if role is not None}
        self.lists = {key: list(value) for key, value in (lists or {}).items()}
        self.added: set[int] = set()
        self.removed: list[tuple[set, set]] = []
        self.total = total
        self.number = 0
        # What each change named, by its number: the job, the exact text of the list item, and the job an add made.
        self.targets: dict[int, dict] = {}
        self.items: dict[int, str] = {}
        self.made: dict[int, dict] = {}
        # A card applied on a later revision than it read (card_rebase.fit): each change's job as it is now, and for
        # a change naming a job this card adds, the number of the change that adds it.
        self.pins: dict[int, dict] = {}
        self.pin_made: dict[int, int] = {}

    def read_title(self, role):
        """@description The job's title as the card's reading had it, or None for a job the card added."""
        return self._read.get(id(role), (None, None))[0]

    def read_org(self, role):
        """@description The job's employer as the card's reading had it, or None for a job the card added."""
        return self._read.get(id(role), (None, None))[1]

    def name(self, role) -> str:
        """@description "Founder at Gulf Coast Test Works", from the job as it is now (its read title when cleared)."""
        title = _value(role, 'title') or self.read_title(role) or 'the new job'
        org = _value(role, 'org') or self.read_org(role) or ''
        return shown(title, NAME_SHOWN) + (' at ' + shown(org, NAME_SHOWN) if org else '')

    def remember_added(self, role) -> None:
        """@description Record a job this card added, under the number of the change that added it."""
        self.added.add(id(role))
        self.made[self.number] = role

    def remember_item(self, text) -> None:
        """@description Record the exact text of the list item the current change acts on."""
        if isinstance(text, str):
            self.items.setdefault(self.number, text)

    def pinned(self):
        """@description The job given for the current change when the card is applied on a later revision, else None."""
        if self.number in self.pins:
            return self.pins[self.number]
        return self.made.get(self.pin_made.get(self.number))

    def remember_removed(self, role) -> None:
        """@description Record a job this card removed, so a later edit naming it is told so."""
        self.removed.append(({_value(role, 'title'), self.read_title(role) or ''},
                             {_value(role, 'org'), self.read_org(role) or ''}))


def _anchor(edit: dict):
    title, org, position = edit.get('roleTitle'), edit.get('roleOrg'), edit.get('roleIndex')
    if not isinstance(title, str) or not title.strip():
        raise CardRefusal('it does not name the job by its title')
    if org is not None and not isinstance(org, str):
        raise CardRefusal(f'it names the employer of {shown(title, NAME_SHOWN)} in a form Career cannot read')
    if position is not None and (type(position) is not int or position < 0):
        raise CardRefusal(f'it names the place of {shown(title, NAME_SHOWN)} in a form Career cannot read')
    return title, org, position


def _missing(card: Card, title: str, org) -> str:
    for titles, orgs in card.removed:
        if title in titles and (org is None or any(_same(org, item) for item in orgs)):
            employer = next((item for item in orgs if item), '')
            return f'{shown(title, NAME_SHOWN)}{" at " + shown(employer, NAME_SHOWN) if employer else ""} is removed by an earlier change on this card'
    return f'there is no job titled {shown(title, NAME_SHOWN)}{" at " + shown(org, NAME_SHOWN) if org else ""} in your work history now'


def _twins(title: str, org) -> str:
    return (f'more than one job is titled {shown(title, NAME_SHOWN)}{" at " + shown(org, NAME_SHOWN) if org else ""}, '
            'so Career cannot tell which one the card means; ask again naming its employer')


def find_job(card: Card, raw: dict, edit: dict):
    """@description The job one edit names: its exact title (and employer, when given) at the place the concierge read
    it or the place the card's earlier edits left it, a job the card added where its add put it, or the only job with
    that title. Two different jobs that both fit are refused.
    @param card the card being applied @param raw the parsed profile @param edit one edit
    @returns (its place now, the role dict)"""
    roles = raw.get('roles')
    if not isinstance(roles, list):
        raise CardRefusal('your work history has no jobs to change')
    title, org, position = _anchor(edit)
    place = {id(role): n for n, role in enumerate(roles)}
    given = card.pinned()
    if given is not None or card.number in card.pins or card.number in card.pin_made:
        if given is None or id(given) not in place:
            raise CardRefusal(_missing(card, title, org))
        card.targets.setdefault(card.number, given)
        return place[id(given)], given

    def fits(role) -> bool:
        return org is None or id(role) in card.added or _same(org, _value(role, 'org')) or _same(org, card.read_org(role))
    applied = roles[position] if position is not None and position < len(roles) else None
    if not (isinstance(applied, dict) and _value(applied, 'title') == title and fits(applied)):
        applied = None
    if applied is not None and id(applied) in card.added:
        return place[id(applied)], applied
    read = card.read[position] if position is not None and position < len(card.read) else (None, '', '')
    read = read[0] if read[0] is not None and read[1] == title and id(read[0]) in place and fits(read[0]) else None
    if applied is not None and read is not None and applied is not read:
        raise CardRefusal(_twins(title, org))
    chosen = applied or read
    if chosen is None:
        matches = [role for role in roles if isinstance(role, dict) and fits(role)
                   and title in (_value(role, 'title'), card.read_title(role))]
        if not matches:
            matches = [role for role in roles if isinstance(role, dict) and fits(role)
                       and any(_same(title, name) for name in (_value(role, 'title'), card.read_title(role)) if name)]
        if len(matches) > 1:
            raise CardRefusal(_twins(title, org))
        if not matches:
            raise CardRefusal(_missing(card, title, org))
        chosen = matches[0]
    card.targets.setdefault(card.number, chosen)
    return place[id(chosen)], chosen


def _quoted(items: list, text: str, index):
    """Where a quoted text is: exactly, else the one item equal to it but for spacing, else the one item a quote of at
    least QUOTE_MIN characters opens (a long bullet need not be copied whole). The profile's revision, checked for the
    whole card, already proves nothing changed since the concierge read it; the quote only says which item."""
    for same in (lambda item: item == text, lambda item: _spaced(item) == _spaced(text),
                 lambda item: len(_spaced(text)) >= QUOTE_MIN and _spaced(item).startswith(_spaced(text).rstrip('…').rstrip())):
        hits = [n for n, item in enumerate(items) if same(item)]
        if hits:
            return hits, (index if index in hits else hits[0])
    return [], None


def list_position(items: list, read_items: list, edit: dict, where: str, noun: str) -> int:
    """@description The place one edit acts on in a list (a job's bullets, the competencies, the skills): the item whose
    text it quotes (before: exactly, but for spacing, or the opening of a long one), its index only choosing between
    identical texts; an add that quotes no text goes at the end, in the order the card writes them.
    @param items the list now @param read_items the list as the card's reading had it
    @param edit one edit @param where "under Founder at Gulf Coast Test Works" @param noun "bullet"
    @returns the position (len(items) for an add at the end)"""
    index = edit.get('index')
    if index is not None and (type(index) is not int or index < 0):
        raise CardRefusal(f'it names a place {where} in a form Career cannot read')
    text = edit['before']
    if edit['op'] == 'add' and text == '':
        if index is not None and index < len(items) and index < len(read_items):
            raise CardRefusal(f'it adds a {noun} {where} somewhere other than the end; to do that, name the {noun} it goes before')
        return len(items)
    hits, at = _quoted(items, text, index)
    if len(hits) > 1 and items[at] != text and len({items[n] for n in hits}) > 1:
        raise CardRefusal(f'more than one {noun} {where} begins "{shown(text)}"; quote more of the one to change')
    if hits:
        return at
    if text and _quoted(read_items, text, None)[0]:
        raise CardRefusal(f'the {noun} "{shown(text)}" {where} is changed or removed by an earlier change on this card')
    raise CardRefusal(f'{where} there is no {noun} that reads "{shown(text)}"')


def _described(edit) -> str:
    if not isinstance(edit, dict):
        return 'an edit'
    summary = edit.get('summary')
    if isinstance(summary, str) and summary.strip():
        return shown(summary, SUMMARY_SHOWN)
    words = f'{_OP_WORDS.get(edit.get("op"), "change")} {FIELD_WORDS.get(edit.get("field"), "a part of the résumé")}'
    title = edit.get('roleTitle')
    return words + (f' of {shown(title, NAME_SHOWN)}' if isinstance(title, str) and title.strip() and edit.get('field') != 'role' else '')


def refusal(card: Card, edit, message: str) -> str:
    """@description The words a refused card shows the person: which change, which job, what is wrong, and that
    nothing changed. At most ERROR_MAX_CHARS (the route shows no more).
    @param card the card @param edit the edit that could not apply, or None for the card as a whole
    @param message what is wrong @returns str"""
    head = 'This change did not apply' if edit is None else f'Change {card.number} of {card.total} ({_described(edit)}) did not apply'
    tail = '. Nothing was changed. Ask again and the concierge reads your work history fresh.'
    body = message.rstrip('.')
    room = ERROR_MAX_CHARS - len(head) - len(tail) - 2
    return f'{head}: {body if len(body) <= room else body[:room - 1].rstrip() + "…"}{tail}'
