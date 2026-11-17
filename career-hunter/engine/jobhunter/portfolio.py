# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-17: "i had oshal and agentic federal but now we have oswarm.ai and the product changed ... the bullets for oshal now should be oswarm and updated"): the saved portfolio (`oss_portfolio`, the entry Other experience lists as saved-portfolio and job scoring reads) is read whole with the exact revision of the main résumé it sits in, and saved whole as one main-résumé edit (field `portfolio` of POST /resume/master-edit, master_edit.apply_edits): every field the Edit form shows is checked first (lengths, item counts, http or https links, no control characters), then the one write goes through the same backup, audit and atomic publish as every main-résumé edit, so Undo (work_history.restore) puts the earlier version back. A save on a main résumé that moved after the form read it is refused, never fitted. Keys the form does not show are kept. A list whose own copy of the entry was saved on Other experience earlier says so on read, and a save there is refused rather than leaving two versions apart. A person with no saved portfolio can have one written by the same edit (the list then offers it); an empty form writes nothing.
"""The saved independent-work portfolio (`oss_portfolio`) read and replaced whole, model-free."""
from __future__ import annotations

import json
import re

from . import config, engagements

FIELD = 'portfolio'
LEGACY = 'saved-portfolio'
# Form field -> (where it is kept, longest text). `entry.` keys sit in the portfolio's `entry` object.
TEXTS = {'label': ('label', 160), 'note': ('_note', 1000), 'title': ('entry.title', 160), 'org': ('entry.org', 160),
         'span': ('entry.span', 100), 'person_url': ('entry.person_url', 500), 'platform_url': ('entry.platform_url', 500),
         'product_url': ('entry.product_url', 500), 'scoring_blurb': ('scoring_blurb', 4000)}
# Form field -> (where it is kept, most items, longest item).
LISTS = {'bullets': ('entry.bullets', 20, 1500), 'tech': ('entry.tech', 60, 100), 'applications': ('entry.applications', 60, 100),
         'skills': ('skills', 60, 100)}
LINKS = ('person_url', 'platform_url', 'product_url')
WORDS = {'label': 'label', 'note': 'private note', 'title': 'your role', 'org': 'organization or product', 'span': 'dates',
         'person_url': 'your site', 'platform_url': 'product site', 'product_url': 'product link', 'scoring_blurb': 'summary for job scoring',
         'bullets': 'bullets', 'tech': 'technology', 'applications': 'applications', 'skills': 'skills'}
CONTROL = re.compile(r'[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]')
LINK = re.compile(r'https?://\S+', re.IGNORECASE)
MOVED = ('Your main résumé changed after this form was opened, so nothing was saved. '
         'The portfolio has been read again as saved; make the change again.')
COPY = ('Your Other experience list keeps its own copy of this entry, saved on that page earlier, and résumés use that '
        'copy. Change it there; this form would leave the two versions apart.')


class PortfolioRefusal(ValueError):
    """A portfolio read or save that cannot be made, in words a person reads (master_edit adds that nothing was saved)."""


def touches(edits) -> bool:
    """@description Whether a main-résumé patch replaces the saved portfolio. @param edits the patch's edits @returns bool"""
    return isinstance(edits, list) and any(isinstance(edit, dict) and edit.get('field') == FIELD for edit in edits)


def _held(portfolio: dict, place: str):
    owner = portfolio.get('entry') if place.startswith('entry.') else portfolio
    return owner.get(place.split('.', 1)[-1]) if isinstance(owner, dict) else None


def form_of(portfolio) -> dict:
    """@description The portfolio as the Edit form shows it: every text as text (absent is empty) and every list as
    its items. A stored value that is not plain text is refused in words rather than shown in part.
    @param portfolio the stored `oss_portfolio` object @returns dict of the form's fields; raises PortfolioRefusal"""
    if not isinstance(portfolio, dict) or not portfolio:
        raise PortfolioRefusal('You have no saved portfolio to change.')
    if 'entry' in portfolio and not isinstance(portfolio['entry'], dict):
        raise PortfolioRefusal('Your saved portfolio is not in the shape this form edits.')
    form = {}
    for name, (place, _) in TEXTS.items():
        value = _held(portfolio, place)
        if value is not None and not isinstance(value, str):
            raise PortfolioRefusal(f'The {WORDS[name]} of your saved portfolio is not plain text, so this form cannot show it whole.')
        form[name] = value or ''
    for name, (place, _, _) in LISTS.items():
        value = _held(portfolio, place)
        if value is not None and (not isinstance(value, list) or any(not isinstance(item, str) for item in value)):
            raise PortfolioRefusal(f'The {WORDS[name]} of your saved portfolio are not a plain list, so this form cannot show them whole.')
        form[name] = list(value or [])
    return form


def _copy_held() -> bool:
    """Whether the Other experience list file keeps its own entry under the saved portfolio's id (an earlier save of
    the entry on that page), which résumés then use instead of the portfolio."""
    path = config.DATA_DIR / 'experience-bank.json'
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 512 * 1024:
            return False
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    entries = data.get('entries') if isinstance(data, dict) else None
    return isinstance(entries, list) and any(isinstance(item, dict) and item.get('id') == LEGACY for item in entries)


def read_section(raw: dict, revision: str) -> dict:
    """@description The answer to GET /resume/master-section?field=portfolio: the whole form with the main résumé's
    exact revision, whether a portfolio is saved, and whether the Other experience list keeps its own copy.
    @param raw the parsed main résumé @param revision its exact revision @returns dict"""
    portfolio = raw.get('oss_portfolio')
    present = isinstance(portfolio, dict) and bool(portfolio)
    return {'ok': True, 'revision': revision, 'field': FIELD, 'present': present, 'copy': _copy_held(),
            'portfolio': form_of(portfolio) if present else None, 'limits': limits()}


def limits() -> dict:
    """@description What the form may hold, so the page and the engine keep one rule. @returns dict"""
    return {'texts': {name: size for name, (_, size) in TEXTS.items()},
            'lists': {name: {'items': items, 'chars': chars} for name, (_, items, chars) in LISTS.items()}}


def _text(name, value) -> str:
    if not isinstance(value, str):
        raise PortfolioRefusal(f'The {WORDS[name]} must be text.')
    value = value.strip()
    if CONTROL.search(value):
        raise PortfolioRefusal(f'The {WORDS[name]} holds a character that cannot be saved.')
    if len(value) > TEXTS[name][1]:
        raise PortfolioRefusal(f'The {WORDS[name]} is longer than {TEXTS[name][1]} characters.')
    if name in LINKS and value and not LINK.fullmatch(value):
        raise PortfolioRefusal(f'The {WORDS[name]} must be a full web address starting with https:// or http://, or empty.')
    return value


def _items(name, value) -> list:
    _, most, longest = LISTS[name]
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise PortfolioRefusal(f'The {WORDS[name]} must be a list of text.')
    items = [item.strip() for item in value if item.strip()]
    if len(items) > most:
        raise PortfolioRefusal(f'Keep at most {most} {WORDS[name]}; this has {len(items)}.')
    for number, item in enumerate(items, 1):
        if CONTROL.search(item):
            raise PortfolioRefusal(f'Item {number} of the {WORDS[name]} holds a character that cannot be saved.')
        if len(item) > longest:
            raise PortfolioRefusal(f'Item {number} of the {WORDS[name]} is longer than {longest} characters.')
    return items


def checked(value) -> dict:
    """@description An Edit form's values, every field checked before anything is written: exactly the form's fields,
    texts within their lengths, links as full http or https addresses, lists within their counts.
    @param value the edit's value @returns dict of cleaned fields; raises PortfolioRefusal"""
    if not isinstance(value, dict) or set(value) != {*TEXTS, *LISTS}:
        raise PortfolioRefusal('Save the whole portfolio form: every field it shows, and nothing else.')
    return {**{name: _text(name, value[name]) for name in TEXTS}, **{name: _items(name, value[name]) for name in LISTS}}


def _put(portfolio: dict, place: str, value) -> None:
    if place.startswith('entry.'):
        owner, key = portfolio.setdefault('entry', {}), place.split('.', 1)[1]
    else:
        owner, key = portfolio, place
    if value == '':
        owner.pop(key, None)
    else:
        owner[key] = value


def apply_edit(raw: dict, edit: dict, changelog: list) -> bool:
    """@description One portfolio replacement inside a main-résumé patch: `{op: 'set', field: 'portfolio', value}`
    (an optional `summary` line is allowed). The stored portfolio must read as the form shows it; the new values are
    written over it, an empty text removes its key, and keys the form does not show are kept. With no portfolio saved
    yet, a form that holds anything writes one.
    @param raw the parsed main résumé, changed in place @param edit the edit @param changelog lines for the audit
    @returns whether anything changed; raises PortfolioRefusal"""
    if set(edit) - {'op', 'field', 'value', 'summary'} or edit.get('op') != 'set':
        raise PortfolioRefusal('A portfolio change replaces the whole form, and carries nothing else.')
    if 'summary' in edit and (not isinstance(edit['summary'], str) or len(edit['summary']) > 300):
        raise PortfolioRefusal('Its summary must be one line of at most 300 characters.')
    if _copy_held():
        raise PortfolioRefusal(COPY)
    values = checked(edit.get('value'))
    portfolio = raw.get('oss_portfolio')
    created = portfolio is None or portfolio == {}
    before = {name: [] if name in LISTS else '' for name in (*TEXTS, *LISTS)} if created else form_of(portfolio)
    changed = [name for name in (*TEXTS, *LISTS) if before[name] != values[name]]
    if created and changed:
        portfolio = raw['oss_portfolio'] = {}
        changelog.append('saved portfolio: created')
    for name in changed:
        _put(portfolio, (TEXTS.get(name) or LISTS[name])[0], values[name])
    changelog.extend(f'saved portfolio: {WORDS[name]} changed' for name in changed)
    return bool(changed)


def check_budget(raw: dict, before: dict) -> None:
    """@description Job scoring reads the whole main résumé, saved portfolio included, and refuses one over 128 KiB, so
    a portfolio change that would grow it past that is refused in words before anything is saved.
    @param raw the main résumé after the change @param before the one before @returns None; raises PortfolioRefusal"""
    after = engagements.scoring_bytes(raw)
    if after > engagements.SCORING_MAX_BYTES and after > engagements.scoring_bytes(before):
        raise PortfolioRefusal(f'Career scores jobs against your whole main résumé, which can be at most '
                               f'{engagements.SCORING_MAX_BYTES // 1024} KB; with this portfolio it would be {after // 1024} KB. '
                               f'Shorten it, then save again.')
