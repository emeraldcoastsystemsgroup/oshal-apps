# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Parse complete employer money tokens, explicit currencies and pay units without numeric floors or implicit annualization.
"""Conservative salary-field parsing. Ambiguous evidence stays raw and unnormalized."""
from __future__ import annotations

import math
import re

_CURRENCIES = {
    '$': 'USD', 'US$': 'USD', 'CA$': 'CAD', 'C$': 'CAD', 'AU$': 'AUD', 'A$': 'AUD',
    'NZ$': 'NZD', 'HK$': 'HKD', 'SG$': 'SGD', 'S$': 'SGD', '£': 'GBP', '€': 'EUR', '₹': 'INR',
}
_CODES = ('USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'GBP', 'EUR', 'INR', 'JPY', 'CHF',
          'SEK', 'NOK', 'DKK', 'CNY', 'BRL', 'MXN', 'ZAR', 'PLN', 'AED')
_CURRENCIES.update((code, code) for code in _CODES)
_PREFIX = '|'.join(re.escape(value) for value in sorted(_CURRENCIES, key=len, reverse=True))
# The trailing and leading guards forbid backtracking into a fraction or a grouped number.
_MONEY = re.compile(r'(?<![\w.,])(?:(?P<currency>' + _PREFIX + r')\s*)?'
                    r'(?P<number>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)'
                    r'\s*(?P<scale>k)?(?![\w.,])', re.I)
_NON_BASE = re.compile(r'\b(?:bonus(?:es)?|equity|stipends?|reimbursements?|allowances?|benefits?)\b', re.I)
_BASE_PAY = re.compile(r'\b(?:salary|salaries|base\s+pay|wages?)\b', re.I)
_UNIT_NAMES = r'credit\s+hours?|contact\s+hours?|hours?|hrs?|months?|mos?|years?|yrs?|annum|courses?|weeks?|wks?|days?|shifts?|semesters?|terms?'
_ADVERBS = r'hourly|monthly|annually|annual|yearly|weekly|daily|biweekly|fortnightly'
_RANGE = re.compile(r'\s*(?:(?:per\s+|/\s*)?(?:' + _UNIT_NAMES + '|' + _ADVERBS + r')\s*)?(?:[-–—]|to|through)\s*', re.I)
_UNIT = re.compile(r'\b(?P<adverb>hourly|monthly|annually|annual|yearly|weekly|daily|biweekly|fortnightly)\b'
                   r'|(?:\b(?:per|an?|each|every)\s+|/\s*)(?P<tag>' + _UNIT_NAMES + r')\b'
                   r'|\b(?P<tail>hour|hr|month|mo|year|yr|course|week|wk|day|shift|semester|term)\s*$', re.I)
_PERIODS = {
    **dict.fromkeys(('hour', 'hours', 'hourly', 'hr', 'hrs'), 'hour'),
    **dict.fromkeys(('month', 'months', 'monthly', 'mo', 'mos'), 'month'),
    **dict.fromkeys(('year', 'years', 'yearly', 'yr', 'yrs', 'annual', 'annually', 'annum'), 'year'),
    **dict.fromkeys(('course', 'courses'), 'course'),
}


def normalize_period(value):
    """Normalize an explicit provider unit; missing or unsupported units remain unknown."""
    return _PERIODS.get(value.strip().lower()) if isinstance(value, str) else None


def normalize_currency(value):
    return _CURRENCIES.get(value.strip().upper()) if isinstance(value, str) else None


def parse_salary(text, *, default_currency=None, default_period=None):
    """Keep the existing min/max/currency/period/raw contract, plus private unit provenance.

    Defaults require an explicit caller argument backed by the provider contract. An
    unsupported explicit unit always overrides a caller default with unknown. Bare $
    retains the existing USD convention; an unlabeled amount has no currency default.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    raw = text.strip()
    units = [normalize_period(match['adverb'] or match['tag'] or match['tail']) for match in _UNIT.finditer(raw)]
    period = units[0] if units and len(set(units)) == 1 else None
    basis = 'explicit' if period else 'unknown'
    if not units and normalize_period(default_period):
        period, basis = normalize_period(default_period), 'provider-default'
    matches = list(_MONEY.finditer(raw))
    if not matches:
        return None
    # Optional benefits after a bullet do not change a preceding pay quote. A benefit-
    # only field must not become salary authority merely because it contains dollars.
    primary = re.split(r'[•;\n]', raw, maxsplit=1)[0]
    if _NON_BASE.search(primary) and not _BASE_PAY.search(primary):
        return None
    empty = dict(min=None, max=None, currency=None, period=period, raw=raw, period_basis=basis)
    if len(set(units)) > 1:
        return empty  # Endpoints stated in different units are not a comparable range.
    pairs = [(a, b) for a, b in zip(matches, matches[1:]) if _RANGE.fullmatch(raw[a.end():b.start()])]
    if len(pairs) == 1:
        selected = pairs[0]
    elif not pairs:
        # Ignore unrelated unmarked counts (401(k), years of experience, etc.).
        monetary = [match for match in matches if match['currency'] or match['scale']]
        if len(monetary) == 1:
            selected = (monetary[0],)
        elif len(matches) == 1 and (period or normalize_currency(default_currency)):
            selected = (matches[0],)
        else:
            return empty if monetary else None
    else:
        return empty  # Multiple ranges cannot be reduced to a single base-pay quote.
    if not any(match['currency'] or match['scale'] for match in selected) and not (period or normalize_currency(default_currency)):
        return None
    currencies = {normalize_currency(match['currency']) for match in selected if match['currency']}
    if len(currencies) > 1:
        return empty
    currency = next(iter(currencies), normalize_currency(default_currency))
    # A negative first amount is not a range delimiter. Do not silently remove its sign.
    if re.search(r'(?:^|:|' + _PREFIX + r')\s*-\s*$', raw[:selected[0].start()], re.I):
        return empty
    values = [float(match['number'].replace(',', '')) * (1000 if match['scale'] else 1) for match in selected]
    if not all(math.isfinite(value) for value in values) or values[0] > values[-1]:
        return empty
    if len(selected) == 2 and bool(selected[0]['scale']) != bool(selected[1]['scale']):
        if any(not match['scale'] and value < 1000 for match, value in zip(selected, values)):
            return empty  # Do not invent a shared K suffix for an ambiguous endpoint.
    return dict(min=values[0], max=values[-1], currency=currency, period=period, raw=raw, period_basis=basis)


def has_salary_quote(raw):
    """Whether the raw field contains monetary pay evidence, rather than benefits prose.

    JSON-LD detail retains its original baseSalary object. Require its numeric value
    shape; ordinary arbitrary JSON/text is not salary authority.
    """
    if not isinstance(raw, str):
        return False
    if raw.lstrip().startswith('{'):
        import json
        try:
            value = json.loads(raw).get('value')
        except (ValueError, AttributeError):
            return False
        def number(item):
            try:
                return not isinstance(item, bool) and isinstance(item, (int, float, str)) and math.isfinite(float(item)) and float(item) >= 0
            except (ValueError, OverflowError):
                return False
        return isinstance(value, dict) and any(number(value.get(key)) for key in ('minValue', 'maxValue', 'value'))
    return parse_salary(raw) is not None
