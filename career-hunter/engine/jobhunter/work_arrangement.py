# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Require affirmative workplace evidence for remote classification and prevent contradictory legacy flags from bypassing an owner's radius.
"""Conservative feed metadata classification; never infer workplace from a description."""
from __future__ import annotations

import re
import string

# Keep these rules in parity with career-search-scope.ts; shared fixtures exercise both SQLs.
_SEPARATORS = string.punctuation.replace('%', '') + '–—\t\n\r\u00a0\u202f\u2009'
_OCCUPATIONS = ('remote sensing', 'hybrid cloud', 'hybrid electric', 'hybrid vehicle')
_CONFLICTS = (
    'hybrid', 'onsite', 'on site', 'in office', 'office based',
    'not remote', 'not a remote', 'non remote', 'nonremote', 'no remote', 'not fully remote', 'not 100% remote',
    'remote unavailable', 'remote not', 'remote is not', 'remote work not', 'remote work is not', 'remote work unavailable',
    'no work from home', 'not work from home', 'no telework', 'not telework',
    'telework not', 'partial remote', 'partially remote', 'occasional remote',
)
_DAYS = ('1 day', '2 days', '3 days', '4 days', '5 days', '6 days',
         'one day', 'two days', 'three days', 'four days', 'five days', 'six days')
_CONFLICTS += tuple(term for days in _DAYS for term in (f'remote {days}', f'{days} remote'))
_POSITIVES = ('remote', 'work from home', 'work from anywhere', 'telework', 'telecommute', 'anywhere')


def _words(value):
    value = value.lower() if isinstance(value, str) else ''
    for separator in _SEPARATORS:
        value = value.replace(separator, ' ')
    # Three passes also keep the SQL expression bounded (up to eight adjacent spaces).
    for _ in range(3):
        value = value.replace('  ', ' ')
    return ' ' + value.strip() + ' '


def _workplace(words):
    for term in _OCCUPATIONS:
        words = words.replace(' ' + term + ' ', ' ')
    return words


def _contains(words, terms):
    return any(' ' + term + ' ' in words for term in terms)


def _conflicts(words):
    return ((bool(words.strip()) and '  ' in words) or _contains(words, _CONFLICTS)
            or ('%' in words and '%' in words.replace('100%', '')))


def structured_remote(value):
    """Only an explicit boolean (including common serialized forms) is authoritative."""
    if isinstance(value, bool):
        return value
    if type(value) is int and value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.lower() in ('true', 'false'):
        return value.lower() == 'true'
    return None


def looks_remote(*parts, verified=None):
    """A structured true is evidence; hybrid/negated/partial statements still win."""
    words = _workplace(_words(' '.join(part for part in parts if isinstance(part, str))))
    structured = structured_remote(verified)
    return int(structured is not False and not _conflicts(words) and (structured is True or _contains(words, _POSITIVES)))


def remote_location(location, *parts, verified=None):
    """Retain structured workplace evidence in the existing normalized location field.

    A bare stored boolean cannot later distinguish a true remote-sensing job from an old
    title false positive. Preserve the employer's structured true without adding a schema.
    """
    if (structured_remote(verified) is True and looks_remote(location, *parts, verified=verified)
            and not looks_remote(location)):
        return f'{location} / Remote' if location else 'Remote'
    return location


def _sql_workplace(words):
    for term in _OCCUPATIONS:
        words = f"REPLACE({words},' {term} ',' ')"
    return words


def _sql_contains(words, terms):
    def pattern(term):
        return '% ' + term.replace('!', '!!').replace('%', '!%').replace('_', '!_') + ' %'
    return '(' + ' OR '.join(f"{words} LIKE '{pattern(term)}' ESCAPE '!'" for term in terms) + ')'


def fully_remote_predicate(alias=''):
    """Narrow an existing flag; local eligibility remains a separate radius decision.

    Legacy remote-sensing flags need independent location evidence. We cannot recover
    their original structured provenance, and never rewrite the corpus during reads.
    Both the native SQLite and portable Postgres compatibility views expose remote 0/1.
    """
    if alias and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', alias):
        raise ValueError('Invalid posting alias')
    prefix = alias + '.' if alias else ''
    fields = {'title_words': prefix + 'title', 'location_words': prefix + 'location',
              'words': f"COALESCE({prefix}title,'') || ' ' || COALESCE({prefix}location,'')"}
    columns = ', '.join(f"LOWER(COALESCE({value},'')) AS {key}" for key, value in fields.items())
    stages = [f'workplace0 AS (SELECT {columns})']
    # Small CTE stages avoid SQLite's parser nesting limit without custom SQL functions.
    for offset in range(0, len(_SEPARATORS), 5):
        columns = []
        for key in fields:
            value = key
            for separator in _SEPARATORS[offset:offset+5]:
                escaped = separator.replace("'", "''")
                value = f"REPLACE({value},'{escaped}',' ')"
            columns.append(f'{value} AS {key}')
        stages.append(f"workplace{len(stages)} AS (SELECT {', '.join(columns)} FROM workplace{len(stages)-1})")
    columns = []
    for key in fields:
        value = key
        for _ in range(3):
            value = f"REPLACE({value},'  ',' ')"
        value = f"(' ' || TRIM({value}) || ' ')"
        columns.append(f'{value} AS {key}')
    stages.append(f"workplace{len(stages)} AS (SELECT {', '.join(columns)} FROM workplace{len(stages)-1})")
    # Compute normalized fields once per posting, rather than re-expanding them in every LIKE.
    stages.append(f'workplace AS MATERIALIZED (SELECT title_words, {_sql_workplace("location_words")} AS location_words, '
                  f'{_sql_workplace("words")} AS words FROM workplace{len(stages)-1})')
    conflicts = _sql_contains('workplace.words', _CONFLICTS)
    partial = "(workplace.words LIKE '%!%%' ESCAPE '!' AND REPLACE(workplace.words,'100%','') LIKE '%!%%' ESCAPE '!')"
    occupational = _sql_contains('workplace.title_words', ('remote sensing',))
    separate = _sql_contains('workplace.location_words', _POSITIVES)
    return (f'(COALESCE({prefix}remote,0)=1 AND EXISTS (WITH {", ".join(stages)} SELECT 1 FROM workplace '
            f"WHERE (TRIM(workplace.words)='' OR workplace.words NOT LIKE '%  %') AND NOT {conflicts} AND NOT {partial} AND (NOT {occupational} OR {separate})))")
