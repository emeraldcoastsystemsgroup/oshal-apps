# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24 (Roger, 2026-11-19: "i have to be able to generate accurate resumes ... i cant have random numbers 2 years vs 11 years vs 20 years getting out of place"). Résumé generation has read a person's own years (`years_by_skill`, `career_years`) since 1.68.22, and no screen wrote them. This is the engine half of Work history's Years by skill section: the read (field `years` of GET /resume/master-section) lists every skill with the years counted from the roles, the person's own figure and what a résumé states, taken from the same table generation reads (skill_tenure.compute_tenure with years_truth.overlay), so the screen cannot show a figure generation would not use; the save (an edit of field `years` of POST /resume/master-edit, master_edit.apply_edits) checks the whole form first, refuses it whole in words that name the row, passes every row through the generation reader so nothing is saved that generation would ignore, and writes exactly those two keys through the same backup, audit and atomic publish as every main-résumé edit, so Undo puts the earlier version back.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.76.1: the screen states what a résumé now states. Once the person has stated any figure, a skill they gave no figure reads "No year count (you gave none)" and, with no total of their own, the total reads "No total (you gave none)"; a person with no figures keeps the counted spans and the roles' floor.
"""The person's own years by skill (`years_by_skill`) and in total (`career_years`), read and replaced whole, model-free."""
from __future__ import annotations

import json
import math
import re

from . import engagements, skill_tenure, years_truth

FIELD = 'years'
WRITES = ('years_by_skill', 'career_years')
MAX_ROWS = 40
NAME_MAX = 60
STEP = 0.5
SKILL_YEARS = (0.5, 60.0)
CAREER_YEARS = (1.0, 70.0)
# A year count is stated for a skill counted from the roles only from this many whole years (skill_tenure.prompt_block).
STATED_FROM = 2
CONTROL = re.compile(r'[\u0000-\u001f\u007f-\u009f]')
MOVED = ('Your main résumé changed after this form was opened, so nothing was saved. '
         'Your years have been read again as saved; make the change again.')


class YearsRefusal(ValueError):
    """A years save that cannot be made, in words a person reads (master_edit adds that nothing was saved)."""


def touches(edits) -> bool:
    """@description Whether a main-résumé patch replaces the person's years. @param edits the patch's edits
    @returns bool"""
    return isinstance(edits, list) and any(isinstance(edit, dict) and edit.get('field') == FIELD for edit in edits)


def _plain(value):
    """A years figure as it is kept and shown: a whole number as an int, anything else to one decimal."""
    number = float(value)
    return int(number) if number.is_integer() else round(number, 1)


def _years_words(value) -> str:
    return f'{value} year' if value == 1 else f'{value} years'


def _tables(raw: dict) -> tuple:
    """The main résumé without the person's figures; the tenure table counted from it; and that table with the
    person's figures laid over it exactly as résumé generation reads it (compute_tenure ends in this overlay)."""
    roles_only = {key: value for key, value in raw.items() if key not in WRITES}
    counted = skill_tenure.compute_tenure(roles_only)
    return roles_only, counted, years_truth.overlay(counted, raw)


def _row(key: str, record: dict, counted: dict, stated: bool = False) -> dict:
    """One skill of the table generation reads: the years counted from the roles, the person's figure, and what a
    résumé states (the person's figure exactly; once they stated any figure, no count for a skill they gave none;
    else at most the whole years counted, and no count under two)."""
    own = record.get('source') == 'person'
    roles = counted.get(key) if own else record
    row = {'skill': str(record.get('display') or key), 'from_roles': _plain(roles['years']) if roles else None,
           'yours': _plain(record['years']) if own else None}
    whole = int(record.get('floor_years') or 0)
    if own:
        row.update(used=row['yours'], used_words=_years_words(row['yours']))
    elif stated:
        row.update(used=None, used_words='No year count (you gave none)')
    elif whole >= STATED_FROM:
        row.update(used=whole, used_words=f'Up to {whole} years')
    else:
        row.update(used=None, used_words=f'No year count (under {STATED_FROM} years)')
    return row


def _career(roles_only: dict, counted: dict, raw: dict) -> dict:
    """The total: counted from the roles' dates, the person's figure, and what a résumé states. The person's figure is
    stated exactly. With none, the last pass over a generated packet (years_truth.enforce) holds the total to the
    whole years the roles give as a floor, and lets "over N years" stand for that total rounded down to five; both
    are asked of that pass's own rule here, so the screen and the pass cannot part."""
    from_roles = _plain(counted['total_career_years_exact']) if int(counted.get('total_career_months') or 0) > 0 else None
    yours = years_truth.figures(raw)['career']
    answer = {'career_from_roles': from_roles, 'career_yours': None if yours is None else _plain(yours)}
    if yours is not None:
        return {**answer, 'career_used': _plain(yours), 'career_used_words': _years_words(_plain(yours))}
    if years_truth._stated(years_truth.figures(raw)):
        return {**answer, 'career_used': None, 'career_used_words': 'No total (you gave none)'}
    held = {'career': None, 'roles_career': years_truth._roles_career(roles_only)}
    floor = years_truth._career(held, 0.0, False)[0]
    if not floor:
        return {**answer, 'career_used': None, 'career_used_words': 'No figure yet'}
    whole = int(floor)
    band = whole // 5 * 5
    words = f'At least {_years_words(whole)}'
    if 0 < band < whole and years_truth._career(held, float(band), True)[1]:
        words += f', or "over {band} years"'
    return {**answer, 'career_used': whole, 'career_used_words': words}


def _size(value) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def _listed(rows: list, room: int) -> tuple:
    """Every skill the person gave a figure for, and of the rest, in their order, as many as the read may carry."""
    kept, more = [], 0
    for row in rows:
        cost = _size(row) + 1
        if row['yours'] is None and (more or cost > room):
            more += 1
            continue
        kept.append(row)
        room -= cost
    return kept, more


def read_section(raw: dict, revision: str, max_bytes: int = 12 * 1024) -> dict:
    """@description The answer to GET /resume/master-section?field=years: one row per skill of the table résumé
    generation reads (skills counted from the roles and skills the person stated), each {skill, from_roles, yours,
    used, used_words}, most years used first then by name; the same for the total (career_*); `more`, the count of
    skills counted from the roles that did not fit the read; and the main résumé's exact revision. The years counted
    from the roles are the main résumé's own (a packet that also carries chosen Other experience may count more).
    @param raw the parsed main résumé @param revision its exact revision @param max_bytes what the read may carry
    @returns dict"""
    roles_only, counted, stated = _tables(raw)
    counted_skills = counted.get('skills') or {}
    own = years_truth._stated(years_truth.figures(raw))
    rows = [_row(key, record, counted_skills, own) for key, record in (stated.get('skills') or {}).items()]
    rows.sort(key=lambda row: (row['used'] is None, -(row['used'] or 0), row['skill'].casefold(), row['skill']))
    result = {'ok': True, 'revision': revision, 'field': FIELD, 'rows': [], 'more': 0, **_career(roles_only, counted, raw),
              'limits': limits()}
    result['rows'], result['more'] = _listed(rows, max_bytes - _size(result))
    return result


def limits() -> dict:
    """@description What the form may hold, so the page and the engine keep one rule. @returns dict"""
    return {'rows': MAX_ROWS, 'name': NAME_MAX,
            'skill_years': {'min': SKILL_YEARS[0], 'max': _plain(SKILL_YEARS[1]), 'step': STEP},
            'career_years': {'min': _plain(CAREER_YEARS[0]), 'max': _plain(CAREER_YEARS[1]), 'step': STEP}}


def _years(value, bounds: tuple, what: str):
    """A years figure within its bounds, in steps of a half; refused in words that begin with what it is."""
    low, high = _plain(bounds[0]), _plain(bounds[1])
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise YearsRefusal(f'{what} must be a number from {low} to {high}, in steps of {STEP}.')
    steps = value / STEP
    if not bounds[0] <= value <= bounds[1] or steps != int(steps):
        raise YearsRefusal(f'{what} must be from {low} to {high}, in steps of {STEP}; it is {value}.')
    return _plain(value)


def _name(number: int, row) -> str:
    if not isinstance(row, dict) or set(row) != {'skill', 'years'}:
        raise YearsRefusal(f'Row {number} of your years by skill must hold a skill and its years, and nothing else.')
    if not isinstance(row['skill'], str):
        raise YearsRefusal(f'The skill of row {number} must be text.')
    name = row['skill'].strip()
    if not name:
        raise YearsRefusal(f'Row {number} has no skill name. Name the skill, or clear its years.')
    if CONTROL.search(name):
        raise YearsRefusal(f'The skill of row {number} holds a character that cannot be saved.')
    if len(name) > NAME_MAX:
        raise YearsRefusal(f'The skill of row {number} ({name[:30]}…) is longer than {NAME_MAX} characters.')
    return name


def _read_as(name: str, years) -> str | None:
    """The skill résumé generation takes a saved row to be (its key in the table years_truth.overlay writes), or None
    when generation would not read the row at all."""
    read = years_truth.overlay({'skills': {}}, {'years_by_skill': [{'skill': name, 'years': years}]}).get('skills') or {}
    return next(iter(read), None)


def _rows(value) -> list:
    if not isinstance(value, list):
        raise YearsRefusal('Your years by skill must be a list of skills and years.')
    if len(value) > MAX_ROWS:
        raise YearsRefusal(f'Keep at most {MAX_ROWS} skills with a figure of your own; this has {len(value)}.')
    rows, names, skills = [], {}, {}
    for number, row in enumerate(value, 1):
        name = _name(number, row)
        years = _years(row['years'], SKILL_YEARS, f'The years of row {number} ({name})')
        if name.casefold() in names:
            raise YearsRefusal(f'Row {number} ({name}) is the same skill as row {names[name.casefold()]}. List each skill once.')
        skill = _read_as(name, years)
        if skill is None:
            raise YearsRefusal(f'Row {number} ({name}) has no letters or digits to match in a résumé. Name the skill in words.')
        if skill in skills:
            raise YearsRefusal(f'Row {number} ({name}) is read as the same skill as row {skills[skill][0]} '
                               f'({skills[skill][1]}). List each skill once.')
        names[name.casefold()], skills[skill] = number, (number, name)
        rows.append({'skill': name, 'years': years})
    return rows


def checked(value) -> dict:
    """@description The whole years form, checked before anything is written: exactly `years_by_skill` and
    `career_years`; at most 40 rows, each a skill name of 1 to 60 characters with no control character, named once
    (ignoring case, and once as generation reads it), with years from 0.5 to 60 in steps of 0.5; the total null or
    from 1 to 70 in steps of 0.5. Every figure is one résumé generation reads back as written.
    @param value the edit's value @returns {years_by_skill, career_years}; raises YearsRefusal naming the row"""
    if not isinstance(value, dict) or set(value) != set(WRITES):
        raise YearsRefusal('Save the whole years form: your years by skill and your years in total, and nothing else.')
    rows = _rows(value['years_by_skill'])
    career = value['career_years']
    if career is not None:
        career = _years(career, CAREER_YEARS, 'Your years of experience in total')
        if years_truth.figures({'career_years': career})['career'] != career:
            raise YearsRefusal('Your years of experience in total cannot be read back as written.')
    return {'years_by_skill': rows, 'career_years': career}


def apply_edit(raw: dict, edit: dict, changelog: list) -> bool:
    """@description One years replacement inside a main-résumé patch: `{op: 'set', field: 'years', value}` (an
    optional `summary` line is allowed). Writes exactly `years_by_skill` (removed when the list is empty) and
    `career_years` (removed when null); every other key of the main résumé is left as it is.
    @param raw the parsed main résumé, changed in place @param edit the edit @param changelog lines for the audit
    @returns whether anything changed; raises YearsRefusal"""
    if set(edit) - {'op', 'field', 'value', 'summary'} or edit.get('op') != 'set':
        raise YearsRefusal('A years change replaces the whole form, and carries nothing else.')
    if 'summary' in edit and (not isinstance(edit['summary'], str) or len(edit['summary']) > 300):
        raise YearsRefusal('Its summary must be one line of at most 300 characters.')
    values = checked(edit.get('value'))
    words = {'years_by_skill': 'years by skill', 'career_years': 'years of experience in total'}
    changed = False
    for key in WRITES:
        new, held = values[key], key in raw
        if new in (None, []):
            if held:
                del raw[key]
                changelog.append(f'{words[key]}: your figures removed')
                changed = True
        elif not held or raw[key] != new:
            raw[key] = new
            changelog.append(f'{words[key]}: {len(new)} stated' if key == 'years_by_skill' else f'{words[key]}: set to {new}')
            changed = True
    return changed


def check_budget(raw: dict, before: dict) -> None:
    """@description Job scoring reads the whole main résumé and refuses one over 128 KiB, so a years change that
    would grow it past that is refused in words before anything is saved.
    @param raw the main résumé after the change @param before the one before @returns None; raises YearsRefusal"""
    after = engagements.scoring_bytes(raw)
    if after > engagements.SCORING_MAX_BYTES and after > engagements.scoring_bytes(before):
        raise YearsRefusal(f'Career scores jobs against your whole main résumé, which can be at most '
                           f'{engagements.SCORING_MAX_BYTES // 1024} KB; with these years it would be {after // 1024} KB. '
                           f'Shorten it, then save again.')
